/**
 * The Project tool's undo and redo for painting and group edits: stroke snapshots, one history
 * with entries that put their state back and return their inverse. Split out of tools/painter.js, which passes in the state and functions it shares (initPaintHistory).
 */
import { normalizeGroup } from '../../src/group-schema.js';
import { updatePaintV2TopButton } from './pack-rules.js';
import { syncLastTopTileFromSelection } from './selection.js';
import { renderPaintInventory } from './paint-inventory-ui.js';
import { HEALTH_PAINT_DELAY_MS } from './group-detail.js';
import { scheduleHealthCheck } from './project-dialogs.js';
import { removeGroupNow, restoreDeletedGroup } from './group-dialogs.js';
import { updateGroupsPanel } from './groups-panel.js';
import { ensureGroupTileColorMap, invalidateGroupColorIndex, paintTargetGroupOrNull, paintTargetHasHash } from './zoom-paint.js';
import { ensureVipOverlayBufferForGroupEye } from './vip-overlay-paint.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initPaintHistory(context) {
  ctx = context;
}

/**
 * Remember a tile pattern's colours before a stroke changes them. `null` means the pattern had
 * no paint at all: `getPackRgba256ForHash` creates a default ramp on demand, and undo has to
 * remove that again rather than leave a painted-looking tile behind.
 * @param {number} hash @param {Uint8Array} buf
 */
export function recordPackUndoSnapForHash(hash, buf) {
  if (!ctx.activePaintUndoMap) return;
  const h = hash >>> 0;
  if (ctx.activePaintUndoMap.has(h)) return;
  // Which store this stroke is writing to decides where undo puts the colours back.
  if (ctx.activePaintUndoGroupId === undefined) ctx.activePaintUndoGroupId = paintTargetGroupOrNull()?.id ?? null;
  ctx.activePaintUndoMap.set(h, paintTargetHasHash(h) ? new Uint8Array(buf) : null);
}

export function commitPaintUndoStroke() {
  ctx.paintEditsSinceSave++;
  if (ctx.activeVipOverlayUndoSnapshot) {
    const snap = ctx.activeVipOverlayUndoSnapshot;
    ctx.activeVipOverlayUndoSnapshot = null;
    pushPaintUndo({ kind: 'vip', groupId: snap.groupId, eye: snap.eye, prev: snap.prev });
    ctx.activePaintUndoMap = null;
    return;
  }
  const map = ctx.activePaintUndoMap;
  const groupId = ctx.activePaintUndoGroupId ?? null;
  ctx.activePaintUndoMap = null;
  ctx.activePaintUndoGroupId = undefined;
  if (!map || map.size === 0) return;
  // A tile erased to nothing is unpainted again, not painted see-through (undo puts it back).
  if (ctx.zoomEraseMode) {
    const store = groupId ? ensureGroupTileColorMap(groupId) : ctx.pack;
    let dropped = 0;
    for (const h of map.keys()) {
      const buf = store.get(h);
      if (!buf) continue;
      let any = false;
      for (let i = 3; i < buf.length; i += 4) if (buf[i]) { any = true; break; }
      if (!any) {
        store.delete(h);
        dropped++;
      }
    }
    if (dropped) {
      invalidateGroupColorIndex();
      if (groupId) ctx.markGroupsDirty();
    }
  }
  scheduleHealthCheck(HEALTH_PAINT_DELAY_MS);
  pushPaintUndo({ kind: 'pack', map, groupId });
}

/** Undone edits, newest last; a new edit clears it. Same entries as {@link paintUndoStack}. */
export const paintRedoStack = /** @type {typeof paintUndoStack} */ ([]);

/** Record an edit for Ctrl+Z (and forget what Ctrl+Shift+Z could redo: history has branched). */
export function pushPaintUndo(entry) {
  ctx.paintUndoStack.push(entry);
  while (ctx.paintUndoStack.length > ctx.PAINT_UNDO_MAX) ctx.paintUndoStack.shift();
  paintRedoStack.length = 0;
}

export function undoLastZoomPaint() {
  return stepPaintHistory(ctx.paintUndoStack, paintRedoStack, 'Undo');
}

export function redoLastZoomPaint() {
  return stepPaintHistory(paintRedoStack, ctx.paintUndoStack, 'Redo');
}

/** Take the newest entry off `from`, put its edit back, and keep what that overwrote on `to`. */
function stepPaintHistory(from, to, verb) {
  const e = from.pop();
  if (!e) return false;
  const inverse = applyPaintEntry(e);
  if (!inverse) {
    from.push(e);
    return false;
  }
  to.push(inverse);
  while (to.length > ctx.PAINT_UNDO_MAX) to.shift();
  syncLastTopTileFromSelection();
  updatePaintV2TopButton();
  ctx.render();
  // The inventory is a view of the paint stores, so keep it honest if it is open.
  if (ctx.paintInventoryDialog?.open) renderPaintInventory();
  ctx.setStatus(`${verb}: ${describePaintEntry(e)}`);
  return true;
}

