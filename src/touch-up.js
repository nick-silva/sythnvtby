/**
 * Touch-ups: a group's "this spot only" paint, anchored to its tiles instead of the screen.
 *
 * A BG group's colours normally live on its tile patterns and are reused wherever those
 * patterns appear. A touch-up is a picture laid over that, for what tile paint cannot do —
 * transparent and blank pixels, one-off detail — stored as
 *   group.touchUp = { anchorHash, box: { dx, dy, width, height }, layout: [{ dx, dy, hash }], png }
 * with `box` and `layout` relative to the anchor tile's top-left. It is drawn wherever the
 * group's arrangement is on screen: an anchor tile whose neighbours sit where the layout says
 * (at least TOUCH_UP_MIN_MATCH of them), so the same corner piece in a different pipe
 * configuration keeps its tile colours and gets no misplaced touch-up. It moves with the
 * anchor, is placed per eye from the anchor's own draw (so parallax is right), and is drawn at
 * the layer's depth over its tiles. Its box is its only limit — it may reach past the layer's
 * window, up to the whole screen (a full-screen background painted over a layer that only
 * draws part of it); layers in front still cover it. Where the arrangement
 * is not found nothing is lost: the tile paint still shows.
 *
 * Pixels share the layer-art store (src/layer-art.js) under `touchUpKey(groupId)`.
 * `overlayToTouchUp` converts an old screen-pinned overlay (painter-v2-vip-overlays.json).
 */

import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { artPixelsFor } from './layer-art.js';
import { clusterTilePositions } from './tile-clusters.js';
import { affineWorlds, sampleAffineWorld } from './affine-world.js';
import { stereoTwins } from './stereo-twin.js';
import { getWindowsTableBytesFromState } from './vip-world-clip.js';

/** Share of the recorded arrangement that must be on screen around an anchor tile. */
export const TOUCH_UP_MIN_MATCH = 0.6;
const FRAME_W = 384;
const FRAME_H = 224;
const MAX_SIDE = 1024;
const MAX_LAYOUT = 256;

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** @typedef {{ dx: number, dy: number, width: number, height: number }} Box */
/** @typedef {{ anchorHash: number, box: Box, layout: Array<{ dx: number, dy: number, hash: number }>, png: string }} TouchUp */

/** @param {string} groupId key of a touch-up's pixels in the shared picture store */
export function touchUpKey(groupId) {
  return `touchup:${groupId}`;
}

/**
 * @param {any} group
 * @returns {TouchUp | null}
 */
export function touchUpOf(group) {
  const t = group?.touchUp;
  if (!t || typeof t !== 'object' || !Number.isFinite(t.anchorHash)) return null;
  const b = t.box;
  if (!b || !isInt(b.dx, -MAX_SIDE, MAX_SIDE) || !isInt(b.dy, -MAX_SIDE, MAX_SIDE)) return null;
  if (!isInt(b.width, 1, MAX_SIDE) || !isInt(b.height, 1, MAX_SIDE)) return null;
  const layout = Array.isArray(t.layout)
    ? t.layout.filter((l) => l && Number.isInteger(l.dx) && Number.isInteger(l.dy) && Number.isFinite(l.hash))
    : [];
  if (!layout.length) return null;
  return {
    anchorHash: t.anchorHash >>> 0,
    box: { dx: b.dx, dy: b.dy, width: b.width, height: b.height },
    layout: layout.map((l) => ({ dx: l.dx, dy: l.dy, hash: l.hash >>> 0 })),
    png: typeof t.png === 'string' ? t.png : '',
  };
}

