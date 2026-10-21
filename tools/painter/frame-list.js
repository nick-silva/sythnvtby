/**
 * The Project tool's frame list: loading a frame's VIP state, the frame dropdown with its filters
 * and highlights, stepping between frames. Split out of tools/painter.js, which passes in the state and functions it shares (initFrameList).
 */
import { measureUncoloured, UNCOLOURED_FILTERS, describeUncoloured, uncolouredMasks, highlightUncoloured } from '../../src/uncoloured.js';
import { changedPatterns, framePatterns, frameTouched } from '../../src/paint-change.js';
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

/**
 * Each frame's measurement and the patterns it shows, the frame row it was taken from, and the
 * paint it was measured against (`sig` for everything but the groups, which are compared one by
 * one: src/paint-change.js).
 */
let frameMeasure = {
  sig: '',
  groupsSig: '',
  groups: /** @type {any[]} */ ([]),
  rows: /** @type {any[]} */ ([]),
  list: /** @type {Array<{ tiles: number, pixels: number } | null>} */ ([]),
  shown: /** @type {Array<Set<number> | null>} */ ([]),
};
const paintEditIds = new WeakMap();
let paintEditNext = 1;

/** A stamp that changes whenever paint other than the groups may have: another pack, a stroke or undo. */
function paintSignature() {
  const id = (o) => {
    if (!o) return 0;
    if (!paintEditIds.has(o)) paintEditIds.set(o, paintEditNext++);
    return paintEditIds.get(o);
  };
  const top = ctx.paintUndoStack[ctx.paintUndoStack.length - 1];
  return [id(ctx.loadedPackParts), ctx.paintUndoStack.length, id(top), ctx.pack.size, id(ctx.gameStatePools), getActiveV2VariantId() ?? ''].join('|');
}

/** A stamp of the groups' patterns and screens, to catch a group changed in place (not replaced). */
function groupsSignature() {
  const crit = ctx.groups.reduce((n, g) => n + (g?.criteria?.hashes?.length || 0) + (g?.criteria?.windowIds?.length || 0), 0);
  const screens = ctx.groups.map((g) => (g?.screens ? `${g.id}:${JSON.stringify(g.screens)}` : '')).join('');
  return `${ctx.groups.length}|${crit}|${screens}`;
}

/** What colours a frame, as the preview has it. */
export function paintForMeasure() {
  return { pack: ctx.pack, overrides: ctx.overrides, groups: ctx.groups, gameStatePools: ctx.gameStatePools, painterV2Rules: ctx.painterV2Rules, variantId: getActiveV2VariantId() };
}

/**
 * The frames whose count may be out of date: all of them after a change that can reach any frame,
 * otherwise new or replaced frames and those showing a pattern of a group that changed.
 * @returns {number[]}
 */
function framesToRecount(force) {
  const n = ctx.availableFrames.length;
  const all = () => Array.from({ length: n }, (_, i) => i);
  if (force || frameMeasure.sig !== paintSignature()) return all();
  const sameGroupsSig = frameMeasure.groupsSig === groupsSignature();
  let changed = /** @type {Set<number> | null} */ (new Set());
  if (frameMeasure.groups !== ctx.groups) changed = changedPatterns(frameMeasure.groups, ctx.groups);
  // The stamp moved but no group was replaced: one was changed in place, so anything may have.
  if (!changed || (!changed.size && !sameGroupsSig)) return all();
  const out = [];
  for (let i = 0; i < n; i++) {
    const fresh = i < frameMeasure.list.length && frameMeasure.rows[i] === ctx.availableFrames[i];
    if (!fresh || (changed.size && frameTouched(frameMeasure.shown[i], changed))) out.push(i);
  }
  return out;
}

/** Recounts this small are done at once; larger ones show the busy note and run a slice per tick. */
const RECOUNT_AT_ONCE = 40;
/** Time per slice of a large recount, so the page keeps drawing the progress. */
const RECOUNT_SLICE_MS = 30;

/** The recount running now, if any. @type {Promise<void> | null} */
let recounting = null;

/** Measure frame `i` against `paint` into `into` (the next frameMeasure). */
function measureFrame(i, paint, into) {
  const row = ctx.availableFrames[i];
  into.rows[i] = row;
  try {
    const state = deserializeVIPState(JSON.parse(row.json));
    into.list[i] = measureUncoloured(state, { ...paint, wram: wramForFrameIndex(i) });
    into.shown[i] = framePatterns(state);
  } catch {
    into.list[i] = null;
    into.shown[i] = null;
  }
}

