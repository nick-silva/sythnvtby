/**
 * Overpaint: one picture per background group, pinned to its layer's BG map
 * (docs/design/overpaint-redesign.md). It replaces touch-ups (anchored to an arrangement of tiles
 * on screen, which drops out when a layer scrolls) and layer art (a picture replacing a layer):
 *
 *   group.overpaint = { world, bgmapBase, mapX, mapY, width, height, png, hideTiles }
 *
 * `mapX`/`mapY` are pixels of the layer's whole BG-map plane, the same for a plain layer (sampled
 * through the scroll mapping, src/layer-art.js) and a scaled one (through the VIP's affine
 * sampling, src/affine-world.js), so the picture scrolls, zooms and keeps stereo parallax with its
 * tiles and never depends on what is around them. It is drawn over the group's tiles at the
 * layer's depth; `hideTiles` (old layer art) skips the layer's tiles under a plain layer instead.
 *
 * Reading goes through `layerArtOf` (src/layer-art.js), which also reads an old `layerArt` as
 * overpaint with `hideTiles`. This module converts old pictures, crops and widens the stored
 * area, and draws overpaint on scaled layers.
 */
import { layerArtOf, layerGeometry, artPixelsFor } from './layer-art.js';
import { touchUpOf, touchUpPlacements, affineTouchUps } from './touch-up.js';
import { affineWorlds, sampleAffineWorld } from './affine-world.js';
import { getWindowsTableBytesFromState } from './vip-world-clip.js';
import { getTileBytes, hashTile } from './vip-state.js';
import { overpaintSwitchHashes, wholePoseHashes, wholePoseOn, dropCoveredPoses } from './overpaint-switch.js';
import { expandPoseOverpaints } from './pose-overpaint.js';

const FRAME_W = 384;
const WORLD_BYTES = 32;

/** @typedef {{ world: number, bgmapBase: number | null, mapX: number, mapY: number, width: number, height: number, png: string, hideTiles: boolean }} Overpaint */
/** @typedef {{ width: number, height: number, data: Uint8ClampedArray | Uint8Array }} Pixels */

/** The group's overpaint (or its old layer art, read as overpaint that hides the tiles), or null. */
export const overpaintOf = layerArtOf;

/**
 * The group with `op` as its overpaint, its old `layerArt` and `touchUp` gone (they are what
 * overpaint replaces); `op` null removes the picture altogether.
 * @param {any} group @param {(Omit<Overpaint, 'png'> & { png?: string }) | null} op
 */
export function withOverpaint(group, op) {
  const { layerArt: _a, touchUp: _t, overpaint: _o, ...rest } = group || {};
  if (!op) return rest;
  const { world, bgmapBase, mapX, mapY, width, height, hideTiles } = op;
  return { ...rest, overpaint: { world, bgmapBase: bgmapBase ?? null, mapX, mapY, width, height, png: op.png || '', hideTiles: hideTiles === true } };
}

/** The world-table header of a world (0 when missing). */
function headerOf(windows, world) {
  return windows && windows.length >= 1024 ? windows[world * WORLD_BYTES] | (windows[world * WORLD_BYTES + 1] << 8) : 0;
}

/**
 * Where a touch-up sits in its layer's map, from the first captured frame it is placed on: a
 * plain layer maps the box's screen corner through that frame's scroll; a scaled layer's touch-up
 * (painted on base tiles) is already laid out in map pixels around its anchor cell.
 * @param {{ group: any, frameCount: number, frameAt: (i: number) => any }} opts
 * @returns {(Omit<Overpaint, 'png'> & { skipX?: number, skipY?: number }) | null} null when no frame
 *   places it. `skipX`/`skipY`: columns/rows of the touch-up left of or above the map's origin, which
 *   can never be drawn and are left out.
 */
