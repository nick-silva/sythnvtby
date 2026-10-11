import { describe, it, expect } from 'vitest';
import { shadeRampFromPaint, rgbaFromShadeRamp } from './shade-ramp.js';

/** Tile bytes from 8 rows of shade digits ('.' = 0), 2 bits per pixel, low bits leftmost. */
function tile(rows) {
  const bytes = new Uint8Array(16);
  rows.forEach((row, y) => {
    let w = 0;
    for (let x = 0; x < 8; x++) w |= ((row[x] === '.' ? 0 : Number(row[x])) & 3) << (x * 2);
    bytes[y * 2] = w & 0xff;
    bytes[y * 2 + 1] = w >> 8;
  });
  return bytes;
}
const BLANK = '........';
/** A painted tile: every pixel of shade s gets colours[s] (null = transparent). */
function painted(bytes, colours) {
  const rgba = new Uint8Array(256);
  for (let y = 0; y < 8; y++) {
    const w = bytes[y * 2] | (bytes[y * 2 + 1] << 8);
    for (let x = 0; x < 8; x++) {
      const c = colours[(w >> (x * 2)) & 3];
      if (!c) continue;
      rgba.set([c[0], c[1], c[2], 255], (y * 8 + x) * 4);
    }
  }
  return rgba;
}
const GREY = [0x8f, 0x8f, 0x8f];
const LIGHT = [0xd9, 0xd9, 0xd9];
const WHITE = [0xff, 0xff, 0xff];

describe('shadeRampFromPaint', () => {
  it('takes the colour painted on each shade', () => {
    const a = tile([BLANK, '..1.....', '.121....', '..3.....', BLANK, BLANK, BLANK, BLANK]);
    const colours = new Map([[1, painted(a, [null, GREY, LIGHT, WHITE])]]);
    expect(shadeRampFromPaint(colours, () => a)).toEqual([null, '#8f8f8f', '#d9d9d9', '#ffffff']);
  });

  it('uses the colour most pixels of a shade were painted, across patterns', () => {
    const a = tile(['111.....', BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK]);
    const b = tile(['1.......', BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK]);
    const colours = new Map([
      [1, painted(a, [null, GREY])],
      [2, painted(b, [null, LIGHT])],
    ]);
    const bytes = new Map([[1, a], [2, b]]);
    expect(shadeRampFromPaint(colours, (h) => bytes.get(h))[1]).toBe('#8f8f8f');
  });

  it('leaves a shade nobody painted empty', () => {
    const a = tile(['1.......', BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK]);
    const ramp = shadeRampFromPaint(new Map([[1, painted(a, [null, GREY])]]), () => a);
    expect(ramp).toEqual([null, '#8f8f8f', null, null]);
  });

  it('skips patterns whose pixels it cannot find', () => {
    expect(shadeRampFromPaint(new Map([[1, new Uint8Array(256)]]), () => null)).toEqual([null, null, null, null]);
  });
});

describe('rgbaFromShadeRamp', () => {
  it('colours a new phase of the tile by its shades', () => {
    // Tile 1136 bright → dim in IntroCin: the star grows and gains a shade-3 centre.
    const dim = tile(['.....1..', '.....2..', '....131.', '...12321', '....131.', '.....2..', '.....1..', BLANK]);
    const rgba = rgbaFromShadeRamp(dim, [null, '#8f8f8f', '#d9d9d9', '#ffffff']);
    const at = (x, y) => [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
    expect(at(5, 0)).toEqual([0x8f, 0x8f, 0x8f, 255]);
    expect(at(5, 1)).toEqual([0xd9, 0xd9, 0xd9, 255]);
    expect(at(5, 3)).toEqual([0xff, 0xff, 0xff, 255]);
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('leaves a shade with no colour transparent, so the mono fallback is not faked', () => {
    const t = tile(['12......', BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK]);
    const rgba = rgbaFromShadeRamp(t, [null, '#8f8f8f', null, null]);
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(0);
  });

  it('gives nothing without a usable ramp', () => {
    const t = tile(['1.......', BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK]);
    expect(rgbaFromShadeRamp(t, null)).toBeNull();
    expect(rgbaFromShadeRamp(t, [null, null, null, null])).toBeNull();
  });
});
