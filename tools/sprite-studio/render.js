/**
 * SpriteStudio's drawing: the frame on stage composited (memoized per frame and view), the selected
 * group's pose layer over it, onion skin, the ghost and selection boxes, and the detail panel. Split
 * out of tools/sprite-studio.js, which passes in the state and functions it shares (initRender).
 */
import { getCompositePixelInfo } from '../../src/color-layer.js';
import { stereoTwins } from '../../src/stereo-twin.js';
import { frameState, frameWram, renderFrame, renderPoseLayer, poseBounds, poseTileLookup, shadeAt, frameLabel, FRAME_W, FRAME_H } from '../shared/pack-session.js';
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { freeCrop } from '../shared/stage-view.js';
import { isObjGroup, patternsInNoPose } from '../../src/obj-sprite-profiles.js';
import { layerArtOf, layerArtPixels, layerArtStageRect, paintLayerArt } from '../../src/layer-art.js';
import { isStarterShade } from '../../src/starter-paint.js';
import { paintOriginal } from '../../src/original-view.js';
import { getWindowsTableBytesFromState } from '../../src/vip-world-clip.js';
import { overpaintPanel, selectedArt, showTouchUps } from './overpaint.js';
import { folderPicker } from './group-list.js';
import { completePose, isUnpaintedPixel } from './painting.js';
import { canFindPoses, openFindPoses } from './find-poses.js';
import { deletePose, isAnimatedGroup, isDeletablePose, isFrameCard, keepFrameAsPose, keepPatternsInNoPoseAsPoses, poseMovePicker, removePatternsInNoPose, renamePose, storedPose } from './poses.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initRender(context) {
  ctx = context;
}

/* ----------------------------------------------------------------- render */

let composedKey = '';
let poseLayerKey = '';

/** Something the stage or the cards show changed: compose them again on the next draw. */
export function invalidateRender() {
  composedKey = '';
  poseLayerKey = '';
  originalKey = '';
}

/** Composite a frame into `frameCanvas`, memoized on frame + view settings. */
export function composeFrame(frameIndex) {
  const state = frameState(ctx.session, frameIndex);
  if (!state) return false;
  const key = `${frameIndex}|${ctx.eye()}|${ctx.brightness()}|${showTouchUps()}|${showUnpainted()}`;
  if (key === composedKey) return true;
  renderFrame({ session: ctx.session, state, imageData: ctx.frameImage, eye: ctx.eye(), brightness: ctx.brightness(), touchUps: showTouchUps(), monoFallback: showUnpainted(), wram: frameWram(ctx.session, frameIndex) });
  ctx.frameCtx.putImageData(ctx.frameImage, 0, 0);
  composedKey = key;
  return true;
}

/** A neighbouring pose, rendered for onion skinning (no memo — it changes constantly). */
function renderGhostPose(view) {
  if (!view?.origin || view.frameIndex < 0) return false;
  const state = frameState(ctx.session, view.frameIndex);
  if (!state) return false;
  const ok = renderPoseLayer({
    session: ctx.layerSession(),
    state,
    pose: view.pose,
    origin: view.origin,
    imageData: ctx.ghostImage,
    eye: ctx.eye(),
    brightness: ctx.brightness(),
    groupId: ctx.selectedGroup?.id || null,
    monoFallback: showUnpainted(),
  });
  ctx.ghostCtx.clearRect(0, 0, FRAME_W, FRAME_H);
  ctx.ghostCtx.putImageData(ctx.ghostImage, 0, 0);
  return ok;
}

/**
 * The colorized reference for this frame's game state, drawn over the sprite so you can
 * paint from it. Its placement (`scale`, `dx`, `dy` in frame pixels) was set once in the
 * Project tool and lives in the pack — nothing is aligned twice here.
 */
