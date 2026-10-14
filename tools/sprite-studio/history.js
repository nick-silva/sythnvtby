/**
 * SpriteStudio's undo and redo: one history of tile strokes, picture strokes and picture changes
 * (add, move, remove), each entry able to put its state back and return its inverse. Split out of
 * tools/sprite-studio.js, which passes in the state and functions it shares (initHistory).
 */
import { liveGroupTileColors, clearGroupOverlay, restoreGroupOverlay } from '../shared/pack-session.js';
import { layerArtOf, artPixelsFor } from '../../src/layer-art.js';
import { copyPixels, replacePixels } from '../../src/layer-art-edit.js';
import { findArtTarget, pictureStore, undoPictureEntry } from './overpaint.js';
import { markActiveRow, renderSpriteLists } from './group-list.js';
import { refreshShadeRamp, renderStrip } from './poses.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initHistory(context) {
  ctx = context;
}

/** Undo snapshots: each stroke keeps the tile buffers it touched, before the stroke. */
export const undoStack = [];
/** Undone changes, newest last; a new change clears it. Same entries as {@link undoStack}. */
export const redoStack = [];

/** Record a change for Undo, and forget what Redo could bring back: history has branched. */
export function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
  syncUndoButtons();
}

/** After a stroke that took paint off: tiles with nothing left go, so they count as unpainted. */
export function dropErasedTiles(hashes) {
  const store = ctx.paintStore();
  for (const h of hashes) {
    const buf = store.get(h);
    if (!buf) continue;
    let any = false;
    for (let i = 3; i < buf.length; i += 4) if (buf[i]) { any = true; break; }
    if (!any) store.delete(h);
  }
}

export function syncUndoButtons() {
  ctx.el('btn-undo').disabled = undoStack.length === 0;
  ctx.el('btn-redo').disabled = redoStack.length === 0;
}

export function undoStroke() {
  stepHistory(undoStack, redoStack, 'Undid');
}

export function redoStroke() {
  stepHistory(redoStack, undoStack, 'Redid');
}

/** Take the newest entry off `from`, put its state back, and keep what that replaced on `to`. */
function stepHistory(from, to, verb) {
  const entry = from.pop();
  if (!entry) return;
  const inverse = applyHistoryEntry(entry, verb);
  if (inverse) {
    to.push(inverse);
    if (to.length > 50) to.shift();
  }
  syncUndoButtons();
}

const copyOrNull = (buf) => (buf ? Uint8Array.from(buf) : null);

/**
 * Put an undo (or redo) entry's state back, returning the entry that puts back what it replaced —
 * undo and redo are the same step in opposite directions. Null when there is nothing to redo with
 * (the change is still undone).
 */
function applyHistoryEntry(entry, verb) {
  if (entry.art) {
    const { key, prev, place } = entry.art;
    const px = artPixelsFor(key, '');
    const group = findArtTarget(key);
    const art = group ? layerArtOf(group) : null;
    const inverse = px ? { art: { key, prev: copyPixels(px), place: art ? { ...art } : null } } : null;
    if (px && px.width === prev.width && px.height === prev.height) replacePixels(px, prev);
    else if (place && group?.overpaint && place.width === prev.width && place.height === prev.height) {
      // Saved (and so cropped) since: the picture goes back to its place before the stroke.
      pictureStore.put(key, { ...layerArtOf(group), ...place }, copyPixels(prev));
    }
    pictureStore.markEdited(key);
    ctx.markDirty();
    ctx.invalidateRender();
    renderStrip();
    ctx.drawStage();
    ctx.renderDetail();
    ctx.setStatus(`${verb} the last change to the overpaint.`);
    return inverse;
  }
  if (entry.picture) {
    const inverse = { picture: { pictures: entry.picture.pictures.map(({ key }) => currentPicture(key)) } };
    undoPictureEntry(entry);
    ctx.markDirty();
    renderSpriteLists();
    markActiveRow();
    ctx.invalidateRender();
    ctx.drawStage();
    ctx.renderDetail();
    ctx.setStatus(`${verb} the last change to the overpaint.`);
    return inverse;
  }
  if (entry.overlay) {
    restoreGroupOverlay(ctx.session, entry.overlay);
    ctx.invalidateRender();
    ctx.drawStage();
    ctx.renderDetail();
    ctx.setStatus(`${verb}: the overlay paint is back.`);
    return { overlayClear: entry.overlay.groupId };
  }
  if (entry.overlayClear) {
    const saved = clearGroupOverlay(ctx.session, entry.overlayClear);
    ctx.invalidateRender();
    ctx.drawStage();
    ctx.renderDetail();
    ctx.setStatus(`${verb}: the overlay paint is cleared again.`);
    return { overlay: saved };
  }
  // Put the colours back where they came from: the group that owned them, or the pack.
  const target = entry.groupId ? ctx.session.groups.find((g) => g.id === entry.groupId) : null;
  const store = target ? liveGroupTileColors(target) : ctx.session.pack;
  const inverse = { groupId: entry.groupId, map: new Map() };
  for (const [hash, buf] of entry.map) {
    inverse.map.set(hash, copyOrNull(store.get(hash)));
    if (buf) store.set(hash, Uint8Array.from(buf));
    else store.delete(hash); // it had no paint before the stroke
  }
  ctx.markDirty();
  refreshShadeRamp(target);
  ctx.invalidateRender();
  ctx.drawStage();
  renderStrip();
  ctx.renderPalette();
  // Pose details count the card's unpainted pixels (Painting complete), which the step changed.
  ctx.renderDetail();
  ctx.setStatus(`${verb} the last stroke.`);
  return inverse;
}

/** A picture's settings and pixels as they are now, in the shape undoPictureEntry restores. */
function currentPicture(key) {
  const settings = pictureStore.settings(key);
  const px = artPixelsFor(key, '');
  return { key, settings, pixels: settings && px ? copyPixels(px) : null };
}
