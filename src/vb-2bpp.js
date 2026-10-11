/**
 * Shared VB 2bpp tile decode and 4-color rendering.
 * Used by the pack editor, frame viewer, and (later) paint-on-game editor.
 */

/** 16 bytes per tile (8×8, 2bpp) */
export const TILE_SIZE = 8;
export const BYTES_PER_TILE = 16;

/**
 * Decode a VB 2bpp tile (16 bytes) to 8×8 indices 0–3.
 * VB pattern data matches the core: each row is one uint16 (little-endian), packed as
 * pixel_col = (word >> (col*2)) & 3 — i.e. bits 0,1 = col 0, bits 2,3 = col 1, etc.
 *
 * @param {Uint8Array} u8 - 16 bytes (8 rows × 2 bytes, packed 2bpp)
 * @returns {Uint8Array} 64 bytes (8×8), each value 0–3
 */
export function decodeTile(u8) {
  const out = new Uint8Array(64);
  for (let row = 0; row < 8; row++) {
    const word = u8[row * 2] | (u8[row * 2 + 1] << 8);
    for (let col = 0; col < 8; col++) {
      out[row * 8 + col] = (word >> (col * 2)) & 3;
    }
  }
  return out;
}

/**
 * Four colors as [R,G,B][] — index 0 = transparent (alpha 0), 1–3 = opaque.
 *
 * @param {number[][]} colors4 - 4× [R,G,B], 0–255
 * @returns {number[][]} 4× [R,G,B,A]
 */
function colorsToRgba(colors4) {
  return [
    [0, 0, 0, 0],
    [colors4[1][0], colors4[1][1], colors4[1][2], 255],
    [colors4[2][0], colors4[2][1], colors4[2][2], 255],
    [colors4[3][0], colors4[3][1], colors4[3][2], 255],
  ];
}

/**
 * Render a 16-byte tile into RGBA (256 bytes) using 4 colors. Level 0 = transparent.
 *
 * @param {Uint8Array} tileBytes - 16 bytes
 * @param {number[][]} colors4 - 4× [R,G,B]
 * @returns {Uint8Array} 256 bytes (8×8 RGBA)
 */
export function tileToRgba(tileBytes, colors4) {
  const decoded = decodeTile(tileBytes);
  const rgba = new Uint8Array(256);
  const levels = colorsToRgba(colors4);
  for (let i = 0; i < 64; i++) {
    const c = levels[decoded[i]];
    rgba[i * 4] = c[0];
    rgba[i * 4 + 1] = c[1];
    rgba[i * 4 + 2] = c[2];
    rgba[i * 4 + 3] = c[3];
  }
  return rgba;
}

/**
 * Draw one 8×8 tile into ImageData at (x0, y0) with optional flip and scale. Uses 4 colors.
 * Clips to image bounds.
 *
 * @param {ImageData} imageData - target (e.g. 384×224)
 * @param {number} x0 - left pixel
 * @param {number} y0 - top pixel
 * @param {Uint8Array} tileBytes - 16 bytes
 * @param {number[][]} colors4 - 4× [R,G,B]
 * @param {{ flipH?: boolean, flipV?: boolean, destW?: number, destH?: number, skipPalette0?: boolean }} options
 *   destW, destH: draw tile scaled to this size (default 8×8). Nearest-neighbor sampling.
 *   skipPalette0: if true, do not write pixels with palette index 0 (VB treats 0 as transparent; leave buffer unchanged).
 */
export function drawTileIntoImageData(imageData, x0, y0, tileBytes, colors4, options = {}) {
  const { flipH = false, flipV = false, destW = 8, destH = 8, skipPalette0 = false } = options;
  const decoded = decodeTile(tileBytes);
  const levels = colorsToRgba(colors4);
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const x0i = Math.round(x0);
  const y0i = Math.round(y0);
  const destWi = Math.max(1, Math.round(destW));
  const destHi = Math.max(1, Math.round(destH));
  const scaleDown = destWi < 8 || destHi < 8;
  if (scaleDown) {
    // Box filter when scaling down
    for (let py = 0; py < destHi; py++) {
      const srcY0 = (py / destHi) * 8;
      const srcY1 = ((py + 1) / destHi) * 8;
      const sy0 = Math.max(0, Math.min(8, Math.floor(srcY0)));
      const sy1 = Math.max(0, Math.min(8, Math.ceil(srcY1)));
      for (let px = 0; px < destWi; px++) {
        const srcX0 = (px / destWi) * 8;
        const srcX1 = ((px + 1) / destWi) * 8;
        const sx0 = Math.max(0, Math.min(8, Math.floor(srcX0)));
        const sx1 = Math.max(0, Math.min(8, Math.ceil(srcX1)));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let sy = sy0; sy < sy1; sy++) {
          const syc = flipV ? 7 - sy : sy;
          for (let sx = sx0; sx < sx1; sx++) {
            const sxc = flipH ? 7 - sx : sx;
            const idx = decoded[syc * 8 + sxc];
            if (skipPalette0 && idx === 0) continue;
            const c = levels[idx];
            r += c[0]; g += c[1]; b += c[2]; a += c[3];
            n++;
          }
        }
        if (n === 0) continue;
        const ix = x0i + px;
        const iy = y0i + py;
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
        const dst = (iy * w + ix) * 4;
        data[dst] = Math.round(r / n);
        data[dst + 1] = Math.round(g / n);
        data[dst + 2] = Math.round(b / n);
        data[dst + 3] = Math.round(a / n);
      }
    }
    return;
  }
  for (let py = 0; py < destHi; py++) {
    const sy = flipV ? 7 - Math.floor((py / destHi) * 8) : Math.floor((py / destHi) * 8);
    const syc = Math.max(0, Math.min(7, sy));
    for (let px = 0; px < destWi; px++) {
      const sx = flipH ? 7 - Math.floor((px / destWi) * 8) : Math.floor((px / destWi) * 8);
      const sxc = Math.max(0, Math.min(7, sx));
      const idx = decoded[syc * 8 + sxc];
      if (skipPalette0 && idx === 0) continue;
      const ix = x0i + px;
      const iy = y0i + py;
      if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
      const c = levels[idx];
      const dst = (iy * w + ix) * 4;
      data[dst] = c[0];
      data[dst + 1] = c[1];
      data[dst + 2] = c[2];
      data[dst + 3] = c[3];
    }
  }
}
