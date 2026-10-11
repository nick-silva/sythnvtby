/**
 * The Project tool's view filters — eye, layer, worlds — the frame state handed to the compositor,
 * and the world debug readout. Split out of tools/painter.js, which passes in the state and functions it shares (initViewFilters).
 */
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { getBgAffineWorldClipRect, getWindowsTableBytesFromState } from '../../src/vip-world-clip.js';
import { brightnessReference, masterBrightnessLevels } from '../../src/fade.js';
import { normWorldKey } from './selection.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initViewFilters(context) {
  ctx = context;
}

/**
 * @param {MouseEvent|PointerEvent} e
 * @param {HTMLCanvasElement} target
 */
export function clientToVipFrame(e, target) {
  const r = target.getBoundingClientRect();
  const u = (e.clientX - r.left) / Math.max(1, r.width);
  const v = (e.clientY - r.top) / Math.max(1, r.height);
  if (ctx.zoomViewport) {
    const { x, y, w, h } = ctx.zoomViewport;
    return {
      px: Math.max(0, Math.min(ctx.W - 1, (x + u * w) | 0)),
      py: Math.max(0, Math.min(ctx.H - 1, (y + v * h) | 0)),
    };
  }
  return {
    px: Math.max(0, Math.min(ctx.W - 1, (u * ctx.W) | 0)),
    py: Math.max(0, Math.min(ctx.H - 1, (v * ctx.H) | 0)),
  };
}

export function drawEye(d) {
  const e = d.eye;
  if (e === 0 || e === 1) return e;
  const n = Number(e);
  return n === 0 || n === 1 ? n : 0;
}

export function getEye() {
  const v = ctx.eyeSelect?.value;
  const n = Number(v);
  return n === 1 ? 1 : 0;
}

export function getLayer() {
  const v = ctx.layerSelect?.value;
  if (v === 'all' || v === '' || v == null) return 'all';
  return Number(v);
}

/**
 * Layer + world strip only, optionally “filter view to group”. Paint hit-testing skips `viewGroupFilterId`
 * so the draw under the cursor is resolved against the full scene (still eye/layer/world UI filters).
 *
 * @param {import('../../src/vip-dump.js').VIPStateObject} state
 * @param {{ skipViewGroup?: boolean }} [opts]
 */
export function filterStateForView(state, opts = {}) {
  if (!state?.drawList?.length) return state;
  const layer = getLayer();
  let drawList = state.drawList.filter((d) => {
    if (layer !== 'all') {
      const L = d.layer !== undefined && d.layer !== null ? Number(d.layer) : undefined;
      if (L !== layer) return false;
    }
    if (ctx.worldFilter !== 'all') {
      const k = normWorldKey(d.world);
      if (!k || !ctx.worldFilter.has(k)) return false;
    }
    return true;
  });
  if (!opts.skipViewGroup && ctx.viewGroupFilterId && state.patternTable) {
    const g = ctx.groups.find((x) => x.id === ctx.viewGroupFilterId);
    const pt = state.patternTable;
    if (g && pt) {
      drawList = drawList.filter((d) => {
        const h = hashTile(getTileBytes(pt, d.tileIndex));
        return ctx.drawMatchesGroup(d, g, h);
      });
    }
  }
  return { ...state, drawList };
}

/**
 * VIP `world` is a window index; `compositeColorFrame` clips BG/Affine draws to that window’s rect.
 * When you filter to a single window, that rect can be empty on disk → every draw in that world is skipped
 * and the canvas looks blank. For authoring preview, drop the windows table while a world filter is active.
 *
 * @param {import('../../src/vip-dump.js').VIPStateObject} state
 */
/** The pack's normal brightness (src/fade.js), worked out once per frame list. */
let brightnessRefFor = /** @type {{ frames: any[], ref: number|null } | null} */ (null);
function packBrightnessReference() {
  if (brightnessRefFor?.frames !== ctx.availableFrames) {
    brightnessRefFor = { frames: ctx.availableFrames, ref: brightnessReference(masterBrightnessLevels(ctx.availableFrames.map((f) => f.json))) };
  }
  return brightnessRefFor.ref;
}

