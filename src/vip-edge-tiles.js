/**
 * BG tiles the core's draw list leaves out at the edges of a world's window.
 *
 * The patched core records one draw per BG tile, on the scanline where the tile's source row 0
 * is drawn and at the column where its source column 0 is drawn
 * (`char_sub_y == 0 && (SourceX & 7) == 0` in `DrawBG`, see
 * `patches/beetle-vb-vip-draw-list-export.patch`). A tile cut by the top of its window (or the
 * screen) never has that scanline drawn, and one cut by the left edge never has that column
 * drawn, so neither is recorded — yet the core still paints its visible pixels into the mono
 * frame. The color layer then drops those tiles a whole tile early: a layer scrolling up past
 * the top of the screen loses its top row of colour while the red picture still shows it.
 * (A vertically flipped tile is recorded on its *bottom* row instead, so for those the loss is
 * at the bottom edge.)
 *
 * Every frame carries what is needed to put them back: the world table (`windows`) and all of
 * display RAM (`segments`, 16 × 8 KiB — BG maps included). This module re-derives, for each
 * normal-mode BG world, exactly the tile cells the core painted but did not record, using the
 * same source-coordinate and BG-map arithmetic as Beetle's `VIP_DrawBlock` / `DrawBG`
 * (mednafen/vb/vip_draw.inc). `src/vip-edge-tiles.test.js` checks it against a line-for-line
 * port of that loop.
 *
 * Not handled: HBias worlds (per-scanline horizontal offsets — no captured game uses them yet),
 * affine worlds, sprites.
 */

import { getWindowsTableBytesFromState } from './vip-world-clip.js';

const FRAME_W = 384;
const FRAME_H = 224;
/** Core patch level from which the draw list already includes cut tiles. */
const CORE_RECORDS_EDGE_TILES = 3;
const WORLD_BYTES = 32;
const SEGMENT_HALFWORDS = 0x1000;

const BGM_NORMAL = 0;
const HDR_LON = 0x8000;
const HDR_RON = 0x4000;
const HDR_OVER = 0x80;
const HDR_END = 0x40;

const BGSC_CHAR = 0x7ff;
const BGSC_VFLIP = 0x1000;
const BGSC_HFLIP = 0x2000;

/** @param {number} v @param {number} bits */
function signExtend(v, bits) {
  const m = v & ((1 << bits) - 1);
  return m >= 1 << (bits - 1) ? m - (1 << bits) : m;
}

/** Recovered draws per state object and eye; a frame is composited several times per eye. */
/** @type {WeakMap<object, Array<import('./vip-state.js').DrawCall[] | undefined>>} */
const cache = new WeakMap();

/**
 * @param {import('./vip-state.js').VIPState} state
 * @param {number} eye 0 left, 1 right
 * @returns {Array<import('./vip-state.js').DrawCall & { recovered: true }>} tile draws the
 *   core painted but left out of `state.drawList`, in the draw list's own shape (top-left
 *   screen position, flips, world, palette). Empty when the frame lacks a world table or DRAM.
 */
export function recoverClippedBgDraws(state, eye) {
  if (!state || typeof state !== 'object') return [];
  const e = eye ? 1 : 0;
  let perEye = cache.get(state);
  if (perEye?.[e]) return perEye[e];
  const out = computeRecovered(state, e);
  if (!perEye) {
    perEye = [];
    cache.set(state, perEye);
  }
  perEye[e] = out;
  return out;
}

/** @param {import('./vip-state.js').VIPState} state @param {number} eye */
function computeRecovered(state, eye) {
  // Patch level 3 records cut tiles itself (patches/beetle-vb-vip-draw-list-edge-tiles.patch);
  // only frames from older cores — including every capture made with one — need rebuilding.
  if ((state.corePatchLevel ?? 0) >= CORE_RECORDS_EDGE_TILES) return [];
  const windows = getWindowsTableBytesFromState(state);
  const segments = state.segments;
  if (!windows || !Array.isArray(segments) || segments.length === 0) return [];

  const rdWin = (off) => windows[off] | (windows[off + 1] << 8);
  const rdDram = (h) => {
    const seg = segments[h >> 12];
    if (!seg || seg.length < SEGMENT_HALFWORDS * 2) return 0;
    const o = (h & (SEGMENT_HALFWORDS - 1)) * 2;
    return seg[o] | (seg[o + 1] << 8);
  };

  /** @type {Array<import('./vip-state.js').DrawCall & { recovered: true }>} */
  const out = [];
  for (let world = 31; world >= 0; world--) {
    const b = world * WORLD_BYTES;
    const header = rdWin(b);
    if (header & HDR_END) break;
    if (((header >> 12) & 3) !== BGM_NORMAL) continue;
    if (!(header & (eye ? HDR_RON : HDR_LON))) continue;
    recoverWorld(world, header, rdWin, rdDram, b, eye, out);
  }
  return out;
}