/** Start measuring: a copy of what is kept, sized to the frames there are now, with the paint's stamps. */
function beginRecount() {
  const n = ctx.availableFrames.length;
  return {
    sig: paintSignature(),
    groupsSig: groupsSignature(),
    groups: ctx.groups,
    rows: frameMeasure.rows.slice(0, n),
    list: frameMeasure.list.slice(0, n),
    shown: frameMeasure.shown.slice(0, n),
  };
}

/** The busy note under the frame buttons ("Counting uncoloured frames… 120 / 794"); hidden at total 0. */
function showRecountProgress(done, total) {
  const box = document.getElementById('frame-count-busy');
  const text = document.getElementById('frame-count-busy-text');
  const busy = total > 0;
  if (box) box.hidden = !busy;
  if (text) text.textContent = busy ? `Counting uncoloured frames… ${done} / ${total}` : '';
  document.body.classList.toggle('frame-counting', busy);
  syncFrameStepButtons();
}

/** Recount these frames a slice per tick, showing progress; the result is kept when all are done. */
function recountInSlices(indices) {
  const into = beginRecount();
  const paint = paintForMeasure();
  return new Promise((resolve) => {
    let k = 0;
    const step = () => {
      const until = performance.now() + RECOUNT_SLICE_MS;
      while (k < indices.length && performance.now() < until) measureFrame(indices[k++], paint, into);
      if (k < indices.length) {
        showRecountProgress(k, indices.length);
        setTimeout(step, 0);
        return;
      }
      // Paint changed while counting is caught on the next look, compared with what was counted.
      frameMeasure = into;
      resolve();
    };
    showRecountProgress(0, indices.length);
    // Let the page draw the note before the first slice.
    setTimeout(step, 0);
  });
}

/** Write the measurements into the frame list: a note on each option, frames the filter leaves out hidden. */
function showFrameFilter() {
  const filter = UNCOLOURED_FILTERS[frameFilter] || UNCOLOURED_FILTERS.all;
  const list = frameFilter === 'all' ? null : frameMeasure.list;
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

/**
 * Hide the frames the Show filter leaves out (the one you are on always stays), and note each
 * shown frame's uncoloured tiles and pixels. Options keep their frame index as value, so
 * everything that picks a frame by number still works. Only frames the paint may have changed
 * are recounted; a large recount runs a slice at a time with a busy note (the list keeps its old
 * counts meanwhile), and the promise settles once the list is up to date.
 * @param {boolean} [force] recount every frame
 * @returns {Promise<void>}
 */
export function applyFrameFilter(force = false) {
  if (!ctx.frameSelect) return Promise.resolve();
  if (frameFilter === 'all') {
    showFrameFilter();
    return Promise.resolve();
  }
  // One recount at a time; look again when it ends (paint may have changed meanwhile).
  if (recounting) return recounting.then(() => applyFrameFilter(force));
  const todo = framesToRecount(force);
  if (todo.length <= RECOUNT_AT_ONCE) {
    if (todo.length || frameMeasure.groups !== ctx.groups) {
      const into = beginRecount();
      const paint = paintForMeasure();
      for (const i of todo) measureFrame(i, paint, into);
      frameMeasure = into;
    }
    showFrameFilter();
    return Promise.resolve();
  }
  showFrameFilter();
  recounting = recountInSlices(todo).finally(() => {
    recounting = null;
    showRecountProgress(0, 0);
  });
  return recounting.then(() => applyFrameFilter());
}

/** The frames the list shows, in order. */
export function shownFrameOptions() {
  return ctx.frameSelect ? [...ctx.frameSelect.options].filter((o) => !o.hidden) : [];
}

/**
 * Step to the previous/next frame the list shows, once its counts are up to date. Clicks while a
 * recount runs are ignored (the buttons are disabled then).
 * @param {number} delta
 */
export async function stepFrame(delta) {
  if (!ctx.frameSelect || !ctx.availableFrames.length || recounting) return;
  await applyFrameFilter();
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
  // Not while the list is being recounted: a step then would land on stale counts.
  const ok = n > 0 && at >= 0 && !document.body.classList.contains('frame-counting');
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
