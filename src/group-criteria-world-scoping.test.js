import { describe, it, expect } from 'vitest';

/** Same rules as tools/paint `drawMatchesGroup`: hash + optional window/layer lists. */
function drawMatchesGroup(draw, group, hash) {
  const c = group.criteria || {};
  const windowIds = Array.isArray(c.windowIds)
    ? c.windowIds
    : (Array.isArray(c.worldIds) ? c.worldIds : []);
  const hashes = c.hashes;
  const layers = c.layers;
  if (windowIds != null && windowIds.length > 0) {
    const w = draw.world;
    if (w === undefined || w === null) return false;
    if (!windowIds.includes(w)) return false;
  }
  if (hashes != null && hashes.length > 0 && !hashes.includes(hash)) return false;
  if (layers != null && layers.length > 0) {
    const L = draw.layer;
    if (L === undefined || L === null) return false;
    if (!layers.includes(L)) return false;
  }
  return true;
}

describe('group criteria: same hash, different worlds', () => {
  it('allows two groups to own the same hash when windowIds differ', () => {
    const h = 0xabcd1234;
    const gW5 = { id: 'a', criteria: { windowIds: [5], hashes: [h], layers: [] } };
    const gW9 = { id: 'b', criteria: { windowIds: [9], hashes: [h], layers: [] } };
    expect(drawMatchesGroup({ world: 5, layer: 0 }, gW5, h)).toBe(true);
    expect(drawMatchesGroup({ world: 5, layer: 0 }, gW9, h)).toBe(false);
    expect(drawMatchesGroup({ world: 9, layer: 0 }, gW9, h)).toBe(true);
    expect(drawMatchesGroup({ world: 9, layer: 0 }, gW5, h)).toBe(false);
  });
});