function drawReferenceImage(crop, scale) {
  const img = ctx.activeReference?.image;
  if (!img || (!ctx.el('toggle-reference').checked && !ctx.referencePeek)) return;
  const t = ctx.activeReference.transform;
  ctx.stageCtx.save();
  ctx.stageCtx.globalAlpha = ctx.referencePeek ? 1 : Number(ctx.el('reference-alpha').value) || 0.6;
  if (ctx.el('toggle-reference-clip').checked) clipToCurrentGroupTiles(crop, scale);
  ctx.stageCtx.imageSmoothingEnabled = true;
  const w = img.naturalWidth * t.scale * scale;
  const h = img.naturalHeight * t.scale * scale;
  const x = (t.dx - crop.x) * scale;
  const y = (t.dy - crop.y) * scale;
  if (ctx.flipReferenceX || ctx.flipReferenceY) {
    // Flip about the image's own box, so it stays where it was placed.
    ctx.stageCtx.translate(x + (ctx.flipReferenceX ? w : 0), y + (ctx.flipReferenceY ? h : 0));
    ctx.stageCtx.scale(ctx.flipReferenceX ? -1 : 1, ctx.flipReferenceY ? -1 : 1);
    ctx.stageCtx.drawImage(img, 0, 0, w, h);
  } else {
    ctx.stageCtx.drawImage(img, x, y, w, h);
  }
  ctx.stageCtx.restore();
}

/** Limit drawing to the tiles the current group paints, so the rest stops competing. */
function clipToCurrentGroupTiles(crop, scale) {
  const view = ctx.poseViews[ctx.poseIndex];
  if (!view?.origin) return;
  const path = new Path2D();
  for (const tile of view.pose.tiles || []) {
    const x = view.origin.x + (tile.dx || 0);
    const y = view.origin.y + (tile.dy || 0);
    path.rect((x - crop.x) * scale, (y - crop.y) * scale, 8 * scale, 8 * scale);
  }
  ctx.stageCtx.clip(path);
}

/** Composite just this pose's draws into `poseCanvas`, transparent elsewhere. */
export function composePoseLayer(view) {
  // Only the group's own picture can hide the tiles (never a pose's), whichever card is on stage.
  const art = ctx.selectedGroup && !isObjGroup(ctx.selectedGroup) ? layerArtOf(ctx.selectedGroup) : null;
  if (art?.hideTiles) {
    // Layer art: the picture across the layer's whole window, drawn through the frame's scroll.
    const st = view.frameIndex >= 0 ? frameState(ctx.session, view.frameIndex) : null;
    const px = layerArtPixels(ctx.selectedGroup);
    if (!st || !px) return false;
    const key = `art|${view.frameIndex}|${ctx.eye()}`;
    if (key === poseLayerKey) return true;
    ctx.poseImage.data.fill(0);
    const windows = getWindowsTableBytesFromState(st);
    // The right eye of a left-only layer is drawn by its right-only twin (src/stereo-twin.js).
    const twin = ctx.eye() === 1 ? [...stereoTwins(windows)].find(([, t]) => t.left === art.world) : null;
    const entry = twin ? { world: twin[0], twin: twin[1] } : { world: art.world };
    paintLayerArt(ctx.poseImage.data, null, windows, ctx.eye(), { ...entry, art, pixels: px, ownerIndex: 0 }, 1);
    ctx.poseCtx.clearRect(0, 0, FRAME_W, FRAME_H);
    ctx.poseCtx.putImageData(ctx.poseImage, 0, 0);
    poseLayerKey = key;
    return true;
  }
  const state = view.origin && view.frameIndex >= 0 ? frameState(ctx.session, view.frameIndex) : null;
  if (!state) return false;
  const key = `${view.frameIndex}|${view.pose.poseId}|${view.origin.x},${view.origin.y}|${ctx.eye()}|${ctx.brightness()}|${showTouchUps()}|${showUnpainted()}|${ctx.ownPaintOnly()}`;
  if (key === poseLayerKey) {
    view.unpainted = poseLayerUnpainted;
    return true;
  }
  const ok = renderPoseLayer({
    session: ctx.layerSession(),
    state,
    pose: view.pose,
    origin: view.origin,
    imageData: ctx.poseImage,
    eye: ctx.eye(),
    brightness: ctx.brightness(),
    groupId: ctx.selectedGroup?.id || null,
    touchUp: showTouchUps(),
    monoFallback: showUnpainted(),
  });
  // Pixels coloured by layer art, a touch-up or the left eye (a stereo twin) are not their tile's paint.
  const covered = getCompositePixelInfo().art;
  // The card's unpainted pixels (its cyan mark, Painting complete), counted before the tint changes them.
  poseLayerUnpainted = ok ? countUnpainted(view, state, covered) : 0;
  view.unpainted = poseLayerUnpainted;
  if (ok && showUnpainted()) tintStarterPixels(view, state, ctx.poseImage, covered);
  ctx.poseCtx.clearRect(0, 0, FRAME_W, FRAME_H);
  ctx.poseCtx.putImageData(ctx.poseImage, 0, 0);
  poseLayerKey = key;
  return ok;
}

