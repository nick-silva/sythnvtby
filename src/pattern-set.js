/**
 * One set of a repeating pattern.
 *
 * Groups match by tile pattern, so a background group made from a few tiles matches every copy
 * of them on screen — a cloud strip of 3 patterns shows as 47 tiles across the whole frame.
 * This finds the smallest block the region repeats by, so a view can work on one copy of it
 * while the others stay around it as context. Paint is per pattern, so painting that one copy
 * still colours all of them.
 */

const TILE = 8;
/** Of the tiles that could have a partner one period away, at least this share must have one. */
const MIN_PARTNER_SHARE = 0.5;

/**
 * @param {Array<{ hash: number, dx: number, dy: number }>} tiles positions relative to the anchor (0, 0)
 * @returns {null | {
 *   periodX: number|null, periodY: number|null,
 *   x0: number, y0: number, x1: number, y1: number,
 *   indices: number[],
 * }} the block holding the anchor (bounds relative to it, x1/y1 exclusive), or null when the
 *   region does not repeat
 */
export function findRepeatSet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 2) return null;
  const at = new Map(tiles.map((t) => [`${t.dx},${t.dy}`, t.hash >>> 0]));
  const xs = tiles.map((t) => t.dx);
  const ys = tiles.map((t) => t.dy);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };

  const periodX = smallestPeriod(tiles, at, box, 1, 0);
  const periodY = smallestPeriod(tiles, at, box, 0, 1);
  if (periodX === null && periodY === null) return null;

  const x0 = periodX === null ? box.minX : blockStart(periodX, box.minX, box.maxX + TILE);
  const y0 = periodY === null ? box.minY : blockStart(periodY, box.minY, box.maxY + TILE);
  const x1 = periodX === null ? box.maxX + TILE : x0 + periodX;
  const y1 = periodY === null ? box.maxY + TILE : y0 + periodY;
  const indices = [];
  tiles.forEach((t, i) => {
    if (t.dx >= x0 && t.dx < x1 && t.dy >= y0 && t.dy < y1) indices.push(i);
  });
  if (indices.length === 0 || indices.length >= tiles.length) return null;
  return { periodX, periodY, x0, y0, x1, y1, indices };
}

/**
 * The smallest shift (whole tiles) along one axis under which every tile that has a partner
 * carries the same pattern. Holes are skipped, not counted against it; tiles whose partner
 * would fall outside the region do not count either way.
 */
function smallestPeriod(tiles, at, box, sx, sy) {
  const span = sx ? box.maxX - box.minX : box.maxY - box.minY;
  // A repeat needs room for two whole periods. Otherwise a framed panel whose left and right
  // border columns match (a scoreboard) passes as "repeating every width minus one tile".
  for (let shift = TILE; shift * 2 <= span + TILE; shift += TILE) {
    let eligible = 0;
    let pairs = 0;
    let mismatch = false;
    for (const t of tiles) {
      const px = t.dx + sx * shift;
      const py = t.dy + sy * shift;
      if (px > box.maxX || py > box.maxY) continue;
      eligible++;
      const h = at.get(`${px},${py}`);
      if (h === undefined) continue;
      if (h !== t.hash >>> 0) {
        mismatch = true;
        break;
      }
      pairs++;
    }
    if (!mismatch && pairs > 0 && pairs >= eligible * MIN_PARTNER_SHARE) return shift;
  }
  return null;
}

/** Start the block at the anchor (0), stepping back whole periods until it fits the region. */
function blockStart(period, lo, hi) {
  let start = 0;
  while (start + period > hi && start - period >= lo) start -= period;
  return start;
}