export function touchUpMapArea({ group, frameCount, frameAt }) {
  const tu = touchUpOf(group);
  if (!tu) return null;
  for (let i = 0; i < frameCount; i++) {
    const state = frameAt(i);
    if (!state) continue;
    const windows = getWindowsTableBytesFromState(state);
    for (const p of touchUpPlacements(state, group, 0)) {
      const g = layerGeometry(windows, p.world, 0);
      if (!g) continue;
      return {
        world: p.world,
        bgmapBase: g.bgmapBase,
        mapX: g.sx(p.x + tu.box.dx),
        mapY: g.sy(p.y + tu.box.dy),
        width: tu.box.width,
        height: tu.box.height,
        hideTiles: false,
      };
    }
    for (const e of affineTouchUps(state, [group], 0)) {
      const p = e.placements[0];
      if (!p) continue;
      const mapX = p.mx + tu.box.dx;
      const mapY = p.my + tu.box.dy;
      const skipX = Math.max(0, -mapX);
      const skipY = Math.max(0, -mapY);
      if (skipX >= tu.box.width || skipY >= tu.box.height) continue;
      return {
        world: e.world,
        bgmapBase: headerOf(windows, e.world) & 0xf,
        mapX: mapX + skipX,
        mapY: mapY + skipY,
        width: tu.box.width - skipX,
        height: tu.box.height - skipY,
        hideTiles: false,
        ...(skipX || skipY ? { skipX, skipY } : {}),
      };
    }
  }
  return null;
}

/**
 * Old pictures as overpaint, for a pack being opened. Layer art becomes overpaint that hides the
 * tiles (same picture, same place). A touch-up becomes overpaint at the place in its layer's map
 * where a captured frame shows it, with the same pixels. A touch-up no frame places stays as it
 * is (it still draws where its tiles line up) and is reported; one on a group that also has layer
 * art never drew, and goes.
 * @param {{ groups: any[], frameCount: number, frameAt: (i: number) => any,
 *   touchUpPixels: (group: any) => Pixels | null }} opts
 * @returns {{ groups: any[], pixels: Map<string, Pixels>, layerArt: string[], touchUps: string[], kept: string[] }}
 *   `pixels`: overpaint pixels by group id for converted touch-ups (layer art keeps its own)
 */
export function convertToOverpaint({ groups, frameCount, frameAt, touchUpPixels }) {
  const pixels = new Map();
  const layerArt = [];
  const touchUps = [];
  const kept = [];
  const next = (groups || []).map((g) => {
    if (g?.overpaint) return g;
    if (g?.layerArt) {
      const art = layerArtOf(g);
      if (!art) return g;
      layerArt.push(g.id);
      return withOverpaint(g, { ...art, hideTiles: true });
    }
    if (!touchUpOf(g)) return g;
    const px = touchUpPixels(g);
    const area = px ? touchUpMapArea({ group: g, frameCount, frameAt }) : null;
    if (!px || !area) {
      kept.push(g.id);
      return g;
    }
    pixels.set(g.id, { width: area.width, height: area.height, data: fitPixels(px, area.width, area.height, area.skipX, area.skipY) });
    touchUps.push(g.id);
    return withOverpaint(g, area);
  });
  return { groups: next, pixels, layerArt, touchUps, kept };
}

/** The part of `px` from (sx, sy) at exactly width × height (cropped, or padded with clear pixels). */
function fitPixels(px, width, height, sx = 0, sy = 0) {
  const out = new Uint8ClampedArray(width * height * 4);
  const w = Math.max(0, Math.min(width, px.width - sx));
  for (let y = 0; y < height && sy + y < px.height; y++) {
    const from = ((sy + y) * px.width + sx) * 4;
    out.set(px.data.subarray(from, from + w * 4), y * width * 4);
  }
  return out;
}

