/**
 * The Project tool's paint target: which group a draw belongs to, where a zoom-paint stroke goes
 * (or why it can't), selecting matching tiles, and the draw stack panel. Split out of tools/painter.js, which passes in the state and functions it shares (initZoomTarget).
 */
import { getTileBytes, hashTile, tileLocalFromVip, isBlankTile } from '../../src/vip-state.js';
import { layerArtOf } from '../../src/layer-art.js';
import { updatePaintV2TopButton } from './pack-rules.js';
import { fullDrawIndexFromDraw, refreshInspectorFromSelection, syncLastTopTileFromSelection, updateSelectionUi } from './selection.js';
import { drawEye, filterStateForView, getEye } from './view-filters.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initZoomTarget(context) {
  ctx = context;
}

/**
 * @param {import('../../src/vip-dump.js').DrawCall} draw
 * @param {{ criteria?: { windowIds?: unknown[], worldIds?: unknown[], hashes?: unknown[], layers?: unknown[] } }} group
 * @param {number} hash
 */
export function drawMatchesGroup(draw, group, hash) {
  const c = group.criteria || {};
  const windowIds = Array.isArray(c.windowIds)
    ? c.windowIds
    : (Array.isArray(c.worldIds) ? c.worldIds : []);
  const hashes = c.hashes;
  const layers = c.layers;
  if (windowIds != null && windowIds.length > 0) {
    const w = draw.world;
    if (w === undefined || w === null) return false;
    if (!windowIds.includes(w)) return false;
  }
  // An animated-tiles group also claims its tile slots, whatever pattern the game wrote there.
  const slots = Array.isArray(c.tileSlots) ? c.tileSlots : null;
  if (hashes != null && hashes.length > 0 && !hashes.includes(hash) && !(slots && slots.includes(draw.tileIndex))) return false;
  if (layers != null && layers.length > 0) {
    const L = draw.layer;
    if (L === undefined || L === null) return false;
    // A background group also covers its worlds when the game scales them (affine, layer 1):
    // the same tiles switch between the two modes (the Clash Tower zoom).
    if (!layers.includes(L) && !(L === 1 && layers.includes(0))) return false;
  }
  return true;
}

/**
 * Full-frame draw indices for the active eye that match `g` (same rules as {@link countDrawsMatchingGroup}).
 * @param {typeof groups[0]} g
 * @returns {number[]}
 */
export function collectFullFrameIndicesMatchingGroup(g) {
  if (!ctx.currentState?.drawList || !ctx.currentState.patternTable) return [];
  const pt = ctx.currentState.patternTable;
  const eye = getEye();
  /** @type {number[]} */
  const out = [];
  for (let fi = 0; fi < ctx.currentState.drawList.length; fi++) {
    const d = ctx.currentState.drawList[fi];
    if (!d || drawEye(d) !== eye) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex));
    if (drawMatchesGroup(d, g, h)) out.push(fi);
  }
  return out;
}

export function getSelectedPaintGroupOrNull() {
  if (!ctx.selectedGroupId) return null;
  return ctx.groups.find((x) => x.id === ctx.selectedGroupId) ?? null;
}

/** True when the group is tied to the reserved universal pool or a pool marked `universal` (no RAM gate). */
function isUniversalPaintGroup(g) {
  const sid = typeof g?.statePoolId === 'string' ? g.statePoolId.trim() : '';
  if (sid === '__universal__') return true;
  const pool = Array.isArray(ctx.gameStatePools)
    ? ctx.gameStatePools.find((p) => p && typeof p.id === 'string' && p.id.trim() === sid)
    : undefined;
  return pool?.universal === true;
}

/** @returns {string|null} null = fill (any view) / zoom brush may run */
export function getZoomPaintBlockedReason() {
  const g = getSelectedPaintGroupOrNull();
  if (!g) return 'Select a group before painting (click a row in the Groups panel).';
  if (isUniversalPaintGroup(g)) return 'Painting is disabled for the universal pool — choose another group.';
  if (layerArtOf(g)?.hideTiles) return `“${g.name || g.id}”’s tiles are hidden under its overpaint — paint the picture in SpriteStudio.`;
  return null;
}

