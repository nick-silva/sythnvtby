/**
 * Layer art: a picture that replaces a BG group's whole layer.
 *
 * A BG group can carry `layerArt` — an image in the layer's own BG-map coordinates:
 *   { world, bgmapBase, mapX, mapY, width, height, png }
 * While the group is on screen in a world that draws from the same BG map, the compositor
 * skips that world's tiles and samples the image instead, pixel by pixel, through the same
 * source mapping the VIP uses (`VIP_DrawBlock` / `DrawBG`: screen x → MX ± MP + x − DestX,
 * screen y → MY + y − GY). Scrolling and stereo parallax therefore line up on their own, and
 * the picture is drawn at the world's place in the depth order — worlds in front still cover it,
 * transparent pixels let the worlds behind show. Paint on tile patterns cannot do this when a
 * backdrop is a handful of repeated tiles: every copy of a pattern gets the same colours.
 *
 * `png` is base64 PNG (saved in groups.json). Pixels come from a live buffer registered by
 * group id (SpriteStudio while painting) or from the PNG, decoded once by an injected decoder
 * (browser: src/layer-art-png.js); until a PNG is decoded the layer draws as usual.
 *
 * Normal BG worlds only for now; HBias and affine worlds are not replaced.
 */

import { stereoTwins } from './stereo-twin.js';
import { getWindowsTableBytesFromState } from './vip-world-clip.js';
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { overpaintSwitchHashes, wholePoseHashes, wholePoseOn, dropCoveredPoses } from './overpaint-switch.js';
import { expandPoseOverpaints } from './pose-overpaint.js';

const FRAME_W = 384;
const FRAME_H = 224;
const WORLD_BYTES = 32;
const MAX_SIDE = 4096; // the largest BG map: 8 segments of 512 px
const BGM_NORMAL = 0;
const HDR_LON = 0x8000;
const HDR_RON = 0x4000;
const HDR_OVER = 0x80;

/**
 * A group's picture in its layer's map. Stored as `overpaint` (src/overpaint.js: drawn over the
 * tiles, or instead of them with `hideTiles`); an older pack's `layerArt` reads as overpaint that
 * hides the tiles, which is what layer art did.
 * @typedef {{ world: number, bgmapBase: number | null, mapX: number, mapY: number, width: number, height: number, png: string, hideTiles: boolean }} LayerArt
 */
/** @typedef {{ width: number, height: number, data: Uint8ClampedArray | Uint8Array }} LayerArtPixels */

