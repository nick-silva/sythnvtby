/**
 * Unit tests for palette pipeline (remap, aspect-fit).
 * Run: npm test
 * See docs/reference/palette-rendering-plan.md.
 */

import { describe, it, expect } from 'vitest';
import { remapFrame, aspectFitRect, PALETTE_PRESETS } from './palette-layer.js';

describe('aspectFitRect', () => {
  it('fits source inside dest, centered', () => {
    const r = aspectFitRect(512, 256, 640, 480);
    expect(r.w).toBe(640);
    expect(r.h).toBe(320);
    expect(r.x).toBe(0);
    expect(r.y).toBe(80);
  });

  it('preserves aspect ratio when height-limited', () => {
    const r = aspectFitRect(100, 100, 200, 50);
    expect(r.w).toBe(50);
    expect(r.h).toBe(50);
    expect(r.x).toBe(75);
    expect(r.y).toBe(0);
  });

  it('handles same size', () => {
    const r = aspectFitRect(320, 240, 320, 240);
    expect(r).toEqual({ x: 0, y: 0, w: 320, h: 240 });
  });
});

describe('remapFrame', () => {
  const green = PALETTE_PRESETS.green;

  function makeImageData(w, h, fillRed) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = typeof fillRed === 'function' ? fillRed(i / 4) : fillRed;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
    return { data, width: w, height: h };
  }

  it('maps red 0 to bucket 0 (black)', () => {
    const src = makeImageData(2, 2, 0);
    const dest = makeImageData(2, 2, 0);
    remapFrame(src, dest, green);
    expect(dest.data[0]).toBe(0);
    expect(dest.data[1]).toBe(0);
    expect(dest.data[2]).toBe(0);
    expect(dest.data[3]).toBe(255);
  });

  it('maps red 85 to bucket 2 (mid green)', () => {
    const src = makeImageData(1, 1, () => 85);
    const dest = makeImageData(1, 1, 0);
    remapFrame(src, dest, green);
    expect(dest.data[0]).toBe(0);
    expect(dest.data[1]).toBe(0xaa);
    expect(dest.data[2]).toBe(0);
  });

  it('maps red 170 and 255 to bucket 3 (bright green)', () => {
    const src = makeImageData(2, 1, (i) => (i === 0 ? 170 : 255));
    const dest = makeImageData(2, 1, 0);
    remapFrame(src, dest, green);
    expect(dest.data[0]).toBe(0);
    expect(dest.data[1]).toBe(0xff);
    expect(dest.data[4]).toBe(0);
    expect(dest.data[5]).toBe(0xff);
  });

  it('does nothing if src and dest length mismatch', () => {
    const src = makeImageData(2, 2, 100);
    const dest = makeImageData(1, 1, 0);
    const before = dest.data.slice();
    remapFrame(src, dest, green);
    expect(dest.data).toEqual(before);
  });
});