/** The group's own non-blank BG draws on one eye, with their hashes. */
function scopedDraws(state, group, eye) {
  const pt = state?.patternTable;
  const list = state?.drawList;
  if (!pt || !Array.isArray(list)) return [];
  const c = group?.criteria || {};
  const worlds = Array.isArray(c.windowIds) && c.windowIds.length ? new Set(c.windowIds.map(Number)) : null;
  const hashes = new Set((Array.isArray(c.hashes) ? c.hashes : []).map((h) => Number(h) >>> 0));
  const slots = new Set((Array.isArray(c.tileSlots) ? c.tileSlots : []).map(Number));
  /** @type {Map<number, number | null>} */
  const bySlot = new Map();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if ((Number(d.eye) === 1 ? 1 : 0) !== eye || (d.layer ?? 0) !== 0 || d.world == null) continue;
    if (worlds && !worlds.has(Number(d.world))) continue;
    let h = bySlot.get(d.tileIndex);
    if (h === undefined) {
      const bytes = getTileBytes(pt, d.tileIndex);
      h = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
      bySlot.set(d.tileIndex, h);
    }
    if (h === null) continue;
    if ((hashes.size || slots.size) && !hashes.has(h) && !slots.has(d.tileIndex)) continue;
    out.push({ d, h, index: i });
  }
  return out;
}

/**
 * A box around the anchor's cluster of the group's tiles, plus `margin`, relative to the anchor.
 * @returns {Box}
 */
export function defaultTouchUpBox(state, group, eye, anchorDraw, margin = 8) {
  const mine = scopedDraws(state, group, eye).filter((s) => s.d.world === anchorDraw.world);
  const at = mine.findIndex((s) => s.d === anchorDraw);
  const clusters = clusterTilePositions(mine.map((s) => s.d));
  const cluster = clusters.find((c) => c.indices.includes(at)) || { indices: [at] };
  const tiles = cluster.indices.map((i) => mine[i]?.d).filter(Boolean);
  if (!tiles.length) tiles.push(anchorDraw);
  const x0 = Math.min(...tiles.map((d) => d.x)) - margin;
  const y0 = Math.min(...tiles.map((d) => d.y)) - margin;
  const x1 = Math.max(...tiles.map((d) => d.x)) + 8 + margin;
  const y1 = Math.max(...tiles.map((d) => d.y)) + 8 + margin;
  return { dx: x0 - anchorDraw.x, dy: y0 - anchorDraw.y, width: x1 - x0, height: y1 - y0 };
}

/**
 * A new touch-up for `box` around `anchorDraw`: the arrangement is the group's tiles in the
 * anchor's world that touch the box, relative to the anchor.
 * @returns {Omit<TouchUp, 'png'>}
 */
