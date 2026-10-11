/**
 * Group 8×8 tile positions into connected clusters.
 *
 * A group's criteria match by tile *pattern*, so a group of, say, text glyphs
 * matches every copy of those glyphs across the frame. The bounding box of all
 * matches is then nearly the whole screen, which is useless to zoom to. Clusters
 * let callers work with the run of tiles that actually sits together.
 */

const TILE = 8;

/**
 * @param {Array<{ x: number, y: number }>} positions screen positions of 8×8 tiles
 * @param {{ gapTiles?: number }} [opts] how many empty tile cells may separate two
 *   tiles and still count as the same cluster (default 1, so touching, diagonal,
 *   or with a one-cell hole between them)
 * @returns {Array<{ indices: number[], count: number, x0: number, y0: number, x1: number, y1: number }>}
 *   clusters, largest first; `x1`/`y1` are exclusive
 */
export function clusterTilePositions(positions, { gapTiles = 1 } = {}) {
  const pts = Array.isArray(positions) ? positions : [];
  if (pts.length === 0) return [];

  const cells = pts.map((p) => ({
    cx: Math.floor(Number(p?.x || 0) / TILE),
    cy: Math.floor(Number(p?.y || 0) / TILE),
  }));

  /** cell key -> indices sharing that cell */
  const byCell = new Map();
  cells.forEach((c, i) => {
    const key = `${c.cx},${c.cy}`;
    const list = byCell.get(key);
    if (list) list.push(i);
    else byCell.set(key, [i]);
  });

  const reach = Math.max(0, Math.floor(gapTiles));
  const seen = new Set();
  const clusters = [];

  for (const startKey of byCell.keys()) {
    if (seen.has(startKey)) continue;
    seen.add(startKey);
    const queue = [startKey];
    /** @type {number[]} */
    const indices = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;

    while (queue.length) {
      const key = queue.pop();
      for (const i of byCell.get(key) || []) {
        indices.push(i);
        const { cx, cy } = cells[i];
        if (cx * TILE < x0) x0 = cx * TILE;
        if (cy * TILE < y0) y0 = cy * TILE;
        if (cx * TILE + TILE > x1) x1 = cx * TILE + TILE;
        if (cy * TILE + TILE > y1) y1 = cy * TILE + TILE;
      }
      const [bx, by] = key.split(',').map(Number);
      for (let dy = -reach - 1; dy <= reach + 1; dy++) {
        for (let dx = -reach - 1; dx <= reach + 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nKey = `${bx + dx},${by + dy}`;
          if (!byCell.has(nKey) || seen.has(nKey)) continue;
          seen.add(nKey);
          queue.push(nKey);
        }
      }
    }
    clusters.push({ indices, count: indices.length, x0, y0, x1, y1 });
  }

  clusters.sort((a, b) => b.count - a.count || a.y0 - b.y0 || a.x0 - b.x0);
  return clusters;
}

/**
 * The cluster a caller should act on: the one holding `preferIndex` (e.g. the
 * group's anchor draw) when given, otherwise the largest.
 *
 * @param {ReturnType<typeof clusterTilePositions>} clusters
 * @param {number} [preferIndex] index into the original positions array
 */
export function pickCluster(clusters, preferIndex = -1) {
  if (!clusters?.length) return null;
  if (preferIndex >= 0) {
    const owner = clusters.find((c) => c.indices.includes(preferIndex));
    if (owner) return owner;
  }
  return clusters[0];
}
