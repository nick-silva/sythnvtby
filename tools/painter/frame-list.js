/**
 * The Project tool's frame list: loading a frame's VIP state, the frame dropdown with its filters
 * and highlights, stepping between frames. Split out of tools/painter.js, which passes in the state and functions it shares (initFrameList).
 */
import { measureUncoloured, UNCOLOURED_FILTERS, describeUncoloured, uncolouredMasks, highlightUncoloured } from '../../src/uncoloured.js';
import { deserializeVIPState, validateVIPState } from '../../src/vip-dump.js';
import { getCompositePixelInfo } from '../../src/color-layer.js';
import { affineStandInDraws } from '../../src/affine-world.js';
import { findPoolVariantForFrameByRam, isCurrentFrameRow, wramForFrameIndex } from './frame-data.js';
import { getActiveV2VariantId, syncV2VariantSelect, updatePaintV2TopButton } from './pack-rules.js';
import { clearSelection } from './selection.js';
import { updateGroupDetail } from './group-detail.js';
import { updateGroupsPoolContextHint } from './pools.js';
import { updateGroupsPanel, updatePoolSummary } from './groups-panel.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initFrameList(context) {
  ctx = context;
}

/**
 * @param {string} jsonStr
 */
export function loadVipFromJson(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
    const v = validateVIPState(obj);
    if (!v.valid) {
      ctx.setStatus(`Invalid VIP: ${v.errors.join('; ')}`);
      ctx.currentState = null;
      ctx.clearVipAuthoringOverlay();
      clearSelection();
      updatePaintV2TopButton();
      updateGroupsPoolContextHint();
      return;
    }
    ctx.currentState = deserializeVIPState(obj);
    const coreDraws = ctx.currentState.drawList?.length ?? 0;
    // Affine tiles the core never recorded (shrunk, or on rotated lines) get in-memory stand-ins,
    // so every tile on screen can be clicked, dragged and grouped. Appended, so core indices
    // keep their meaning; never saved (see preparePainterVbpackParts).
    const standIns = affineStandInDraws(ctx.currentState);
    if (standIns.length) ctx.currentState = { ...ctx.currentState, drawList: ctx.currentState.drawList.concat(standIns) };
    ctx.setStatus(`Frame loaded · ${coreDraws} draws`);
    if (ctx.btnReload) ctx.btnReload.disabled = false;
    // Per-frame authoring: switching VIP state drops overlay buffers (pack load re-applies painter-v2-vip-overlays.json after this).
    ctx.clearVipAuthoringOverlay();
    clearSelection();
    ctx.v2Tile8VariantOverride = null;
    ctx.selectedGroupId = null;
    ctx.viewGroupFilterId = null;
    syncV2VariantSelect();
    updateGroupsPanel();
    updatePoolSummary();
    updateGroupDetail(null);
    ctx.render();
    updatePaintV2TopButton();
    updateGroupsPoolContextHint();
  } catch (e) {
    ctx.setStatus(`VIP parse error: ${e?.message || String(e)}`);
    ctx.currentState = null;
    ctx.clearVipAuthoringOverlay();
    clearSelection();
    updatePaintV2TopButton();
    updateGroupsPoolContextHint();
  }
}

/**
 * Step to the previous/next frame through the same path as picking it from the
 * dropdown, so everything a frame change resets still resets.
 * @param {number} delta
 */
/* Frame list filter (Show: all / uncoloured tiles / uncoloured pixels, src/uncoloured.js). */
export const FRAME_FILTER_KEY = 'painter.frameFilter';
export let frameFilter = (() => {
  try {
    const v = localStorage.getItem(FRAME_FILTER_KEY);
    return v && UNCOLOURED_FILTERS[v] ? v : 'all';
  } catch {
    return 'all';
  }
})();

/** @param {string} value a key of UNCOLOURED_FILTERS, or 'all' */
export function setFrameFilter(value) {
  frameFilter = value;
}