/** @param {number} v @param {number} bits */
function signExtend(v, bits) {
  const m = v & ((1 << bits) - 1);
  return m >= 1 << (bits - 1) ? m - (1 << bits) : m;
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * @param {any} group
 * @returns {LayerArt | null} the group's layer art, or null when it has none (or it is malformed)
 */
export function layerArtOf(group) {
  const isOverpaint = !!group?.overpaint && typeof group.overpaint === 'object';
  const a = isOverpaint ? group.overpaint : group?.layerArt;
  if (!a || typeof a !== 'object') return null;
  // Map pixels of the layer's whole map plane: mapY may sit well up an overplane map when the
  // picture reaches above the layer's window; a scaled layer's plane is 1024 cells across.
  if (!isInt(a.world, 0, 31) || !isInt(a.mapX, 0, 0x1fff) || !isInt(a.mapY, 0, 0x1fff)) return null;
  if (!isInt(a.width, 1, MAX_SIDE) || !isInt(a.height, 1, MAX_SIDE)) return null;
  return {
    world: a.world,
    bgmapBase: isInt(a.bgmapBase, 0, 15) ? a.bgmapBase : null,
    mapX: a.mapX,
    mapY: a.mapY,
    width: a.width,
    height: a.height,
    png: typeof a.png === 'string' ? a.png : '',
    hideTiles: isOverpaint ? a.hideTiles === true : true,
  };
}

/**
 * A plain (normal BG) world's screen → map mapping for one eye, or null for other kinds of world
 * (src/overpaint.js places pictures with it).
 * @param {Uint8Array} windows @param {number} world @param {number} [eye]
 */
export function layerGeometry(windows, world, eye = 0) {
  return worldGeometry(windows, world, eye);
}

/**
 * Where a normal-BG world draws this frame, and its screen → BG-map mapping for one eye.
 * @param {Uint8Array} windows 1024-byte world table
 * @returns {null | { bgmapBase: number, startX: number, finalX: number, rowStart: number, rowEnd: number, sx: (x: number) => number, sy: (y: number) => number }}
 */
function worldGeometry(windows, world, eye) {
  if (!windows || windows.length < 1024 || !isInt(world, 0, 31)) return null;
  const b = world * WORLD_BYTES;
  const rd = (off) => windows[b + off] | (windows[b + off + 1] << 8);
  const header = rd(0);
  if (((header >> 12) & 3) !== BGM_NORMAL) return null;
  if (!(header & (eye ? HDR_RON : HDR_LON))) return null;
  const over = !!(header & HDR_OVER);
  const scy = (header >> 8) & 3;
  const scx = (header >> 10) & 3;
  const gx = signExtend(rd(2), 11);
  const gp = signExtend(rd(4), 9);
  const gy = signExtend(rd(6), 11);
  const mx = rd(8);
  const mp = signExtend(rd(10), 9);
  const my = rd(12);
  const destWidth = signExtend(rd(14), 11) & 0xffff;
  const destHeight = rd(16) & 0x3ff;
  const rowStart = Math.max(0, gy);
  const rowEnd = Math.min(FRAME_H - 1, gy + destHeight);
  const destX = signExtend(gx + (eye ? gp : -gp), 10);
  const startX = Math.max(0, destX);
  const finalX = Math.min(FRAME_W - 1, destX + destWidth);
  if (rowStart > rowEnd || startX > finalX) return null;
  const maskX = over ? 0x1fff : (512 << scx) - 1;
  const maskY = over ? 0x1fff : (512 << scy) - 1;
  const srcX0 = mx + (eye ? mp : -mp);
  return {
    bgmapBase: header & 0xf,
    startX,
    finalX,
    rowStart,
    rowEnd,
    sx: (x) => (srcX0 + x - destX) & maskX,
    sy: (y) => (my + y - gy) & maskY,
    maskX,
    maskY,
    over,
    mapWidth: 512 << scx,
    mapHeight: 512 << scy,
    overplane: rd(20),
  };
}

/**
 * Every column a game can scroll a world's layer to, from map X 0: a game may start the window at
 * any column — Mario's Tennis picks a different start for its crowd backdrop per match — and art
 * covering only what one frame showed leaves the rest bare. Two cases:
 * - the map **wraps** (the usual case): its whole width, 512 px or more;
 * - **overplane** (the world's OVER flag): past the map's edge the VIP shows one filler tile
 *   instead of wrapping, so the art covers the map plus one window's width of filler beyond it —
 *   enough for any start inside the map.
 * Same rows as the layer shows now. Null for worlds that cannot take layer art.
 * @param {Uint8Array} windows @param {number} world @param {number} [eye]
 * @returns {Omit<LayerArt, 'png'> | null}
 */
export function layerArtLoop(windows, world, eye = 0) {
  const rect = layerArtRectForWorld(windows, world, eye);
  const g = worldGeometry(windows, world, eye);
  if (!rect || !g) return null;
  const width = g.over ? Math.min(MAX_SIDE, g.mapWidth + (g.finalX - g.startX + 1)) : g.maskX + 1;
  return { ...rect, mapX: 0, width };
}

/**
 * The rows a layer art needs to fill the screen's height: from the map row screen row 0 shows to
 * 224 rows below it. The layer's own window is usually a strip; above and below it nothing of the
 * layer is drawn, and art reaching there is the way to colour that space (a sky over a crowd).
 * @param {Uint8Array} windows @param {number} world @param {number} [eye]
 * @returns {{ mapY: number, height: number } | null}
 */
export function layerArtFullHeight(windows, world, eye = 0) {
  const g = worldGeometry(windows, world, eye);
  return g ? { mapY: g.sy(0), height: FRAME_H } : null;
}

/**
 * Move a picture's rows to a new range of map rows, keeping each row's place in the map.
 * @param {LayerArtPixels} old @param {{ mapY: number }} oldArt
 * @param {LayerArtPixels} base @param {{ mapY: number }} newArt
 * @param {number} maskY the map's row wrap mask
 */
export function placeArtRows(old, oldArt, base, newArt, maskY) {
  const w = Math.min(old.width, base.width);
  for (let ay = 0; ay < old.height; ay++) {
    const ny = (oldArt.mapY + ay - newArt.mapY) & maskY;
    if (ny >= base.height) continue;
    base.data.set(old.data.subarray(ay * old.width * 4, (ay * old.width + w) * 4), ny * base.width * 4);
  }
  return base;
}

/**
 * Where a layer art shows on screen: the layer's window across, and the rows the art covers
 * (more than the window when it fills the screen's height). For framing the stage.
 * @returns {{ x0: number, y0: number, x1: number, y1: number } | null}
 */
export function layerArtStageRect(windows, world, eye, art) {
  const g = worldGeometry(windows, world, eye);
  if (!g) return null;
  let y0 = g.rowStart;
  let y1 = g.rowEnd + 1;
  for (let y = 0; y < FRAME_H; y++) {
    if (((g.sy(y) - art.mapY) & g.maskY) >= art.height) continue;
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y + 1);
  }
  return { x0: g.startX, y0, x1: g.finalX + 1, y1 };
}

