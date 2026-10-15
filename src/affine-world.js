/**
 * Affine worlds: the VIP's scaled and rotated background layers, sampled pixel by pixel.
 *
 * A normal background world shows its BG map 1:1. An affine world (world header mode 2) instead
 * reads a parameter table in display RAM — one 8-halfword row per scanline at `PARAM_BASE`:
 *   MX, MY  where in the BG map this scanline starts (fixed point, 3 fraction bits)
 *   MP      a left/right eye offset in screen pixels
 *   DX, DY  how far to step through the map for each screen pixel (fixed point, 9 fraction bits)
 * A step below one map pixel per screen pixel zooms in: neighbouring screen pixels read the same
 * texel of the same tile, so tiles grow. A non-zero DY rotates.
 *
 * The core's draw list cannot describe that: it records an affine tile wherever a screen pixel
 * reads its top-left texel (`patches/beetle-vb-vip-draw-list-export.patch`), so zoomed in one
 * tile is recorded many times and each record is drawn as a rigid 8×8 tile — the gaps and
 * unscaled copies seen in the colour layer. Every frame carries the world table and all of display
 * RAM (`windows`, `segments`: 16 × 8 KiB, parameter tables included), so this module redoes what
 * the VIP does: a line-for-line port of Beetle's `DrawAffine` (mednafen/vb/vip_draw.inc at the
 * pinned revision, see docs/core/core-build.md), called the way `VIP_DrawBlock` calls it.
 */

import { getWindowsTableBytesFromState } from './vip-world-clip.js';
import { RecentMap } from './lazy-entries.js';

/** Frames whose affine pixel maps are kept (affinePixelMap). */
const PIXEL_MAP_FRAMES = 24;

const FRAME_H = 224;
const WORLD_BYTES = 32;
const SEGMENT_HALFWORDS = 0x1000;

export const BGM_AFFINE = 2;
const HDR_LON = 0x8000;
const HDR_RON = 0x4000;
const HDR_OVER = 0x80;
const HDR_END = 0x40;

/** @param {number} v @param {number} bits */
function signExtend(v, bits) {
  const m = v & ((1 << bits) - 1);
  return m >= 1 << (bits - 1) ? m - (1 << bits) : m;
}
const s16 = (v) => (v << 16) >> 16;

/**
 * Readers over a frame's world table, display RAM (halfwords) and character RAM (halfwords).
 * @returns {null | { rdWin: (off: number) => number, rdDram: (h: number) => number, chr16: (i: number) => number }}
 */
function frameMemory(state) {
  const windows = getWindowsTableBytesFromState(state);
  const segments = state?.segments;
  const pt = state?.patternTable;
  if (!windows || !Array.isArray(segments) || segments.length === 0 || !pt) return null;
  return {
    rdWin: (off) => windows[off] | (windows[off + 1] << 8),
    rdDram: (h) => {
      const seg = segments[(h >> 12) & 0xf];
      if (!seg || seg.length < SEGMENT_HALFWORDS * 2) return 0;
      const o = (h & (SEGMENT_HALFWORDS - 1)) * 2;
      return seg[o] | (seg[o + 1] << 8);
    },
    chr16: (i) => {
      const o = (i & 0x3fff) * 2;
      return o + 1 < pt.length ? pt[o] | (pt[o + 1] << 8) : 0;
    },
  };
}

/**
 * Affine worlds this frame shows for an eye, back to front (the VIP's order), stopping at the
 * END world.
 * @returns {number[]}
 */
export function affineWorlds(state, eye) {
  const mem = frameMemory(state);
  if (!mem) return [];
  const out = [];
  for (let world = 31; world >= 0; world--) {
    const header = mem.rdWin(world * WORLD_BYTES);
    if (header & HDR_END) break;
    if (((header >> 12) & 3) === BGM_AFFINE && header & (eye ? HDR_RON : HDR_LON)) out.push(world);
  }
  return out;
}