export function stateForComposite(state) {
  // Fades are measured against the game's normal brightness, so a game that always runs dim
  // still shows painted white as white.
  const filtered = state ? { ...filterStateForView(state), brightnessReference: packBrightnessReference() } : filterStateForView(state);
  if (ctx.worldFilter === 'all') return filtered;
  // Keep the table, though: affine worlds are drawn from it (src/affine-world.js), and without it
  // an isolated affine world fell back to rigid 8×8 tiles — a jumbled court in Mario's Tennis.
  // Every other world is marked OBJ-mode, which the clip and the samplers ignore: no clip for
  // plain backgrounds (what dropping the table did), and filtered-out affine worlds not drawn.
  const src = getWindowsTableBytesFromState(filtered);
  if (!src) return { ...filtered, windows: new Uint8Array(0) };
  const windows = Uint8Array.from(src);
  for (let w = 0; w < 32; w++) {
    const b = w * 32;
    const header = windows[b] | (windows[b + 1] << 8);
    if (header & 0x40) continue; // END stays where it is
    const affineShown = ((header >> 12) & 3) === 2 && ctx.worldFilter.has(normWorldKey(w));
    if (affineShown) continue;
    const obj = (header & ~0x3000) | 0x3000;
    windows[b] = obj & 0xff;
    windows[b + 1] = (obj >> 8) & 0xff;
  }
  return { ...filtered, windows };
}

function worldHistogramForEyeLayer() {
  /** @type {Map<string, number>} */
  const hist = new Map();
  if (!ctx.currentState?.drawList?.length) return { hist, eyeLayerTotal: 0 };
  const layer = getLayer();
  const eye = getEye();
  let eyeLayerTotal = 0;
  for (const d of ctx.currentState.drawList) {
    if (drawEye(d) !== eye) continue;
    if (layer !== 'all') {
      const L = d.layer !== undefined && d.layer !== null ? Number(d.layer) : undefined;
      if (L !== layer) continue;
    }
    eyeLayerTotal++;
    const key = d.world === undefined || d.world === null ? '—' : normWorldKey(d.world);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  return { hist, eyeLayerTotal };
}

function emptyWindowClipCountForWorlds(worldIds) {
  const wt = ctx.currentState ? getWindowsTableBytesFromState(ctx.currentState) : null;
  if (!wt) return { hasTable: false, empty: 0, checked: 0 };
  const eye = getEye();
  let empty = 0;
  let checked = 0;
  for (const id of worldIds) {
    const n = Number(id);
    if (!Number.isFinite(n) || n < 0 || n > 31) continue;
    checked++;
    const r = getBgAffineWorldClipRect(wt, n, eye);
    if (r && r.x0 > r.x1) empty++;
  }
  return { hasTable: true, empty, checked };
}

function logWorldDebugSnapshot(reason) {
  if (!ctx.painterWorldDebug || !ctx.currentState?.drawList) return;
  const { hist, eyeLayerTotal } = worldHistogramForEyeLayer();
  const filtered = filterStateForView(ctx.currentState);
  const parts = [...hist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`);
  console.debug(`[painter world] ${reason}`, {
    eye: getEye(),
    layer: getLayer(),
    worldFilter: ctx.worldFilter === 'all' ? 'all' : [...ctx.worldFilter].sort().join(','),
    eyeLayerDraws: eyeLayerTotal,
    filteredDraws: filtered.drawList?.length ?? 0,
    histogram: parts.join(' '),
  });
}

export function updateWorldFilterDebug() {
  ctx.syncWorldButtons();
  if (!ctx.worldFilterDebug) return;
  if (!ctx.currentState?.drawList?.length) {
    ctx.worldFilterDebug.textContent = '';
    if (ctx.painterWorldDebug) console.debug('[painter world] no frame loaded');
    return;
  }
  const { hist, eyeLayerTotal } = worldHistogramForEyeLayer();
  const filtered = filterStateForView(ctx.currentState);
  const nFilt = filtered.drawList?.length ?? 0;
  const top = [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}:${v}`)
    .join(' · ');
  const more = hist.size > 6 ? ` · +${hist.size - 6} more` : '';
  if (ctx.worldFilter === 'all') {
    ctx.worldFilterDebug.innerHTML = `<span class="muted">Worlds in frame (eye+layer): ${eyeLayerTotal} draws — ${ctx.escapeHtml(top)}${ctx.escapeHtml(more)}</span>`;
    if (ctx.painterWorldDebug) logWorldDebugSnapshot('world-all');
    return;
  }
  const ids = [...ctx.worldFilter].sort((a, b) => Number(a) - Number(b));
  const clipInfo = emptyWindowClipCountForWorlds(ids);
  const clipNote =
    clipInfo.hasTable && clipInfo.checked
      ? ` VIP table: <strong>${clipInfo.empty}</strong>/${clipInfo.checked} selected window(s) have an empty clip (would blank BG/Affine in strict mode).`
      : '';
  ctx.worldFilterDebug.innerHTML = `<span class="muted">Filter <strong>${ctx.escapeHtml(ids.join(', '))}</strong> → <strong>${nFilt}</strong> draws · preview skips VIP window clip · no-pack mono uses stack depth <strong>1</strong> + <strong>red diagnostic ramp</strong> (main app uses depth 2 + grayscale).${clipNote} Histogram: ${ctx.escapeHtml(top)}${ctx.escapeHtml(more)}</span>`;
  if (ctx.painterWorldDebug) logWorldDebugSnapshot('world-filter');
}
