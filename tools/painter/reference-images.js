/**
 * The Project tool's reference images: per-frame and per-screen references kept in the pack, the
 * overlay and its transform (move, scale, revert), and Fill selection from reference. Split out of
 * tools/painter.js, which passes in the state and functions it shares (initReferenceImages).
 */
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { fillTilesFromReference, referencePixelsForPlacements } from '../../src/reference-fill.js';
import { newReferenceId, normalizeReferences, addReference, removeReference, referenceForFrame, referenceFileName } from '../../src/frame-metadata.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initReferenceImages(context) {
  ctx = context;
}

// ---------------------------------------------------------------- reference images
// A colour reference is an image of this frame someone colorized elsewhere, pinned over the
// frame to paint from (docs/design/reference-images.md). It belongs to the frame's game state
// when we know it, otherwise to the frame alone.

function clearReferenceStore() {
  for (const url of ctx.referenceUrls.values()) URL.revokeObjectURL(url);
  ctx.referenceUrls = new Map();
  ctx.referenceBlobs = new Map();
  ctx.packReferences = { items: [], active: {} };
  ctx.activeReferenceMeta = null;
  ctx.activeReferenceImage = null;
  ctx.activeReferenceUrl = null;
  ctx.referencesDirty = false;
}

/** @param {Array<{name: string, buffer: ArrayBuffer}>|undefined} referencesFolder */
export function primeReferenceStore(referencesFolder, manifestReferences) {
  clearReferenceStore();
  ctx.packReferences = normalizeReferences(manifestReferences);
  for (const file of Array.isArray(referencesFolder) ? referencesFolder : []) {
    const name = typeof file?.name === 'string' ? file.name.trim() : '';
    if (!name || !(file?.buffer instanceof ArrayBuffer)) continue;
    const refId = name.replace(/\.png$/i, '');
    const blob = new Blob([file.buffer], { type: 'image/png' });
    ctx.referenceBlobs.set(refId, blob);
    ctx.referenceUrls.set(refId, URL.createObjectURL(blob));
  }
}

/** Where a frame's reference may be stored: the frame itself, and the game state it matches. */
function referenceScopesForFrameIndex(i) {
  const ent = ctx.availableFrames[i]?.frameRegistryEntry;
  const frameId = typeof ent?.frameId === 'string' ? ent.frameId.trim() : '';
  let poolId = '';
  try {
    poolId = String(ctx.findPoolVariantForFrameByRam(i)?.match?.poolId || '');
  } catch {
    poolId = '';
  }
  return { frameId, poolId };
}

/** Leave Move & scale without the status message — used when the frame or reference changes. */
export function setReferenceTransformModeQuiet(on) {
  ctx.referenceTransformMode = !!on;
  ctx.referenceDrag = null;
  const wrap = ctx.canvasWrap;
  if (wrap) wrap.style.cursor = '';
  if (ctx.btnReferenceTransform) ctx.btnReferenceTransform.classList.toggle('active', ctx.referenceTransformMode);
}

export function updateReferenceUi() {
  const has = !!ctx.activeReferenceMeta && ctx.referenceUrls.has(ctx.activeReferenceMeta.refId);
  const tools = document.getElementById('reference-tools');
  if (tools) tools.hidden = !has;
  ctx.syncOverlayAlphaUi(has);
  if (ctx.toggleReferenceOverlay) {
    ctx.toggleReferenceOverlay.disabled = !has;
    ctx.toggleReferenceOverlay.checked = has && ctx.referenceOverlayEnabled;
  }
  if (ctx.btnReferenceTransform) ctx.btnReferenceTransform.disabled = !has;
  if (ctx.btnReferenceRevert) ctx.btnReferenceRevert.disabled = !has || !referenceTransformChanged();
  const fillSelection = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-reference-fill-selection'));
  if (fillSelection) fillSelection.disabled = !has || ctx.selectedDrawFullIndices.size === 0;
  if (ctx.frameMenuRemoveReference) ctx.frameMenuRemoveReference.disabled = !has;
  if (!ctx.referenceStatus) return;
  if (!has) {
    ctx.referenceStatus.textContent = ctx.availableFrames.length
      ? 'No reference for this frame — Frame ▸ Add colorized reference…'
      : 'Load a .vbpack';
    return;
  }
  const meta = ctx.activeReferenceMeta;
  const where = meta.scope === 'pool' ? 'this game state' : 'this frame only';
  const size = Array.isArray(meta.originalSize) ? ` · from ${meta.originalSize[0]}×${meta.originalSize[1]}` : '';
  const fitted = meta.fit?.mode === 'contain' ? ' · letterboxed' : '';
  ctx.referenceStatus.textContent = `${meta.name || meta.originalName || meta.refId} — ${where}${size}${fitted}`;
}