/**
 * Walk every screen pixel an affine world samples, exactly as the VIP does.
 * `visit(x, y, char, texelX, texelY, pixel, palette, hflip, vflip, rotated)` gets the character
 * read, the texel within it (0–7, flips applied, as the VIP reads it) and its 2-bit value — 0 is
 * transparent, so the VIP leaves that pixel alone. Called for every sampled pixel, lit or not;
 * `rotated` says the scanline took the VIP's rotation path (DY ≠ 0). The 11th argument, `cell`,
 * is the source map cell read (`cellY * 1024 + cellX`, in 8 px cells of the world's whole map
 * plane), or -1 where the overplane character stands in: the unscaled picture is the map itself.
 * @returns {boolean} false when the world is not an affine world shown on this eye
 */
export function sampleAffineWorld(state, world, eye, visit) {
  const mem = frameMemory(state);
  if (!mem || world < 0 || world > 31) return false;
  const { rdWin, rdDram, chr16 } = mem;
  const b = world * WORLD_BYTES;
  const header = rdWin(b);
  const lr = eye ? 1 : 0;
  if (((header >> 12) & 3) !== BGM_AFFINE || !(header & (lr ? HDR_RON : HDR_LON))) return false;

  // VIP_DrawBlock's world fields (uint16 in C, so sums wrap at 16 bits).
  const bgmapBase = header & 0xf;
  const over = !!(header & HDR_OVER);
  const scy = (header >> 8) & 3;
  const scx = (header >> 10) & 3;
  const gx = signExtend(rdWin(b + 2), 11) & 0xffff;
  const gp = signExtend(rdWin(b + 4), 9) & 0xffff;
  const gy = signExtend(rdWin(b + 6), 11) & 0xffff;
  const destWidth = signExtend(rdWin(b + 14), 11) & 0xffff;
  const destHeight = rdWin(b + 16) & 0x3ff;
  const paramBase = rdWin(b + 18) & 0xfff0;
  const overplaneChar = rdWin(b + 20);
  const destX = s16(signExtend((gx + (lr ? gp : -gp)) & 0xffff, 10));
  const destY = gy;

  // DrawAffine
  const sourceXSize = 512 << scx;
  const sourceYSize = 512 << scy;
  const sourceXMask = over ? 0x3ffffff : (sourceXSize << 9) - 1;
  const sourceYMask = over ? 0x3ffffff : (sourceYSize << 9) - 1;
  const bgscOverplane = rdDram(overplaneChar);
  const mapBase = bgmapBase * 4096;
  const startX = Math.max(0, destX);
  const finalX = Math.min(383, destX + destWidth);

  for (let realY = 0; realY < FRAME_H; realY++) {
    const line = (realY - destY) & 0xffff;
    if (line > destHeight) continue;
    const p = (paramBase + 8 * (realY - destY)) & 0xffff;
    const mx = s16(rdDram(p));
    const mp = s16(rdDram((p + 1) & 0xffff));
    const my = s16(rdDram((p + 2) & 0xffff));
    const dx = s16(rdDram((p + 3) & 0xffff));
    const dy = s16(rdDram((p + 4) & 0xffff));

    let sourceX = mx << 6;
    let sourceY = my << 6;
    if (destX < 0) {
      sourceX += dx * -destX;
      sourceY += dy * -destX;
    }
    if (mp >= 0 && lr) {
      sourceX += dx * mp;
      sourceY += dy * mp;
    } else if (mp < 0 && !lr) {
      sourceX += dx * -mp;
      sourceY += dy * -mp;
    }
    sourceX |= 0;
    sourceY |= 0;

    if (dy === 0) {
      // The VIP's no-rotation path: the map row is fixed for the whole scanline.
      sourceY &= sourceYMask;
      if (sourceY >= sourceYSize << 9) continue;
      const rowBase = mapBase | (((sourceY >> 6) & ~0xfff) << scx) | (((sourceY >> 12) & 0x3f) * 0x40);
      for (let x = startX; x <= finalX; x++) {
        sourceX &= sourceXMask;
        let bgsc = bgscOverplane;
        let cell = -1;
        if (sourceX < sourceXSize << 9) {
          bgsc = rdDram((rowBase | ((sourceX >> 6) & ~0xfff) | ((sourceX >> 12) & 0x3f)) & 0xffff);
          cell = (sourceY >> 12) * 1024 + (sourceX >> 12);
        }
        const hflip = (bgsc & 0x2000) !== 0;
        const vflip = (bgsc & 0x1000) !== 0;
        const subY = (vflip ? 7 : 0) ^ ((sourceY >> 9) & 7);
        const subX2 = (hflip ? 0xe : 0) ^ ((sourceX >> 8) & 0xe);
        const char = bgsc & 0x7ff;
        const pixel = (chr16(char * 8 + subY) >> subX2) & 3;
        visit(x, realY, char, subX2 >> 1, subY, pixel, bgsc >> 14, hflip, vflip, false, cell);
        sourceX = (sourceX + dx) | 0;
      }
    } else {
      for (let x = startX; x <= finalX; x++) {
        sourceX &= sourceXMask;
        sourceY &= sourceYMask;
        let bgsc = bgscOverplane;
        let cell = -1;
        if (sourceX < sourceXSize << 9 && sourceY < sourceYSize << 9) {
          cell = (sourceY >> 12) * 1024 + (sourceX >> 12);
          const mIndex = ((sourceX >> 6) & ~0xfff) + (((sourceY >> 6) & ~0xfff) << scx);
          const subIndex = ((sourceX >> 12) & 0x3f) + ((sourceY >> 12) & 0x3f) * 0x40;
          bgsc = rdDram((mapBase | mIndex | subIndex) & 0xffff);
        }
        const hflip = (bgsc & 0x2000) !== 0;
        const vflip = (bgsc & 0x1000) !== 0;
        const subY = (vflip ? 7 : 0) ^ ((sourceY >> 9) & 7);
        const subX = (hflip ? 7 : 0) ^ ((sourceX >> 9) & 7);
        const char = bgsc & 0x7ff;
        const pixel = (chr16(char * 8 + subY) >> (subX * 2)) & 3;
        visit(x, realY, char, subX, subY, pixel, bgsc >> 14, hflip, vflip, true, cell);
        sourceX = (sourceX + dx) | 0;
        sourceY = (sourceY + dy) | 0;
      }
    }
  }
  return true;
}

