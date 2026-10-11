import { describe, it, expect } from 'vitest';
import { floodFill } from './flood-fill.js';

/** keyAt over rows of characters; '.' is not fillable (outside, or transparent in the game). */
function keysOf(rows) {
  return (x, y) => {
    const ch = rows[y]?.[x];
    return ch === undefined || ch === '.' ? null : ch;
  };
}

const asSet = (pixels) => new Set(pixels.map(([x, y]) => `${x},${y}`));

describe('floodFill', () => {
  it('takes the touching pixels of the start colour, in four directions', () => {
    const rows = ['aab', 'aba', 'bba'];
    expect(asSet(floodFill(0, 0, keysOf(rows)))).toEqual(new Set(['0,0', '1,0', '0,1']));
  });

  it('does not leak diagonally', () => {
    const rows = ['ab', 'ba'];
    expect(floodFill(0, 0, keysOf(rows))).toHaveLength(1);
  });

  it('stops at pixels that cannot be filled', () => {
    const rows = ['aa.aa'];
    expect(floodFill(0, 0, keysOf(rows))).toHaveLength(2);
  });

  it('fills nothing when the start pixel cannot be filled', () => {
    expect(floodFill(1, 0, keysOf(['a.a']))).toEqual([]);
  });

  it('visits each pixel once, however it is reached', () => {
    const rows = ['aaaa', 'aaaa', 'aaaa'];
    expect(floodFill(1, 1, keysOf(rows))).toHaveLength(12);
  });

  it('stops at the pixel limit', () => {
    const rows = ['aaaaaaaaaa'];
    expect(floodFill(0, 0, keysOf(rows), { maxPixels: 4 })).toHaveLength(4);
  });
});