export function buildTouchUp(state, group, eye, anchorDraw, box) {
  const ax = anchorDraw.x;
  const ay = anchorDraw.y;
  const bx0 = ax + box.dx;
  const by0 = ay + box.dy;
  const seen = new Set();
  const layout = [];
  for (const { d, h } of scopedDraws(state, group, eye)) {
    if (d.world !== anchorDraw.world) continue;
    if (d.x + 8 <= bx0 || d.x >= bx0 + box.width || d.y + 8 <= by0 || d.y >= by0 + box.height) continue;
    const key = `${d.x - ax},${d.y - ay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    layout.push({ dx: d.x - ax, dy: d.y - ay, hash: h });
    if (layout.length >= MAX_LAYOUT) break;
  }
  const anchorHash = hashTile(getTileBytes(state.patternTable, anchorDraw.tileIndex)) >>> 0;
  return { anchorHash, box: { ...box }, layout };
}

/**
 * The group's anchor tiles on this frame and eye (every group tile when it has no anchor):
 * where a new touch-up can be made.
 * @returns {any[]} draws
 */
export function anchorDrawsFor(state, group, eye) {
  const mine = scopedDraws(state, group, eye);
  if (!Number.isFinite(group?.anchorHash)) return mine.map((s) => s.d);
  const want = group.anchorHash >>> 0;
  return mine.filter((s) => s.h === want).map((s) => s.d);
}

/**
 * The same picture laid out for a new box around the same anchor: what stays inside is kept,
 * new area is empty.
 * @param {{ width: number, height: number, data: Uint8ClampedArray | Uint8Array }} pixels
 * @param {Box} oldBox @param {Box} newBox
 */
export function reboxPixels(pixels, oldBox, newBox) {
  const out = { width: newBox.width, height: newBox.height, data: new Uint8ClampedArray(newBox.width * newBox.height * 4) };
  const ox = oldBox.dx - newBox.dx;
  const oy = oldBox.dy - newBox.dy;
  for (let y = 0; y < pixels.height; y++) {
    const ny = y + oy;
    if (ny < 0 || ny >= newBox.height) continue;
    for (let x = 0; x < pixels.width; x++) {
      const nx = x + ox;
      if (nx < 0 || nx >= newBox.width) continue;
      const si = (y * pixels.width + x) * 4;
      out.data.set(pixels.data.subarray(si, si + 4), (ny * newBox.width + nx) * 4);
    }
  }
  return out;
}

/**
 * Where the group's touch-up goes on this frame: each anchor tile whose arrangement matches.
 * @returns {Array<{ x: number, y: number, world: number, ownerIndex: number, matched: number, total: number }>}
 */
export function touchUpPlacements(state, group, eye) {
  const tu = touchUpOf(group);
  if (!tu) return [];
  const mine = scopedDraws(state, group, eye);
  /** @type {Map<string, number>} */
  const at = new Map();
  for (const { d, h } of mine) at.set(`${d.world}|${d.x}|${d.y}`, h);
  const out = [];
  for (const { d, h, index } of mine) {
    if (h !== tu.anchorHash) continue;
    let matched = 0;
    for (const l of tu.layout) if (at.get(`${d.world}|${d.x + l.dx}|${d.y + l.dy}`) === l.hash) matched++;
    if (matched / tu.layout.length < TOUCH_UP_MIN_MATCH) continue;
    out.push({ x: d.x, y: d.y, world: d.world, ownerIndex: index, matched, total: tu.layout.length });
  }
  return out;
}

/**
 * Touch-ups to draw on this frame and eye, one entry per group and world.
 * @returns {Array<{ world: number, group: any, tu: TouchUp, pixels: { width: number, height: number, data: Uint8ClampedArray | Uint8Array }, placements: ReturnType<typeof touchUpPlacements> }>}
 */
export function activeTouchUps(state, groups, eye) {
  if (!Array.isArray(groups)) return [];
  const out = [];
  for (const group of groups) {
    const tu = touchUpOf(group);
    if (!tu || group.layerArt || group.overpaint) continue;
    const pixels = artPixelsFor(touchUpKey(group.id), tu.png);
    if (!pixels) continue;
    /** @type {Map<number, ReturnType<typeof touchUpPlacements>>} */
    const byWorld = new Map();
    for (const p of touchUpPlacements(state, group, eye)) {
      if (!byWorld.has(p.world)) byWorld.set(p.world, []);
      byWorld.get(p.world).push(p);
    }
    if (eye === 1) for (const [world, placements] of twinPlacements(state, group, byWorld)) byWorld.set(world, placements);
    for (const [world, placements] of byWorld) out.push({ world, group, tu, pixels, placements });
  }
  return out;
}

/**
 * Right-eye placements on the right-only twin of a left-only world the touch-up is placed on
 * (src/stereo-twin.js): the game draws that layer's right eye from another copy of its tiles,
 * which the arrangement does not match, so the left placements are moved across by the twins'
 * shift instead. Twins already placed directly on the right eye are left as they are.
 * @param {Map<number, ReturnType<typeof touchUpPlacements>>} placedRight
 * @returns {Array<[number, ReturnType<typeof touchUpPlacements>]>}
 */
function twinPlacements(state, group, placedRight) {
  const twins = stereoTwins(getWindowsTableBytesFromState(state));
  if (!twins.size) return [];
  const list = Array.isArray(state?.drawList) ? state.drawList : [];
  const left = touchUpPlacements(state, group, 0);
  const out = [];
  for (const [right, twin] of twins) {
    if (placedRight.has(right)) continue;
    const mine = left.filter((p) => p.world === twin.left);
    if (!mine.length) continue;
    const ownerIndex = list.findIndex((d) => d.world === right && Number(d.eye) === 1);
    if (ownerIndex < 0) continue;
    out.push([right, mine.map((p) => ({ ...p, x: p.x + twin.shift, world: right, ownerIndex }))]);
  }
  return out;
}

/**
 * Draw one group's touch-up at its placements (a compositor pass), within its box and the screen.
 * Not clipped to the world's window: the box is the author's choice of extent.
 * @param {Uint8Array | null} [painted] set to 1 where the touch-up drew (the compositor's record)
 * @returns {number} pixels drawn
 */
export function paintTouchUp(data, drawOwner, _windows, _eye, entry, brightness, painted = null) {
  const { tu, pixels, placements } = entry;
  const cx0 = 0;
  const cx1 = FRAME_W - 1;
  const cy0 = 0;
  const cy1 = FRAME_H - 1;
  const k = Math.max(0, Math.min(1, brightness));
  const pw = Math.min(pixels.width, tu.box.width);
  const ph = Math.min(pixels.height, tu.box.height);
  let n = 0;
  for (const p of placements) {
    const ox = p.x + tu.box.dx;
    const oy = p.y + tu.box.dy;
    for (let j = 0; j < ph; j++) {
      const y = oy + j;
      if (y < cy0 || y > cy1 || y < 0 || y >= FRAME_H) continue;
      for (let i = 0; i < pw; i++) {
        const x = ox + i;
        if (x < cx0 || x > cx1 || x < 0 || x >= FRAME_W) continue;
        const si = (j * pixels.width + i) * 4;
        const a = pixels.data[si + 3];
        if (!a) continue;
        const pidx = y * FRAME_W + x;
        const di = pidx * 4;
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
        if (drawOwner) drawOwner[pidx] = p.ownerIndex;
        if (painted) painted[pidx] = 1;
        n++;
      }
    }
  }
  return n;
}

/**
 * The touch-up pixel at a screen pixel (for painting), from the first placement containing it.
 * @returns {{ tx: number, ty: number, placement: ReturnType<typeof touchUpPlacements>[number] } | null}
 */
export function screenToTouchUp(state, group, eye, x, y) {
  const tu = touchUpOf(group);
  if (!tu) return null;
  for (const placement of touchUpPlacements(state, group, eye)) {
    const tx = x - (placement.x + tu.box.dx);
    const ty = y - (placement.y + tu.box.dy);
    if (tx >= 0 && ty >= 0 && tx < tu.box.width && ty < tu.box.height) return { tx, ty, placement };
  }
  return null;
}

/**
 * Convert a screen-pinned overlay (384×224 RGBA) into a touch-up anchored where it was painted:
 * on a frame showing the group's anchor, the painted area becomes the box around that anchor.
 * @returns {{ touchUp: Omit<TouchUp, 'png'>, pixels: { width: number, height: number, data: Uint8ClampedArray } } | null}
 *   null when the anchor is not on this frame or nothing is painted
 */
export function overlayToTouchUp(state, group, overlay, eye = 0) {
  if (!Number.isFinite(group?.anchorHash)) return null;
  const ah = group.anchorHash >>> 0;
  const anchor = scopedDraws(state, group, eye).find((s) => s.h === ah);
  if (!anchor) return null;
  let x0 = FRAME_W;
  let y0 = FRAME_H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (!overlay[(y * FRAME_W + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * FRAME_W + x0) * 4;
    data.set(overlay.subarray(from, from + width * 4), y * width * 4);
  }
  const box = { dx: x0 - anchor.d.x, dy: y0 - anchor.d.y, width, height };
  return { touchUp: buildTouchUp(state, group, eye, anchor.d, box), pixels: { width, height, data } };
}

/**
 * Convert every group's old overlay into a touch-up, using the first captured frame that shows
 * the group's anchor. Groups whose anchor no frame shows keep their overlay.
 * @param {{ groups: any[], overlays: Map<string, Map<number, Uint8Array>>, frameCount: number, frameAt: (i: number) => any }} opts
 * @returns {{ groups: any[], pixels: Map<string, { width: number, height: number, data: Uint8ClampedArray }>, converted: string[], kept: string[] }}
 */
export function convertOverlaysToTouchUps({ groups, overlays, frameCount, frameAt }) {
  const pixels = new Map();
  const converted = [];
  const kept = [];
  const next = groups.map((g) => {
    const byEye = overlays.get(g.id);
    const eye = byEye?.get(0) ? 0 : 1;
    const overlay = byEye?.get(eye);
    if (!overlay || touchUpOf(g) || g.layerArt || g.overpaint) return g;
    for (let i = 0; i < frameCount; i++) {
      const state = frameAt(i);
      if (!state) continue;
      const made = overlayToTouchUp(state, g, overlay, eye);
      if (!made) continue;
      pixels.set(g.id, made.pixels);
      converted.push(g.id);
      return { ...g, touchUp: { ...made.touchUp, png: '' } };
    }
    kept.push(g.id);
    return g;
  });
  return { groups: next, pixels, converted, kept };
}

/**
 * Touch-ups on scaled (affine) worlds. A touch-up painted on a scaled group's base tiles
 * (src/affine-base.js) is laid out in the world's map: its anchor and arrangement are map cells,
 * 8 px apart. On screen the world is zoomed, so there are no plain tiles to anchor to; instead the
 * anchor is found among the map cells the VIP reads this frame, and the picture is drawn through
 * the same sampling as the tiles — scaled with them, at the world's depth.
 * @returns {Array<{ world: number, group: any, tu: TouchUp, pixels: { width: number, height: number, data: Uint8ClampedArray | Uint8Array }, placements: Array<{ mx: number, my: number }> }>}
 */
export function affineTouchUps(state, groups, eye) {
  if (!Array.isArray(groups) || !state?.patternTable) return [];
  const shown = affineWorlds(state, eye);
  if (!shown.length) return [];
  const twins = eye === 1 ? stereoTwins(getWindowsTableBytesFromState(state)) : null;
  const out = [];
  /** @type {Map<string, Map<number, number>>} "world|eye" → map cell → pattern hash, sampled once */
  const cellsByWorld = new Map();
  const hashOfChar = new Map();
  const cellsOf = (world, e = eye) => {
    let cells = cellsByWorld.get(`${world}|${e}`);
    if (cells) return cells;
    cells = new Map();
    sampleAffineWorld(state, world, e, (_x, _y, ch, _tx, _ty, _px, _pal, _hf, _vf, _rot, cell) => {
      if (cell < 0 || cells.has(cell)) return;
      let h = hashOfChar.get(ch);
      if (h === undefined) hashOfChar.set(ch, (h = hashTile(getTileBytes(state.patternTable, ch)) >>> 0));
      cells.set(cell, h);
    });
    cellsByWorld.set(`${world}|${e}`, cells);
    return cells;
  };
  /** @type {Map<number, { dx: number, dy: number } | null>} right twin → where its copy sits from the left's */
  const copyOffsets = new Map();
  const copyOffsetOf = (right, left) => {
    if (!copyOffsets.has(right)) copyOffsets.set(right, twinCopyOffset(state, left, right));
    return copyOffsets.get(right);
  };
  for (const group of groups) {
    const tu = touchUpOf(group);
    if (!tu || group.layerArt || group.overpaint) continue;
    // Map cells are 8 px apart: an arrangement off that grid was not made on base tiles.
    if (!tu.layout.every((l) => l.dx % 8 === 0 && l.dy % 8 === 0)) continue;
    const ids = group?.criteria?.windowIds;
    // On the right eye, a right-only twin of one of the group's left-only worlds counts as that
    // world (src/stereo-twin.js).
    const mine = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
    const worlds = mine ? shown.filter((w) => mine.has(w) || (twins && mine.has(twins.get(w)?.left))) : shown;
    for (const world of worlds) {
      let placements = affinePlacements(cellsOf(world), tu);
      const twin = twins?.get(world);
      if (!placements.length && twin) {
        // The right eye's copy of the art often uses other tiles (drawn shifted for depth), so the
        // arrangement is not found there: place it where the left eye's is, in the copy.
        const off = copyOffsetOf(world, twin.left);
        if (off) placements = affinePlacements(cellsOf(twin.left, 0), tu).map((p) => ({ mx: p.mx + off.dx, my: p.my + off.dy }));
      }
      if (!placements.length) continue;
      const pixels = artPixelsFor(touchUpKey(group.id), tu.png);
      if (pixels) out.push({ world, group, tu, pixels, placements });
    }
  }
  return out;
}

/** Where a touch-up's arrangement is among a scaled world's map cells: map pixels of each anchor. */
function affinePlacements(cells, tu) {
  const placements = [];
  for (const [cell, h] of cells) {
    if (h !== tu.anchorHash) continue;
    const cx = cell % 1024;
    const cy = Math.floor(cell / 1024);
    let matched = 0;
    for (const l of tu.layout) if (cells.get((cy + l.dy / 8) * 1024 + cx + l.dx / 8) === l.hash) matched++;
    if (matched / tu.layout.length < TOUCH_UP_MIN_MATCH) continue;
    placements.push({ mx: cx * 8, my: cy * 8 });
  }
  return placements;
}

/**
 * How far, in map pixels, a scaled right-eye twin's copy of the art sits from the left's: the
 * commonest difference between the map cells the two read at the same screen pixel (Mario's
 * Tennis's title: 16 cells down). Null when the two share too few pixels to tell.
 */
function twinCopyOffset(state, left, right) {
  /** @type {Map<number, number>} screen pixel → map cell, left eye */
  const at = new Map();
  sampleAffineWorld(state, left, 0, (x, y, _ch, _tx, _ty, _px, _pal, _hf, _vf, _rot, cell) => {
    if (cell >= 0 && (x & 3) === 0 && (y & 3) === 0) at.set(y * FRAME_W + x, cell);
  });
  /** @type {Map<string, number>} */
  const votes = new Map();
  let total = 0;
  sampleAffineWorld(state, right, 1, (x, y, _ch, _tx, _ty, _px, _pal, _hf, _vf, _rot, cell) => {
    if (cell < 0 || (x & 3) || (y & 3)) return;
    const l = at.get(y * FRAME_W + x);
    if (l === undefined) return;
    const key = `${(cell % 1024) - (l % 1024)},${Math.floor(cell / 1024) - Math.floor(l / 1024)}`;
    votes.set(key, (votes.get(key) || 0) + 1);
    total++;
  });
  let best = null;
  let bestN = 0;
  for (const [k, n] of votes) if (n > bestN) [best, bestN] = [k, n];
  if (!best || bestN < Math.max(8, total / 2)) return null;
  const [cx, cy] = best.split(',').map(Number);
  return { dx: cx * 8, dy: cy * 8 };
}

/**
 * Draw one scaled-world touch-up (a compositor pass): every screen pixel the world samples is
 * traced back to its map pixel, and where that falls inside the touch-up's box its colour goes on.
 * @param {Uint8Array | null} [painted] set to 1 where the touch-up drew (the compositor's record)
 * @returns {number} pixels drawn
 */
export function paintAffineTouchUp(data, drawOwner, state, eye, entry, brightness, painted = null) {
  const { tu, pixels, placements, world } = entry;
  const k = Math.max(0, Math.min(1, brightness));
  const pw = Math.min(pixels.width, tu.box.width);
  const ph = Math.min(pixels.height, tu.box.height);
  const owner = (state.drawList || []).findIndex((d) => d.layer === 1 && d.world === world && (d.eye ?? 0) === eye);
  let n = 0;
  sampleAffineWorld(state, world, eye, (x, y, _ch, tx, ty, _px, _pal, hflip, vflip, _rot, cell) => {
    if (cell < 0) return;
    // The map pixel, before the tile's flips: how the base tiles lay it out.
    const mx = (cell % 1024) * 8 + (hflip ? 7 - tx : tx);
    const my = Math.floor(cell / 1024) * 8 + (vflip ? 7 - ty : ty);
    for (const p of placements) {
      const i = mx - (p.mx + tu.box.dx);
      const j = my - (p.my + tu.box.dy);
      if (i < 0 || j < 0 || i >= pw || j >= ph) continue;
      const si = (j * pixels.width + i) * 4;
      const a = pixels.data[si + 3];
      if (!a) return;
      const di = (y * FRAME_W + x) * 4;
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
      if (drawOwner && owner >= 0) drawOwner[y * FRAME_W + x] = owner;
      if (painted) painted[y * FRAME_W + x] = 1;
      n++;
      return;
    }
  });
  return n;
}