/**
 * The character in each 8 px cell of an affine world's map plane, read the way sampleAffineWorld
 * reads it (`cell` there is `cellY * 1024 + cellX`): what lies beside a cell on screen at any zoom.
 * @returns {null | { width: number, height: number, charAt: (cx: number, cy: number) => number }}
 *   cells across and down; charAt is -1 outside the map. Null when the world is not affine.
 */
export function affineMapReader(state, world) {
  const mem = frameMemory(state);
  if (!mem || world < 0 || world > 31) return null;
  const header = mem.rdWin(world * WORLD_BYTES);
  if (((header >> 12) & 3) !== BGM_AFFINE) return null;
  const mapBase = (header & 0xf) * 4096;
  const scy = (header >> 8) & 3;
  const scx = (header >> 10) & 3;
  const width = 64 << scx;
  const height = 64 << scy;
  return {
    width,
    height,
    charAt(cx, cy) {
      if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx >= width || cy >= height) return -1;
      const addr = (mapBase | (((cy >> 6) << 12) << scx) | ((cy & 0x3f) << 6) | ((cx >> 6) << 12) | (cx & 0x3f)) & 0xffff;
      return mem.rdDram(addr) & 0x7ff;
    },
  };
}

/** @typedef {{ char: Int16Array, tx: Uint8Array, ty: Uint8Array, lit: Uint8Array, mx: Int32Array, my: Int32Array }} AffinePixels `mx`/`my`: the map pixel read (-1 where none), as the map lays it out */

/** Per frame object and eye: the tools ask about the same frame many times per pointer move. */
// The frames being worked on only: each map is ~1 MB per scaled layer, and a pass over a whole
// project (a group's views) would otherwise keep one for every frame it looked at.
const pixelMapCache = new RecentMap(PIXEL_MAP_FRAMES);

