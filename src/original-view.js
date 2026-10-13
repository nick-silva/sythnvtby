/**
 * A pose's original picture: the game's own monochrome shades, with no paint at all. SpriteStudio
 * shows it over the painted pose (Original, or hold O) so paint filled in bulk can be checked
 * against what the game draws.
 */

/** Grey per shade 0–3: a lit pixel the palette turns to shade 0 is black, not see-through. */
export const ORIGINAL_GREYS = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([80, 80, 80]),
  Object.freeze([160, 160, 160]),
  Object.freeze([240, 240, 240]),
]);

/**
 * The shade the game shows a pixel value in. Background layers go through the frame's palette
 * (GPLT); sprites (layer 2) keep the raw value, as in the compositor (src/color-layer.js).
 * @param {number} value pixel value 1–3
 * @param {{ layer?: number, paletteSelector?: number } | null | undefined} draw
 * @param {number[] | null | undefined} gplt
 */
export function originalShade(value, draw, gplt) {
  if (!Array.isArray(gplt) || gplt.length < 4 || Number(draw?.layer) === 2) return value;
  return (Number(gplt[(draw?.paletteSelector ?? 0) & 3]) >> (value * 2)) & 3;
}

/**
 * Paint a pose's original picture into RGBA pixels, leaving everything outside it transparent.
 * @param {{
 *   data: Uint8ClampedArray | Uint8Array,
 *   width: number,
 *   height: number,
 *   bounds: { x0: number, y0: number, x1: number, y1: number },
 *   lookup: (x: number, y: number) => ({ value: number, draw?: any } | null),
 *   gplt?: number[] | null,
 * }} opts `lookup` gives the pixel value (0 = see-through) of the pose tile in front at a pixel
 * @returns {number} lit pixels painted
 */
export function paintOriginal({ data, width, height, bounds, lookup, gplt = null }) {
  data.fill(0);
  let lit = 0;
  for (let y = Math.max(0, bounds.y0); y < Math.min(height, bounds.y1); y++) {
    for (let x = Math.max(0, bounds.x0); x < Math.min(width, bounds.x1); x++) {
      const hit = lookup(x, y);
      if (!hit?.value) continue;
      const [r, g, b] = ORIGINAL_GREYS[originalShade(hit.value, hit.draw, gplt)];
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
      lit++;
    }
  }
  return lit;
}
