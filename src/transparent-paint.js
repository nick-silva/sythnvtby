/**
 * Paint on transparent pixels.
 *
 * A tile's pixel value 0 is see-through: the Virtual Boy never draws it. Colouring those pixels
 * anyway — the grass between the speckles of Mario's Tennis's court, an outline around a sprite —
 * means drawing paint where the game draws nothing, covering whatever is behind.
 *
 * Older tools let strokes land on transparent pixels, where they never showed. So such paint is
 * only drawn for a pack whose manifest says it is intentional (`paintOnTransparent: 1`). The
 * authoring tools set that flag when they open a pack without it, after clearing the stray paint,
 * so nothing that showed before changes; the emulator draws transparent paint only for flagged
 * packs, so an old pack plays exactly as before until a tool saves it.
 */

import { getTileBytes, hashTile } from './vip-state.js';

export const PAINT_ON_TRANSPARENT_VERSION = 1;

/** @param {any} manifest @returns {boolean} this pack's transparent-pixel paint is intentional */
export function packPaintsTransparent(manifest) {
  return Number(manifest?.paintOnTransparent) >= PAINT_ON_TRANSPARENT_VERSION;
}

/** @param {any} manifest @returns {object} the manifest with the flag set (a copy) */
export function withPaintOnTransparent(manifest) {
  return { ...(manifest && typeof manifest === 'object' ? manifest : {}), paintOnTransparent: PAINT_ON_TRANSPARENT_VERSION };
}

/**
 * Tile paint with the alpha of transparent pixels cleared, as copies.
 * @param {Map<number, Uint8Array>} entries pattern hash → 256-byte RGBA
 * @param {(hash: number) => Uint8Array | null} bytesOf a pattern's 16 bytes, or null if unknown
 * @returns {{ entries: Map<number, Uint8Array>, pixels: number, tiles: number, unknown: number }}
 *   `unknown`: patterns whose bytes no frame holds — left as they are
 */
export function withoutTransparentPaint(entries, bytesOf) {
  const out = new Map();
  let pixels = 0;
  let tiles = 0;
  let unknown = 0;
  for (const [hash, rgba] of entries) {
    const bytes = bytesOf(hash >>> 0);
    if (!bytes || !rgba || rgba.length < 256) {
      if (!bytes) unknown++;
      out.set(hash, rgba);
      continue;
    }
    let copy = null;
    for (let y = 0; y < 8; y++) {
      const row = bytes[y * 2] | (bytes[y * 2 + 1] << 8);
      for (let x = 0; x < 8; x++) {
        if ((row >> (x * 2)) & 3) continue;
        const a = (y * 8 + x) * 4 + 3;
        if (!rgba[a]) continue;
        copy ??= Uint8Array.from(rgba);
        copy[a] = 0;
        pixels++;
      }
    }
    if (copy) tiles++;
    out.set(hash, copy ?? rgba);
  }
  return { entries: out, pixels, tiles, unknown };
}

/**
 * Pattern bytes for the hashes wanted, from frames' character memory (every slot, not just drawn
 * ones), reading frames only until all are found.
 * @param {number} frameCount @param {(i: number) => { patternTable?: Uint8Array } | null} stateAt
 * @param {Iterable<number>} wanted
 * @returns {(hash: number) => Uint8Array | null}
 */
export function patternBytesFromFrames(frameCount, stateAt, wanted) {
  const want = new Set([...wanted].map((h) => h >>> 0));
  /** @type {Map<number, Uint8Array>} */
  const found = new Map();
  for (let i = 0; i < frameCount && found.size < want.size; i++) {
    const st = stateAt(i);
    if (!st?.patternTable) continue;
    for (let ch = 0; ch < 2048 && found.size < want.size; ch++) {
      const bytes = getTileBytes(st.patternTable, ch);
      const h = hashTile(bytes) >>> 0;
      if (want.has(h) && !found.has(h)) found.set(h, Uint8Array.from(bytes));
    }
  }
  return (hash) => found.get(hash >>> 0) || null;
}