/**
 * What every screen pixel of each affine world reads on one eye — for the authoring tools, which
 * must hit-test, paint and outline a scaled layer by what is actually on screen, not by the draw
 * list's rigid 8×8 records. `char` is -1 where the world does not sample the pixel.
 * @returns {Map<number, AffinePixels>} by world; empty when the frame has no affine world
 */
export function affinePixelMap(state, eye) {
  if (!state || typeof state !== 'object') return new Map();
  const e = eye ? 1 : 0;
  let perEye = pixelMapCache.get(state);
  if (perEye?.[e]) return perEye[e];
  /** @type {Map<number, AffinePixels>} */
  const out = new Map();
  for (const world of affineWorlds(state, e)) {
    const n = 384 * FRAME_H;
    const px = {
      char: new Int16Array(n).fill(-1),
      tx: new Uint8Array(n),
      ty: new Uint8Array(n),
      lit: new Uint8Array(n),
      mx: new Int32Array(n).fill(-1),
      my: new Int32Array(n).fill(-1),
    };
    sampleAffineWorld(state, world, e, (x, y, ch, tx, ty, pixel, _pal, hflip, vflip, _rot, cell) => {
      const i = y * 384 + x;
      px.char[i] = ch;
      px.tx[i] = tx;
      px.ty[i] = ty;
      px.lit[i] = pixel ? 1 : 0;
      if (cell >= 0) {
        px.mx[i] = (cell % 1024) * 8 + (hflip ? 7 - tx : tx);
        px.my[i] = Math.floor(cell / 1024) * 8 + (vflip ? 7 - ty : ty);
      }
    });
    out.set(world, px);
  }
  if (!perEye) {
    perEye = [];
    pixelMapCache.set(state, perEye);
  }
  perEye[e] = out;
  return out;
}

/**
 * Stand-in draw records for affine tiles the frame shows but the core never recorded — shrunk
 * tiles whose top-left texel no screen pixel reads (the far end of a perspective floor), and every
 * tile on a rotated scanline. Without them such tiles cannot be clicked, dragged or grouped. One
 * per (eye, world, character), at the first screen pixel that reads it, marked `standIn: true` so
 * nothing ever saves them. The compositor skips affine records anyway.
 * @returns {Array<{ tileIndex: number, x: number, y: number, flipH: false, flipV: false, world: number, eye: number, layer: 1, paletteSelector: number, standIn: true }>}
 */
export function affineStandInDraws(state) {
  const recorded = new Set();
  for (const d of state?.drawList || []) {
    if (d.layer === 1) recorded.add(`${d.eye ?? 0}|${d.world}|${d.tileIndex}`);
  }
  const out = [];
  for (const eye of [0, 1]) {
    for (const world of affineWorlds(state, eye)) {
      const seen = new Set();
      sampleAffineWorld(state, world, eye, (x, y, ch, _tx, _ty, pixel, pal) => {
        if (!pixel || seen.has(ch)) return;
        seen.add(ch);
        if (recorded.has(`${eye}|${world}|${ch}`)) return;
        out.push({ tileIndex: ch, x, y, flipH: false, flipV: false, world, eye, layer: 1, paletteSelector: pal, standIn: true });
      });
    }
  }
  return out;
}

/**
 * The affine tiles the patched core records in its draw list for a world: one per screen pixel
 * that reads a tile's top-left texel, in the no-rotation path only (see the patch). Used to check
 * this port against real frames; the compositor does not need it.
 * @returns {Array<{ tileIndex: number, x: number, y: number, flipH: boolean, flipV: boolean, world: number, eye: number }>}
 */
export function coreAffineRecords(state, world, eye) {
  const out = [];
  sampleAffineWorld(state, world, eye, (x, y, char, tx, ty, _pixel, _pal, hflip, vflip, rotated) => {
    if (rotated || tx !== 0 || ty !== 0) return;
    out.push({ tileIndex: char, x: x - (hflip ? 7 : 0), y: y - (vflip ? 7 : 0), flipH: hflip, flipV: vflip, world, eye: eye ? 1 : 0 });
  });
  return out;
}
