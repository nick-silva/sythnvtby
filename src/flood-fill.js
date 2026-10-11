/**
 * 4-connected flood fill over screen pixels. The caller decides what a pixel's colour is and
 * which pixels may be filled at all (`keyAt` returns null for those), so the same fill works on
 * painted tiles, unpainted ones (compared by shade) and across tile edges.
 */

const FRAME_PIXELS = 384 * 224;

/**
 * @param {number} x @param {number} y start pixel
 * @param {(x: number, y: number) => string|null} keyAt colour key, or null when not fillable
 * @param {{ maxPixels?: number }} [opts]
 * @returns {Array<[number, number]>} the region, start included; empty when the start cannot be filled
 */
export function floodFill(x, y, keyAt, { maxPixels = FRAME_PIXELS } = {}) {
  const target = keyAt(x, y);
  if (target === null) return [];
  /** @type {Array<[number, number]>} */
  const out = [];
  const seen = new Set([`${x},${y}`]);
  /** @type {Array<[number, number]>} */
  const stack = [[x, y]];
  while (stack.length && out.length < maxPixels) {
    const [px, py] = /** @type {[number, number]} */ (stack.pop());
    out.push([px, py]);
    for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (keyAt(nx, ny) === target) stack.push([nx, ny]);
    }
  }
  return out;
}