/** Unpainted pixels of the pose layer composed last, for a card that composes to the same layer again. */
let poseLayerUnpainted = 0;

/**
 * Lit pixels of a card nothing has chosen a colour for (no paint, clear, or a starting grey) that
 * no picture covers — what Painting complete would keep, and what the card's cyan mark stands for.
 */
function countUnpainted(view, state, covered = null) {
  const bounds = poseBounds(view.pose, view.origin);
  if (!bounds) return 0;
  const lookup = poseTileLookup(state, view.pose, view.origin, ctx.eye());
  let n = 0;
  for (let y = Math.max(0, bounds.y0); y < Math.min(FRAME_H, bounds.y1); y++) {
    for (let x = Math.max(0, bounds.x0); x < Math.min(FRAME_W, bounds.x1); x++) {
      if (covered?.[y * FRAME_W + x]) continue;
      const hit = lookup(x, y);
      if (hit && isUnpaintedPixel(hit)) n++;
    }
  }
  return n;
}

/** Show unpainted: tiles with no paint in red, as the Project tool shows them, and leftover starting greys tinted. */
export function showUnpainted() {
  return !!ctx.el('toggle-unpainted')?.checked;
}

/** Tint for a pixel still on a starting grey: red over it at this strength. */
const STARTER_TINT = 0.45;

/**
 * Pixels of painted tiles that still hold a starting grey (src/starter-paint.js) get a red tint:
 * nobody chose a colour there, but the game will show that grey. Works through the same lookup
 * the brush uses, so scaled (affine) cards and base tiles are covered too.
 */
function tintStarterPixels(view, state, image, covered = null) {
  const bounds = poseBounds(view.pose, view.origin);
  if (!bounds) return;
  const lookup = poseTileLookup(state, view.pose, view.origin, ctx.eye());
  const d = image.data;
  for (let y = Math.max(0, bounds.y0); y < Math.min(FRAME_H, bounds.y1); y++) {
    for (let x = Math.max(0, bounds.x0); x < Math.min(FRAME_W, bounds.x1); x++) {
      const i = (y * FRAME_W + x) * 4;
      if (!d[i + 3] || covered?.[y * FRAME_W + x]) continue;
      const hit = lookup(x, y);
      if (!hit || pixelPaintState(hit) !== 'starter') continue;
      d[i] = Math.round(d[i] * (1 - STARTER_TINT) + 255 * STARTER_TINT);
      d[i + 1] = Math.round(d[i + 1] * (1 - STARTER_TINT));
      d[i + 2] = Math.round(d[i + 2] * (1 - STARTER_TINT));
    }
  }
}

/**
 * A pose pixel's paint: 'none' (its tile has no paint, so the game shows the original picture),
 * 'starter' (painted tile, but this lit pixel still holds a starting grey), 'transparent' (a pixel
 * the game leaves see-through) or 'painted'.
 */
export function pixelPaintState(hit) {
  const value = shadeAt(hit.tileBytes, hit.lx, hit.ly);
  const rgba = ctx.colourForHash(hit.hash);
  if (!rgba) return value ? 'none' : 'transparent';
  if (!value) return 'transparent';
  return isStarterShade(rgba, hit.ly * 8 + hit.lx, value) ? 'starter' : 'painted';
}

/** How much of a card is painted: its tile patterns with paint, and lit pixels left on a starting grey. */
function paintProgress(view) {
  const patterns = [...new Set(ctx.viewPatterns(view))];
  const painted = patterns.filter((h) => ctx.colourForHash(h));
  let starter = 0;
  const state = view.frameIndex >= 0 ? frameState(ctx.session, view.frameIndex) : null;
  for (const h of painted) {
    const rgba = ctx.colourForHash(h);
    const bytes = state ? patternBytesFor(state, h) : null;
    if (!bytes) continue;
    for (let i = 0; i < 64; i++) {
      const value = shadeAt(bytes, i % 8, (i / 8) | 0);
      if (value && isStarterShade(rgba, i, value)) starter++;
    }
  }
  return { painted: painted.length, total: patterns.length, starter };
}