export function refreshFrameReference(i) {
  ctx.activeReferenceImage = null;
  ctx.activeReferenceMeta = null;
  ctx.activeReferenceUrl = null;
  ctx.activeReferenceTransform = null;
  setReferenceTransformModeQuiet(false);
  if (Number.isFinite(i) && i >= 0 && i < ctx.availableFrames.length) {
    ctx.activeReferenceMeta = referenceForFrame(ctx.packReferences, referenceScopesForFrameIndex(i));
  }
  const url = ctx.activeReferenceMeta ? ctx.referenceUrls.get(ctx.activeReferenceMeta.refId) : null;
  if (!url) {
    updateReferenceUi();
    ctx.render();
    return;
  }
  ctx.activeReferenceUrl = url;
  const img = new Image();
  img.onload = () => {
    if (ctx.activeReferenceUrl !== url) return;
    ctx.activeReferenceImage = img;
    ctx.activeReferenceTransform = normalizeReferenceTransform(
      ctx.activeReferenceMeta?.transform,
      img.naturalWidth,
      img.naturalHeight,
    );
    updateReferenceUi();
    ctx.render();
  };
  img.onerror = () => {
    if (ctx.activeReferenceUrl !== url) return;
    ctx.activeReferenceImage = null;
    ctx.activeReferenceTransform = null;
    updateReferenceUi();
    ctx.render();
  };
  img.src = url;
  updateReferenceUi();
}

/**
 * Keep the image at the size it arrived at and remember how to place it, so it can be moved
 * and scaled afterwards — including larger than the frame, which is what dead space around a
 * generated image needs. Only the format is normalized, to PNG.
 */
