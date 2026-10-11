/**
 * SpriteStudio's tile painting tools: Brush, Eraser, Fill, Swap, Pick from the reference and Clone
 * on a group's patterns (and on its overpaint, through ./overpaint.js), the paint colour, and
 * starter shades for unpainted tiles. Split out of tools/sprite-studio.js, which passes in the state
 * and functions it shares (initPainting).
 */
import { frameState, poseBounds, poseTileAtVip, poseTileLookup, shadeAt, paintTilePixel, patternShades, paintTargetGroupFor } from '../shared/pack-session.js';
import { referenceColorAt } from '../../src/reference-fill.js';
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { floodFill } from '../../src/flood-fill.js';
import { isObjGroup } from '../../src/obj-sprite-profiles.js';
import { copyPixels, pixelAt } from '../../src/layer-art-edit.js';
import { isStarterShade } from '../../src/starter-paint.js';
import { activePicture, artChanged, fillArtAt, materializePosePicture, paintArtAt, pickArtAt, pushArtUndo } from './overpaint.js';
import { renderStrip } from './poses.js';
import { pushUndo, undoStack } from './history.js';
import { drawStage, invalidateRender } from './render.js';
import { colourForHash, paintStore, paneAt } from './ghost-box.js';
import { explainAt, hideExplainBubble } from './pick.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initPainting(context) {
  ctx = context;
}

/* --------------------------------------------------------------- painting */

export function setTool(next) {
  ctx.tool = next;
  hideExplainBubble();
  for (const [id, name] of [
    ['btn-tool-none', 'look'],
    ['btn-tool-brush', 'brush'],
    ['btn-tool-erase', 'erase'],
    ['btn-tool-fill', 'fill'],
    ['btn-tool-pick', 'pick'],
    ['btn-tool-clone', 'clone'],
    ['btn-tool-swap', 'swap'],
  ]) {
    ctx.el(id).classList.toggle('active', ctx.tool === name);
  }
  ctx.el('fill-options').hidden = ctx.tool !== 'fill';
  ctx.canvas.classList.toggle('painting', ctx.tool !== 'look');
}

export function paintColor() {
  // The eraser paints "nothing": see-through, which is what an unpainted pixel or picture shows.
  if (ctx.tool === 'erase') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = ctx.el('paint-color').value || '#ff0000';
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    a: 255,
  };
}

/** Client coords → VIP pixel, using the crop the stage last drew. */
export function vipFromClient(e) {
  const r = ctx.canvas.getBoundingClientRect();
  // Side by side widens the canvas; the painted pane is only the left part of it, so the
  // pointer has to be measured against that pane, not the whole element.
  const paneFraction = ctx.sideBySide() && ctx.canvas.width > 0 ? ctx.stagePaneW / ctx.canvas.width : 1;
  const paneWidth = Math.max(1, r.width * paneFraction);
  let u = (e.clientX - r.left) / paneWidth;
  let v = (e.clientY - r.top) / Math.max(1, r.height);
  // The flips are a view, so a click has to be read in the frame's own orientation.
  if (ctx.flipViewX) u = 1 - u;
  if (ctx.flipViewY) v = 1 - v;
  return {
    vx: Math.floor(ctx.stageCrop.x + u * ctx.stageCrop.w),
    vy: Math.floor(ctx.stageCrop.y + v * ctx.stageCrop.h),
  };
}

export function tileUnderPointer(e) {
  const view = ctx.poseViews[ctx.poseIndex];
  if (!view?.origin || view.frameIndex < 0) return null;
  const state = frameState(ctx.session, view.frameIndex);
  if (!state) return null;
  let { vx, vy } = vipFromClient(e);
  if (ctx.stageMirror) {
    // The stage shows this pose flipped; undo that to find the real pixel.
    const b = poseBounds(view.pose, view.origin);
    if (b) vx = b.x0 + b.x1 - 1 - vx;
  }
  return poseTileAtVip(state, view.pose, view.origin, vx, vy, ctx.eye());
}

/** Shades per pixel value a background pattern shows in on the current card's frame, memoized. */
export const seedShadeCache = new Map();
/**
 * What a tile's paint starts from when its first pixel is painted: background tiles take the shades
 * the game shows them in (its palette), the same greys the unpainted preview draws, so painting one
 * pixel leaves the rest of the tile looking unchanged. Sprite palettes are not in the frame data,
 * so sprite tiles start from their raw values.
 */