/** A pattern's bytes from a frame that shows it, found by hash (memoized per frame). */
const patternBytesCache = new WeakMap();
function patternBytesFor(state, hash) {
  let byHash = patternBytesCache.get(state);
  if (!byHash) {
    byHash = new Map();
    for (const d of state.drawList || []) {
      const bytes = getTileBytes(state.patternTable, d.tileIndex);
      const h = hashTile(bytes) >>> 0;
      if (!byHash.has(h)) byHash.set(h, bytes);
    }
    patternBytesCache.set(state, byHash);
  }
  return byHash.get(hash >>> 0) || null;
}

export function onionOn() {
  return !!ctx.el('toggle-onion')?.checked;
}

/** The pose chosen to ghost on top, or '' for the previous and next poses behind. */
export function onionPick() {
  return ctx.el('onion-pose')?.value || '';
}

function onionAlpha() {
  const v = Number(ctx.el('onion-alpha')?.value);
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : ctx.ONION_ALPHA;
}

/** True while O is held: the original picture at full strength, whatever Original is set to. */
let originalPeek = false;

/** Hold O to see the original picture; let go to see the paint again. */
export function setOriginalPeek(on) {
  originalPeek = !!on;
}

/** Original: the pose's monochrome picture, as the game draws it, over the paint. */
export function originalOn() {
  return originalPeek || !!ctx.el('toggle-original')?.checked;
}

function originalAlpha() {
  if (originalPeek) return 1;
  const v = Number(ctx.el('original-alpha')?.value);
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 1;
}

let originalCanvas = null;
let originalKey = '';

/** The pose's original picture in a frame-sized canvas, transparent elsewhere (memoized). */
function composeOriginal(view) {
  const state = view?.origin && view.frameIndex >= 0 ? frameState(ctx.session, view.frameIndex) : null;
  const bounds = state ? poseBounds(view.pose, view.origin) : null;
  if (!bounds) return null;
  if (!originalCanvas) {
    originalCanvas = document.createElement('canvas');
    originalCanvas.width = FRAME_W;
    originalCanvas.height = FRAME_H;
  }
  const key = `${view.frameIndex}|${view.pose.poseId}|${view.origin.x},${view.origin.y}|${ctx.eye()}`;
  if (key === originalKey) return originalCanvas;
  const octx = /** @type {CanvasRenderingContext2D} */ (originalCanvas.getContext('2d'));
  const image = octx.createImageData(FRAME_W, FRAME_H);
  const lookup = poseTileLookup(state, view.pose, view.origin, ctx.eye());
  paintOriginal({
    data: image.data,
    width: FRAME_W,
    height: FRAME_H,
    bounds,
    lookup: (x, y) => {
      const hit = lookup(x, y);
      return hit ? { value: shadeAt(hit.tileBytes, hit.lx, hit.ly), draw: hit.draw } : null;
    },
    gplt: state.gplt,
  });
  octx.putImageData(image, 0, 0);
  originalKey = key;
  return originalCanvas;
}

/** The onion pose menu follows the filmstrip, keeping the chosen pose while it is still there. */
export function renderOnionOptions() {
  const select = /** @type {HTMLSelectElement|null} */ (ctx.el('onion-pose'));
  if (!select) return;
  const keep = select.value;
  select.textContent = '';
  const opt = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };
  select.append(opt('', 'Previous & next'), ...ctx.poseViews.map((v) => opt(v.pose.poseId, v.pose.name || v.pose.poseId)));
  select.value = ctx.poseViews.some((v) => v.pose.poseId === keep) ? keep : '';
}

