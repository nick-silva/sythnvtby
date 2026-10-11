import { describe, it, expect } from 'vitest';
import { packPaintsTransparent, withPaintOnTransparent, withoutTransparentPaint, patternBytesFromFrames } from './transparent-paint.js';
import { hashTile } from './vip-state.js';

// Row 0: pixel 0 is value 1, pixel 1 is transparent; every other pixel transparent.
const bytes = new Uint8Array(16);
bytes[0] = 0b01;
const solid = (a) => {
  const rgba = new Uint8Array(256);
  for (let i = 0; i < 64; i++) rgba.set([10, 20, 30, a], i * 4);
  return rgba;
};

describe('the pack flag', () => {
  it('is off unless set, and setting it copies the manifest', () => {
    const m = { gameId: 'x' };
    expect(packPaintsTransparent(m)).toBe(false);
    const flagged = withPaintOnTransparent(m);
    expect(packPaintsTransparent(flagged)).toBe(true);
    expect(flagged.gameId).toBe('x');
    expect(m.paintOnTransparent).toBeUndefined();
  });
});

describe('withoutTransparentPaint', () => {
  it('clears the alpha of transparent pixels only, as copies', () => {
    const rgba = solid(255);
    const r = withoutTransparentPaint(new Map([[7, rgba]]), () => bytes);
    const out = r.entries.get(7);
    expect(out[3]).toBe(255); // pixel 0 is lit: kept
    expect(out[7]).toBe(0); // pixel 1 is transparent: cleared
    expect(r.pixels).toBe(63);
    expect(r.tiles).toBe(1);
    expect(rgba[7]).toBe(255); // the original is untouched
  });

  it('leaves tiles alone when their pattern is unknown, and counts them', () => {
    const rgba = solid(255);
    const r = withoutTransparentPaint(new Map([[7, rgba]]), () => null);
    expect(r.entries.get(7)).toBe(rgba);
    expect(r.unknown).toBe(1);
    expect(r.pixels).toBe(0);
  });
});

describe('patternBytesFromFrames', () => {
  it('finds a pattern in any character slot of any frame', () => {
    const pt = new Uint8Array(2048 * 16);
    pt.set(bytes, 1000 * 16);
    const find = patternBytesFromFrames(2, (i) => (i === 1 ? { patternTable: pt } : null), [hashTile(bytes)]);
    expect(Array.from(find(hashTile(bytes)))).toEqual(Array.from(bytes));
    expect(find(12345)).toBeNull();
  });
});