/** @param {any} e @returns {string} */
function describePaintEntry(e) {
  if (e.kind === 'vip') return 'VIP paint overlay.';
  if (e.kind === 'move') return 'a colour moved between the shared pack and a group.';
  if (e.kind === 'clear') return `cleared paint (${e.groupMap.size} group colour(s), ${(e.overlayMap ?? new Map()).size} overlay(s), ${e.packMap.size} pack tile(s)).`;
  if (e.kind === 'group-delete') return `group “${e.group.name || e.group.id}” is back.`;
  if (e.kind === 'group-remove') return 'the group is deleted again.';
  return e.groupId ? 'this group’s tile colour(s).' : 'vbcolor pack tile(s).';
}

const copyOrNull = (buf) => (buf ? Uint8Array.from(buf) : null);

/**
 * Put an undo (or redo) entry's state back, returning the entry that puts back what it replaced —
 * so undo and redo are the same step in opposite directions. A stored null means "no paint here".
 * @returns {any | null} the inverse entry, or null when it cannot be applied
 */
function applyPaintEntry(e) {
  if (e.kind === 'vip') {
    const eye = typeof e.eye === 'number' ? e.eye & 1 : 0;
    const gid = typeof e.groupId === 'string' && e.groupId.length > 0 ? e.groupId : ctx.selectedGroupId;
    if (!gid) {
      ctx.setStatus('Undo: VIP overlay entry had no group id — select a group and try again.');
      return null;
    }
    const buf = ensureVipOverlayBufferForGroupEye(gid, eye);
    const inverse = { kind: 'vip', groupId: gid, eye, prev: Uint8Array.from(buf) };
    buf.set(e.prev);
    return inverse;
  }
  if (e.kind === 'move') {
    const live = ensureGroupTileColorMap(e.groupId);
    const inverse = {
      kind: 'move',
      groupId: e.groupId,
      hash: e.hash,
      groupPrev: copyOrNull(live.get(e.hash)),
      packPrev: copyOrNull(ctx.pack.get(e.hash)),
      addedHash: !!e.restoreHash,
      restoreHash: !!e.addedHash,
    };
    if (e.groupPrev) live.set(e.hash, new Uint8Array(e.groupPrev));
    else live.delete(e.hash);
    if (e.packPrev) ctx.pack.set(e.hash, new Uint8Array(e.packPrev));
    else ctx.pack.delete(e.hash);
    if (e.addedHash || e.restoreHash) {
      ctx.groups = ctx.groups.map((x) => {
        if (x.id !== e.groupId) return x;
        const hashes = (x.criteria?.hashes || []).filter((v) => (Number(v) >>> 0) !== e.hash);
        if (e.restoreHash) hashes.push(e.hash);
        return normalizeGroup({ ...x, criteria: { ...(x.criteria || {}), hashes } });
      });
    }
    ctx.markGroupsDirty();
    invalidateGroupColorIndex();
    updateGroupsPanel();
    return inverse;
  }
  if (e.kind === 'clear') {
    const inverse = { kind: 'clear', groupId: e.groupId, groupMap: new Map(), packMap: new Map(), overlayMap: new Map() };
    for (const [eye, prev] of e.overlayMap ?? []) {
      const buf = ensureVipOverlayBufferForGroupEye(e.groupId, eye);
      inverse.overlayMap.set(eye, Uint8Array.from(buf));
      buf.set(prev);
    }
    if (e.groupMap.size) {
      const live = ensureGroupTileColorMap(e.groupId);
      for (const [h, prev] of e.groupMap) {
        inverse.groupMap.set(h >>> 0, copyOrNull(live.get(h >>> 0)));
        if (prev) live.set(h >>> 0, new Uint8Array(prev));
        else live.delete(h >>> 0);
      }
      invalidateGroupColorIndex();
      ctx.markGroupsDirty();
    }
    for (const [h, prev] of e.packMap) {
      inverse.packMap.set(h >>> 0, copyOrNull(ctx.pack.get(h >>> 0)));
      if (prev) ctx.pack.set(h >>> 0, new Uint8Array(prev));
      else ctx.pack.delete(h >>> 0);
    }
    return inverse;
  }
  if (e.kind === 'group-delete') {
    restoreDeletedGroup(e);
    return { kind: 'group-remove', groupId: e.group.id };
  }
  if (e.kind === 'group-remove') {
    return removeGroupNow(e.groupId);
  }
  const store = e.groupId ? ensureGroupTileColorMap(e.groupId) : ctx.pack;
  const inverse = { kind: 'pack', groupId: e.groupId ?? null, map: new Map() };
  for (const [h, prev] of e.map) {
    inverse.map.set(h >>> 0, copyOrNull(store.get(h >>> 0)));
    if (prev) store.set(h >>> 0, new Uint8Array(prev));
    else store.delete(h >>> 0); // it had no paint before the stroke
  }
  if (e.groupId) {
    invalidateGroupColorIndex();
    ctx.markGroupsDirty();
  }
  return inverse;
}