export function drawStage() {
  const view = ctx.poseViews[ctx.poseIndex] || null;
  const showBackground = ctx.el('toggle-background').checked;
  const zoom = ctx.el('toggle-zoom').checked;
  const outline = ctx.el('toggle-outline').checked;
  const artRect = artStageRect(view);
  const bounds = artRect || (view?.origin ? poseBounds(view.pose, view.origin) : null);
  const setRect = artRect ? null : oneSetRect(view);
  // Fit goes to the one set when there is one, so a repeating backdrop is not the whole screen.
  // Layer art frames the layer's whole window: that is what the picture covers.
  const focus = setRect || bounds;

  const wrap = ctx.canvas.parentElement;
  const availW = Math.max(160, (wrap?.clientWidth || 768) - 24);
  const availH = Math.max(120, (wrap?.clientHeight || 560) - 24);
  ctx.stageAvail = { w: availW, h: availH };
  const frameSize = { w: FRAME_W, h: FRAME_H };

  const crop = ctx.freeView
    ? freeCrop(ctx.freeView, ctx.stageAvail, frameSize)
    : zoom && focus
      ? {
          x: Math.max(0, focus.x0 - ctx.STAGE_PAD),
          y: Math.max(0, focus.y0 - ctx.STAGE_PAD),
          w: Math.min(FRAME_W, focus.x1 + ctx.STAGE_PAD) - Math.max(0, focus.x0 - ctx.STAGE_PAD),
          h: Math.min(FRAME_H, focus.y1 + ctx.STAGE_PAD) - Math.max(0, focus.y0 - ctx.STAGE_PAD),
        }
      : { x: 0, y: 0, w: FRAME_W, h: FRAME_H };
  const scale = ctx.freeView ? ctx.freeView.scale : Math.max(1, Math.floor(Math.min(availW / crop.w, availH / crop.h)));
  ctx.stageCrop = crop;
  ctx.stageScale = scale;
  const paneW = crop.w * scale;
  const paneH = crop.h * scale;
  ctx.stagePaneW = paneW;
  ctx.canvas.width = ctx.sideBySide() ? paneW * 2 + ctx.PANE_GAP : paneW;
  ctx.canvas.height = paneH;
  ctx.stageCtx.imageSmoothingEnabled = false;
  // A loud colour here is the point: dark sprite edges vanish against a dark scene.
  ctx.stageCtx.fillStyle = ctx.stageBackgroundColor();
  ctx.stageCtx.fillRect(0, 0, paneW, paneH);

  if (!view || view.frameIndex < 0 || !composeFrame(view.frameIndex)) {
    ctx.el('stage-note').textContent = ctx.session ? 'No pose to show.' : '';
    return;
  }

  // Flip the painted pane as a view only; the reference pane and the boxes stay upright.
  ctx.stageCtx.save();
  if (ctx.flipViewX || ctx.flipViewY) {
    ctx.stageCtx.translate(ctx.flipViewX ? paneW : 0, ctx.flipViewY ? paneH : 0);
    ctx.stageCtx.scale(ctx.flipViewX ? -1 : 1, ctx.flipViewY ? -1 : 1);
  }

  if (showBackground) {
    // A pinned frame keeps one scene behind every pose, so playback does not
    // cut between backgrounds while the sprite animates.
    const bgIndex = ctx.el('toggle-pin-background').checked && ctx.pinnedFrameIndex >= 0 ? ctx.pinnedFrameIndex : view.frameIndex;
    if (composeFrame(bgIndex)) {
      ctx.stageCtx.drawImage(ctx.frameCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, paneW, paneH);
    }
  }

  drawReferenceImage(crop, scale);

  // Onion skin, "Previous & next": the neighbouring poses, faint, behind this one.
  if (onionOn() && !onionPick() && ctx.poseViews.length > 1) {
    ctx.stageCtx.save();
    ctx.stageCtx.globalAlpha = onionAlpha();
    for (const offset of [-1, 1]) {
      const ghost = ctx.poseViews[(ctx.poseIndex + offset + ctx.poseViews.length) % ctx.poseViews.length];
      if (!ghost || ghost === view || !renderGhostPose(ghost)) continue;
      ctx.stageCtx.drawImage(ctx.ghostCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, paneW, paneH);
    }
    ctx.stageCtx.restore();
  }

  if (composePoseLayer(view)) {
    ctx.stageCtx.save();
    if (ctx.stageMirror && bounds) {
      // Flip about the sprite's own vertical centre so it stays in place.
      const axis = ((bounds.x0 + bounds.x1) / 2 - crop.x) * scale;
      ctx.stageCtx.translate(axis * 2, 0);
      ctx.stageCtx.scale(-1, 1);
    }
    if (setRect) {
      // Every copy for context, faint; then the one set at full strength.
      ctx.stageCtx.globalAlpha = ctx.OTHER_COPIES_ALPHA;
      ctx.stageCtx.drawImage(ctx.poseCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, paneW, paneH);
      ctx.stageCtx.globalAlpha = 1;
      ctx.stageCtx.beginPath();
      ctx.stageCtx.rect((setRect.x0 - crop.x) * scale, (setRect.y0 - crop.y) * scale, (setRect.x1 - setRect.x0) * scale, (setRect.y1 - setRect.y0) * scale);
      ctx.stageCtx.clip();
    }
    ctx.stageCtx.drawImage(ctx.poseCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, paneW, paneH);
    // Original: the game's monochrome over the paint, lined up pixel for pixel, so bulk-filled
    // paint can be checked (and erased) against what the game draws.
    const original = originalOn() && !selectedArt()?.hideTiles ? composeOriginal(view) : null;
    if (original) {
      ctx.stageCtx.globalAlpha = originalAlpha();
      ctx.stageCtx.drawImage(original, crop.x, crop.y, crop.w, crop.h, 0, 0, paneW, paneH);
    }
    ctx.stageCtx.restore();
  }

  // Onion skin, one chosen pose: on top, lined up on its anchor tile so it sits over this pose
  // even when the two were captured on different frames or in different places.
  const picked = onionOn() && onionPick() ? ctx.poseViews.find((v) => v.pose.poseId === onionPick()) : null;
  if (picked && picked !== view && picked.origin && view.origin && renderGhostPose(picked)) {
    const dx = view.origin.x - picked.origin.x;
    const dy = view.origin.y - picked.origin.y;
    ctx.stageCtx.save();
    ctx.stageCtx.globalAlpha = onionAlpha();
    ctx.stageCtx.drawImage(ctx.ghostCanvas, crop.x - dx, crop.y - dy, crop.w, crop.h, 0, 0, paneW, paneH);
    ctx.stageCtx.restore();
  }

  const outlined = setRect || bounds;
  if (outline && outlined) {
    ctx.stageCtx.strokeStyle = 'rgba(94, 184, 168, 0.9)';
    ctx.stageCtx.lineWidth = Math.max(1, scale / 2);
    ctx.stageCtx.strokeRect(
      (outlined.x0 - crop.x) * scale,
      (outlined.y0 - crop.y) * scale,
      (outlined.x1 - outlined.x0) * scale,
      (outlined.y1 - outlined.y0) * scale,
    );
  }


  ctx.stageCtx.restore();

  if (ctx.sideBySide()) drawReferencePane(crop, scale, paneW, paneH);
  drawGhostBoxes(crop, scale, paneW);

  const setNote = setRect ? ` · one set: ${view.set.indices.length} of ${view.pose.tiles.length} tiles` : '';
  const zoomNote = ctx.freeView ? ' · wheel zoom (Fit to reset)' : '';
  ctx.el('stage-note').textContent = `${frameLabel(ctx.session, view.frameIndex) || '—'} · ${scale}×${zoomNote}${setNote}${ctx.stageMirror ? ' · mirrored' : ''}${originalOn() ? ' · original' : ''}${ctx.sideBySide() ? ' · painted | reference' : ''}`;
}

