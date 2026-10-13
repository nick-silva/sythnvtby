import { describe, expect, it } from 'vitest';
import { ORIGINAL_GREYS, originalShade, paintOriginal } from './original-view.js';

describe('originalShade', () => {
  it('keeps the raw value without a palette', () => {
    expect(originalShade(2, { layer: 0, paletteSelector: 1 }, null)).toBe(2);
  });

  it('maps a background pixel through its palette', () => {
    // Palette 1 swaps values 1 and 3: 0b01_10_11_00 → value 1 → 3, 2 → 2, 3 → 1.
    const gplt = [0xe4, 0b01101100, 0xe4, 0xe4];
    expect(originalShade(1, { layer: 0, paletteSelector: 1 }, gplt)).toBe(3);
    expect(originalShade(3, { layer: 0, paletteSelector: 1 }, gplt)).toBe(1);
  });

  it('leaves sprites (layer 2) on the raw value', () => {
    const gplt = [0b01101100, 0b01101100, 0b01101100, 0b01101100];
    expect(originalShade(1, { layer: 2, paletteSelector: 0 }, gplt)).toBe(1);
  });
});

describe('paintOriginal', () => {
  it('paints lit pose pixels grey and leaves the rest transparent', () => {
    const width = 4;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4).fill(9);
    const values = { '1,1': 3, '2,1': 1, '1,2': 0 };
    const lit = paintOriginal({
      data,
      width,
      height,
      bounds: { x0: 0, y0: 0, x1: 4, y1: 3 },
      lookup: (x, y) => (`${x},${y}` in values ? { value: values[`${x},${y}`], draw: { layer: 2 } } : null),
    });
    expect(lit).toBe(2);
    const at = (x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
    expect(at(1, 1)).toEqual([...ORIGINAL_GREYS[3], 255]);
    expect(at(2, 1)).toEqual([...ORIGINAL_GREYS[1], 255]);
    expect(at(1, 2)).toEqual([0, 0, 0, 0]);
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('stays inside the frame when the bounds run past it', () => {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    const lit = paintOriginal({ data, width: 2, height: 2, bounds: { x0: -5, y0: -5, x1: 9, y1: 9 }, lookup: () => ({ value: 2 }) });
    expect(lit).toBe(4);
  });
});
