/**
 * SpriteStudio's overpaint: a BG group's picture pinned to its layer's map, and pose pictures
 * (src/overpaint.js, src/pose-overpaint.js) — the tools that create, move, paint, widen, save and
 * load them, and the Overpaint panel. Split out of tools/sprite-studio.js, which passes in the state
 * and functions it shares (initOverpaint).
 */
import { frameState, frameWram, posesOf, renderFrame, renderPoseLayer, poseBounds, clearGroupOverlay, FRAME_W, FRAME_H, mayShowPatterns } from '../shared/pack-session.js';
import { referenceColorAt } from '../../src/reference-fill.js';
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { floodFill } from '../../src/flood-fill.js';
import { isObjGroup } from '../../src/obj-sprite-profiles.js';
import { createPictureStore } from '../../src/picture-store.js';
import { downloadBlob } from '../../src/art-pack.js';
import { layerArtOf, layerArtPixels, loadLayerArtPixels, layerArtLoop, mapCellDraws, placeArtColumns, placeArtRows, layerArtFullHeight, layerArtMaskY, artPixelsFor, loadArtPixelsFor, layerGeometry, activeLayerArts } from '../../src/layer-art.js';
import { convertToOverpaint, cropOverpaint, placeOverpaint, mapWrap, paintedBounds, cellMapPixelAt, seedRepeatedColumns } from '../../src/overpaint.js';
import { groupScreensOf, groupShownOnScreens, matchedScreens, describeGroupScreens } from '../../src/screen-gate.js';
import { describeGroupConditions, heldProjectGameStates, projectConditionsAllow } from '../../src/game-states.js';
import { posePictureGroups, posePictureKey, posePictureFor, expandPoseOverpaints, newPosePictureId } from '../../src/pose-overpaint.js';
import { setAside } from '../../src/recovery.js';
import { affinePixelMap } from '../../src/affine-world.js';
import { touchUpOf, touchUpKey, convertOverlaysToTouchUps } from '../../src/touch-up.js';
import { encodePngBase64, imageBlobToPixels, readClipboardImage, writeClipboardImage, pixelsToPngBlob } from '../../src/layer-art-png.js';
import { copyPixels, pixelAt, dab, fillArt, replacePixels } from '../../src/layer-art-edit.js';
import { getWindowsTableBytesFromState } from '../../src/vip-world-clip.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initOverpaint(context) {
  ctx = context;
}

/* -------------------------------------------------------------- overpaint */
// A BG group's picture pinned to its layer's BG map (src/overpaint.js): painted over the group's
// tiles — blank and transparent pixels too — and shown wherever the layer is on screen, scrolled,
// zoomed and in stereo with it. It replaces touch-ups and layer art; "Hide the tiles under it" is
// what layer art did. "Paint on: Overpaint" (T) routes Brush, Fill, Swap, Pick and Clone to it, and
// the stage turns amber so the two kinds of paint are never confused. While you paint, the picture
// covers the whole layer (its map loop, the screen's height); Save stores only what is painted.

/**
 * Every picture's settings, live pixels and edited mark, written together (src/picture-store.js):
 * overpaint by group id, a pose picture by posePictureKey, an old touch-up by touchUpKey.
 */
export const pictureStore = createPictureStore({
  getGroups: () => ctx.session?.groups || [],
  setGroups: (groups) => {
    ctx.session.groups = groups;
    if (ctx.selectedGroup) ctx.selectedGroup = groups.find((g) => g.id === ctx.selectedGroup.id) || ctx.selectedGroup;
  },
});
/** The picture before the current brush stroke, for one undo step per stroke. */
let artStrokeSnapshot = null;
/** 'tiles' | 'overpaint' — where brush strokes go. Back to Tiles whenever a group is selected. */
let paintOn = 'tiles';

/** Where strokes go, set without setPaintOn's checks and redraw (a group just selected, a card change). */
export function resetPaintOn(mode) {
  paintOn = mode;
}

/** An overpaint stroke just ended: one undo step for it. False when the stroke was not on overpaint. */
export function finishArtStroke() {
  if (!artStrokeSnapshot) return false;
  const { key, prev } = artStrokeSnapshot;
  pushArtUndo(key, prev);
  artStrokeSnapshot = null;
  artChanged(key);
  return true;
}
/** Margin, in map pixels, overpaint on a scaled layer gets around the group's cells. */
const SCALED_MARGIN = 16;

/*
 * Pose pictures (src/pose-overpaint.js) live inside the group: on a card whose pose has one, the
 * Overpaint tools work on it; on any other card, on the group's own picture. Either way the tools
 * see a group with an `overpaint` — a pose picture as the drawn group posePictureGroups gives,
 * keyed posePictureKey(group, pose) — and the picture store writes it back where it belongs.
 */

/** A Base tiles card's pose id: this prefix and the scaled pose it shows (tools/shared/pack-session.js affineBaseView). */
const BASE_TILES_PREFIX = '__base:';

/**
 * The saved pose a card shows, or undefined for a card that is a captured frame. A Base tiles card
 * stands for the scaled pose behind it, so painting there paints that pose, not every pose.
 */
function savedPoseOfView(view) {
  const id = view?.pose?.poseId;
  if (typeof id !== 'string' || !ctx.selectedGroup) return undefined;
  const bare = id.startsWith(BASE_TILES_PREFIX) ? id.slice(BASE_TILES_PREFIX.length) : id;
  return posesOf(ctx.selectedGroup).find((p) => p.poseId === bare);
}

/** The saved pose the card on stage shows, or undefined for a card that is a captured frame. */
function stageSavedPoseId() {
  return savedPoseOfView(ctx.poseViews[ctx.poseIndex])?.poseId;
}

/** The selected group's pose picture for the card on stage, or null. */
function stagePosePicture() {
  if (!ctx.selectedGroup || isObjGroup(ctx.selectedGroup) || ctx.selectedGroup.wholePose === true) return null;
  return posePictureFor(ctx.selectedGroup, stagePosePatterns(), stageSavedPoseId());
}

/*
 * Overpaint scope: 'pose' paints the card's pose only (its own picture), 'all' the group's picture,
 * which shows on every pose. A character — a background group that kept two or more poses — starts
 * on 'pose', everything else (backdrops, menus, one-view groups) on 'all'; Paint all poses / Back to
 * this pose only switch it for the group, for this session.
 */
/** @type {Map<string, 'pose' | 'all'>} */
const overpaintScopes = new Map();

/** A character's group: several poses of its own, painted pose by pose. */
export function isPoseCharacter(group) {
  return (
    !!group &&
    !isObjGroup(group) &&
    group.wholePose !== true &&
    posesOf(group).length >= 2 &&
    !ctx.isAnimatedGroup(group) &&
    !layerArtOf(group)?.hideTiles
  );
}

/** @returns {'pose' | 'all'} */
export function overpaintScope(group = ctx.selectedGroup) {
  if (!group) return 'all';
  return overpaintScopes.get(group.id) || (isPoseCharacter(group) ? 'pose' : 'all');
}

/** Painting this pose only, on a card that has no picture for it yet: the first stroke starts one. */
export function posePictureCanStart() {
  return overpaintScope() === 'pose' && !stagePosePicture() && stagePosePatterns().length > 0;
}

/** Switch the selected group between painting this pose only and all its poses. */
export function setOverpaintScope(scope) {
  if (!ctx.selectedGroup) return;
  overpaintScopes.set(ctx.selectedGroup.id, scope);
  if (paintOn === 'overpaint' && !overpaintMode()) paintOn = 'tiles';
  syncPaintOnUi();
  ctx.invalidateRender();
  ctx.drawStage();
  ctx.renderDetail();
  const n = posesOf(ctx.selectedGroup).length;
  ctx.setStatus(
    scope === 'all'
      ? `Overpaint now paints all ${n} poses of “${ctx.selectedGroup.name || ctx.selectedGroup.id}” at once: the group’s own picture shows on every pose.`
      : 'Overpaint paints this pose only again: each pose gets its own picture.',
  );
}

/** In this-pose-only mode, the stroke about to land starts the pose's picture if it has none. */
export function materializePosePicture() {
  if (paintOn !== 'overpaint' || selectedArt() || !posePictureCanStart()) return false;
  return createOverpaint({ pose: true });
}

