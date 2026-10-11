/**
 * Painting on layer art (src/layer-art.js) in SpriteStudio: brush dabs, fill, pick, and
 * replacing the whole picture with an imported one. Operates on a live RGBA buffer
 * `{ width, height, data }` in art coordinates; the caller maps screen pixels to art pixels.
 */

import { floodFill } from './flood-fill.js';

/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Pixels */
/** @typedef {{ r: number, g: number, b: number, a: number }} Colour */

/** @param {Pixels} px @returns {Pixels} a copy that shares nothing (undo snapshots) */
export function copyPixels(px) {
  return { width: px.width, height: px.height, data: new Uint8ClampedArray(px.data) };
}

/** @param {Pixels} px @param {number} x @param {number} y @returns {number[] | null} RGBA */
export function pixelAt(px, x, y) {
  if (x < 0 || y < 0 || x >= px.width || y >= px.height) return null;
  const i = (y * px.width + x) * 4;
  return [px.data[i], px.data[i + 1], px.data[i + 2], px.data[i + 3]];
}

/** @param {Pixels} px @returns {boolean} whether the pixel changed */
function setPixel(px, x, y, c) {
  const i = (y * px.width + x) * 4;
  const d = px.data;
  if (d[i] === c.r && d[i + 1] === c.g && d[i + 2] === c.b && d[i + 3] === c.a) return false;
  d[i] = c.r;
  d[i + 1] = c.g;
  d[i + 2] = c.b;
  d[i + 3] = c.a;
  return true;
}

/**
 * Paint a size×size square centred on (x, y), clipped to the art.
 * @param {Pixels} px @param {number} x @param {number} y @param {number} size @param {Colour} colour
 * @returns {number} pixels changed
 */
export function dab(px, x, y, size, colour) {
  const s = Math.max(1, Math.floor(size));
  const x0 = x - Math.floor((s - 1) / 2);
  const y0 = y - Math.floor((s - 1) / 2);
  let n = 0;
  for (let yy = Math.max(0, y0); yy < Math.min(px.height, y0 + s); yy++) {
    for (let xx = Math.max(0, x0); xx < Math.min(px.width, x0 + s); xx++) if (setPixel(px, xx, yy, colour)) n++;
  }
  return n;
}

/**
 * Fill the 4-connected pixels of the clicked colour.
 * @param {Pixels} px @param {number} x @param {number} y @param {Colour} colour
 * @returns {number} pixels changed (0 when that area is already the colour)
 */
export function fillArt(px, x, y, colour) {
  const start = pixelAt(px, x, y);
  if (!start) return 0;
  if (start[0] === colour.r && start[1] === colour.g && start[2] === colour.b && start[3] === colour.a) return 0;
  const keyAt = (xx, yy) => {
    const p = pixelAt(px, xx, yy);
    return p ? p.join(',') : null;
  };
  let n = 0;
  for (const [xx, yy] of floodFill(x, y, keyAt, { maxPixels: px.width * px.height })) if (setPixel(px, xx, yy, colour)) n++;
  return n;
}

/**
 * Overwrite the whole picture with another of the same size (import, paste, undo).
 * @param {Pixels} px @param {Pixels} from
 */
export function replacePixels(px, from) {
  if (from.width !== px.width || from.height !== px.height) {
    throw new Error(`Image is ${from.width}×${from.height}, layer art is ${px.width}×${px.height}.`);
  }
  px.data.set(from.data);
}