/**
 * The map's row wrap mask for a world (for moving rows round it).
 * @param {Uint8Array} windows @param {number} world @param {number} [eye]
 */
export function layerArtMaskY(windows, world, eye = 0) {
  return worldGeometry(windows, world, eye)?.maskY ?? 0x1fff;
}

/**
 * Move a picture's columns to a new area of the same map rows (per column, round the map's
 * wrap): what was painted keeps its place in the map. `base` supplies the new area's pixels.
 * @param {LayerArtPixels} old @param {{ mapX: number }} oldArt
 * @param {LayerArtPixels} base @param {{ mapX: number }} newArt
 * @param {number} wrap the map's wrap width, or 0 for an overplane map (no wrap)
 */
export function placeArtColumns(old, oldArt, base, newArt, wrap) {
  const rows = Math.min(old.height, base.height);
  for (let ax = 0; ax < old.width; ax++) {
    let mx = oldArt.mapX + ax;
    if (wrap) mx %= wrap;
    const nx = mx - newArt.mapX;
    if (nx < 0 || nx >= base.width) continue;
    for (let y = 0; y < rows; y++) {
      const si = (y * old.width + ax) * 4;
      base.data.set(old.data.subarray(si, si + 4), (y * base.width + nx) * 4);
    }
  }
  return base;
}

/**
 * Every BG-map cell under a layer art's area as an ordinary background draw, positioned in the
 * art's own pixels (x 0 = the art's mapX), wrapping with the map. Rendering these shows how the
 * layer's tiles look across the whole area, including the part no captured frame scrolled to.
 * @param {any} state a VIP frame (its world table and display RAM segments)
 * @param {{ world: number, mapX: number, mapY: number, width: number, height: number }} art
 * @param {number} [eye]
 * @returns {Array<{ tileIndex: number, x: number, y: number, flipH: boolean, flipV: boolean, paletteSelector: number, world: number, layer: 0, eye: number }>}
 */
export function mapCellDraws(state, art, eye = 0) {
  const windows = getWindowsTableBytesFromState(state);
  const g = worldGeometry(windows, art.world, eye);
  const segments = state?.segments;
  if (!g || !Array.isArray(segments)) return [];
  const header = windows[art.world * WORLD_BYTES] | (windows[art.world * WORLD_BYTES + 1] << 8);
  const scx = (header >> 10) & 3;
  const cellsX = g.mapWidth / 8;
  const cellsY = g.mapHeight / 8;
  // Past an overplane map's edge the VIP draws one filler cell (a BG-map word in display RAM).
  const rdDram = (h) => {
    const seg = segments[(h >> 12) & 0xf];
    return seg ? seg[(h & 0xfff) * 2] | (seg[(h & 0xfff) * 2 + 1] << 8) : 0;
  };
  const overWord = g.over ? rdDram(g.overplane) : 0;
  const out = [];
  const cx0 = Math.floor(art.mapX / 8);
  const cx1 = Math.floor((art.mapX + art.width - 1) / 8);
  const cy0 = Math.floor(art.mapY / 8);
  const cy1 = Math.floor((art.mapY + art.height - 1) / 8);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      let word;
      if (g.over && (cx < 0 || cy < 0 || cx >= cellsX || cy >= cellsY)) {
        word = overWord;
      } else {
        const mcx = ((cx % cellsX) + cellsX) % cellsX;
        const mcy = ((cy % cellsY) + cellsY) % cellsY;
        const seg = segments[g.bgmapBase + (mcy >> 6) * (1 << scx) + (mcx >> 6)];
        if (!seg) continue;
        const o = ((mcy & 63) * 64 + (mcx & 63)) * 2;
        word = seg[o] | (seg[o + 1] << 8);
      }
      out.push({
        tileIndex: word & 0x7ff,
        x: cx * 8 - art.mapX,
        y: cy * 8 - art.mapY,
        flipH: (word & 0x2000) !== 0,
        flipV: (word & 0x1000) !== 0,
        paletteSelector: word >> 14,
        world: art.world,
        layer: 0,
        eye: eye ? 1 : 0,
      });
    }
  }
  return out;
}