/** The layer's window on screen, when the selected group's overpaint hides its tiles. */
function artStageRect(view) {
  const art = selectedArt()?.hideTiles ? selectedArt() : null;
  const st = art && view && view.frameIndex >= 0 ? frameState(ctx.session, view.frameIndex) : null;
  return st ? layerArtStageRect(getWindowsTableBytesFromState(st), art.world, ctx.eye(), art) : null;
}

/** The one set in frame pixels, when One set is on and the group's pattern repeats. */
function oneSetRect(view) {
  if (!view?.set || !view.origin || !ctx.el('toggle-one-set').checked) return null;
  const { x0, y0, x1, y1 } = view.set;
  return { x0: view.origin.x + x0, y0: view.origin.y + y0, x1: view.origin.x + x1, y1: view.origin.y + y1 };
}

/** The shade colours an animated group gives the steps nobody painted. */
function describeShadeRamp(ramp) {
  if (!Array.isArray(ramp) || !ramp.some(Boolean)) return 'mono — paint a phase to set their colours';
  return [1, 2, 3].map((s) => `${s}: ${ramp[s] || '—'}`).join('  ');
}

/** A plain-words summary of how a pattern repeats. */
function describeRepeat(set) {
  const across = set.periodX ? `every ${set.periodX} px across` : '';
  const down = set.periodY ? `every ${set.periodY} px down` : '';
  return [across, down].filter(Boolean).join(', ');
}


