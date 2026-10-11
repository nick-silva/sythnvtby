/**
 * SpriteStudio's side-by-side reference and its ghost box (docs/design/reference-images.md §5.3):
 * the same frame rectangle drawn on the stage and on the reference pane, the reference-side box
 * moved and resized on its own, and Paste into box. Split out of tools/sprite-studio.js, which
 * passes in the state and functions it shares (initGhostBox).
 */import { poseBounds, paintTargetGroupFor, liveGroupTileColors } from '../shared/pack-session.js';
import { fillTilesFromReference, transformForGhostBoxes, placementsInRect } from '../../src/reference-fill.js';
import { applyFilledTiles, currentGroupPlacements } from './reference.js';
import { drawStage } from './render.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initGhostBox(context) {
  ctx = context;
}

/* ------------------------------------------------------------- ghost box */

/** Pointer → which pane, and the frame pixel under it (unclamped, so drags can leave). */
export function paneAt(e) {
  const r = ctx.canvas.getBoundingClientRect();
  const cx = ((e.clientX - r.left) / Math.max(1, r.width)) * ctx.canvas.width;
  const cy = ((e.clientY - r.top) / Math.max(1, r.height)) * ctx.canvas.height;
  const onRef = ctx.sideBySide() && cx >= ctx.stagePaneW + ctx.PANE_GAP;
  const x = onRef ? cx - (ctx.stagePaneW + ctx.PANE_GAP) : cx;
  return {
    pane: /** @type {'stage'|'ref'} */ (onRef ? 'ref' : 'stage'),
    fx: ctx.stageCrop.x + x / ctx.stageScale,
    fy: ctx.stageCrop.y + cy / ctx.stageScale,
  };
}

/** Which part of a box the pointer is on: a corner, or inside it. */
function ghostHandleAt(rect, fx, fy, tol) {
  if (!rect) return null;
  const nearL = Math.abs(fx - rect.x) <= tol;
  const nearR = Math.abs(fx - (rect.x + rect.w)) <= tol;
  const nearT = Math.abs(fy - rect.y) <= tol;
  const nearB = Math.abs(fy - (rect.y + rect.h)) <= tol;
  const inside = fx >= rect.x - tol && fx <= rect.x + rect.w + tol && fy >= rect.y - tol && fy <= rect.y + rect.h + tol;
  if (!inside) return null;
  if (nearL && nearT) return 'nw';
  if (nearR && nearT) return 'ne';
  if (nearL && nearB) return 'sw';
  if (nearR && nearB) return 'se';
  return 'move';
}

/** The whole current group, as a starting box. */
export function defaultGhostBox() {
  const view = ctx.poseViews[ctx.poseIndex];
  if (!view?.origin) return null;
  const b = poseBounds(view.pose, view.origin);
  return { x: b.x0, y: b.y0, w: Math.max(8, b.x1 - b.x0), h: Math.max(8, b.y1 - b.y0) };
}

export function setGhostBox(rect) {
  ctx.ghostStage = rect;
  ctx.ghostRef = rect ? { ...rect } : null;
  updateGhostUi();
  drawStage();
}

export function updateGhostUi() {
  const on = !!ctx.ghostStage && !!ctx.activeReference;
  ctx.el('btn-reference-paste').disabled = !on;
  ctx.el('btn-reference-box-reset').disabled = !ctx.ghostStage;
  if (!ctx.ghostStage || !ctx.ghostRef) {
    ctx.el('reference-box-note').textContent = ctx.sideBySide() ? 'Drag a box on either pane to aim a paste.' : '';
    return;
  }
  const dx = Math.round(ctx.ghostRef.x - ctx.ghostStage.x);
  const dy = Math.round(ctx.ghostRef.y - ctx.ghostStage.y);
  const zoom = ctx.ghostStage.w ? ctx.ghostRef.w / ctx.ghostStage.w : 1;
  ctx.el('reference-box-note').textContent =
    `box ${Math.round(ctx.ghostStage.w)}×${Math.round(ctx.ghostStage.h)} · taking from ${dx >= 0 ? '+' : ''}${dx},${dy >= 0 ? '+' : ''}${dy}`
    + `${Math.abs(zoom - 1) > 0.01 ? ` · ${zoom.toFixed(2)}×` : ''} (arrows nudge)`;
}

/** Drag on the stage pane draws the box; on the reference pane it aims the paste. */
export function onGhostPointerDown(e) {
  const { pane, fx, fy } = paneAt(e);
  const tol = 6 / Math.max(0.001, ctx.stageScale);
  const rect = pane === 'ref' ? ctx.ghostRef : ctx.ghostStage;
  const handle = ghostHandleAt(rect, fx, fy, tol);
  if (pane === 'stage' && !handle) {
    // A fresh drag on the painted pane starts a new box.
    ctx.ghostDrag = { pane, handle: 'new', startX: fx, startY: fy, start: null };
    setGhostBox({ x: fx, y: fy, w: 1, h: 1 });
    ctx.canvas.setPointerCapture?.(e.pointerId);
    return true;
  }
  if (!handle) return false;
  ctx.ghostDrag = { pane, handle, startX: fx, startY: fy, start: { ...rect } };
  ctx.canvas.setPointerCapture?.(e.pointerId);
  return true;
}