/**
 * The group (or pose picture, as a drawn group) the Overpaint tools work on; null for sprites, and
 * for a pose with no picture yet while painting this pose only — never the all-poses picture then.
 */
export function artTarget() {
  if (!ctx.selectedGroup || isObjGroup(ctx.selectedGroup)) return null;
  // A character switched to Paint all poses paints the group's picture, whichever card is on stage.
  if (isPoseCharacter(ctx.selectedGroup) && overpaintScope() === 'all') return ctx.selectedGroup;
  const pose = stagePosePicture();
  if (pose) return posePictureGroups(ctx.selectedGroup).find((g) => g.posePictureId === pose.id) || ctx.selectedGroup;
  return overpaintScope() === 'pose' && stagePosePatterns().length ? null : ctx.selectedGroup;
}

/** A picture's owner by its pixel key: a group, or a group's pose picture. */
export function findArtTarget(key) {
  for (const g of ctx.session?.groups || []) {
    if (g.id === key) return g;
    const pose = posePictureGroups(g).find((p) => p.id === key);
    if (pose) return pose;
  }
  return null;
}

/** After a picture's settings changed: the list and panels follow (as replaceSelectedGroup). */
function groupsChanged() {
  ctx.markDirty();
  ctx.renderTracksPanel();
  ctx.renderSpriteLists();
  ctx.markActiveRow();
}

/** @returns {ReturnType<typeof layerArtOf>} the overpaint the tools work on (or old layer art) */
export function selectedArt() {
  const t = artTarget();
  return t ? layerArtOf(t) : null;
}

/** The frame on stage, which the picture is painted through. */
function stageState() {
  const view = ctx.poseViews[ctx.poseIndex];
  return view && view.frameIndex >= 0 ? frameState(ctx.session, view.frameIndex) : null;
}

/** The captured frame behind the stage: a Base tiles card's own frame is a stand-in without a world table. */
export function sourceState() {
  const view = ctx.poseViews[ctx.poseIndex];
  if (view?.base) return frameState(ctx.session, view.base.sourceFrameIndex);
  return stageState();
}

/**
 * Stage pixel → picture pixel for the card on stage, or null when the picture is not on it:
 * a plain layer through the frame's scroll, a scaled layer through what each pixel reads, and a
 * Base tiles card cell by cell. The mapping is built once per call, for a whole fill.
 * @returns {((x: number, y: number) => { ax: number, ay: number } | null) | null}
 */
function stageArtMapper() {
  const art = selectedArt();
  const view = ctx.poseViews[ctx.poseIndex];
  const state = stageState();
  if (!art || !view || !state) return null;
  const inPicture = (mx, my) => {
    const ax = mx - art.mapX;
    const ay = my - art.mapY;
    return ax >= 0 && ay >= 0 && ax < art.width && ay < art.height ? { ax, ay } : null;
  };
  if (view.base) {
    const draws = (state.drawList || []).filter((d) => Number.isInteger(d.cellX));
    return (x, y) => {
      const m = cellMapPixelAt(draws, x, y, ctx.eye());
      return m ? inPicture(m.mx, m.my) : null;
    };
  }
  const scaled = affinePixelMap(state, ctx.eye()).get(art.world);
  if (scaled) {
    return (x, y) => {
      const i = y * FRAME_W + x;
      return scaled.mx[i] >= 0 ? inPicture(scaled.mx[i], scaled.my[i]) : null;
    };
  }
  const windows = getWindowsTableBytesFromState(state);
  // The world the group is on here: a group that hops worlds draws the same map from either.
  const world = activeLayerArts({ ...state, windows }, [artTarget()], ctx.eye())[0]?.world ?? art.world;
  const g = layerGeometry(windows, world, ctx.eye());
  if (!g) return null;
  return (x, y) => {
    if (x < g.startX || x > g.finalX || y < 0 || y >= FRAME_H) return null;
    const ax = (g.sx(x) - art.mapX) & g.maskX;
    const ay = (g.sy(y) - art.mapY) & g.maskY;
    return ax < art.width && ay < art.height ? { ax, ay } : null;
  };
}

/** The picture pixel under the pointer, or null off the picture. */
function artHit(e) {
  const map = stageArtMapper();
  const { vx, vy } = ctx.vipFromClient(e);
  const hit = map && vx >= 0 && vy >= 0 && vx < FRAME_W && vy < FRAME_H ? map(vx, vy) : null;
  return hit ? { ...hit, vx, vy } : null;
}

function brushSize() {
  return Math.max(1, Number(ctx.el('brush-size')?.value) || 1);
}

/** @param {string} key picture store key (overpaint: the group id) */
export function pushArtUndo(key, prev) {
  // Where the picture was, too: Save crops it between a stroke and its undo.
  const group = findArtTarget(key);
  const art = group ? layerArtOf(group) : null;
  const place = art && group.overpaint ? { mapX: art.mapX, mapY: art.mapY, width: art.width, height: art.height } : null;
  ctx.pushUndo({ art: { key, prev, place } });
  if (ctx.undoStack.length > 50) ctx.undoStack.shift();
  ctx.el('btn-undo').disabled = false;
}

/** @param {string} [key] the picture that changed; defaults to the one strokes go to */
export function artChanged(key = activePicture()?.key) {
  if (key) pictureStore.markEdited(key);
  ctx.markDirty();
  ctx.invalidateRender();
  // The cards show the picture too (Show overpaint).
  ctx.renderStrip();
  ctx.drawStage();
  ctx.renderDetail();
}

export function overpaintMode() {
  return paintOn === 'overpaint' && (!!selectedArt() || posePictureCanStart());
}

export function showTouchUps() {
  return ctx.el('toggle-touchup').checked;
}

/** The picture strokes go to: the overpaint in Overpaint mode (always, when it hides the tiles); null = tiles. */
export function activePicture() {
  const art = selectedArt();
  if (!art || (!art.hideTiles && !overpaintMode())) return null;
  const target = artTarget();
  return { kind: 'overpaint', key: target.id, pixels: layerArtPixels(target), hit: artHit };
}