/** Highlight (with a Show filter on): mark what is uncoloured on the frame on screen. */
const FRAME_HIGHLIGHT_KEY = 'painter.frameHighlight';
export let frameHighlight = (() => {
  try {
    return localStorage.getItem(FRAME_HIGHLIGHT_KEY) === '1';
  } catch {
    return false;
  }
})();

/** The Highlight box shows only while a Show filter is on. */
export function syncFrameHighlightUi() {
  const wrap = document.getElementById('frame-highlight-wrap');
  const box = /** @type {HTMLInputElement|null} */ (document.getElementById('frame-highlight'));
  if (wrap) wrap.hidden = frameFilter === 'all';
  if (box) box.checked = frameHighlight;
}

export function setFrameHighlight(on) {
  frameHighlight = on;
  try {
    localStorage.setItem(FRAME_HIGHLIGHT_KEY, on ? '1' : '0');
  } catch {
    /* the toggle just isn't remembered */
  }
  syncFrameHighlightUi();
  ctx.render();
}

/**
 * Highlight what the Show filter is about on the composite just drawn (src/uncoloured.js): tiles
 * with no paint at all, or every lit pixel nothing colours. Counts what this view shows.
 */
export function applyFrameHighlight(imageData, viewState) {
  const note = document.getElementById('frame-highlight-note');
  if (frameFilter === 'all' || !frameHighlight) {
    if (note) note.textContent = '';
    return;
  }
  const m = uncolouredMasks(viewState, getCompositePixelInfo());
  const tiles = frameFilter === 'tiles';
  highlightUncoloured(imageData, tiles ? m.tileMask : m.pixelMask);
  if (note) {
    note.textContent = tiles
      ? (m.tiles ? `${m.tiles} unpainted tile${m.tiles === 1 ? '' : 's'} here` : 'no unpainted tiles here')
      : (m.pixels ? `${m.pixels} uncoloured px here` : 'nothing uncoloured here');
  }
}

/** Each frame's measurement, and the paint it was measured against. */
let frameMeasure = { sig: '', list: /** @type {Array<{ tiles: number, pixels: number } | null>} */ ([]) };
const paintEditIds = new WeakMap();
let paintEditNext = 1;

/** A stamp that changes whenever paint may have: another pack, a stroke or undo, groups edited. */
function paintSignature() {
  const id = (o) => {
    if (!o) return 0;
    if (!paintEditIds.has(o)) paintEditIds.set(o, paintEditNext++);
    return paintEditIds.get(o);
  };
  const crit = ctx.groups.reduce((n, g) => n + (g?.criteria?.hashes?.length || 0) + (g?.criteria?.windowIds?.length || 0), 0);
  const screens = ctx.groups.map((g) => (g?.screens ? `${g.id}:${JSON.stringify(g.screens)}` : '')).join('');
  const top = ctx.paintUndoStack[ctx.paintUndoStack.length - 1];
  return [id(ctx.loadedPackParts), ctx.paintUndoStack.length, id(top), ctx.pack.size, ctx.groups.length, crit, ctx.availableFrames.length, id(ctx.gameStatePools), screens].join('|');
}

/** What colours a frame, as the preview has it. */
export function paintForMeasure() {
  return { pack: ctx.pack, overrides: ctx.overrides, groups: ctx.groups, gameStatePools: ctx.gameStatePools, painterV2Rules: ctx.painterV2Rules, variantId: getActiveV2VariantId() };
}

/** How uncoloured each frame is (recounted only when the paint changed). */
function frameMeasurements(force = false) {
  const sig = paintSignature();
  if (!force && frameMeasure.sig === sig && frameMeasure.list.length === ctx.availableFrames.length) return frameMeasure.list;
  const paint = paintForMeasure();
  const list = ctx.availableFrames.map((row, i) => {
    try {
      return measureUncoloured(deserializeVIPState(JSON.parse(row.json)), { ...paint, wram: wramForFrameIndex(i) });
    } catch {
      return null;
    }
  });
  frameMeasure = { sig, list };
  return list;
}