/** The box around a picture's painted (non-clear) pixels, x1/y1 exclusive; null when nothing is painted. */
export function paintedBounds(px) {
  let x0 = px.width;
  let y0 = px.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      if (!px.data[(y * px.width + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * The overpaint stored as small as it can be: cropped to what is painted (the editor works on a
 * picture covering the whole layer, mostly clear). A picture that hides the tiles is kept whole —
 * its clear pixels show what is behind the layer. Null when nothing is painted.
 * @param {Omit<Overpaint, 'png'>} op @param {Pixels} px
 * @param {{ wrapX?: number, wrapY?: number }} [wrap] the map's size where it wraps (0 = no wrap)
 * @returns {{ op: Omit<Overpaint, 'png'>, pixels: Pixels } | null}
 */
export function cropOverpaint(op, px, { wrapX = 0, wrapY = 0 } = {}) {
  if (op.hideTiles) return { op, pixels: px };
  const b = paintedBounds(px);
  if (!b) return null;
  const width = b.x1 - b.x0;
  const height = b.y1 - b.y0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((b.y0 + y) * px.width + b.x0) * 4;
    data.set(px.data.subarray(from, from + width * 4), y * width * 4);
  }
  const mapX = wrapX ? (op.mapX + b.x0) % wrapX : op.mapX + b.x0;
  const mapY = wrapY ? (op.mapY + b.y0) % wrapY : op.mapY + b.y0;
  return { op: { ...op, mapX, mapY, width, height }, pixels: { width, height, data } };
}

/**
 * The picture moved onto a new area of the map: every pixel keeps its place in the map (round the
 * map's wrap where it has one); pixels outside the new area are dropped, new area is clear.
 * @param {{ mapX: number, mapY: number }} op @param {Pixels} px
 * @param {{ mapX: number, mapY: number, width: number, height: number }} area
 * @param {{ wrapX?: number, wrapY?: number }} [wrap]
 * @returns {{ pixels: { width: number, height: number, data: Uint8ClampedArray }, dropped: number }}
 */
export function placeOverpaint(op, px, area, { wrapX = 0, wrapY = 0 } = {}) {
  const out = new Uint8ClampedArray(area.width * area.height * 4);
  const rel = (v, base, wrap) => (wrap ? (((v - base) % wrap) + wrap) % wrap : v - base);
  let dropped = 0;
  for (let y = 0; y < px.height; y++) {
    const ny = rel(op.mapY + y, area.mapY, wrapY);
    for (let x = 0; x < px.width; x++) {
      const si = (y * px.width + x) * 4;
      if (!px.data[si + 3]) continue;
      const nx = rel(op.mapX + x, area.mapX, wrapX);
      if (nx < 0 || ny < 0 || nx >= area.width || ny >= area.height) {
        dropped++;
        continue;
      }
      out.set(px.data.subarray(si, si + 4), (ny * area.width + nx) * 4);
    }
  }
  return { pixels: { width: area.width, height: area.height, data: out }, dropped };
}

/**
 * A backdrop picture widened over its map (Cover the whole map): each new 8 px map column starts as
 * a copy of a painted column that shows exactly the same tiles — a game's backdrop map often
 * repeats (Mario's Tennis's crowd hills) — so scrolling to a part no frame was painted on shows the
 * paint already made. Pixels already there are kept; columns with no twin stay clear to paint.
 * @param {Pixels} px the widened picture, x 0 = map column `mapX`
 * @param {number} mapX
 * @param {{ x0: number, x1: number }} painted the map columns the picture covered before (x1 exclusive)
 * @param {(cellX: number) => string | null} columnKey the tiles of 8 px map column `cellX`, top to bottom
 * @returns {{ pixels: Pixels, filled: number, unmatched: number }} a new picture; columns filled / left clear
 */
export function seedRepeatedColumns(px, mapX, painted, columnKey) {
  const out = { width: px.width, height: px.height, data: new Uint8ClampedArray(px.data) };
  const first = Math.ceil(mapX / 8);
  const last = Math.floor((mapX + px.width) / 8) - 1;
  /** @type {Map<string, number>} tiles → a painted cell column showing them */
  const sources = new Map();
  for (let cx = first; cx <= last; cx++) {
    if (cx * 8 < painted.x0 || cx * 8 + 8 > painted.x1) continue;
    const key = columnKey(cx);
    if (key && !sources.has(key)) sources.set(key, cx);
  }
  let filled = 0;
  let unmatched = 0;
  for (let cx = first; cx <= last; cx++) {
    // A column painted all through is done; one painted partly (the old picture's edge) gets its
    // clear pixels from a twin, so no seam is left where the old picture stopped.
    if (cx * 8 >= painted.x0 && cx * 8 + 8 <= painted.x1) continue;
    const key = columnKey(cx);
    const src = key ? sources.get(key) : undefined;
    if (src === undefined) {
      unmatched++;
      continue;
    }
    for (let y = 0; y < out.height; y++) {
      for (let i = 0; i < 8; i++) {
        const t = (y * out.width + cx * 8 + i - mapX) * 4;
        if (out.data[t + 3]) continue;
        const s = (y * out.width + src * 8 + i - mapX) * 4;
        out.data.set(px.data.subarray(s, s + 4), t);
      }
    }
    filled++;
  }
  return { pixels: out, filled, unmatched };
}

/**
 * How a world's map wraps, for the two functions above: a plain layer wraps at its map's size
 * (no wrap past an overplane map's edge); a scaled layer's plane does not wrap here.
 * @param {Uint8Array} windows @param {number} world
 */
export function mapWrap(windows, world) {
  const g = layerGeometry(windows, world, 0);
  if (!g) return { wrapX: 0, wrapY: 0 };
  return { wrapX: g.over ? 0 : g.maskX + 1, wrapY: g.over ? 0 : g.maskY + 1 };
}

/* ------------------------------------------------------- scaled layers */

/**
 * Overpaints to draw on this frame's scaled (affine) worlds: a group's picture applies to each
 * scaled world it is on (by its worlds, and its tiles being read there), when the world draws from
 * the picture's BG map. Only the group's own patterns switch it on, judged against `allGroups`
 * (src/overpaint-switch.js).
 * @returns {Array<{ world: number, group: any, op: Overpaint, pixels: Pixels }>}
 */
export function affineOverpaints(state, groups, eye, allGroups = groups) {
  if (!Array.isArray(groups) || !state?.patternTable) return [];
  // Pose pictures kept inside a character's group draw as whole-pose groups (src/pose-overpaint.js).
  groups = expandPoseOverpaints(groups);
  const withOp = groups.filter((g) => layerArtOf(g));
  if (!withOp.length) return [];
  const shown = affineWorlds(state, eye);
  if (!shown.length) return [];
  const windows = getWindowsTableBytesFromState(state);
  /** @type {Map<number, Set<number>>} world → patterns it reads this frame */
  const patternsOf = new Map();
  const hashOfChar = new Map();
  const readIn = (world) => {
    let set = patternsOf.get(world);
    if (set) return set;
    set = new Set();
    const seen = new Set();
    sampleAffineWorld(state, world, eye, (_x, _y, ch) => {
      if (seen.has(ch)) return;
      seen.add(ch);
      let h = hashOfChar.get(ch);
      if (h === undefined) hashOfChar.set(ch, (h = hashTile(getTileBytes(state.patternTable, ch)) >>> 0));
      set.add(h);
    });
    patternsOf.set(world, set);
    return set;
  };
  const out = [];
  for (const [order, group] of withOp.entries()) {
    const op = /** @type {Overpaint} */ (layerArtOf(group));
    const ids = group?.criteria?.windowIds;
    const mine = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
    // A whole-pose group needs all of its pose read there; any other, one of its own patterns.
    const pose = wholePoseHashes(group);
    const switches = pose ? null : overpaintSwitchHashes(group, allGroups);
    const hashes = switches ? [...switches] : (group?.criteria?.hashes || []).map((h) => Number(h) >>> 0);
    for (const world of shown) {
      if (mine && !mine.has(world)) continue;
      if (op.bgmapBase != null && (headerOf(windows, world) & 0xf) !== op.bgmapBase) continue;
      const read = readIn(world);
      if (pose ? !wholePoseOn(group, read) : hashes.length && !hashes.some((h) => read.has(h))) continue;
      const pixels = artPixelsFor(group.id, op.png);
      if (!pixels) continue;
      out.push({ world, group, op, pixels, order });
    }
  }
  // Every group's picture on a world is drawn; the group higher in the list goes on top.
  return dropCoveredPoses(out).sort((a, b) => b.world - a.world || b.order - a.order).map(({ order: _o, ...e }) => e);
}

/**
 * Draw one scaled-world overpaint (a compositor pass): every screen pixel the world samples is
 * traced back to its map pixel, and the picture's pixel there goes on, scaled with the tiles.
 * @param {Uint8ClampedArray} data @param {Int32Array | null} drawOwner @param {any} state
 * @param {number} eye @param {{ world: number, op: Overpaint, pixels: Pixels }} entry
 * @param {number} brightness @param {Uint8Array | null} [painted] set to 1 where it drew
 * @returns {number} pixels drawn
 */
export function paintAffineOverpaint(data, drawOwner, state, eye, entry, brightness, painted = null) {
  const { op, pixels, world } = entry;
  const k = Math.max(0, Math.min(1, brightness));
  const owner = (state.drawList || []).findIndex((d) => d.layer === 1 && d.world === world && (d.eye ?? 0) === eye);
  let n = 0;
  sampleAffineWorld(state, world, eye, (x, y, _ch, tx, ty, _px, _pal, hflip, vflip, _rot, cell) => {
    if (cell < 0) return;
    const i = (cell % 1024) * 8 + (hflip ? 7 - tx : tx) - op.mapX;
    const j = Math.floor(cell / 1024) * 8 + (vflip ? 7 - ty : ty) - op.mapY;
    if (i < 0 || j < 0 || i >= pixels.width || j >= pixels.height) return;
    const si = (j * pixels.width + i) * 4;
    const a = pixels.data[si + 3];
    if (!a) return;
    const p = y * FRAME_W + x;
    const di = p * 4;
    const r = (pixels.data[si] * k) | 0;
    const g = (pixels.data[si + 1] * k) | 0;
    const b = (pixels.data[si + 2] * k) | 0;
    if (a === 255) {
      data[di] = r;
      data[di + 1] = g;
      data[di + 2] = b;
      data[di + 3] = 255;
    } else {
      const t = a / 255;
      data[di] = (r * t + data[di] * (1 - t)) | 0;
      data[di + 1] = (g * t + data[di + 1] * (1 - t)) | 0;
      data[di + 2] = (b * t + data[di + 2] * (1 - t)) | 0;
      data[di + 3] = Math.max(a, data[di + 3]);
    }
    if (drawOwner && owner >= 0) drawOwner[p] = owner;
    if (painted) painted[p] = 1;
    n++;
  });
  return n;
}

/* ------------------------------------------------------- base tiles */

/**
 * Lay a scaled layer's overpaint on its base tiles (src/affine-base.js): each base tile is one map
 * cell drawn unscaled, so its 8×8 pixels are map pixels cellX·8 + x, cellY·8 + y.
 * @param {Uint8ClampedArray} data 384×224 RGBA @param {any[]} draws base-tile draws (with cellX/cellY)
 * @param {{ mapX: number, mapY: number }} op @param {Pixels} pixels @param {number} [eye]
 * @param {Uint8Array | null} [painted] set to 1 where it drew (the compositor's record of pictures)
 * @returns {number} pixels drawn
 */
export function paintOverpaintOnCells(data, draws, op, pixels, eye = 0, painted = null) {
  let n = 0;
  for (const d of draws) {
    if (!Number.isInteger(d.cellX) || (d.eye ? 1 : 0) !== (eye ? 1 : 0)) continue;
    for (let ly = 0; ly < 8; ly++) {
      const y = d.y + ly;
      const j = d.cellY * 8 + ly - op.mapY;
      if (y < 0 || y >= 224 || j < 0 || j >= pixels.height) continue;
      for (let lx = 0; lx < 8; lx++) {
        const x = d.x + lx;
        const i = d.cellX * 8 + lx - op.mapX;
        if (x < 0 || x >= FRAME_W || i < 0 || i >= pixels.width) continue;
        const si = (j * pixels.width + i) * 4;
        const a = pixels.data[si + 3];
        if (!a) continue;
        const di = (y * FRAME_W + x) * 4;
        const t = a / 255;
        data[di] = (pixels.data[si] * t + data[di] * (1 - t)) | 0;
        data[di + 1] = (pixels.data[si + 1] * t + data[di + 1] * (1 - t)) | 0;
        data[di + 2] = (pixels.data[si + 2] * t + data[di + 2] * (1 - t)) | 0;
        data[di + 3] = Math.max(a, data[di + 3]);
        if (painted) painted[y * FRAME_W + x] = 1;
        n++;
      }
    }
  }
  return n;
}

/**
 * The map pixel under a screen pixel of a base-tiles view, or null off its tiles.
 * @param {any[]} draws base-tile draws (with cellX/cellY) @param {number} x @param {number} y @param {number} [eye]
 * @returns {{ mx: number, my: number } | null}
 */
export function cellMapPixelAt(draws, x, y, eye = 0) {
  for (const d of draws) {
    if (!Number.isInteger(d.cellX) || (d.eye ? 1 : 0) !== (eye ? 1 : 0)) continue;
    if (x < d.x || y < d.y || x >= d.x + 8 || y >= d.y + 8) continue;
    return { mx: d.cellX * 8 + (x - d.x), my: d.cellY * 8 + (y - d.y) };
  }
  return null;
}