/**
 * The BG-map region a world shows on screen (left eye): what new layer art covers.
 * @param {Uint8Array} windows
 * @param {number} world
 * @param {number} [eye]
 * @returns {Omit<LayerArt, 'png'> | null}
 */
export function layerArtRectForWorld(windows, world, eye = 0) {
  const g = worldGeometry(windows, world, eye);
  if (!g) return null;
  return {
    world,
    bgmapBase: g.bgmapBase,
    mapX: g.sx(g.startX),
    mapY: g.sy(g.rowStart),
    width: g.finalX - g.startX + 1,
    height: g.rowEnd - g.rowStart + 1,
  };
}

/**
 * Where a world's window sits on screen for one eye (x1/y1 exclusive), for framing the stage.
 * @param {Uint8Array} windows @param {number} world @param {number} [eye]
 * @returns {{ x0: number, y0: number, x1: number, y1: number } | null}
 */
export function layerArtScreenRect(windows, world, eye = 0) {
  const g = worldGeometry(windows, world, eye);
  return g ? { x0: g.startX, y0: g.rowStart, x1: g.finalX + 1, y1: g.rowEnd + 1 } : null;
}

/**
 * The art pixel shown at a screen pixel, or null when the pixel is outside the layer or the art.
 * @param {Uint8Array} windows @param {number} world @param {number} eye
 * @param {number} x @param {number} y screen pixel
 * @param {{ mapX: number, mapY: number, width: number, height: number }} art
 * @returns {{ ax: number, ay: number } | null}
 */
export function screenToLayerArt(windows, world, eye, x, y, art) {
  // Rows above and below the layer's window count too, when the art reaches them (Fill the
  // screen's height); its columns still follow the layer's scroll.
  const g = worldGeometry(windows, world, eye);
  if (!g || x < g.startX || x > g.finalX || y < 0 || y >= FRAME_H) return null;
  // Measured round the map's wrap, so a picture can span the point where the map loops.
  const ax = (g.sx(x) - art.mapX) & g.maskX;
  const ay = (g.sy(y) - art.mapY) & g.maskY;
  if (ax >= art.width || ay >= art.height) return null;
  return { ax, ay };
}

/* ---------------------------------------------------------------- pixels */

/** @type {Map<string, LayerArtPixels>} live buffers by group id (SpriteStudio while painting) */
const live = new Map();
/** @type {Map<string, LayerArtPixels | 'pending' | 'failed'>} decoded PNGs by their base64 */
const decoded = new Map();
/** @type {((png: string) => Promise<LayerArtPixels>) | null} */
let decoder = null;
/** @type {Set<() => void>} */
const listeners = new Set();

/** @param {(png: string) => Promise<LayerArtPixels>} fn how to turn base64 PNG into pixels */
export function setLayerArtDecoder(fn) {
  decoder = fn;
}

