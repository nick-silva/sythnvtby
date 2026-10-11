import { describe, it, expect } from 'vitest';
import { findRepeatSet } from './pattern-set.js';

/**
 * Tiles from rows of pattern letters, one letter per 8 px cell; '.' is an empty cell.
 * `anchor` is the [col, row] offsets are measured from.
 */
function grid(rows, anchor = [0, 0]) {
  const tiles = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      tiles.push({ hash: ch.charCodeAt(0), dx: (c - anchor[0]) * 8, dy: (r - anchor[1]) * 8 });
    });
  });
  return tiles;
}

const letters = (tiles, set) => set.indices.map((i) => String.fromCharCode(tiles[i].hash)).join('');

describe('findRepeatSet', () => {
  it('finds one copy of a pattern repeated along a strip (CloudLayer20: 3 patterns x 16)', () => {
    const tiles = grid(['ABCABCABCABC']);
    const set = findRepeatSet(tiles);
    expect(set).toMatchObject({ periodX: 24, periodY: null, x0: 0, x1: 24 });
    expect(letters(tiles, set)).toBe('ABC');
  });

  it('starts the set at the anchor tile', () => {
    const tiles = grid(['ABCABCABC'], [1, 0]);
    const set = findRepeatSet(tiles);
    expect(letters(tiles, set)).toBe('BCA');
    expect(set.x0).toBe(0);
  });

  it('keeps the set inside the region when the anchor is near its far edge', () => {
    const tiles = grid(['ABCABCABC'], [8, 0]);
    const set = findRepeatSet(tiles);
    expect(set.indices).toHaveLength(3);
    expect(set.x1).toBeLessThanOrEqual(8);
  });

  it('reduces a single repeated pattern to one tile', () => {
    const tiles = grid(['AAAAAA']);
    expect(findRepeatSet(tiles).indices).toHaveLength(1);
  });

  it('finds a block that repeats across and down (CloudLayer26-like)', () => {
    const tiles = grid(['ABABAB', 'CDCDCD', 'ABABAB', 'CDCDCD']);
    const set = findRepeatSet(tiles);
    expect(set).toMatchObject({ periodX: 16, periodY: 16 });
    expect(letters(tiles, set)).toBe('ABCD');
  });

  it('repeats across only when the rows below differ', () => {
    const tiles = grid(['ABABAB', 'CDCDCD', 'EFEFEF']);
    const set = findRepeatSet(tiles);
    expect(set).toMatchObject({ periodX: 16, periodY: null });
    expect(letters(tiles, set)).toBe('ABCDEF');
  });

  it('finds nothing in a pattern that does not repeat', () => {
    expect(findRepeatSet(grid(['ABCD', 'EFGH']))).toBeNull();
  });

  it('is not fooled by one coincidental match', () => {
    // A lines up with A at 16 px, but B does not line up with C.
    expect(findRepeatSet(grid(['ABAC']))).toBeNull();
  });

  it('needs room for two whole periods: a framed panel with matching borders does not repeat', () => {
    // LaikutoScore: the left and right border columns are the same tiles, 80 px apart, in an
    // 88 px wide board. One partner column is not a repeat.
    expect(findRepeatSet(grid(['XABCDEFGHIX', 'YJKLMNOPQRY', 'ZSTUVWabcdZ']))).toBeNull();
  });

  it('ignores holes rather than treating them as a mismatch', () => {
    const tiles = grid(['ABC.BCABC']);
    expect(findRepeatSet(tiles)).toMatchObject({ periodX: 24 });
  });

  it('has nothing to reduce for a single tile', () => {
    expect(findRepeatSet(grid(['A']))).toBeNull();
  });
});