export function onGhostPointerMove(e) {
  if (!ctx.ghostDrag) return;
  const { fx, fy } = paneAt(e);
  const d = ctx.ghostDrag;
  if (d.handle === 'new') {
    const rect = { x: Math.min(d.startX, fx), y: Math.min(d.startY, fy), w: Math.abs(fx - d.startX), h: Math.abs(fy - d.startY) };
    ctx.ghostStage = { ...rect, w: Math.max(1, rect.w), h: Math.max(1, rect.h) };
    ctx.ghostRef = { ...ctx.ghostStage };
    drawStage();
    return;
  }
  const start = d.start;
  let next;
  if (d.handle === 'move') {
    next = { ...start, x: start.x + (fx - d.startX), y: start.y + (fy - d.startY) };
  } else {
    // Corners resize; the reference box keeps the stage box's shape so scale stays uniform.
    const anchorX = d.handle.includes('w') ? start.x + start.w : start.x;
    const anchorY = d.handle.includes('n') ? start.y + start.h : start.y;
    const w = Math.max(4, Math.abs(fx - anchorX));
    const aspect = start.h / Math.max(1, start.w);
    const h = Math.max(4, w * aspect);
    next = { x: Math.min(anchorX, fx > anchorX ? anchorX : anchorX - w), y: anchorY - (d.handle.includes('n') ? h : 0), w, h };
    if (!d.handle.includes('w')) next.x = anchorX;
    if (!d.handle.includes('n')) next.y = anchorY;
  }
  if (d.pane === 'ref') ctx.ghostRef = next;
  else {
    const shift = { x: next.x - ctx.ghostStage.x, y: next.y - ctx.ghostStage.y };
    ctx.ghostStage = next;
    if (ctx.ghostRef) ctx.ghostRef = { ...ctx.ghostRef, x: ctx.ghostRef.x + shift.x, y: ctx.ghostRef.y + shift.y, w: next.w, h: next.h };
  }
  updateGhostUi();
  drawStage();
}

export function endGhostDrag(e) {
  if (!ctx.ghostDrag) return;
  ctx.canvas.releasePointerCapture?.(e.pointerId);
  ctx.ghostDrag = null;
  updateGhostUi();
}

/** Paste only what the box covers, sampled through the box's own placement. */
export function pasteIntoBox() {
  if (!ctx.activeReference || !ctx.ghostStage || !ctx.ghostRef) return;
  const image = ctx.referenceImageData();
  if (!image) return;
  const { placements, patterns } = currentGroupPlacements();
  const inBox = placementsInRect(placements, ctx.ghostStage);
  if (!inBox.length) {
    ctx.setStatus('No tiles of this group inside the box.');
    return;
  }
  const transform = transformForGhostBoxes(ctx.activeReference.transform, ctx.ghostRef, ctx.ghostStage);
  const out = fillTilesFromReference({ ...image, transform }, inBox, (hash) => patterns.get(hash) || null);
  if (!out.tiles.size) {
    ctx.setStatus('The reference does not reach that box.');
    return;
  }
  applyFilledTiles(out, patterns);
  const dx = Math.round(ctx.ghostRef.x - ctx.ghostStage.x);
  const dy = Math.round(ctx.ghostRef.y - ctx.ghostStage.y);
  ctx.setStatus(`Pasted ${out.patterns} tile pattern(s) into the box, taken from ${dx >= 0 ? '+' : ''}${dx},${dy >= 0 ? '+' : ''}${dy}. Undo puts it back.`);
}

/**
 * Where paint for the current view goes. A BG group keeps its colours to itself so one
 * pattern can differ per layer; sprite patterns stay in the shared pack, where painting a
 * pose tile updates every pose that uses it. Both are `Map<hash, Uint8Array>`.
 */
export function paintStore() {
  const g = paintTargetGroupFor(ctx.selectedGroup);
  return g ? liveGroupTileColors(g) : ctx.session.pack;
}

/** The colour in effect for a pattern: the group's own, else (unless Only this group's paint) the shared pack's. */
export function colourForHash(hash) {
  const g = paintTargetGroupFor(ctx.selectedGroup);
  const own = g ? liveGroupTileColors(g).get(hash >>> 0) : null;
  if (g && ctx.ownPaintOnly()) return own;
  return own || ctx.session.pack.get(hash >>> 0);
}