/** The right-hand pane: the reference alone, over the same frame region at the same scale. */
function drawReferencePane(crop, scale, paneW, paneH) {
  const x0 = paneW + ctx.PANE_GAP;
  ctx.stageCtx.save();
  ctx.stageCtx.fillStyle = '#0b0b0d';
  ctx.stageCtx.fillRect(x0, 0, paneW, paneH);
  const img = ctx.activeReference?.image;
  if (img) {
    const t = ctx.activeReference.transform;
    ctx.stageCtx.beginPath();
    ctx.stageCtx.rect(x0, 0, paneW, paneH);
    ctx.stageCtx.clip();
    ctx.stageCtx.imageSmoothingEnabled = true;
    ctx.stageCtx.drawImage(
      img,
      x0 + (t.dx - crop.x) * scale,
      (t.dy - crop.y) * scale,
      img.naturalWidth * t.scale * scale,
      img.naturalHeight * t.scale * scale,
    );
  } else {
    ctx.stageCtx.fillStyle = '#666';
    ctx.stageCtx.font = '12px system-ui';
    ctx.stageCtx.fillText('no reference', x0 + 10, 20);
  }
  ctx.stageCtx.restore();
}

/**
 * The ghost box, drawn on both panes: the left one is where paint lands, the right one is
 * where the colours come from. Moving the right one aims a paste without touching the
 * placement the whole pack shares.
 */
function drawGhostBoxes(crop, scale, paneW) {
  if (!ctx.ghostStage) return;
  const box = (rect, xOffset, color, label) => {
    const x = xOffset + (rect.x - crop.x) * scale;
    const y = (rect.y - crop.y) * scale;
    const w = rect.w * scale;
    const h = rect.h * scale;
    ctx.stageCtx.save();
    ctx.stageCtx.lineWidth = 1;
    ctx.stageCtx.setLineDash([5, 3]);
    ctx.stageCtx.strokeStyle = '#000';
    ctx.stageCtx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.stageCtx.strokeStyle = color;
    ctx.stageCtx.lineDashOffset = 5;
    ctx.stageCtx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.stageCtx.setLineDash([]);
    ctx.stageCtx.fillStyle = color;
    for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) ctx.stageCtx.fillRect(hx - 2.5, hy - 2.5, 5, 5);
    if (label) {
      ctx.stageCtx.font = '10px system-ui';
      ctx.stageCtx.fillText(label, x + 3, Math.max(10, y - 3));
    }
    ctx.stageCtx.restore();
  };
  box(ctx.ghostStage, 0, '#5eb8a8', ctx.sideBySide() ? 'paint here' : '');
  if (ctx.sideBySide()) box(ctx.ghostRef || ctx.ghostStage, paneW + ctx.PANE_GAP, '#3ad2ff', 'take from here');
}