/** Call `fn` whenever a PNG finishes decoding (so a page can redraw). @returns {() => void} unsubscribe */
export function onLayerArtDecoded(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** @param {string} groupId @param {LayerArtPixels} pixels */
export function setLayerArtPixels(groupId, pixels) {
  live.set(groupId, pixels);
}

/** @param {string} groupId */
export function clearLayerArtPixels(groupId) {
  live.delete(groupId);
}

/**
 * The pixels to draw for a group's layer art: its live buffer, else its decoded PNG. Starts
 * decoding a PNG it has not seen and returns null until that finishes.
 * @param {any} group
 * @returns {LayerArtPixels | null}
 */
export function layerArtPixels(group) {
  return artPixelsFor(group?.id, layerArtOf(group)?.png || '');
}

/**
 * Pixels for any stored picture (layer art, touch-ups): the live buffer registered under
 * `key`, else the decoded `png`. Starts decoding a PNG it has not seen; null until it is ready.
 * @param {string | undefined} key
 * @param {string} png base64 PNG, or ''
 * @returns {LayerArtPixels | null}
 */
export function artPixelsFor(key, png) {
  const own = key != null ? live.get(key) : undefined;
  if (own) return own;
  if (!png) return null;
  const hit = decoded.get(png);
  if (hit && typeof hit === 'object') return hit;
  if (hit === undefined && decoder) {
    decoded.set(png, 'pending');
    decoder(png).then(
      (px) => {
        decoded.set(png, px);
        for (const fn of listeners) fn();
      },
      (err) => {
        decoded.set(png, 'failed');
        console.warn('[Layer art] Could not decode a stored picture for', key, err);
      },
    );
  }
  return null;
}

/** The same, waiting for the PNG to decode. @param {string | undefined} key @param {string} png */
export async function loadArtPixelsFor(key, png) {
  const now = artPixelsFor(key, png);
  if (now) return now;
  if (!png || !decoder) return null;
  const px = await decoder(png);
  decoded.set(png, px);
  return px;
}

/**
 * The same for a group's layer art (SpriteStudio, before painting on it).
 * @param {any} group
 * @returns {Promise<LayerArtPixels | null>}
 */
export async function loadLayerArtPixels(group) {
  return loadArtPixelsFor(group?.id, layerArtOf(group)?.png || '');
}

/* ------------------------------------------------------------- rendering */

/**
 * Pictures (overpaint, old layer art) to draw on this frame and eye, back to front. A group's
 * picture applies to each of its worlds the group has a tile in on this eye, when that world
 * draws from the picture's BG map (a double-buffer twin showing another part of the map is left
 * alone). Several groups' overpaint can share a world (the group higher in the list on top); only
 * one picture per world can hide its tiles.
 * @param {{ patternTable?: Uint8Array, windows?: Uint8Array, windowsBase64?: string, drawList?: any[] }} state
 * @param {any[]} groups
 * @param {number} eye
 * @param {any[]} [allGroups] every group, for which patterns are shared (src/overpaint-switch.js):
 *   only the group's own patterns switch its picture on. Defaults to `groups`.
 * On the right eye, a group on a left-only world also gets that world's right-only twin, with
 * `twin` saying where to sample (see paintLayerArt).
 * @returns {Array<{ world: number, group: any, art: LayerArt, pixels: LayerArtPixels, ownerIndex: number, twin?: { left: number, shift: number } }>}
 */
export function activeLayerArts(state, groups, eye, allGroups = groups) {
  if (!Array.isArray(groups) || !groups.length) return [];
  // Pose pictures kept inside a character's group draw as whole-pose groups (src/pose-overpaint.js).
  groups = expandPoseOverpaints(groups);
  const withArt = groups.filter((g) => layerArtOf(g));
  if (!withArt.length) return [];
  const windows = getWindowsTableBytesFromState(state);
  const pt = state?.patternTable;
  const drawList = state?.drawList;
  if (!windows || !pt || !Array.isArray(drawList)) return [];
  /** @type {Map<number, number | null>} */
  const hashBySlot = new Map();
  const hashOf = (tileIndex) => {
    let h = hashBySlot.get(tileIndex);
    if (h === undefined) {
      const bytes = getTileBytes(pt, tileIndex);
      h = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
      hashBySlot.set(tileIndex, h);
    }
    return h;
  };
  // Every group's overpaint on a layer is drawn; only one picture can replace a layer's tiles.
  /** @type {Array<ReturnType<typeof activeLayerArts>[number] & { order: number }>} */
  const out = [];
  /** @type {Set<number>} worlds whose tiles a picture already replaces */
  const hidden = new Set();
  const take = (entry, order) => {
    if (entry.art.hideTiles) {
      if (hidden.has(entry.world)) return;
      hidden.add(entry.world);
    }
    out.push({ ...entry, order });
  };
  const twins = eye === 1 ? stereoTwins(windows) : null;
  // Whole-pose pictures (a character's poses, often dozens): one pass over the draw list per eye
  // finds every pattern on each plain layer and its first draw there; each pose then just checks
  // its own patterns, instead of each scanning the whole list.
  /** @type {Map<number, Map<number, Map<number, number>>>} eye → world → pattern → first draw index */
  const layerPatterns = new Map();
  const patternsOn = (e) => {
    let byWorld = layerPatterns.get(e);
    if (byWorld) return byWorld;
    byWorld = new Map();
    for (let i = 0; i < drawList.length; i++) {
      const d = drawList[i];
      if ((Number(d.eye) === 1 ? 1 : 0) !== e || (d.layer ?? 0) !== 0 || d.world == null) continue;
      const h = hashOf(d.tileIndex);
      if (h === null) continue;
      let m = byWorld.get(d.world);
      if (!m) byWorld.set(d.world, (m = new Map()));
      if (!m.has(h)) m.set(h, i);
    }
    layerPatterns.set(e, byWorld);
    return byWorld;
  };
  for (const [order, group] of withArt.entries()) {
    const pixels = layerArtPixels(group);
    if (!pixels) continue;
    const art = /** @type {LayerArt} */ (layerArtOf(group));
    const c = group.criteria || {};
    const worlds = Array.isArray(c.windowIds) && c.windowIds.length ? new Set(c.windowIds.map(Number)) : null;
    const hashes = new Set((Array.isArray(c.hashes) ? c.hashes : []).map((h) => Number(h) >>> 0));
    const slots = new Set((Array.isArray(c.tileSlots) ? c.tileSlots : []).map(Number));
    // Patterns other groups on these layers share (a fill or black-out tile) do not switch it on.
    // A whole-pose group's picture needs all of its pose there; any other, one of its own patterns.
    const pose = wholePoseHashes(group);
    const switches = pose ? null : overpaintSwitchHashes(group, allGroups);
    /** @returns {Map<number, number>} world → first draw index of the group there, on eye `e` */
    const poseOn = (e) => {
      const first = new Map();
      for (const [world, at] of patternsOn(e)) {
        if (worlds && !worlds.has(Number(world))) continue;
        let firstIndex = Infinity;
        let whole = true;
        for (const h of /** @type {Set<number>} */ (pose)) {
          const i = at.get(h);
          if (i === undefined) {
            whole = false;
            break;
          }
          if (i < firstIndex) firstIndex = i;
        }
        if (whole) first.set(world, firstIndex);
      }
      return first;
    };
    /** @returns {Map<number, number>} world → first draw index of the group there, on eye `e` */
    const firstOn = pose && !slots.size ? poseOn : (e) => {
      const first = new Map();
      const switched = new Set();
      /** @type {Map<number, Set<number>>} world → the pose's patterns drawn there */
      const drawn = new Map();
      for (let i = 0; i < drawList.length; i++) {
        const d = drawList[i];
        if ((Number(d.eye) === 1 ? 1 : 0) !== e || (d.layer ?? 0) !== 0 || d.world == null) continue;
        if (worlds && !worlds.has(Number(d.world))) continue;
        const h = hashOf(d.tileIndex);
        if (h === null) continue;
        if ((hashes.size || slots.size) && !hashes.has(h) && !slots.has(d.tileIndex)) continue;
        if (!first.has(d.world)) first.set(d.world, i);
        if (switches && (switches.has(h) || slots.has(d.tileIndex))) switched.add(d.world);
        if (pose) {
          if (!drawn.has(d.world)) drawn.set(d.world, new Set());
          drawn.get(d.world).add(h);
        }
      }
      if (switches) for (const w of [...first.keys()]) if (!switched.has(w)) first.delete(w);
      if (pose) for (const w of [...first.keys()]) if (!wholePoseOn(group, drawn.get(w))) first.delete(w);
      return first;
    };
    const placed = new Set();
    for (const [world, ownerIndex] of firstOn(eye)) {
      const g = worldGeometry(windows, world, eye);
      if (!g || (art.bgmapBase != null && g.bgmapBase !== art.bgmapBase)) continue;
      placed.add(world);
      take({ world, group, art, pixels, ownerIndex }, order);
    }
    // The right eye's copy of a left-only layer the group is on (src/stereo-twin.js): the same
    // picture, drawn at the copy's depth through the left world's mapping.
    if (twins?.size) {
      const onLeft = firstOn(0);
      for (const [right, twin] of twins) {
        if (placed.has(right) || !onLeft.has(twin.left)) continue;
        const g = worldGeometry(windows, twin.left, 0);
        if (!g || (art.bgmapBase != null && g.bgmapBase !== art.bgmapBase)) continue;
        const ownerIndex = drawList.findIndex((d) => d.world === right && Number(d.eye) === 1);
        if (ownerIndex < 0) continue;
        take({ world: right, group, art, pixels, ownerIndex, twin }, order);
      }
    }
  }
  // Back to front; on a shared layer the group higher in the list is drawn last (on top), as the
  // first group supplies a shared tile's colours.
  return dropCoveredPoses(out).sort((a, b) => b.world - a.world || b.order - a.order).map(({ order: _o, ...e }) => e);
}

/**
 * Draw one layer art into a 384×224 RGBA frame (a compositor pass).
 * @param {Uint8ClampedArray} data frame pixels
 * @param {Int32Array | null} drawOwner front-most draw per pixel, updated where art is drawn
 * @param {Uint8Array} windows world table
 * @param {number} eye
 * @param {{ world: number, art: { mapX: number, mapY: number }, pixels: LayerArtPixels, ownerIndex: number, twin?: { left: number, shift: number } }} entry
 * @param {number} brightness 0..1, the scene's fade
 * @param {Uint8Array | null} [painted] set to 1 where the art drew (the compositor's record)
 * @returns {number} pixels drawn
 */
export function paintLayerArt(data, drawOwner, windows, eye, entry, brightness, painted = null) {
  const g = worldGeometry(windows, entry.world, eye);
  if (!g) return 0;
  // A right-eye twin draws within its own window, but the picture is the left copy's: each pixel
  // samples what the left eye shows `shift` px to its left (src/stereo-twin.js).
  const from = entry.twin ? worldGeometry(windows, entry.twin.left, 0) : g;
  if (!from) return 0;
  const shift = entry.twin ? entry.twin.shift : 0;
  const { width: pw, height: ph, data: src } = entry.pixels;
  const k = Math.max(0, Math.min(1, brightness));
  let n = 0;
  // Every screen row, not just the window's: art made to fill the screen's height reaches above
  // and below the layer. Rows the art does not cover map past its edge and draw nothing.
  for (let y = 0; y < FRAME_H; y++) {
    const ay = (from.sy(y) - entry.art.mapY) & from.maskY;
    if (ay >= ph) continue;
    for (let x = g.startX; x <= g.finalX; x++) {
      const ax = (from.sx(x - shift) - entry.art.mapX) & from.maskX;
      if (ax >= pw) continue;
      const si = (ay * pw + ax) * 4;
      const a = src[si + 3];
      if (!a) continue;
      const p = y * FRAME_W + x;
      const di = p * 4;
      const r = (src[si] * k) | 0;
      const gg = (src[si + 1] * k) | 0;
      const b = (src[si + 2] * k) | 0;
      if (a === 255) {
        data[di] = r;
        data[di + 1] = gg;
        data[di + 2] = b;
        data[di + 3] = 255;
      } else {
        const t = a / 255;
        data[di] = (r * t + data[di] * (1 - t)) | 0;
        data[di + 1] = (gg * t + data[di + 1] * (1 - t)) | 0;
        data[di + 2] = (b * t + data[di + 2] * (1 - t)) | 0;
        data[di + 3] = Math.max(a, data[di + 3]);
      }
      if (drawOwner) drawOwner[p] = entry.ownerIndex;
      if (painted) painted[p] = 1;
      n++;
    }
  }
  return n;
}

/**
 * New layer art for a world, started from how that layer looks now.
 * @param {Uint8Array} windows
 * @param {number} world
 * @param {Uint8ClampedArray} rendered 384×224 RGBA of the layer as it looks (e.g. just its draws)
 * @param {number} [eye]
 * @returns {{ art: Omit<LayerArt, 'png'>, pixels: { width: number, height: number, data: Uint8ClampedArray } } | null}
 */
export function newLayerArt(windows, world, rendered, eye = 0) {
  const art = layerArtRectForWorld(windows, world, eye);
  if (!art) return null;
  const data = new Uint8ClampedArray(art.width * art.height * 4);
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const hit = screenToLayerArt(windows, world, eye, x, y, art);
      if (!hit) continue;
      const si = (y * FRAME_W + x) * 4;
      data.set(rendered.subarray(si, si + 4), (hit.ay * art.width + hit.ax) * 4);
    }
  }
  return { art, pixels: { width: art.width, height: art.height, data } };
}
