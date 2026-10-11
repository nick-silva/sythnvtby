import { describe, it, expect } from 'vitest';
import { copyPixels, pixelAt, dab, fillArt, replacePixels } from './layer-art-edit.js';
import { layerArtScreenRect } from './layer-art.js';

const px = (w, h, rgba = [0, 0, 0, 255]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
};
const RED = { r: 255, g: 0, b: 0, a: 255 };

describe('layer art editing', () => {
  it('copies without sharing the buffer', () => {
    const a = px(2, 2);
    const b = copyPixels(a);
    b.data[0] = 9;
    expect(a.data[0]).toBe(0);
  });

  it('reads a pixel, or null outside the art', () => {
    const a = px(2, 1, [1, 2, 3, 4]);
    expect(pixelAt(a, 1, 0)).toEqual([1, 2, 3, 4]);
    expect(pixelAt(a, 2, 0)).toBeNull();
  });

  it('dabs a square brush centred on the pixel, clipped to the art, counting what changed', () => {
    const a = px(4, 4);
    expect(dab(a, 0, 0, 3, RED)).toBe(4); // 3×3 around a corner: 2×2 inside
    expect(pixelAt(a, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(a, 2, 2)).toEqual([0, 0, 0, 255]);
    expect(dab(a, 0, 0, 3, RED)).toBe(0); // already that colour
    expect(dab(a, 3, 3, 1, RED)).toBe(1);
  });

  it('fills the touching pixels of the clicked colour', () => {
    const a = px(3, 3);
    a.data.set([9, 9, 9, 255], (1 * 3 + 1) * 4); // a different pixel in the middle
    expect(fillArt(a, 0, 0, RED)).toBe(8);
    expect(pixelAt(a, 1, 1)).toEqual([9, 9, 9, 255]);
    expect(fillArt(a, 2, 2, RED)).toBe(0); // same colour already
  });

  it('replaces every pixel from an imported image of the same size', () => {
    const a = px(2, 2);
    const img = px(2, 2, [5, 6, 7, 255]);
    replacePixels(a, img);
    expect(pixelAt(a, 1, 1)).toEqual([5, 6, 7, 255]);
    expect(() => replacePixels(a, px(3, 2))).toThrow();
  });
});

describe('layerArtScreenRect', () => {
  it('is where the layer’s window sits on screen', () => {
    const win = new Uint8Array(1024);
    const b = 30 * 32;
    const wr = (o, v) => {
      win[b + o] = v & 0xff;
      win[b + o + 1] = (v >> 8) & 0xff;
    };
    wr(0, 0xc005);
    wr(2, 32);
    wr(14, 295);
    wr(16, 159);
    expect(layerArtScreenRect(win, 30, 0)).toEqual({ x0: 32, y0: 0, x1: 328, y1: 160 });
  });
});