/** @param {typeof groups[0]} g */
export function findAnchorDrawForGroup(g) {
  if (!ctx.currentState?.drawList || !ctx.currentState.patternTable) return null;
  if (typeof g.anchorHash !== 'number' || !Number.isFinite(g.anchorHash)) return null;
  const ah = g.anchorHash >>> 0;
  const pt = ctx.currentState.patternTable;
  const eye = getEye();
  for (const fi of collectFullFrameIndicesMatchingGroup(g)) {
    const d = ctx.currentState.drawList[fi];
    if (!d || drawEye(d) !== eye) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex)) >>> 0;
    if (h === ah) return d;
  }
  return null;
}

/**
 * Zoom paint uses a 1:1 VIP overlay only when the group has an anchor **and** that
 * pattern appears once in its world+layer on this eye. If the same hash is reused
 * (copies), paint stays on per-hash tile8 so every matching draw updates together.
 * The anchor still highlights all copies (green) for macro / placement identity.
 * @param {typeof groups[0]} g
 */
/**
 * Where paint goes: always the group's tile colours now, reused wherever its patterns appear.
 * "This spot only" paint is a touch-up (src/touch-up.js), made in SpriteStudio; a unique anchor
 * no longer silently switches painting to a screen-pinned overlay.
 */
export function useVipOverlayForZoomPaint(_g) {
  return false;
}

/** An old overlay is shown while its group's anchor is unique on this frame and eye. */
export function legacyOverlayShowing(g) {
  if (typeof g.anchorHash !== 'number' || !Number.isFinite(g.anchorHash)) return false;
  const da = findAnchorDrawForGroup(g);
  if (!da) return false;
  return ctx.countSameHashWorldLayerEye(da, g.anchorHash >>> 0) === 1;
}

/**
 * Frontmost (on top) draw in the filtered VIP stack at this pixel that belongs to `g`.
 * @param {number} vx
 * @param {number} vy
 * @param {typeof groups[0]} g
 * @returns {import('../../src/vip-dump.js').DrawCall | null}
 */
export function findFrontmostGroupDrawAtVip(vx, vy, g) {
  if (!ctx.currentState?.patternTable) return null;
  const pt = ctx.currentState.patternTable;
  const state = filterStateForView(ctx.currentState, { skipViewGroup: true });
  const drawList = state.drawList;
  const eye = getEye();
  const sorted = ctx.collectVisibleIndicesForHit(state).filter((i) => drawEye(drawList[i]) === eye);
  const affine = ctx.affineMapForEye();
  for (let k = sorted.length - 1; k >= 0; k--) {
    const i = sorted[k];
    const d = drawList[i];
    if (!d) continue;
    if (ctx.isAffineRecord(d, affine)) {
      // On a scaled layer a tile is under the pointer when that pixel reads it.
      if (affine.get(d.world).char[vy * ctx.W + vx] !== d.tileIndex) continue;
    } else if (vx < d.x || vx >= d.x + 8 || vy < d.y || vy >= d.y + 8) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex)) >>> 0;
    if (!drawMatchesGroup(d, g, h)) continue;
    return d;
  }
  return null;
}

/** Local 8×8 texel under a VIP pixel for a draw: the VIP's own sampling on a scaled layer. */
function drawLocalAtVip(d, vx, vy) {
  const affine = ctx.affineMapForEye();
  if (ctx.isAffineRecord(d, affine)) {
    const px = affine.get(d.world);
    const p = vy * ctx.W + vx;
    return px.char[p] === d.tileIndex ? { lx: px.tx[p], ly: px.ty[p] } : null;
  }
  return tileLocalFromVip(d, vx, vy);
}

/**
 * Pattern hash + tile bytes + local 8×8 coords for the tile you paint (per draw in the group). Macro/anchor export is separate.
 * @param {number} vx
 * @param {number} vy
 * @param {typeof groups[0]} g
 * @returns {{ hash: number, tileBytes: Uint8Array, lx: number, ly: number } | null}
 */
export function resolveZoomPaintTileContext(vx, vy, g) {
  if (!ctx.currentState?.patternTable) return null;
  const pt = ctx.currentState.patternTable;
  const d = findFrontmostGroupDrawAtVip(vx, vy, g);
  if (d) {
    const local = drawLocalAtVip(d, vx, vy);
    if (!local) return null;
    const tileBytes = getTileBytes(pt, d.tileIndex);
    const hash = hashTile(tileBytes) >>> 0;
    return { hash, tileBytes, ...local };
  }
  const da = findAnchorDrawForGroup(g);
  const anchorLocal = da ? drawLocalAtVip(da, vx, vy) : null;
  if (anchorLocal) {
    const tileBytes = getTileBytes(pt, da.tileIndex);
    const hash = hashTile(tileBytes) >>> 0;
    return { hash, tileBytes, ...anchorLocal };
  }
  return null;
}