function seedShades(hash) {
  const view = ctx.poseViews[ctx.poseIndex];
  if (!ctx.selectedGroup || isObjGroup(ctx.selectedGroup) || !view || view.frameIndex < 0) return null;
  const key = `${view.frameIndex}:${hash >>> 0}`;
  if (!seedShadeCache.has(key)) seedShadeCache.set(key, patternShades(frameState(ctx.session, view.frameIndex), hash));
  return seedShadeCache.get(key);
}

export function paintAt(e) {
  materializePosePicture();
  if (activePicture()) {
    paintArtAt(e);
    return;
  }
  const hit = tileUnderPointer(e);
  if (!hit) {
    const { vx, vy } = vipFromClient(e);
    ctx.setStatus(`Nothing of this sprite at ${vx},${vy} — paint lands on the sprite's own tiles.`);
    return;
  }
  // The clone brush takes its colour from the reference at the pixel being painted.
  if (ctx.tool === 'clone') {
    const image = ctx.referenceImageData();
    const { vx, vy } = vipFromClient(e);
    const c = image ? referenceColorAt(image, vx, vy) : null;
    if (!c) {
      ctx.setStatus('The reference has nothing there to clone.');
      return;
    }
    ctx.el('paint-color').value = `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  }
  // Erasing a tile with no paint does nothing (painting it would seed it with starter shades).
  if (ctx.tool === 'erase' && !paintStore().has(hit.hash)) return;
  if (!ctx.strokeSnapshot) ctx.strokeSnapshot = new Map();
  if (!ctx.strokeSnapshot.has(hit.hash)) {
    // null = this pattern had no paint at all, so undo must remove the entry rather than
    // leave the default ramp behind.
    const existing = paintStore().get(hit.hash);
    ctx.strokeSnapshot.set(hit.hash, existing ? Uint8Array.from(existing) : null);
  }
  if (!paintTilePixel(ctx.session, hit.hash, hit.tileBytes, hit.lx, hit.ly, paintColor(), paintTargetGroupFor(ctx.selectedGroup), seedShades(hit.hash))) return;
  invalidateRender();
  drawStage();
}

/**
 * Fill the touching pixels of the clicked colour. It crosses tile edges within what is on
 * stage (this pose, or the BG group's region) unless Across tiles is off, skips pixels the game
 * draws as transparent, and — like every stroke here — paints tile patterns, so each copy of a
 * filled pattern changes too. One click is one undo step.
 */
export function floodFillAt(e) {
  materializePosePicture();
  if (activePicture()) {
    fillArtAt(e);
    return;
  }
  const view = ctx.poseViews[ctx.poseIndex];
  const start = tileUnderPointer(e);
  if (!view?.origin || !start) {
    ctx.setStatus('Nothing to fill there — click on the sprite or the group’s tiles.');
    return;
  }
  const state = frameState(ctx.session, view.frameIndex);
  let { vx, vy } = vipFromClient(e);
  if (ctx.stageMirror) {
    const b = poseBounds(view.pose, view.origin);
    if (b) vx = b.x0 + b.x1 - 1 - vx;
  }
  const lookup = poseTileLookup(state, view.pose, view.origin, ctx.eye());
  const across = ctx.el('toggle-fill-across').checked;
  const colourKeyAt = (x, y) => {
    const hit = lookup(x, y);
    if (!hit || (!across && hit.draw !== start.draw)) return null;
    const shade = shadeAt(hit.tileBytes, hit.lx, hit.ly);
    if (shade === 0) return null; // transparent in the game: never shows, never fills
    const buf = colourForHash(hit.hash);
    if (!buf) return `shade${shade}`;
    const i = (hit.ly * 8 + hit.lx) * 4;
    return `${buf[i]},${buf[i + 1]},${buf[i + 2]},${buf[i + 3]}`;
  };
  const region = floodFill(vx, vy, colourKeyAt);
  if (!region.length) {
    ctx.setStatus('That pixel is transparent in the game, so there is nothing to fill.');
    return;
  }
  const colour = paintColor();
  const snapshot = new Map();
  const store = paintStore();
  let changed = 0;
  for (const [x, y] of region) {
    const hit = lookup(x, y);
    if (!snapshot.has(hit.hash)) {
      const existing = store.get(hit.hash);
      snapshot.set(hit.hash, existing ? Uint8Array.from(existing) : null);
    }
    if (paintTilePixel(ctx.session, hit.hash, hit.tileBytes, hit.lx, hit.ly, colour, paintTargetGroupFor(ctx.selectedGroup), seedShades(hit.hash))) changed++;
  }
  if (!changed) {
    ctx.setStatus('That area is already this colour.');
    return;
  }
  pushUndo({ groupId: paintTargetGroupFor(ctx.selectedGroup)?.id ?? null, map: snapshot });
  if (undoStack.length > 50) undoStack.shift();
  ctx.el('btn-undo').disabled = false;
  ctx.markDirty();
  invalidateRender();
  drawStage();
  renderStrip();
  ctx.renderPalette();
  ctx.setStatus(`Filled ${region.length} px across ${snapshot.size} tile pattern(s)${across ? '' : ' (this tile only)'}. Undo puts it back.`);
}

/**
 * Every pattern the selected group paints, with its 16 bytes: the group's own pattern list, looked
 * up in character memory frame by frame (not just in draw lists — a tile the core never recorded,
 * like the far end of a perspective floor, still counts). Poses' frames are searched first.
 * @returns {Map<number, Uint8Array>}
 */
function groupPatterns(group) {
  const want = new Set((Array.isArray(group?.criteria?.hashes) ? group.criteria.hashes : []).map((h) => Number(h) >>> 0));
  for (const v of ctx.poseViews) for (const t of v.pose?.tiles || []) if (typeof t.hash === 'number') want.add(t.hash >>> 0);
  /** @type {Map<number, Uint8Array>} */
  const out = new Map();
  const first = [...new Set(ctx.poseViews.map((v) => v.frameIndex).filter((i) => i >= 0))];
  const order = [...first, ...ctx.session.frames.map((_, i) => i).filter((i) => !first.includes(i))];
  for (const i of order) {
    if (out.size === want.size) break;
    const st = frameState(ctx.session, i);
    if (!st?.patternTable) continue;
    for (let ch = 0; ch < 2048 && out.size < want.size; ch++) {
      const bytes = getTileBytes(st.patternTable, ch);
      const h = hashTile(bytes) >>> 0;
      if (want.has(h) && !out.has(h)) out.set(h, Uint8Array.from(bytes));
    }
  }
  return out;
}

/**
 * Swap (S): click a pixel, and every pixel of the group's tiles showing that same colour takes
 * the brush colour — across all its tiles and poses at once, as one undo step. Unpainted pixels
 * count as their shade, so a whole group can be blocked in shade by shade. On a touch-up or layer
 * art it swaps that exact colour inside the picture instead.
 */
export function swapColourAt(e) {
  const pic = activePicture();
  if (pic) {
    swapInPicture(e, pic);
    return;
  }
  const hit = tileUnderPointer(e);
  if (!hit) {
    ctx.setStatus('Click a pixel of this group’s tiles to choose the colour to swap.');
    return;
  }
  // A pixel's colour as you see it: its paint, or its shade when unpainted. Transparent pixels
  // (shade 0) count too — swapping them paints where the game draws nothing, like the grass
  // between a court's speckles (src/transparent-paint.js).
  // A starter shade (src/starter-paint.js) is unpainted too: a tile whose paint began when some
  // other pixel of it was painted must still match "unpainted" for the rest.
  const keyAt = (hash, bytes, lx, ly) => {
    const shade = shadeAt(bytes, lx, ly);
    const buf = colourForHash(hash);
    const i = (ly * 8 + lx) * 4;
    if (!buf || (shade === 0 && !buf[i + 3]) || isStarterShade(buf, ly * 8 + lx, shade)) return `shade${shade}`;
    return `${buf[i]},${buf[i + 1]},${buf[i + 2]},${buf[i + 3]}`;
  };
  const source = keyAt(hit.hash, hit.tileBytes, hit.lx, hit.ly);
  const colour = paintColor();
  if (source === `${colour.r},${colour.g},${colour.b},255`) {
    ctx.setStatus('Those pixels are already the brush colour — pick another colour first.');
    return;
  }
  const patterns = groupPatterns(ctx.selectedGroup);
  patterns.set(hit.hash, hit.tileBytes);
  const target = paintTargetGroupFor(ctx.selectedGroup);
  const store = paintStore();
  const snapshot = new Map();
  let changed = 0;
  for (const [hash, bytes] of patterns) {
    // Read the whole pattern first: its first repaint creates its colour buffer, which would
    // change how its other pixels read.
    const matching = [];
    for (let ly = 0; ly < 8; ly++) for (let lx = 0; lx < 8; lx++) if (keyAt(hash, bytes, lx, ly) === source) matching.push([lx, ly]);
    if (!matching.length) continue;
    const existing = store.get(hash);
    snapshot.set(hash, existing ? Uint8Array.from(existing) : null);
    for (const [lx, ly] of matching) if (paintTilePixel(ctx.session, hash, bytes, lx, ly, colour, target, seedShades(hash))) changed++;
  }
  if (!changed) {
    ctx.setStatus('Nothing else in this group shows that colour.');
    return;
  }
  pushUndo({ groupId: target?.id ?? null, map: snapshot });
  if (undoStack.length > 50) undoStack.shift();
  ctx.el('btn-undo').disabled = false;
  ctx.markDirty();
  invalidateRender();
  drawStage();
  renderStrip();
  ctx.renderPalette();
  const what = source === 'shade0' ? 'transparent px (now drawn, covering what is behind)' : 'px';
  ctx.setStatus(`Swapped ${changed} ${what} in ${snapshot.size} of ${patterns.size} tile pattern(s) of “${ctx.selectedGroup.name || ctx.selectedGroup.id}”. Undo puts them back.`);
}

/** Swap inside a touch-up or layer art: every pixel of exactly the clicked colour. */
function swapInPicture(e, pic) {
  const px = pic.pixels;
  const hit = px ? pic.hit(e) : null;
  const c = hit ? pixelAt(px, hit.ax, hit.ay) : null;
  if (!c || !c[3]) {
    ctx.setStatus(`Click a painted pixel of the ${pic.kind} to choose the colour to swap.`);
    return;
  }
  const colour = paintColor();
  const prev = copyPixels(px);
  let changed = 0;
  for (let i = 0; i < px.data.length; i += 4) {
    if (px.data[i] !== c[0] || px.data[i + 1] !== c[1] || px.data[i + 2] !== c[2] || px.data[i + 3] !== c[3]) continue;
    px.data[i] = colour.r;
    px.data[i + 1] = colour.g;
    px.data[i + 2] = colour.b;
    px.data[i + 3] = 255;
    changed++;
  }
  if (!changed) return;
  pushArtUndo(pic.key, prev);
  artChanged(pic.key);
  ctx.setStatus(`Swapped ${changed} px of that colour in the ${pic.kind}. Undo puts them back.`);
}

/** Eyedropper on the reference pane: the colour it holds at that frame pixel. */
export function pickFromReference(e) {
  const image = ctx.referenceImageData();
  if (!image) return;
  const { fx, fy } = paneAt(e);
  const c = referenceColorAt(image, Math.floor(fx), Math.floor(fy));
  if (!c) {
    ctx.setStatus('The reference has nothing at that point.');
    return;
  }
  const hex = `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  ctx.el('paint-color').value = hex;
  ctx.setStatus(`Picked ${hex} from the reference.`);
  ctx.markPaletteSelection();
}

export function pickAt(e) {
  explainAt(e);
  if (activePicture()) {
    pickArtAt(e);
    return;
  }
  const hit = tileUnderPointer(e);
  if (!hit) return;
  const buf = colourForHash(hit.hash);
  if (!buf) return;
  const i = (hit.ly * 8 + hit.lx) * 4;
  const hex = `#${[buf[i], buf[i + 1], buf[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  ctx.el('paint-color').value = hex;
  ctx.setStatus(`Picked ${hex} from tile #${hit.hash.toString(16).toUpperCase()}.`);
  ctx.markPaletteSelection();
}