export function paintArtAt(e) {
  if (!artStrokeSnapshot) startArtStroke();
  const pic = activePicture();
  const px = pic?.pixels;
  if (!px) {
    ctx.setStatus('The overpaint is still loading.');
    return;
  }
  const hit = pic.hit(e);
  if (!hit) {
    ctx.setStatus('Outside this group’s layer — overpaint goes on the layer the group is drawn on.');
    return;
  }
  if (ctx.tool === 'clone') {
    const image = ctx.referenceImageData();
    const c = image ? referenceColorAt(image, hit.vx, hit.vy) : null;
    if (!c) {
      ctx.setStatus('The reference has nothing there to clone.');
      return;
    }
    ctx.el('paint-color').value = `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  }
  if (!artStrokeSnapshot) artStrokeSnapshot = { key: pic.key, kind: pic.kind, prev: copyPixels(px) };
  if (!dab(px, hit.ax, hit.ay, brushSize(), ctx.paintColor())) return;
  ctx.invalidateRender();
  ctx.drawStage();
}

/**
 * Fill on overpaint stops where the picture you see changes: overpaint where there is some,
 * otherwise the group's own tile paint, and the scene behind when Background is on. Filling only
 * by the picture's own pixels would flood the whole clear layer.
 */
function overpaintFillAt(e, pic) {
  const state = stageState();
  const view = ctx.poseViews[ctx.poseIndex];
  const map = stageArtMapper();
  const px = pic.pixels;
  const { vx, vy } = ctx.vipFromClient(e);
  if (!state || !view || !map || !px || !map(vx, vy)) {
    ctx.setStatus('Nothing to fill there — click on this group’s layer.');
    return;
  }
  const layer = new ImageData(FRAME_W, FRAME_H);
  renderPoseLayer({ session: ctx.layerSession(), state, pose: view.pose, origin: view.origin, imageData: layer, eye: ctx.eye(), brightness: ctx.brightness(), groupId: ctx.selectedGroup.id, touchUp: false });
  let scene = null;
  if (ctx.el('toggle-background').checked) {
    scene = new ImageData(FRAME_W, FRAME_H);
    renderFrame({ session: ctx.session, state, imageData: scene, eye: ctx.eye(), brightness: ctx.brightness(), touchUps: false });
  }
  const seenAt = (x, y) => {
    if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return null;
    const a = map(x, y);
    if (!a) return null;
    const t = (a.ay * px.width + a.ax) * 4;
    if (px.data[t + 3]) return `${px.data[t]},${px.data[t + 1]},${px.data[t + 2]}`;
    const i = (y * FRAME_W + x) * 4;
    if (layer.data[i + 3]) return `${layer.data[i]},${layer.data[i + 1]},${layer.data[i + 2]}`;
    if (scene && scene.data[i + 3]) return `${scene.data[i]},${scene.data[i + 1]},${scene.data[i + 2]}`;
    return 'empty';
  };
  const region = floodFill(vx, vy, seenAt);
  const colour = ctx.paintColor();
  const prev = copyPixels(px);
  let n = 0;
  for (const [x, y] of region) {
    const a = map(x, y);
    if (!a) continue;
    const t = (a.ay * px.width + a.ax) * 4;
    if (px.data[t] === colour.r && px.data[t + 1] === colour.g && px.data[t + 2] === colour.b && px.data[t + 3] === 255) continue;
    px.data.set([colour.r, colour.g, colour.b, 255], t);
    n++;
  }
  if (!n) {
    ctx.setStatus('That area is already this colour.');
    return;
  }
  pushArtUndo(pic.key, prev);
  artChanged(pic.key);
  ctx.setStatus(`Filled ${n} px of overpaint, stopping where the picture you see changes${scene ? '' : ' (the scene is off, so it does not count)'}. Undo puts it back.`);
}

export function fillArtAt(e) {
  startArtStroke();
  const pic = activePicture();
  if (!pic) return;
  if (!selectedArt()?.hideTiles) {
    overpaintFillAt(e, pic);
    return;
  }
  // A picture that hides the tiles is the whole look of the layer: fill by its own pixels.
  const px = pic.pixels;
  const hit = px ? pic.hit(e) : null;
  if (!px || !hit) {
    ctx.setStatus('Nothing to fill there — click on this group’s layer.');
    return;
  }
  const prev = copyPixels(px);
  const n = fillArt(px, hit.ax, hit.ay, ctx.paintColor());
  if (!n) {
    ctx.setStatus('That area is already this colour.');
    return;
  }
  pushArtUndo(pic.key, prev);
  artChanged(pic.key);
  ctx.setStatus(`Filled ${n} px of the overpaint. Undo puts it back.`);
}

export function pickArtAt(e) {
  const pic = activePicture();
  const hit = pic?.pixels ? pic.hit(e) : null;
  const own = hit ? pixelAt(pic.pixels, hit.ax, hit.ay) : null;
  // The picture's own paint first (exact, undimmed); anywhere else, whatever the stage shows.
  const seen = own && own[3] ? { c: own, from: 'the overpaint' } : colourOnStageAt(e);
  if (!seen) {
    ctx.setStatus('Nothing is drawn there to pick a colour from.');
    return;
  }
  const hex = `#${seen.c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  ctx.el('paint-color').value = hex;
  ctx.setStatus(`Picked ${hex} from ${seen.from}.`);
  ctx.markPaletteSelection();
}

/**
 * The colour the stage shows at the pointer, read from the images it is drawn from — not the
 * canvas itself, so Overpaint mode's amber outline never ends up in the pick: the sprite or group
 * layer (with its overpaint), then the scene behind it when Background is on.
 * @returns {{ c: number[], from: string } | null}
 */
function colourOnStageAt(e) {
  const view = ctx.poseViews[ctx.poseIndex];
  const { vx, vy } = ctx.vipFromClient(e);
  if (vx < 0 || vy < 0 || vx >= FRAME_W || vy >= FRAME_H) return null;
  const read = (img, x) => {
    const i = (vy * FRAME_W + x) * 4;
    return img.data[i + 3] ? [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]] : null;
  };
  // A mirrored step shows the pose layer flipped about the sprite's own centre.
  let px = vx;
  if (ctx.stageMirror && view?.origin) {
    const b = poseBounds(view.pose, view.origin);
    if (b) px = b.x0 + b.x1 - 1 - vx;
  }
  const onLayer = px >= 0 && px < FRAME_W ? read(ctx.poseImage, px) : null;
  if (onLayer) return { c: onLayer, from: 'the stage' };
  const inScene = ctx.el('toggle-background').checked ? read(ctx.frameImage, vx) : null;
  return inScene ? { c: inScene, from: 'the scene' } : null;
}

/** The world the selected group's overpaint goes on, from the card on stage. */
function overpaintWorldOnStage(group, view, state) {
  if (view?.base?.worlds?.length) return view.base.worlds[0];
  if (view?.pose?.affineWorlds?.length) return view.pose.affineWorlds[0];
  const c = group.criteria || {};
  const worlds = new Set((c.windowIds || []).map(Number));
  const hashes = new Set((c.hashes || []).map((h) => Number(h) >>> 0));
  const slots = new Set((c.tileSlots || []).map(Number));
  /** @type {Map<number, number>} */
  const perWorld = new Map();
  for (const d of state.drawList || []) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== ctx.eye() || (d.layer ?? 0) !== 0 || d.world == null) continue;
    if (worlds.size && !worlds.has(Number(d.world))) continue;
    const h = hashTile(getTileBytes(state.patternTable, d.tileIndex)) >>> 0;
    if ((hashes.size || slots.size) && !hashes.has(h) && !slots.has(d.tileIndex)) continue;
    perWorld.set(d.world, (perWorld.get(d.world) || 0) + 1);
  }
  return [...perWorld].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Undo for add / move / remove / Hide the tiles: each picture the step changes, its settings and its
 * pixels as they are now. Only those pictures go back — never the whole group, which would also
 * take every other picture back to before a Save had cropped it (its pixels cropped, its settings
 * not: Save then refused it).
 * @param {string | string[]} keys
 */
function pushPictureUndo(keys) {
  const pictures = (Array.isArray(keys) ? keys : [keys]).map((key) => {
    const px = artPixelsFor(key, '');
    return { key, settings: pictureStore.settings(key), pixels: px ? copyPixels(px) : null };
  });
  ctx.pushUndo({ picture: { pictures } });
  if (ctx.undoStack.length > 50) ctx.undoStack.shift();
  ctx.el('btn-undo').disabled = false;
}

export function undoPictureEntry(entry) {
  for (const { key, settings, pixels } of entry.picture.pictures) pictureStore.put(key, settings, settings ? pixels : null);
  if (!selectedArt() && paintOn === 'overpaint' && !posePictureCanStart()) paintOn = 'tiles';
  ctx.invalidateRender();
  syncPaintOnUi();
  ctx.renderStrip();
  ctx.setStatus('Undid the last change to the overpaint.');
}

/**
 * New, empty overpaint on the layer the card on stage shows the group on: the group's own, or with
 * `pose`, a picture for the pose on stage only (src/pose-overpaint.js).
 * @param {{ pose?: boolean }} [opts]
 */