/**
 * Select every full-frame draw index that matches the group (current eye). Does not change filters or zoom.
 * @param {typeof groups[0]} g
 */
/**
 * Select every draw on this eye whose tile pattern matches the one selected tile (view filters and
 * the blank-tile rule still apply). The fast way to find every place a pattern is reused.
 */
export function selectAllMatchingSelectedTile() {
  if (!ctx.currentState?.patternTable || ctx.selectedDrawFullIndices.size !== 1) {
    ctx.setStatus('Select exactly one tile first, then Select matching.');
    return;
  }
  const [only] = [...ctx.selectedDrawFullIndices];
  const pt = ctx.currentState.patternTable;
  const target = hashTile(getTileBytes(pt, ctx.currentState.drawList[only].tileIndex)) >>> 0;
  const view = filterStateForView(ctx.currentState);
  const eye = getEye();
  const found = [];
  for (const d of view.drawList) {
    if (drawEye(d) !== eye) continue;
    if (!ctx.includeBlankTiles && ctx.isBlankDraw(d)) continue;
    if ((hashTile(getTileBytes(pt, d.tileIndex)) >>> 0) !== target) continue;
    const fi = fullDrawIndexFromDraw(d);
    if (fi >= 0) found.push(fi);
  }
  ctx.selectedDrawFullIndices.clear();
  for (const fi of found) ctx.selectedDrawFullIndices.add(fi);
  syncLastTopTileFromSelection();
  ctx.drawSelectionOverlay();
  updateSelectionUi();
  refreshInspectorFromSelection();
  updatePaintV2TopButton();
  ctx.setStatus(`Selected ${found.length} draw(s) sharing pattern #${target.toString(16).toUpperCase()} on this eye.`);
}

/** List every draw stacked at a VIP pixel (front first) for debugging and isolation. */
export function updateDrawStackPanel(vx, vy) {
  const panel = document.getElementById('draw-stack-panel');
  if (!panel) return;
  if (!ctx.stackPanelEnabled || !ctx.currentState?.patternTable) {
    panel.innerHTML = '';
    return;
  }
  const view = filterStateForView(ctx.currentState);
  const hits = ctx.hitDrawIndices(vx, vy);
  const pt = ctx.currentState.patternTable;
  if (!hits.length) {
    panel.innerHTML = `<span class="muted">Nothing at ${vx},${vy}.</span>`;
    return;
  }
  const rows = hits.map((i, n) => {
    const d = view.drawList[i];
    const tb = getTileBytes(pt, d.tileIndex);
    const h = hashTile(tb) >>> 0;
    const layer = d.layer === 0 ? 'BG' : d.layer === 1 ? 'Affine' : d.layer === 2 ? 'OBJ' : '?';
    const owner = ctx.groups.find((g) => drawMatchesGroup(d, g, h));
    const fi = fullDrawIndexFromDraw(d);
    return `<button type="button" class="stack-row" data-full-index="${fi}" title="Select this draw">
      <span>${n === 0 ? 'front' : `#${n + 1}`}</span>
      <span>${layer} w${d.world ?? '—'}</span>
      <span>tile ${d.tileIndex}</span>
      <span class="muted">#${h.toString(16).toUpperCase().slice(0, 6)}${isBlankTile(tb) ? ' blank' : ''}</span>
      <span class="muted">${owner ? ctx.escapeHtml(owner.name || owner.id) : '—'}</span>
    </button>`;
  });
  panel.innerHTML = `<div class="stack-list">${rows.join('')}</div>`;
  panel.querySelectorAll('.stack-row').forEach((row) => {
    row.addEventListener('click', () => {
      const fi = Number(row.getAttribute('data-full-index'));
      if (!Number.isFinite(fi) || fi < 0) return;
      ctx.selectedDrawFullIndices.clear();
      ctx.selectedDrawFullIndices.add(fi);
      syncLastTopTileFromSelection();
      ctx.drawSelectionOverlay();
      updateSelectionUi();
      refreshInspectorFromSelection();
    });
  });
}
