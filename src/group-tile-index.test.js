import { describe, it, expect } from 'vitest';
import { buildGroupTileColorIndex } from './color-layer.js';
import { encodeGroupTileColors } from './group-tile-colors.js';

const tile = (v) => new Uint8Array(256).fill(v);

describe('buildGroupTileColorIndex caching', () => {
  it('stored colours: one index per groups array', () => {
    const groups = [{ id: 'a', tileColors: encodeGroupTileColors(new Map([[1, tile(9)]])) }];
    const index = buildGroupTileColorIndex(groups);
    expect(index.get(1)[0].rgba[0]).toBe(9);
    expect(buildGroupTileColorIndex(groups)).toBe(index);
  });

  it('while painting (a live Map): reused until a pattern is added, removed or its buffer swapped', () => {
    const live = new Map([[1, tile(1)]]);
    const groups = [{ id: 'a', tileColors: live }, { id: 'b', tileColors: encodeGroupTileColors(new Map([[2, tile(2)]])) }];
    const first = buildGroupTileColorIndex(groups);
    expect(buildGroupTileColorIndex(groups)).toBe(first);
    live.get(1)[0] = 7; // painting into a buffer: the index already points at it
    expect(buildGroupTileColorIndex(groups)).toBe(first);
    expect(first.get(1)[0].rgba[0]).toBe(7);

    live.set(3, tile(3)); // a new pattern
    const second = buildGroupTileColorIndex(groups);
    expect(second).not.toBe(first);
    expect(second.get(3)[0].rgba[0]).toBe(3);

    live.set(1, tile(5)); // undo swaps a buffer
    const third = buildGroupTileColorIndex(groups);
    expect(third).not.toBe(second);
    expect(third.get(1)[0].rgba[0]).toBe(5);

    live.delete(3);
    expect(buildGroupTileColorIndex(groups).has(3)).toBe(false);
  });

  it('a group turned live in place (same array) is noticed', () => {
    const groups = [{ id: 'a', tileColors: encodeGroupTileColors(new Map([[1, tile(1)]])) }];
    buildGroupTileColorIndex(groups);
    groups[0].tileColors = new Map([[4, tile(4)]]);
    expect(buildGroupTileColorIndex(groups).has(4)).toBe(true);
  });
});