/**
 * One normal-mode world. Only edge cells can be unrecorded: a cell is recorded when its
 * recording row (top row, or bottom row when vflipped) is on a drawn scanline and its left
 * column is on a drawn pixel. So interior cell rows need only their first cell checked (it may
 * start left of the window), while the first and last cell rows are checked cell by cell.
 */
function recoverWorld(world, header, rdWin, rdDram, b, eye, out) {
  const bgmapBase = header & 0xf;
  const over = !!(header & HDR_OVER);
  const scy = (header >> 8) & 3;
  const scx = (header >> 10) & 3;
  const gx = signExtend(rdWin(b + 2), 11);
  const gp = signExtend(rdWin(b + 4), 9);
  const gy = signExtend(rdWin(b + 6), 11);
  const mx = rdWin(b + 8);
  const mp = signExtend(rdWin(b + 10), 9);
  const my = rdWin(b + 12);
  const destWidth = signExtend(rdWin(b + 14), 11) & 0xffff;
  const destHeight = rdWin(b + 16) & 0x3ff;
  const overplaneChar = rdWin(b + 20);

  // Scanlines this world draws: RealY − GY in [0, H] (the core compares as uint16).
  const rowStart = Math.max(0, gy);
  const rowEnd = Math.min(FRAME_H - 1, gy + destHeight);
  if (rowStart > rowEnd) return;

  // DrawBG narrows DestX to 10 bits and clamps the span to the screen.
  const destX = signExtend(gx + (eye ? gp : -gp), 10);
  const startX = Math.max(0, destX);
  const finalX = Math.min(FRAME_W - 1, destX + destWidth);
  if (startX > finalX) return;

  const sizeX = 512 << scx;
  const sizeY = 512 << scy;
  const maskX = over ? 0x1fff : sizeX - 1;
  const maskY = over ? 0x1fff : sizeY - 1;
  const srcX0 = mx + (eye ? mp : -mp);
  /** Source X of screen pixel x (the core walks SourceX one per pixel from startX). */
  const sourceXAt = (x) => (srcX0 + x - destX) & maskX;
  /** Source Y of scanline y. */
  const sourceYAt = (y) => (my + y - gy) & maskY;
  const fetch = (sx, sy) => {
    if (sx >= sizeX || sy >= sizeY) return rdDram(overplaneChar & 0xffff);
    const rowBase = (bgmapBase << 12) | (((sy >> 3) & 0x3f) * 0x40) | (((sy << 3) & ~0xfff) << scx);
    return rdDram((rowBase | ((sx << 3) & ~0xfff) | ((sx >> 3) & 0x3f)) & 0xffff);
  };

  const firstCellX = startX - (sourceXAt(startX) & 7);
  const firstCellY = rowStart - (sourceYAt(rowStart) & 7);
  for (let yTop = firstCellY; yTop <= rowEnd; yTop += 8) {
    const fullRow = yTop >= rowStart && yTop + 7 <= rowEnd;
    const sy = sourceYAt(Math.max(yTop, rowStart));
    for (let xLeft = firstCellX; xLeft <= finalX; xLeft += 8) {
      const colRecorded = xLeft >= startX;
      if (fullRow && colRecorded) break; // the rest of an interior row was recorded
      const bgsc = fetch(sourceXAt(Math.max(xLeft, startX)), sy);
      const vflip = !!(bgsc & BGSC_VFLIP);
      const recordRow = yTop + (vflip ? 7 : 0);
      if (colRecorded && recordRow >= rowStart && recordRow <= rowEnd) continue;
      out.push({
        tileIndex: bgsc & BGSC_CHAR,
        x: xLeft,
        y: yTop,
        flipH: !!(bgsc & BGSC_HFLIP),
        flipV: vflip,
        eye,
        world,
        layer: 0,
        paletteSelector: (bgsc >> 14) & 3,
        strip: Math.max(rowStart, yTop) >> 3,
        recovered: true,
      });
    }
  }
}