export function renderDetail() {
  const host = ctx.el('pose-detail');
  host.textContent = '';
  const view = ctx.poseViews[ctx.poseIndex];
  const message = (text) => {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    host.append(p);
  };
  if (!ctx.selectedGroup) {
    message('Select a sprite.');
    return;
  }
  host.append(folderPicker(ctx.selectedGroup));
  if (!isObjGroup(ctx.selectedGroup)) {
    host.append(overpaintPanel(ctx.selectedGroup));
  }
  if (!view) {
    message('This group has no poses yet. Capture them in the Project tool.');
    return;
  }
  const { pose } = view;
  const isBg = !isObjGroup(ctx.selectedGroup);
  const anchor = typeof pose.anchorHash === 'number' ? `#${(pose.anchorHash >>> 0).toString(16).toUpperCase()}` : '—';
  const frame = view.frameIndex >= 0 ? frameLabel(ctx.session, view.frameIndex) : 'not found';
  const rows = isBg
    ? [
        ['BG group', ctx.selectedGroup.name || ctx.selectedGroup.id],
        ...paintedRow(view),
        ...(isDeletablePose(pose) ? [['Pose', pose.name || pose.poseId]] : []),
        ['Region', `${pose.tiles.length} tile(s)`],
        ['Anchor', anchor],
        ['Frame', frame],
        ...(view.set ? [['One set', `${view.set.indices.length} of ${pose.tiles.length} tiles — repeats ${describeRepeat(view.set)}`]] : []),
        ...(isAnimatedGroup(ctx.selectedGroup)
          ? [
              ['Animated', `${ctx.selectedGroup.criteria.tileSlots.length} tile slot(s) · ${ctx.poseViews.length} phase(s) captured`],
              ['Unpainted steps', describeShadeRamp(ctx.selectedGroup.shadeRamp)],
            ]
          : []),
        [
          'Paint',
          ctx.hasOverlayPaint(ctx.selectedGroup)
            ? 'Overlay from the Project tool (hides pattern paint)'
            : `Here, per tile pattern — every copy (${pose.tiles.length}) follows`,
        ],
      ]
    : [
        ['Sprite', ctx.selectedGroup.name || ctx.selectedGroup.id],
        ...paintedRow(view),
        ['Pose', pose.name || pose.poseId],
        ['Tiles', `${pose.tiles.length}`],
        ['Anchor', anchor],
        ['Frame', frame],
        ['Matched here', `${view.matched} / ${view.total}`],
      ];
  if (pose.clippedAtCapture) rows.push(['Note', 'clipped at capture']);
  const dl = document.createElement('dl');
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    if (k === 'Matched here' && view.matched < view.total) dd.className = 'warn';
    dl.append(dt, dd);
  }
  host.append(dl);
  // Patterns the group still lists but no pose uses keep painting wherever the game shows them.
  const stray = patternsInNoPose(ctx.selectedGroup);
  if (stray.length) {
    const painted = stray.filter((h) => ctx.colourForHash(h)).length;
    const note = document.createElement('p');
    note.className = 'empty';
    note.id = 'stray-patterns-note';
    note.textContent = `${stray.length} tile pattern${stray.length === 1 ? '' : 's'} in this group ${stray.length === 1 ? 'is' : 'are'} in none of its poses${painted ? ` (${painted} painted — that paint still shows wherever they appear)` : ''}.`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.id = 'btn-remove-stray-patterns';
    remove.textContent = 'Remove…';
    remove.title = 'Take these patterns out of the group, with their paint';
    remove.addEventListener('click', removePatternsInNoPose);
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.id = 'btn-keep-stray-patterns';
    keep.textContent = 'Keep as pose';
    keep.title = 'Make poses from the frames that show these patterns, so you can repaint them (they may be a real frame of the animation)';
    keep.addEventListener('click', keepPatternsInNoPoseAsPoses);
    host.append(note, keep, remove);
  }
  if (isFrameCard(pose)) {
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.id = 'btn-pose-keep';
    keep.textContent = 'Keep as pose';
    keep.title = "Save this frame as one of the group's poses. A group with poses shows just those in the filmstrip.";
    keep.addEventListener('click', () => keepFrameAsPose(view));
    host.append(keep);
  }
  if (view.origin && view.frameIndex >= 0 && !selectedArt()?.hideTiles) {
    const left = view.unpainted || 0;
    const done = document.createElement('button');
    done.type = 'button';
    done.id = 'btn-pose-complete';
    done.textContent = left ? `Painting complete (${left.toLocaleString()} px left)` : 'Painting complete ✓';
    done.disabled = !left;
    done.title = left
      ? 'Keep every pixel still unpainted on this pose at the grey it shows now, as paint of its own, so it stops counting as unpainted. Tiles other poses share keep that grey too. Undo takes it back.'
      : 'Every pixel of this pose has a colour.';
    done.addEventListener('click', completePose);
    host.append(done);
  }
  if (canFindPoses(ctx.selectedGroup)) {
    const find = document.createElement('button');
    find.type = 'button';
    find.id = 'btn-find-poses';
    find.textContent = 'Find poses…';
    find.title = 'Look through the captured frames for poses of this character that are not kept yet, and for poses kept twice';
    find.addEventListener('click', openFindPoses);
    host.append(find);
  }
  const stored = storedPose(pose);
  if (isDeletablePose(stored) && !isAnimatedGroup(ctx.selectedGroup)) {
    const del = document.createElement('button');
    del.type = 'button';
    del.id = 'btn-pose-delete';
    del.textContent = 'Delete pose…';
    del.title = `Remove this pose from the ${isBg ? 'group' : 'sprite'} (Delete key). Painted tiles stay.`;
    del.addEventListener('click', () => deletePose(stored.poseId));
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.id = 'btn-pose-rename';
    rename.textContent = 'Rename…';
    rename.title = 'Give this pose a new name (F2)';
    rename.addEventListener('click', () => renamePose(stored.poseId));
    host.append(rename, del, poseMovePicker(stored));
  }
}

/** The Painted row of Pose details: how many of the card's tile patterns have paint. */
function paintedRow(view) {
  const p = paintProgress(view);
  const starter = p.starter ? ` · ${p.starter} pixel${p.starter === 1 ? '' : 's'} on a starting grey` : '';
  return [['Painted', `${p.painted} of ${p.total} tile pattern${p.total === 1 ? '' : 's'}${starter}`]];
}