async function referenceBlobFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('could not read that image'));
      el.src = url;
    });
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    let blob = file;
    if (file.type !== 'image/png') {
      const canvas = document.createElement('canvas');
      canvas.width = srcW;
      canvas.height = srcH;
      const c = canvas.getContext('2d');
      if (!c) throw new Error('no 2d context');
      c.drawImage(img, 0, 0);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('could not encode the reference');
    }
    return { blob, originalSize: [srcW, srcH], transform: defaultReferenceTransform(srcW, srcH) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fit the whole image inside the frame, centred — where Revert puts it back to. */
function defaultReferenceTransform(srcW, srcH) {
  const scale = Math.min(ctx.W / Math.max(1, srcW), ctx.H / Math.max(1, srcH));
  return {
    scale: Number(scale.toFixed(6)),
    dx: Number(((ctx.W - srcW * scale) / 2).toFixed(3)),
    dy: Number(((ctx.H - srcH * scale) / 2).toFixed(3)),
  };
}

function normalizeReferenceTransform(t, srcW, srcH) {
  const fallback = defaultReferenceTransform(srcW, srcH);
  if (!t || typeof t !== 'object') return fallback;
  const scale = Number(t.scale);
  return {
    scale: Number.isFinite(scale) && scale > 0 ? scale : fallback.scale,
    dx: Number.isFinite(Number(t.dx)) ? Number(t.dx) : fallback.dx,
    dy: Number.isFinite(Number(t.dy)) ? Number(t.dy) : fallback.dy,
  };
}

/** The reference's rectangle in frame pixels; may extend outside 0,0–384,224. */
export function referenceRectInFrame() {
  if (!ctx.activeReferenceImage || !ctx.activeReferenceTransform) return null;
  const iw = ctx.activeReferenceImage.naturalWidth || 1;
  const ih = ctx.activeReferenceImage.naturalHeight || 1;
  const t = ctx.activeReferenceTransform;
  return { x: t.dx, y: t.dy, w: iw * t.scale, h: ih * t.scale };
}

/** Frame pixels per canvas pixel, and the visible frame origin — zoom changes both. */
export function frameToCanvasMapping(dw, dh) {
  const v = ctx.zoomViewport || { x: 0, y: 0, w: ctx.W, h: ctx.H };
  return { vx: v.x, vy: v.y, kx: dw / v.w, ky: dh / v.h };
}

export function clientToFrameFloat(e, target) {
  const r = target.getBoundingClientRect();
  const u = (e.clientX - r.left) / Math.max(1, r.width);
  const v = (e.clientY - r.top) / Math.max(1, r.height);
  const vp = ctx.zoomViewport || { x: 0, y: 0, w: ctx.W, h: ctx.H };
  return { fx: vp.x + u * vp.w, fy: vp.y + v * vp.h };
}

/** Which part of the reference box the pointer is on: a scale handle, inside, or nothing. */
export function referenceHandleAt(fx, fy, toleranceFramePx) {
  const rect = referenceRectInFrame();
  if (!rect) return null;
  const nearL = Math.abs(fx - rect.x) <= toleranceFramePx;
  const nearR = Math.abs(fx - (rect.x + rect.w)) <= toleranceFramePx;
  const nearT = Math.abs(fy - rect.y) <= toleranceFramePx;
  const nearB = Math.abs(fy - (rect.y + rect.h)) <= toleranceFramePx;
  const insideX = fx >= rect.x - toleranceFramePx && fx <= rect.x + rect.w + toleranceFramePx;
  const insideY = fy >= rect.y - toleranceFramePx && fy <= rect.y + rect.h + toleranceFramePx;
  if (!insideX || !insideY) return null;
  if (nearL && nearT) return 'nw';
  if (nearR && nearT) return 'ne';
  if (nearL && nearB) return 'sw';
  if (nearR && nearB) return 'se';
  if (nearL) return 'w';
  if (nearR) return 'e';
  if (nearT) return 'n';
  if (nearB) return 's';
  return 'move';
}

export const REFERENCE_CURSORS = { move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

export function setReferenceTransformMode(on) {
  ctx.referenceTransformMode = !!on && !!ctx.activeReferenceImage;
  if (!ctx.referenceTransformMode) {
    ctx.referenceDrag = null;
    const wrap = ctx.canvasWrap;
  if (wrap) wrap.style.cursor = '';
  }
  if (ctx.btnReferenceTransform) ctx.btnReferenceTransform.classList.toggle('active', ctx.referenceTransformMode);
  if (ctx.referenceTransformMode) {
    // One canvas tool at a time.
    ctx.zoomPaintTool = null;
    ctx.updateSelectionUi();
    ctx.setStatus('Move & scale: drag inside the outline to move it, drag an edge or corner to resize. Pick another tool to leave.');
  }
  updateReferenceUi();
  ctx.render();
}

/** Apply a drag to the transform: move keeps the size, a handle scales about the opposite side. */
export function applyReferenceDrag(fx, fy) {
  const d = ctx.referenceDrag;
  if (!d) return;
  const iw = ctx.activeReferenceImage?.naturalWidth || 1;
  const ih = ctx.activeReferenceImage?.naturalHeight || 1;
  const start = d.startTransform;
  if (d.handle === 'move') {
    ctx.activeReferenceTransform = { scale: start.scale, dx: start.dx + (fx - d.startX), dy: start.dy + (fy - d.startY) };
    return;
  }
  const startW = iw * start.scale;
  const startH = ih * start.scale;
  const left = start.dx;
  const top = start.dy;
  const right = left + startW;
  const bottom = top + startH;
  const MIN = 8; // never smaller than a tile, or it cannot be grabbed again
  let scale = start.scale;
  if (d.handle.includes('e')) scale = Math.max(MIN / iw, (fx - left) / iw);
  else if (d.handle.includes('w')) scale = Math.max(MIN / iw, (right - fx) / iw);
  if (d.handle.includes('s')) scale = Math.max(MIN / ih, Math.max(scale, (fy - top) / ih));
  else if (d.handle.includes('n')) scale = Math.max(MIN / ih, Math.max(scale, (bottom - fy) / ih));
  if (d.handle === 'n' || d.handle === 's') scale = Math.max(MIN / ih, d.handle === 's' ? (fy - top) / ih : (bottom - fy) / ih);
  const w = iw * scale;
  const h = ih * scale;
  // The edge or corner opposite the one being dragged stays put.
  const dx = d.handle.includes('w') ? right - w : left;
  const dy = d.handle.includes('n') ? bottom - h : top;
  ctx.activeReferenceTransform = { scale, dx, dy };
}

export function commitReferenceTransform() {
  if (!ctx.activeReferenceMeta || !ctx.activeReferenceTransform) return;
  const meta = ctx.activeReferenceMeta;
  meta.transform = {
    scale: Number(ctx.activeReferenceTransform.scale.toFixed(6)),
    dx: Number(ctx.activeReferenceTransform.dx.toFixed(3)),
    dy: Number(ctx.activeReferenceTransform.dy.toFixed(3)),
  };
  ctx.packReferences = {
    ...ctx.packReferences,
    items: ctx.packReferences.items.map((r) => (r.refId === meta.refId ? { ...r, transform: meta.transform } : r)),
  };
  ctx.referencesDirty = true;
  updateReferenceUi();
}

export function revertReferenceTransform() {
  if (!ctx.activeReferenceMeta || !ctx.activeReferenceImage) return;
  ctx.activeReferenceTransform = defaultReferenceTransform(ctx.activeReferenceImage.naturalWidth, ctx.activeReferenceImage.naturalHeight);
  commitReferenceTransform();
  ctx.render();
  ctx.setStatus('Reference put back where it landed on import.');
}

/** True once the reference has been moved or scaled away from its import position. */
function referenceTransformChanged() {
  if (!ctx.activeReferenceTransform || !ctx.activeReferenceImage) return false;
  const base = defaultReferenceTransform(ctx.activeReferenceImage.naturalWidth, ctx.activeReferenceImage.naturalHeight);
  return (
    Math.abs(base.scale - ctx.activeReferenceTransform.scale) > 1e-4 ||
    Math.abs(base.dx - ctx.activeReferenceTransform.dx) > 0.5 ||
    Math.abs(base.dy - ctx.activeReferenceTransform.dy) > 0.5
  );
}

export async function addColorizedReferenceFromFile(file) {
  const i = ctx.getCurrentFrameSelectIndex();
  if (i == null) {
    ctx.setStatus('Pick a frame first.');
    return;
  }
  const { frameId, poolId } = referenceScopesForFrameIndex(i);
  if (!frameId && !poolId) {
    ctx.setStatus('This frame has no id in the pack — recapture it from the emulator.');
    return;
  }
  let made;
  try {
    made = await referenceBlobFromFile(file);
  } catch (err) {
    ctx.setStatus(`Reference not added: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const refId = newReferenceId();
  ctx.referenceBlobs.set(refId, made.blob);
  ctx.referenceUrls.set(refId, URL.createObjectURL(made.blob));
  ctx.packReferences = addReference(ctx.packReferences, {
    refId,
    // Scoped to the game state when the frame matches one, so every frame of that state uses it.
    scope: poolId ? 'pool' : 'frame',
    scopeId: poolId || frameId,
    sourceFrameId: frameId,
    originalName: file.name,
    originalSize: made.originalSize,
    transform: made.transform,
  });
  ctx.referencesDirty = true;
  ctx.referenceOverlayEnabled = true;
  refreshFrameReference(i);
  const scopeWord = poolId ? 'this game state' : 'this frame';
  const [ow, oh] = made.originalSize;
  const shaped = Math.abs(ow / oh - ctx.W / ctx.H) / (ctx.W / ctx.H) > 0.01 ? ' — its shape differs from the frame, so use Move & scale' : '';
  ctx.setStatus(`Reference added for ${scopeWord}${shaped}. Save the pack to keep it.`);
}

export function removeActiveReference() {
  if (!ctx.activeReferenceMeta) return;
  const refId = ctx.activeReferenceMeta.refId;
  ctx.packReferences = removeReference(ctx.packReferences, refId);
  const url = ctx.referenceUrls.get(refId);
  if (url) URL.revokeObjectURL(url);
  ctx.referenceUrls.delete(refId);
  ctx.referenceBlobs.delete(refId);
  ctx.referencesDirty = true;
  refreshFrameReference(ctx.getCurrentFrameSelectIndex());
  ctx.setStatus('Reference removed. Save the pack to keep that.');
}

/** Reference images for the pack writer: only the ones the manifest still lists. */
export function referencesFolderForSave() {
  const wanted = new Set(ctx.packReferences.items.map((r) => r.refId));
  const out = [];
  for (const [refId, blob] of ctx.referenceBlobs) {
    if (wanted.has(refId)) out.push({ name: referenceFileName(refId), blob });
  }
  return out;
}

/** The reference as pixels, for sampling — drawn once per image into a scratch canvas. */
let referencePixels = null;
let referencePixelsKey = '';
function referenceImageDataForFill() {
  if (!ctx.activeReferenceImage || !ctx.activeReferenceTransform) return null;
  const img = ctx.activeReferenceImage;
  const key = `${ctx.activeReferenceMeta?.refId}|${img.naturalWidth}x${img.naturalHeight}`;
  if (referencePixelsKey !== key) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx = c.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    cx.drawImage(img, 0, 0);
    referencePixels = { data: cx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
    referencePixelsKey = key;
  }
  return { ...referencePixels, transform: ctx.activeReferenceTransform };
}

/**
 * Take the selected tiles' colours out of the reference, once per tile pattern — the same
 * action SpriteStudio has, over whatever is selected here.
 */
export function fillSelectionFromReference() {
  const image = referenceImageDataForFill();
  if (!image || !ctx.currentState?.drawList?.length) {
    ctx.setStatus('Add a colorized reference for this frame first (Frame ▸ Add colorized reference…).');
    return;
  }
  if (ctx.selectedDrawFullIndices.size === 0) {
    ctx.setStatus('Select the tiles to fill first.');
    return;
  }
  const placements = [];
  const patterns = new Map();
  for (const i of ctx.selectedDrawFullIndices) {
    const d = ctx.currentState.drawList[i];
    if (!d) continue;
    const bytes = getTileBytes(ctx.currentState.patternTable, d.tileIndex);
    if (!bytes) continue;
    const hash = hashTile(bytes) >>> 0;
    placements.push({ hash, x: d.x, y: d.y, flipH: !!d.flipH, flipV: !!d.flipV });
    if (!patterns.has(hash)) patterns.set(hash, { bytes, shades: shadesOfTileBytes(bytes) });
  }
  const patternOf = (hash) => patterns.get(hash) || null;

  // An anchored group paints by position, so fill it the same way the brush does — sampling
  // each copy where it actually sits, rather than averaging the copies into one pattern.
  // Routing this differently from the brush is what used to split one group across two stores.
  const overlayGroup = ctx.getSelectedPaintGroupOrNull();
  if (overlayGroup && ctx.useVipOverlayForZoomPaint(overlayGroup)) {
    const eye = ctx.getEye();
    const buf = ctx.ensureVipOverlayBufferForGroupEye(overlayGroup.id, eye);
    const shot = referencePixelsForPlacements(image, placements, patternOf);
    if (!shot.pixels.length) {
      ctx.setStatus('The reference does not reach any of the selected tiles.');
      return;
    }
    ctx.pushPaintUndo({ kind: 'vip', groupId: overlayGroup.id, eye, prev: Uint8Array.from(buf) });
    ctx.paintEditsSinceSave++;
    for (const { x, y, color } of shot.pixels) {
      if (x < 0 || x >= ctx.W || y < 0 || y >= ctx.H) continue;
      const o = (y * ctx.W + x) * 4;
      buf[o] = color[0];
      buf[o + 1] = color[1];
      buf[o + 2] = color[2];
      buf[o + 3] = 255;
    }
    ctx.render();
    ctx.syncLastTopTileFromSelection();
    ctx.updatePaintV2TopButton();
    if (ctx.paintInventoryDialog?.open) ctx.renderPaintInventory();
    ctx.setStatus(
      `Filled ${shot.tiles} tile(s) from the reference into “${overlayGroup.name || overlayGroup.id}”`
        + ` (its anchored overlay — each copy takes the colours over it).`
        + (shot.skipped ? ` ${shot.skipped} tile(s) the reference does not reach were left alone.` : ''),
    );
    return;
  }

  const out = fillTilesFromReference(image, placements, patternOf);
  if (!out.tiles.size) {
    ctx.setStatus('The reference does not reach any of the selected tiles.');
    return;
  }
  ctx.activePaintUndoMap = new Map();
  ctx.activePaintUndoGroupId = ctx.paintTargetGroupOrNull()?.id ?? null;
  for (const [hash, rgba] of out.tiles) {
    const had = ctx.paintTargetHasHash(hash);
    const buf = ctx.getPackRgba256ForHash(hash, patterns.get(hash).bytes);
    if (!ctx.activePaintUndoMap.has(hash)) ctx.activePaintUndoMap.set(hash, had ? Uint8Array.from(buf) : null);
    buf.set(rgba);
  }
  ctx.commitPaintUndoStroke();
  ctx.render();
  ctx.syncLastTopTileFromSelection();
  ctx.updatePaintV2TopButton();
  const conflicts = out.conflicts.length ? ` · ${out.conflicts.length} pattern(s) had copies coloured differently (majority used)` : '';
  const missed = out.skipped ? ` · ${out.skipped} not covered` : '';
  ctx.setStatus(`Filled ${out.patterns} tile pattern(s) from ${out.placements} selected tile(s)${conflicts}${missed}. Undo with the paint undo.`);
}

/** The 64 shades of a tile, in pattern order — 2 bits per pixel, 2 bytes per row. */
function shadesOfTileBytes(bytes) {
  const shades = new Uint8Array(64);
  for (let py = 0; py < 8; py++) {
    const word = bytes[py * 2] | (bytes[py * 2 + 1] << 8);
    for (let px = 0; px < 8; px++) shades[py * 8 + px] = (word >> (px * 2)) & 3;
  }
  return shades;
}
