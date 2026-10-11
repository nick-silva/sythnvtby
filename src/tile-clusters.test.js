import { describe, it, expect } from 'vitest';
import { clusterTilePositions, pickCluster } from './tile-clusters.js';

/** A run of `n` tiles starting at (x, y), left to right. */
const row = (x, y, n) => Array.from({ length: n }, (_, i) => ({ x: x + i * 8, y }));

describe('clusterTilePositions', () => {
  it('keeps a contiguous run together', () => {
    const clusters = clusterTilePositions(row(64, 32, 6));
    expect(clusters.length).toBe(1);
    expect(clusters[0]).toMatchObject({ count: 6, x0: 64, y0: 32, x1: 112, y1: 40 });
  });

  it('separates copies that sit far apart', () => {
    const clusters = clusterTilePositions([...row(16, 16, 3), ...row(300, 200, 2)]);
    expect(clusters.map((c) => c.count)).toEqual([3, 2]);
    expect(clusters[0].x1).toBeLessThan(clusters[1].x0);
  });

  it('joins tiles that are diagonal or one cell apart, not two', () => {
    expect(clusterTilePositions([{ x: 0, y: 0 }, { x: 8, y: 8 }]).length).toBe(1);
    expect(clusterTilePositions([{ x: 0, y: 0 }, { x: 16, y: 0 }]).length).toBe(1);
    expect(clusterTilePositions([{ x: 0, y: 0 }, { x: 32, y: 0 }]).length).toBe(2);
  });

  it('honors a wider gap tolerance when asked', () => {
    expect(clusterTilePositions([{ x: 0, y: 0 }, { x: 32, y: 0 }], { gapTiles: 3 }).length).toBe(1);
  });

  it('returns the biggest cluster first', () => {
    const clusters = clusterTilePositions([...row(0, 0, 2), ...row(200, 100, 9)]);
    expect(clusters[0].count).toBe(9);
  });

  it('handles empty and malformed input', () => {
    expect(clusterTilePositions([])).toEqual([]);
    expect(clusterTilePositions(null)).toEqual([]);
    expect(clusterTilePositions([{}]).length).toBe(1);
  });

  it('does not lose or duplicate any position', () => {
    const pts = [...row(0, 0, 4), ...row(120, 60, 5), ...row(300, 200, 2)];
    const clusters = clusterTilePositions(pts);
    const all = clusters.flatMap((c) => c.indices).sort((a, b) => a - b);
    expect(all).toEqual(pts.map((_, i) => i));
  });
});

describe('pickCluster', () => {
  const pts = [...row(0, 0, 2), ...row(200, 100, 6)];
  const clusters = clusterTilePositions(pts);

  it('prefers the cluster containing the anchor, even when it is smaller', () => {
    expect(pickCluster(clusters, 0).count).toBe(2);
  });

  it('falls back to the largest cluster with no anchor or an unknown one', () => {
    expect(pickCluster(clusters).count).toBe(6);
    expect(pickCluster(clusters, 999).count).toBe(6);
  });

  it('returns null when there is nothing to pick', () => {
    expect(pickCluster([], 0)).toBeNull();
  });
});