function createOverpaint({ pose = false } = {}) {
  const group = ctx.selectedGroup;
  const view = ctx.poseViews[ctx.poseIndex];
  const src = sourceState();
  if (!group || isObjGroup(group) || !src) return false;
  const world = overpaintWorldOnStage(group, view, view?.base ? src : stageState() || src);
  if (world == null) {
    ctx.setStatus('None of this group’s tiles are on this card — pick a pose or frame that shows it first.');
    return false;
  }
  const windows = getWindowsTableBytesFromState(src);
  const header = windows && windows.length >= 1024 ? windows[world * 32] | (windows[world * 32 + 1] << 8) : 0;
  if (!layerGeometry(windows, world, ctx.eye()) && !affinePixelMap(src, ctx.eye()).has(world)) {
    ctx.setStatus(`World ${world} cannot take overpaint yet (only plain and scaled background layers can).`);
    return false;
  }
  const start = { world, bgmapBase: header & 0xf, mapX: 0, mapY: 0, width: 1, height: 1, hideTiles: false };
  if (pose) {
    const hashes = stagePosePatterns();
    if (!hashes.length) {
      ctx.setStatus('Pick a card that shows this pose first.');
      return false;
    }
    const pictureId = newPosePictureId(group);
    const key = posePictureKey(group.id, pictureId);
    const name = savedPoseOfView(view)?.name || view?.pose?.name || `Frame ${(view?.frameIndex ?? 0) + 1}`;
    pushPictureUndo(key);
    // Tied to the saved pose on stage, when it is one: the picture follows that pose's tiles.
    pictureStore.put(key, { ...start, hashes, name, poseId: stageSavedPoseId() }, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
    groupsChanged();
    ensureOverpaintArea();
    ctx.setStatus(`“${name}” has its own overpaint: it shows only when all ${hashes.length} tiles of this pose are on screen. Paint it here, then Save.`);
    return true;
  }
  pushPictureUndo(group.id);
  pictureStore.put(group.id, start, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
  groupsChanged();
  ensureOverpaintArea();
  ctx.setStatus(`“${group.name || group.id}” has overpaint on world ${world}: paint anywhere on its layer — it stays pinned there however the layer scrolls.`);
  return true;
}

/** The map area the group's tiles cover on a scaled layer this frame, plus a margin; null when none. */
function scaledGroupArea(state, group, world) {
  const px = affinePixelMap(state, ctx.eye()).get(world);
  if (!px) return null;
  const hashes = new Set((group.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  const hashOfChar = new Map();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < px.char.length; i++) {
    const ch = px.char[i];
    if (ch < 0 || px.mx[i] < 0) continue;
    let h = hashOfChar.get(ch);
    if (h === undefined) hashOfChar.set(ch, (h = hashTile(getTileBytes(state.patternTable, ch)) >>> 0));
    if (hashes.size && !hashes.has(h)) continue;
    x0 = Math.min(x0, px.mx[i]);
    y0 = Math.min(y0, px.my[i]);
    x1 = Math.max(x1, px.mx[i] + 1);
    y1 = Math.max(y1, px.my[i] + 1);
  }
  if (!Number.isFinite(x0)) return null;
  return { x0: Math.max(0, x0 - SCALED_MARGIN), y0: Math.max(0, y0 - SCALED_MARGIN), x1: x1 + SCALED_MARGIN, y1: y1 + SCALED_MARGIN };
}

/**
 * Make the selected overpaint cover everything you can paint from this card: a plain layer's whole
 * map loop and the screen's height (so a backdrop the game starts at another column is covered
 * too); on a scaled layer, the group's cells here joined with what is already painted. What was
 * painted keeps its place in the map. A picture that hides the tiles keeps its size (its Cover the
 * whole map / Fill the screen's height buttons widen it, seeded from the tiles).
 */
function ensureOverpaintArea() {
  const group = artTarget();
  const art = selectedArt();
  const px = art ? layerArtPixels(group) : null;
  const src = sourceState();
  if (!art || !px || !src || art.hideTiles) return;
  const windows = getWindowsTableBytesFromState(src);
  let area = null;
  if (layerGeometry(windows, art.world, ctx.eye())) {
    const loop = layerArtLoop(windows, art.world, ctx.eye());
    const full = layerArtFullHeight(windows, art.world, ctx.eye());
    if (loop && full) area = { mapX: loop.mapX, width: loop.width, mapY: full.mapY, height: full.height };
  } else {
    const cells = scaledGroupArea(src, group, art.world);
    if (cells) {
      const painted = paintedBounds(px);
      const x0 = painted ? Math.min(cells.x0, art.mapX + painted.x0) : cells.x0;
      const y0 = painted ? Math.min(cells.y0, art.mapY + painted.y0) : cells.y0;
      const x1 = painted ? Math.max(cells.x1, art.mapX + painted.x1) : cells.x1;
      const y1 = painted ? Math.max(cells.y1, art.mapY + painted.y1) : cells.y1;
      area = { mapX: x0, mapY: y0, width: x1 - x0, height: y1 - y0 };
    }
  }
  if (!area || (area.mapX === art.mapX && area.mapY === art.mapY && area.width === art.width && area.height === art.height)) return;
  const { pixels, dropped } = placeOverpaint(art, px, area, mapWrap(windows, art.world));
  pictureStore.put(group.id, { ...art, ...area }, pixels);
  groupsChanged();
  ctx.invalidateRender();
  if (dropped) ctx.setStatus(`${dropped} px of overpaint lay outside what this layer can show and were left out.`);
}

export function setPaintOn(mode) {
  if (mode === 'overpaint' && ctx.selectedGroup && !isObjGroup(ctx.selectedGroup) && !selectedArt()) {
    // A character's pose gets its own picture; anything else, the group's.
    if (!createOverpaint({ pose: posePictureCanStart() })) return;
  }
  paintOn = mode === 'overpaint' && selectedArt() ? 'overpaint' : 'tiles';
  if (paintOn === 'overpaint') {
    ensureOverpaintArea();
    // You cannot paint what you cannot see.
    if (!showTouchUps()) ctx.el('toggle-touchup').checked = true;
    ctx.invalidateRender();
  }
  syncPaintOnUi();
  ctx.drawStage();
  ctx.renderDetail();
  if (paintOn === 'overpaint') {
    ctx.setStatus(
      artTarget()?.posePictureId
        ? 'Overpaint on this pose’s own picture: it shows only when this whole pose is on screen. T goes back to tile paint.'
        : 'Overpaint: strokes go on a picture pinned to this layer — over the tiles, blank and transparent pixels too — and show wherever the layer is on screen. T goes back to tile paint.',
    );
  }
}

/** The switch, the amber stage cue and the badge follow the mode. */
export function syncPaintOnUi() {
  const art = selectedArt();
  const bg = !!ctx.selectedGroup && !isObjGroup(ctx.selectedGroup) && !art?.hideTiles;
  ctx.el('paint-on').hidden = !bg;
  const on = overpaintMode();
  ctx.el('btn-paint-tiles').classList.toggle('active', !on);
  ctx.el('btn-paint-tiles').setAttribute('aria-pressed', String(!on));
  ctx.el('btn-paint-touchup').classList.toggle('active', on);
  ctx.el('btn-paint-touchup').setAttribute('aria-pressed', String(on));
  ctx.el('canvas-wrap').classList.toggle('touch-up-mode', on);
  const badge = ctx.el('touch-up-badge');
  badge.hidden = !on;
  // Which picture strokes go to, before the first one lands.
  const target = on ? artTarget() : null;
  const allPoses = on && !!target && !target.posePictureId && isPoseCharacter(ctx.selectedGroup);
  badge.classList.toggle('all-poses', allPoses);
  if (!on) return;
  if (target?.posePictureId || posePictureCanStart()) {
    badge.textContent = `OVERPAINT · THIS POSE ONLY${target?.poseName ? ` (${target.poseName})` : ''}`;
  } else if (allPoses) {
    badge.textContent = `OVERPAINT · ALL ${posesOf(ctx.selectedGroup).length} POSES`;
  } else {
    badge.textContent = 'OVERPAINT · pinned to this layer';
  }
}

export function clearOverpaint() {
  const key = artTarget()?.id;
  const px = selectedArt() && key ? artPixelsFor(key, '') : null;
  if (!px) return;
  pushArtUndo(key, copyPixels(px));
  px.data.fill(0);
  artChanged(key);
  ctx.setStatus('Cleared the overpaint — the tile paint shows through again. Undo puts it back.');
}

export function removeOverpaint() {
  removePicture(artTarget());
}

/**
 * Remove one picture: a pose's own, or the group's (its all-poses picture on a character). Takes the
 * picture explicitly, so the group's picture can go from a card painting this pose only, where the
 * Overpaint tools aim at the pose instead.
 * @param {any} target the group, or a pose picture as posePictureGroups gives it
 */
export function removePicture(target) {
  if (!target || !layerArtOf(target)) return;
  const what = target.posePictureId ? `this pose’s own overpaint (“${target.name}”)` : `“${target.name || target.id}”’s overpaint`;
  if (!window.confirm(`Remove ${what}? Its tile paint stays. Undo brings it back; nothing is written until you save.`)) return;
  pushPictureUndo(target.id);
  paintOn = 'tiles';
  pictureStore.put(target.id, null, null);
  groupsChanged();
  syncPaintOnUi();
  ctx.invalidateRender();
  ctx.renderStrip();
  ctx.drawStage();
  ctx.renderDetail();
  ctx.setStatus(target.posePictureId ? 'The pose’s own overpaint is removed.' : 'Overpaint removed — the group shows its tile paint only.');
}

/** The selected group's patterns the card on stage shows: what "this pose" is. */
export function stagePosePatterns() {
  return viewPosePatterns(ctx.poseViews[ctx.poseIndex]);
}

/** The selected group's patterns a card shows (any card of the filmstrip). */
export function viewPosePatterns(view) {
  if (!view || !ctx.selectedGroup) return [];
  // A Base tiles card shows a scaled pose's cells unscaled: its patterns are that pose's.
  const saved = view.base ? savedPoseOfView(view) : null;
  if (view.base && !saved) return [];
  const shown = saved ? saved.tiles.map((t) => t.hash) : Array.isArray(view.patterns) ? view.patterns : (view.pose?.tiles || []).map((t) => t.hash);
  const own = new Set((ctx.selectedGroup.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  return [...new Set(shown.map((h) => Number(h) >>> 0))].filter((h) => !own.size || own.has(h));
}

/** A card's own pose picture in the selected group, or null (the filmstrip marks cards that have one). */
export function posePictureForView(view) {
  const group = ctx.selectedGroup;
  if (!group || isObjGroup(group) || group.wholePose === true || !Array.isArray(group.poseOverpaints) || !group.poseOverpaints.length) return null;
  return posePictureFor(group, viewPosePatterns(view), savedPoseOfView(view)?.poseId);
}

/** "1,234 px painted" for a picture, from its pixels. */
function paintedPixelsText(target) {
  const px = target ? layerArtPixels(target) : null;
  if (!px) return 'loading';
  let n = 0;
  for (let i = 3; i < px.data.length; i += 4) if (px.data[i]) n++;
  return n ? `${n.toLocaleString()} px painted` : 'nothing painted';
}

/**
 * The top of the Overpaint panel: which pictures draw on the card on stage — the pose's own, the
 * group's (on a character, its all-poses picture, flagged: it shows on every pose), both or none —
 * each with what can be done to it right there. The group's picture can always be moved to this
 * pose or removed from here, whichever scope the panel is painting in.
 * @param {any} group @param {(id: string, label: string, title: string, onClick: () => void) => HTMLButtonElement} button
 * @returns {HTMLElement | null}
 */
export function onThisPosePart(group, button) {
  if (!group || isObjGroup(group) || group.wholePose === true) return null;
  const wrap = document.createElement('div');
  wrap.id = 'overpaint-on-pose';
  wrap.className = 'overpaint-on-pose';
  const title = document.createElement('p');
  title.className = 'overpaint-on-pose-title';
  title.textContent = 'Drawing on this card';
  const list = document.createElement('ul');
  const item = (text, className = '') => {
    const li = document.createElement('li');
    li.className = className;
    const span = document.createElement('span');
    span.textContent = text;
    li.append(span);
    list.append(li);
    return li;
  };
  const posePicture = stagePosePicture();
  const groupArt = layerArtOf(group);
  const character = isPoseCharacter(group);
  if (posePicture) {
    const drawn = posePictureGroups(group).find((p) => p.posePictureId === posePicture.id);
    item(`This pose’s own picture (${drawn?.poseName || posePicture.name || posePicture.id}): ${paintedPixelsText(drawn)}, shown only on this pose.`, 'pose');
  }
  if (groupArt) {
    const n = posesOf(group).length;
    const li = item(
      character
        ? `The group’s all-poses picture: ${paintedPixelsText(group)}, shown on all ${n} poses — this one and every other.`
        : `The group’s picture: ${paintedPixelsText(group)}, shown wherever this layer is on screen.`,
      character ? 'warn' : '',
    );
    const row = document.createElement('div');
    row.className = 'layer-art-actions';
    if (character && !posePicture && stagePosePatterns().length) {
      row.append(button('btn-overpaint-move-to-pose', 'Move it to this pose', 'Make the all-poses picture this pose’s own, so it stops showing on the other poses', () => overpaintThisPose(true)));
    }
    row.append(
      button(
        'btn-overpaint-remove-group',
        character ? 'Remove the all-poses picture' : 'Remove it',
        'Drop the group’s picture. Tile paint and pose pictures stay; Undo brings it back.',
        () => removePicture(group),
      ),
    );
    li.append(row);
  }
  if (!posePicture && !groupArt) item('No overpaint: only tile paint.', 'none');
  wrap.append(title, list);
  return wrap;
}

/**
 * "Overpaint just this pose": a picture kept in the group for the pose on stage
 * (src/pose-overpaint.js), shown only when every one of the pose's tiles is on screen. `move` hands
 * it the group's own picture (taking it off the group); otherwise it starts clear.
 * @param {boolean} move
 */
export function overpaintThisPose(move) {
  const group = ctx.selectedGroup;
  const view = ctx.poseViews[ctx.poseIndex];
  const hashes = stagePosePatterns();
  if (!group || isObjGroup(group) || group.wholePose === true || !view || !hashes.length) {
    ctx.setStatus('Pick a card that shows this pose first.');
    return;
  }
  if (stagePosePicture()) {
    ctx.setStatus('This pose already has its own overpaint — it is the one the panel shows.');
    return;
  }
  if (!move) {
    if (createOverpaint({ pose: true })) setPaintOn('overpaint');
    return;
  }
  const art = layerArtOf(group);
  const px = art ? layerArtPixels(group) : null;
  if (!art || !px || !group.overpaint) return;
  const name = savedPoseOfView(view)?.name || view.pose?.name || `Frame ${view.frameIndex + 1}`;
  if (!window.confirm(`Move “${group.name || group.id}”’s overpaint to the pose “${name}”?\n\nIt will show only when all ${hashes.length} tiles of this pose are on screen, not on the group’s other poses. Undo puts it back; nothing is written until you save.`)) return;
  ctx.stopPlayback();
  const pictureId = newPosePictureId(group);
  const key = posePictureKey(group.id, pictureId);
  // One undo step for both pictures: the group's back on it, the pose's gone again.
  pushPictureUndo([group.id, key]);
  pictureStore.put(key, { ...group.overpaint, hashes, name, poseId: stageSavedPoseId() }, copyPixels(px));
  pictureStore.put(group.id, null, null);
  groupsChanged();
  ctx.invalidateRender();
  ctx.renderStrip();
  paintOn = 'overpaint';
  syncPaintOnUi();
  ctx.drawStage();
  ctx.renderDetail();
  ctx.setStatus(`“${name}” has the overpaint now: it shows only when all ${hashes.length} tiles of this pose are on screen. Save to keep it.`);
}

/**
 * Hide the tiles under it (what layer art did): the layer shows only the picture, transparent
 * where nothing is painted. Turning it on starts every clear pixel from how the tiles look, so the
 * layer does not empty out; turning it off keeps the picture as it is, drawn over the tiles again.
 */
export function setHideTiles(hide) {
  // A pose's own picture never hides the layer's tiles: they belong to every pose.
  if (artTarget()?.posePictureId) return;
  const group = ctx.selectedGroup;
  const art = selectedArt();
  const px = art ? layerArtPixels(group) : null;
  const src = sourceState();
  if (!art || !px || art.hideTiles === hide) return;
  pushPictureUndo(group.id);
  let next = art;
  // A copy: px may be the decoded PNG, shared by everything that draws it.
  let nextPixels = copyPixels(px);
  const windows = hide && src ? getWindowsTableBytesFromState(src) : null;
  const loop = windows ? layerArtLoop(windows, art.world, ctx.eye()) : null;
  if (loop) {
    // Hiding the tiles hides all of them, so the picture must cover the whole layer: its map loop
    // across, the layer's window down (and any rows painted above or below it). Every clear pixel
    // in the window starts as the tiles look, so the layer does not empty out.
    const painted = paintedBounds(px);
    const y0 = painted ? Math.min(loop.mapY, art.mapY + painted.y0) : loop.mapY;
    const y1 = painted ? Math.max(loop.mapY + loop.height, art.mapY + painted.y1) : loop.mapY + loop.height;
    const area = { mapX: loop.mapX, width: loop.width, mapY: y0, height: y1 - y0 };
    const { pixels } = placeOverpaint(art, px, area, mapWrap(windows, art.world));
    const look = renderArtFromMap(src, { world: art.world, mapX: area.mapX, mapY: loop.mapY, width: area.width, height: loop.height });
    const top = loop.mapY - area.mapY;
    let seeded = 0;
    for (let y = 0; y < loop.height; y++) {
      for (let x = 0; x < area.width; x++) {
        const d = ((top + y) * area.width + x) * 4;
        const s = (y * area.width + x) * 4;
        if (pixels.data[d + 3] || !look.data[s + 3]) continue;
        pixels.data.set(look.data.subarray(s, s + 4), d);
        seeded++;
      }
    }
    nextPixels = pixels;
    next = { ...art, ...area };
    ctx.setStatus(`The layer’s tiles are hidden: the picture now covers the whole layer, and ${seeded} px of it started from how the tiles looked, so nothing went blank. Paint over them freely.`);
  }
  paintOn = hide ? 'overpaint' : paintOn;
  pictureStore.put(group.id, { ...next, hideTiles: hide }, nextPixels);
  groupsChanged();
  artChanged(group.id);
  syncPaintOnUi();
  if (!hide) ctx.setStatus('The overpaint is drawn over the layer’s tiles again; the tiles show wherever it is clear.');
}

/**
 * How an area of a plain layer looks from its BG map: every map cell in it drawn with today's
 * tile paint, in slices the size of the screen. Shows parts of the loop no captured frame scrolled to.
 * @param {any} state a frame showing the layer
 * @param {{ world: number, mapX: number, mapY: number, width: number, height: number }} art
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
function renderArtFromMap(state, art) {
  const out = { width: art.width, height: art.height, data: new Uint8ClampedArray(art.width * art.height * 4) };
  const draws = mapCellDraws(state, art, ctx.eye());
  const slice = new ImageData(FRAME_W, FRAME_H);
  for (let y0 = 0; y0 < art.height; y0 += FRAME_H) {
    for (let x0 = 0; x0 < art.width; x0 += FRAME_W) {
      const here = draws
        .filter((d) => d.x + 8 > x0 && d.x < x0 + FRAME_W && d.y + 8 > y0 && d.y < y0 + FRAME_H)
        .map((d) => ({ ...d, x: d.x - x0, y: d.y - y0 }));
      // No world table (nothing to scroll or replace) and no fade: the tiles as painted.
      renderFrame({
        session: ctx.session,
        state: { patternTable: state.patternTable, ...(state.gplt && { gplt: state.gplt }), drawList: here },
        imageData: slice,
        eye: ctx.eye(),
        brightness: 1,
        overlayGroupIds: [],
        touchUps: false,
      });
      for (let y = 0; y < FRAME_H && y0 + y < art.height; y++) {
        const w = Math.min(FRAME_W, art.width - x0);
        out.data.set(slice.data.subarray(y * FRAME_W * 4, (y * FRAME_W + w) * 4), ((y0 + y) * art.width + x0) * 4);
      }
    }
  }
  return out;
}

/** A tile-hiding picture widened to its map's whole loop, the new part seeded from the tiles. */
export function coverWholeLoop() {
  const group = ctx.selectedGroup;
  const art = layerArtOf(group);
  const state = sourceState();
  const old = group ? layerArtPixels(group) : null;
  if (!art || !state || !old) return;
  const windows = getWindowsTableBytesFromState(state);
  const loop = layerArtLoop(windows, art.world, ctx.eye());
  if (!loop) return;
  const wide = { ...art, mapX: loop.mapX, width: loop.width };
  const over = !!(windows[art.world * 32] & 0x80);
  if (!art.hideTiles) {
    coverWholeLoopOverTiles(group, art, old, state, loop, wide, over);
    return;
  }
  if (art.width >= loop.width && art.mapX === loop.mapX) return;
  const pixels = placeArtColumns(old, art, renderArtFromMap(state, wide), wide, over ? 0 : loop.width);
  const added = wide.width - art.width;
  pictureStore.put(group.id, wide, pixels);
  groupsChanged();
  artChanged(group.id);
  ctx.renderStrip();
  ctx.setStatus(`“${group.name || group.id}”: the picture now covers the whole ${wide.width} px map loop (${added} px added, started from the tiles' paint), so it shows whatever column the game starts at. Paint the new part on a frame that shows it, then Save.`);
}

/**
 * The tiles of each 8 px map column across an area of a layer's map, over the rows the layer's
 * window shows, as a key per column: equal keys are columns that look the same.
 * @returns {(cellX: number) => string | null}
 */
function mapColumnKeys(state, world, area, rows) {
  const cells = mapCellDraws(state, { world, mapX: area.mapX, mapY: rows.mapY, width: area.width, height: rows.height }, ctx.eye());
  /** @type {Map<number, string[]>} */
  const cols = new Map();
  for (const d of cells) {
    const cx = Math.floor((area.mapX + d.x) / 8);
    if (!cols.has(cx)) cols.set(cx, []);
    cols.get(cx).push(`${d.y}:${hashTile(getTileBytes(state.patternTable, d.tileIndex)) >>> 0}${d.flipH ? 'h' : ''}${d.flipV ? 'v' : ''}`);
  }
  const keys = new Map([...cols].map(([cx, parts]) => [cx, parts.sort().join('|')]));
  return (cx) => keys.get(cx) ?? null;
}

/**
 * Cover the whole map for a picture drawn over the tiles (a backdrop): widen it to the map's
 * loop and start each new column as a copy of a painted column showing the same tiles
 * (seedRepeatedColumns) — games often repeat a backdrop, so the part a frame scrolls to is mostly
 * paint already made. Columns with no twin stay clear: the tiles show there until painted.
 */
function coverWholeLoopOverTiles(group, art, old, state, loop, wide, over) {
  const b = paintedBounds(old);
  if (!b) return;
  const painted = { x0: art.mapX + b.x0, x1: art.mapX + b.x1 };
  if (painted.x0 <= loop.mapX && painted.x1 >= loop.mapX + loop.width) return;
  pushPictureUndo(group.id);
  const base = { width: wide.width, height: art.height, data: new Uint8ClampedArray(wide.width * art.height * 4) };
  const placed = placeArtColumns(old, art, base, wide, over ? 0 : loop.width);
  const keyOf = mapColumnKeys(state, art.world, wide, loop);
  const { pixels, filled, unmatched } = seedRepeatedColumns(placed, wide.mapX, painted, keyOf);
  pictureStore.put(group.id, wide, pixels);
  groupsChanged();
  artChanged(group.id);
  // What still needs paint: the columns captured frames show that stay clear.
  const shown = pictureCoverage(group, art);
  const clear = [];
  if (shown.x1 > shown.x0) {
    for (let cx = Math.floor(shown.x0 / 8); cx * 8 < shown.x1; cx++) {
      let painted = false;
      for (let y = 0; y < pixels.height && !painted; y++) {
        for (let i = 0; i < 8; i++) {
          const x = cx * 8 + i - wide.mapX;
          if (x >= 0 && x < pixels.width && pixels.data[(y * pixels.width + x) * 4 + 3]) {
            painted = true;
            break;
          }
        }
      }
      if (!painted) clear.push(cx * 8);
    }
  }
  ctx.setStatus(
    `“${group.name || group.id}” now covers the whole ${wide.width} px map; ${filled} column(s) started as copies of painted columns showing the same tiles (${unmatched} elsewhere in the map have no painted twin). `
      + (clear.length
        ? `The captured frames still show ${clear.length} clear column(s), at map ${clear.map((x) => `${x}–${x + 7}`).join(', ')}: paint them on a frame that shows them.`
        : 'Everything the captured frames show is painted.')
      + ' Undo puts it back.',
  );
}

/** group object → its backdrop picture's coverage across the captured frames. */
const _pictureCoverage = new WeakMap();

/**
 * A backdrop picture (at least as wide as its layer's window) across the captured frames that show
 * it: how many scroll its layer past the painted part (the tiles show through there), and the map
 * columns they show between them (x1 exclusive). Worked out once per group object.
 * @returns {{ past: number, x0: number, x1: number }}
 */
function pictureCoverage(group, art) {
  if (_pictureCoverage.has(group)) return _pictureCoverage.get(group);
  const px = layerArtPixels(group);
  const b = px ? paintedBounds(px) : null;
  const out = { past: 0, x0: Infinity, x1: -Infinity };
  if (b) {
    const x0 = art.mapX + b.x0;
    const x1 = art.mapX + b.x1;
    const hashes = new Set((group?.criteria?.hashes || []).map((h) => Number(h) >>> 0));
    for (let i = 0; i < ctx.session.frames.length; i++) {
      // The picture shows only where its group's tiles are: other frames are not decoded.
      if (!mayShowPatterns(ctx.session, i, hashes)) continue;
      const st = frameState(ctx.session, i);
      if (!st?.drawList) continue;
      const windows = getWindowsTableBytesFromState(st);
      for (const e of activeLayerArts({ ...st, windows }, [group], ctx.eye())) {
        const g = layerGeometry(windows, e.world, ctx.eye());
        if (!g) continue;
        const shownWidth = g.finalX - g.startX + 1;
        if (x1 - x0 < shownWidth - 16) continue; // not a backdrop: a picture of part of the layer
        const from = g.sx(g.startX);
        out.x0 = Math.min(out.x0, from);
        out.x1 = Math.max(out.x1, from + shownWidth);
        if (from < x0 || from + shownWidth > x1) {
          out.past++;
          break;
        }
      }
    }
  }
  _pictureCoverage.set(group, out);
  return out;
}

/** How many captured frames scroll the group's backdrop picture past its painted part. */
export function framesPastPicture(group, art) {
  return pictureCoverage(group, art).past;
}

/** A tile-hiding picture made tall enough to fill the screen's height; the new rows start clear. */
export function fillArtScreenHeight() {
  const group = ctx.selectedGroup;
  const art = layerArtOf(group);
  const state = sourceState();
  const old = group ? layerArtPixels(group) : null;
  if (!art || !state || !old) return;
  const windows = getWindowsTableBytesFromState(state);
  const full = layerArtFullHeight(windows, art.world, ctx.eye());
  if (!full || (art.mapY === full.mapY && art.height >= full.height)) return;
  const tall = { ...art, mapY: full.mapY, height: full.height };
  const base = { width: art.width, height: tall.height, data: new Uint8ClampedArray(art.width * tall.height * 4) };
  const pixels = placeArtRows(old, art, base, tall, layerArtMaskY(windows, art.world, ctx.eye()));
  pictureStore.put(group.id, tall, pixels);
  groupsChanged();
  artChanged(group.id);
  ctx.renderStrip();
  ctx.setStatus(`“${group.name || group.id}”: the picture now fills the screen's height (${tall.height} rows). The new rows above and below the layer are see-through: pick Fill (G) and click there to colour them. Then Save.`);
}

/** Import, Paste and Ctrl+V all land here: the image replaces the picture, scaled to its size. */
export async function usePictureImage(blob, how, key = artTarget()?.id, kind = 'overpaint') {
  // Painting this pose only and it has no picture yet: the image starts one.
  if (!key && kind === 'overpaint' && materializePosePicture()) key = artTarget()?.id;
  if (kind === 'overpaint' && key === artTarget()?.id) startArtStroke();
  const px = key ? artPixelsFor(key, '') : null;
  if (!px) {
    ctx.setStatus(`Select a group with ${kind} first.`);
    return;
  }
  try {
    const { pixels, sourceWidth, sourceHeight } = await imageBlobToPixels(blob, px.width, px.height);
    pushArtUndo(key, copyPixels(px));
    replacePixels(px, pixels);
    artChanged(key);
    const fit = sourceWidth === px.width && sourceHeight === px.height ? '' : ` — scaled from ${sourceWidth}×${sourceHeight} to ${px.width}×${px.height}`;
    ctx.setStatus(`${how} into the ${kind}${fit}. Undo puts the old picture back.`);
  } catch (err) {
    ctx.setStatus(`Could not use that image: ${err?.message || err}`);
  }
}

export async function pastePictureFromClipboard(key = artTarget()?.id, kind = 'overpaint') {
  try {
    const blob = await readClipboardImage();
    if (!blob) {
      ctx.setStatus('No image on the clipboard — copy one in your paint program first (or press Ctrl+V here).');
      return;
    }
    await usePictureImage(blob, 'Pasted', key, kind);
  } catch (err) {
    ctx.setStatus(`The browser would not read the clipboard (${err?.message || err}) — try Ctrl+V instead.`);
  }
}

export async function copyPicture(key = artTarget()?.id, kind = 'overpaint') {
  const px = key ? artPixelsFor(key, '') : null;
  if (!px) return;
  try {
    await writeClipboardImage(px);
    ctx.setStatus(`Copied the ${px.width}×${px.height} ${kind} — paste it into your paint program, then paste it back here.`);
  } catch (err) {
    ctx.setStatus(`Could not copy: ${err?.message || err}. Export PNG works everywhere.`);
  }
}

export async function exportPicture(key = artTarget()?.id, kind = 'overpaint') {
  const px = key ? artPixelsFor(key, '') : null;
  if (!px) return;
  const name = String(findArtTarget(key)?.name || key).replace(/[^\w.-]+/g, '_');
  downloadBlob(await pixelsToPngBlob(px), `${name}-${kind.replace(' ', '-')}-${px.width}x${px.height}.png`);
  ctx.setStatus(`Exported ${px.width}×${px.height} PNG — edit it at that size and Import it back.`);
}

/**
 * Before saving or handing the pack back: edited pictures become the PNG stored in groups.json.
 * Overpaint is stored cropped to what is painted (a picture with nothing painted goes); the one
 * being painted widens again for the next stroke.
 */
export async function encodeEditedLayerArt() {
  await setAsidePicturesOutOfStep();
  for (const key of pictureStore.takeEdited()) {
    // A group's own picture, or one of its pose pictures (stored back into its group).
    const group = findArtTarget(key);
    const art = group ? layerArtOf(group) : null;
    const px = art ? artPixelsFor(key, '') : null;
    if (!art || !px) continue;
    const stored = cropOverpaint(art, px);
    if (!stored) pictureStore.put(key, null, null);
    else pictureStore.put(key, { ...stored.op, png: await encodePngBase64(stored.pixels) }, stored.pixels, { edited: false });
  }
  // The picture stays cropped until the next stroke widens it (startArtStroke): widening it here
  // ran before the pack was written and stored the cropped PNG under the wide size and place.
  if (paintOn === 'overpaint' && !selectedArt()) paintOn = 'tiles';
}

/**
 * Recovery at Save (src/recovery.js): a picture whose live pixels are not the size its settings
 * say is out of step, and neither says where its paint belongs. Rather than refuse the whole save,
 * ask, then set each aside — its paint as it is, cropped to what is painted, kept in the pack's
 * recovery folder and listed in its group's Overpaint panel — and save the rest. Cancelling
 * writes nothing.
 */
async function setAsidePicturesOutOfStep() {
  const outOfStep = [];
  for (const g of expandPoseOverpaints(ctx.session.groups)) {
    const art = layerArtOf(g);
    const px = art ? artPixelsFor(g.id, '') : null;
    if (px && (px.width !== art.width || px.height !== art.height)) outOfStep.push({ g, art, px });
  }
  if (!outOfStep.length) return;
  const names = outOfStep.map(({ g }) => `• ${g.name || g.id}`).join('\n');
  const ok = window.confirm(
    `${outOfStep.length} picture(s) are out of step — their settings and paint disagree, so where they belong is unknown:\n\n${names}\n\n`
      + 'Save anyway? They are set aside with their paint, kept in the pack, and listed under Recovered pictures in their group’s Overpaint panel, where you can put them back. Everything else saves.\n\nCancel writes nothing.',
  );
  if (!ok) throw new Error('nothing was written (pictures out of step; see the list above)');
  for (const { g, art, px } of outOfStep) {
    const stored = cropOverpaint({ ...art, width: px.width, height: px.height }, px);
    pictureStore.forget(g.id);
    const reason = `out of step at Save: settings ${art.width}×${art.height}, paint ${px.width}×${px.height}`;
    if (!stored) {
      // Nothing painted: nothing to keep.
      pictureStore.put(g.id, null, null);
      continue;
    }
    const r = setAside(ctx.session.groups, { key: g.id, png: await encodePngBase64(stored.pixels), reason });
    ctx.session.groups = r.groups;
    ctx.session.recovered = [...(ctx.session.recovered || []), r.item];
  }
  if (ctx.selectedGroup) ctx.selectedGroup = ctx.session.groups.find((x) => x.id === ctx.selectedGroup.id) || ctx.selectedGroup;
}

/** Before a stroke or fill on overpaint: a picture cropped by Save covers its whole layer again. */
function startArtStroke() {
  if (overpaintMode()) ensureOverpaintArea();
}

/** A pack just opened: load its pictures into live buffers so they can be painted on. */
export function loadLayerArtForSession() {
  pictureStore.reset();
  // Pose pictures too, each under its own key (src/pose-overpaint.js).
  for (const g of expandPoseOverpaints(ctx.session.groups)) {
    pictureStore.forget(g.id);
    if (!layerArtOf(g)) continue;
    loadLayerArtPixels(g).then(
      (px) => {
        if (!px || pictureStore.isEdited(g.id)) return;
        pictureStore.adopt(g.id, copyPixels(/** @type {any} */ (px)));
        ctx.invalidateRender();
        // Cards drawn before the picture loaded get it now.
        ctx.renderStrip();
        ctx.drawStage();
      },
      (err) => ctx.setStatus(`Could not load the overpaint of “${g.name || g.id}”: ${err?.message || err}`),
    );
  }
}

/**
 * Old screen-pinned overlays from the Project tool become touch-ups (then overpaint, below),
 * anchored where they were painted. Groups whose anchor no frame shows keep their overlay.
 * @returns {{ converted: number, kept: number }}
 */
function convertSessionOverlays() {
  const overlays = ctx.session.vipOverlays;
  if (!overlays?.size) return { converted: 0, kept: 0 };
  const result = convertOverlaysToTouchUps({
    groups: ctx.session.groups,
    overlays,
    frameCount: ctx.session.frames.length,
    frameAt: (i) => frameState(ctx.session, i),
  });
  if (!result.converted.length) return { converted: 0, kept: result.kept.length };
  ctx.session.groups = result.groups;
  for (const id of result.converted) {
    pictureStore.adopt(touchUpKey(id), result.pixels.get(id));
    clearGroupOverlay(ctx.session, id);
  }
  return { converted: result.converted.length, kept: result.kept.length };
}

/**
 * A pack just opened: touch-ups and layer art become overpaint (src/overpaint.js). A touch-up is
 * placed in its layer's map from a captured frame it shows on; one no frame places stays a
 * touch-up and still draws where its tiles line up. Returns what changed, for the status line.
 * @returns {Promise<{ touchUps: number, layerArt: number, kept: number, overlays: number }>}
 */
export async function convertSessionToOverpaint() {
  const overlays = convertSessionOverlays();
  const old = ctx.session.groups.filter((g) => !g.overpaint && (g.layerArt || touchUpOf(g)));
  if (!old.length) return { touchUps: 0, layerArt: 0, kept: 0, overlays: overlays.converted };
  /** @type {Map<string, any>} */
  const tuPixels = new Map();
  for (const g of old) {
    const tu = g.layerArt ? null : touchUpOf(g);
    if (!tu) continue;
    const key = touchUpKey(g.id);
    const px = artPixelsFor(key, '') || (tu.png ? await loadArtPixelsFor(key, tu.png).catch(() => null) : null);
    if (px) tuPixels.set(g.id, px);
  }
  const r = convertToOverpaint({
    groups: ctx.session.groups,
    frameCount: ctx.session.frames.length,
    frameAt: (i) => frameState(ctx.session, i),
    touchUpPixels: (g) => tuPixels.get(g.id) || null,
  });
  ctx.session.groups = r.groups;
  for (const [id, px] of r.pixels) {
    pictureStore.adopt(id, copyPixels(px), { edited: true });
    pictureStore.forget(touchUpKey(id));
  }
  return { touchUps: r.touchUps.length, layerArt: r.layerArt.length, kept: r.kept.length, overlays: overlays.converted };
}

/** The Overpaint section of the details panel, for BG groups. */
/**
 * A note for a group whose paint shows only sometimes (the Project tool's "Paint shows when…": a
 * screens setting and conditions on game states): what, and whether the frame on stage is one of
 * them — the stage shows the picture either way, to paint.
 */
export function groupScreensNote(group) {
  const screens = groupScreensOf(group);
  const conditions = describeGroupConditions(group);
  if (!screens && !conditions) return null;
  const view = ctx.poseViews[ctx.poseIndex];
  const frameIndex = view?.base ? view.base.sourceFrameIndex : view?.frameIndex;
  const wram = frameIndex >= 0 ? frameWram(ctx.session, frameIndex) : null;
  const matched = wram ? matchedScreens(ctx.session.gameStatePools, wram) : null;
  const held = heldProjectGameStates(wram);
  const p = document.createElement('p');
  p.className = 'muted';
  p.id = 'overpaint-screens-note';
  const known = matched !== null || held !== null;
  const shown = groupShownOnScreens(group, matched) && projectConditionsAllow(group, held);
  const here = !known ? '' : shown ? ' This frame is one of them.' : ' The game hides it on this frame; it shows here so you can paint it.';
  const what = [screens ? `on ${describeGroupScreens(group, ctx.session.gameStatePools).toLowerCase()}` : '', conditions].filter(Boolean).join(', ');
  p.textContent = `Paint shows ${what} (set in the Project tool).${here}`;
  return p;
}

/**
 * The per-pose part of the Overpaint panel: on a pose's own picture, what it is; on a group's
 * picture, "Overpaint just this pose" / "Move this overpaint to this pose" (a character painting all
 * poses gets only Move, its scope switch being above); on an old-style pose group that no character
 * took in, what it is and the way back.
 * @returns {HTMLElement | null}
 */
export function overpaintPosePart(group, target, button) {
  const wrap = document.createElement('div');
  wrap.id = 'overpaint-pose';
  const p = document.createElement('p');
  p.className = 'muted';
  const poses = posePictureGroups(group).length;
  if (target?.posePictureId) {
    const n = target.criteria.hashes.length;
    const others = overpaintScope(group) === 'pose' ? 'other poses get their own when you paint them' : `other cards paint ${layerArtOf(group) ? 'the group’s picture' : 'a new one'}`;
    p.textContent = `This pose’s own picture: it shows only when all ${n} of its tiles are on screen.${layerArtOf(group) ? ' The group’s own picture shows on every pose, this one too.' : ''} ${poses} pose${poses === 1 ? ' has' : 's have'} a picture of its own; ${others}.`;
    wrap.append(p);
    return wrap;
  }
  if (group.wholePose === true) {
    const n = (group.criteria?.hashes || []).length;
    const parent = ctx.session.groups.find((g) => g.id === group.poseOf);
    p.textContent = `One pose of ${parent ? `“${parent.name || parent.id}”` : 'a character'}: its overpaint shows only when all ${n} of its tiles are on screen. Its tiles take their colour from the character’s group.`;
    wrap.append(p);
    if (parent) wrap.append(button('btn-overpaint-pose-parent', `Back to ${parent.name || parent.id}`, 'Select the character’s group', () => ctx.selectGroup(parent)));
    return wrap;
  }
  if (!stagePosePatterns().length) return null;
  // A character painting all poses has the scope switch above; Move still applies.
  const hasArt = !!layerArtOf(group);
  // A character's all-poses picture is listed, with Move and Remove, at the top of the panel.
  if (isPoseCharacter(group)) return null;
  p.textContent = `${hasArt ? 'This overpaint shows on every pose of this group. ' : ''}To paint one pose only, give it a picture of its own${poses ? ` (${poses} pose${poses === 1 ? ' has' : 's have'} one)` : ''}.`;
  const row = document.createElement('div');
  row.className = 'layer-art-actions';
  row.append(button('btn-overpaint-pose', 'Overpaint just this pose', 'Start a picture for the pose on stage, kept in this group, that shows only when this whole pose is on screen', () => overpaintThisPose(false)));
  if (hasArt) row.append(button('btn-overpaint-move-pose', 'Move this overpaint to this pose', 'Make this picture the pose on stage’s own, so it stops showing on the other poses', () => overpaintThisPose(true)));
  wrap.append(p, row);
  return wrap;
}

/** The Overpaint panel, with the group's recovered pictures (if any) under it. */
export function overpaintPanel(group) {
  const box = ctx.overpaintPanelBody(group);
  const recovered = ctx.recoveredPicturesPart(group);
  if (recovered) box.append(recovered);
  return box;
}