/**
 * Hide the frames the Show filter leaves out (the one you are on always stays), and note each
 * shown frame's uncoloured tiles and pixels. Options keep their frame index as value, so
 * everything that picks a frame by number still works.
 */
export function applyFrameFilter(force = false) {
  if (!ctx.frameSelect) return;
  const filter = UNCOLOURED_FILTERS[frameFilter] || UNCOLOURED_FILTERS.all;
  const list = frameFilter === 'all' ? null : frameMeasurements(force);
  const cur = ctx.frameSelect.value;
  for (const o of ctx.frameSelect.options) {
    const base = o.dataset.base ?? o.textContent ?? '';
    o.dataset.base = base;
    const m = list ? list[Number(o.value)] : null;
    o.textContent = m ? `${base} · ${describeUncoloured(m)}` : base;
    o.hidden = !!list && !(m && filter.keep(m)) && o.value !== cur;
  }
  syncFrameStepButtons();
}

/** The frames the list shows, in order. */
export function shownFrameOptions() {
  return ctx.frameSelect ? [...ctx.frameSelect.options].filter((o) => !o.hidden) : [];
}

export function stepFrame(delta) {
  if (!ctx.frameSelect || !ctx.availableFrames.length) return;
  applyFrameFilter();
  const shown = shownFrameOptions();
  const at = shown.findIndex((o) => o.value === ctx.frameSelect.value);
  const next = shown[Math.max(0, Math.min(shown.length - 1, (at < 0 ? 0 : at) + delta))];
  if (!next || next.value === ctx.frameSelect.value) return;
  ctx.frameSelect.value = next.value;
  ctx.frameSelect.dispatchEvent(new Event('change', { bubbles: true }));
  applyFrameFilter();
}

export function syncFrameStepButtons() {
  const prev = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-frame-prev'));
  const next = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-frame-next'));
  const pos = document.getElementById('frame-position');
  const n = ctx.availableFrames.length;
  const shown = shownFrameOptions();
  const at = ctx.frameSelect ? shown.findIndex((o) => o.value === ctx.frameSelect.value) : -1;
  const ok = n > 0 && at >= 0;
  if (prev) prev.disabled = !ok || at <= 0;
  if (next) next.disabled = !ok || at >= shown.length - 1;
  if (pos) pos.textContent = ok ? `${at + 1} / ${shown.length}${shown.length < n ? ` (of ${n})` : ''}` : '';
}

/**
 * The screen the Current (Colorize!) frame is on, when its memory matches exactly one screen's
 * fingerprint from Analyze memory; '' otherwise. Captures are named by you, so only the Colorize!
 * frame needs a guess.
 */
function screenGuessForCurrentFrame(i) {
  if (!ctx.gameStatePools.length || !isCurrentFrameRow(ctx.availableFrames[i])) return '';
  const r = findPoolVariantForFrameByRam(i);
  return r.match && !r.ambiguous ? String(r.match.poolLabel || '') : '';
}

export function populateFrames() {
  if (!ctx.frameSelect) return;
  const keep = ctx.frameSelect.value;
  ctx.frameSelect.innerHTML = '';
  for (let i = 0; i < ctx.availableFrames.length; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    const guess = screenGuessForCurrentFrame(i);
    o.textContent = guess ? `${ctx.availableFrames[i].label} · looks like ${guess}` : ctx.availableFrames[i].label;
    if (guess) o.title = `Its game memory matches the “${guess}” fingerprint from Analyze memory.`;
    ctx.frameSelect.appendChild(o);
  }
  if (keep && Number(keep) < ctx.availableFrames.length) ctx.frameSelect.value = keep;
  ctx.frameSelect.disabled = ctx.availableFrames.length === 0;
  applyFrameFilter();
}
