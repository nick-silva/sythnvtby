import { describe, it, expect } from 'vitest';
import { changedPatterns, framePatterns, frameTouched } from './paint-change.js';
import { hashTile } from './vip-state.js';

const group = (id, hashes, extra = {}) => ({ id, name: id, criteria: { hashes, windowIds: [1] }, ...extra });

describe('changedPatterns', () => {
  it('is empty when no group was replaced', () => {
    const a = group('a', [1, 2]);
    const b = group('b', [3]);
    expect(changedPatterns([a, b], [a, b])).toEqual(new Set());
  });

  it('lists the old and new patterns of a group a pose was added to', () => {
    const a = group('a', [1, 2]);
    const b = group('b', [3]);
    const a2 = { ...a, criteria: { ...a.criteria, hashes: [1, 2, 4] }, poses: [{ poseId: 'p1', tiles: [{ hash: 4 }, { hash: 5 }] }] };
    expect(changedPatterns([a, b], [a2, b])).toEqual(new Set([1, 2, 4, 5]));
  });

  it('counts a new group and a removed group, with their pose pictures', () => {
    const a = group('a', [1]);
    const gone = group('gone', [7], { poseOverpaints: [{ id: 'x', hashes: [8] }] });
    const added = group('new', [9]);
    expect(changedPatterns([a, gone], [a, added])).toEqual(new Set([7, 8, 9]));
  });

  it('gives up (null) for changes that can reach any frame', () => {
    const a = group('a', [1]);
    const b = group('b', [2]);
    // Reordered: which group colours a shared pattern changes.
    expect(changedPatterns([a, b], [b, a])).toBeNull();
    // A group with no pattern list covers whole layers.
    expect(changedPatterns([a], [a, { id: 'w', criteria: { windowIds: [3] } }])).toBeNull();
    // Tile slots claim whatever pattern the game writes there.
    expect(changedPatterns([a], [{ ...a, criteria: { hashes: [1], tileSlots: [5] } }])).toBeNull();
    // Two groups with one id cannot be told apart.
    expect(changedPatterns([a], [a, { ...b, id: 'a' }])).toBeNull();
  });
});

describe('framePatterns', () => {
  it('lists the left eye’s patterns, not blank ones or the right eye’s', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0xff], 1 * 16);
    patternTable.set([0x0f], 2 * 16);
    const hash = (t) => hashTile(patternTable.subarray(t * 16, t * 16 + 16)) >>> 0;
    const state = {
      patternTable,
      drawList: [
        { tileIndex: 0, x: 0, y: 0, eye: 0, layer: 0, world: 1 },
        { tileIndex: 1, x: 8, y: 0, eye: 0, layer: 0, world: 1 },
        { tileIndex: 1, x: 16, y: 0, eye: 0, layer: 0, world: 1 },
        { tileIndex: 2, x: 8, y: 0, eye: 1, layer: 0, world: 1 },
      ],
    };
    expect(framePatterns(state)).toEqual(new Set([hash(1)]));
  });
});

describe('frameTouched', () => {
  it('is true when the frame shows a changed pattern, or what it shows is not known', () => {
    expect(frameTouched(new Set([1, 2]), new Set([2]))).toBe(true);
    expect(frameTouched(new Set([1, 2]), new Set([3]))).toBe(false);
    expect(frameTouched(null, new Set([3]))).toBe(true);
  });
});
