import { describe, it, expect } from 'vitest';
import { isStarterShade, isStarterColour, convertOldStarterShades, keptStarterColour, STARTER_SHADES } from './starter-paint.js';
import { decodeGroupTileColors, encodeGroupTileColors } from './group-tile-colors.js';

const px = (r, g, b, a = 255) => new Uint8Array([r, g, b, a]);

describe('isStarterShade', () => {
  it('recognises either tool’s starter shade for the pixel’s own value', () => {
    expect(isStarterShade(px(80, 80, 81), 0, 1)).toBe(true); // SpriteStudio grey, value 1
    expect(isStarterShade(px(255, 0, 1), 0, 3)).toBe(true); // Project tool red, value 3
  });

  it('recognises another value’s starter shade too (paint seeded through an inverted palette)', () => {
    expect(isStarterShade(px(240, 240, 241), 0, 1)).toBe(true);
    expect(isStarterShade(px(80, 80, 81), 0, 3)).toBe(true);
  });

  it('is false for a chosen colour or a see-through pixel', () => {
    expect(isStarterShade(px(255, 255, 255), 0, 1)).toBe(false);
    expect(isStarterShade(px(80, 80, 81, 0), 0, 1)).toBe(false);
    expect(isStarterShade(px(80, 80, 81), 0, 0)).toBe(false);
  });
});

describe('isStarterColour', () => {
  it('knows every tool’s starter shades and nothing else', () => {
    expect(isStarterColour(80, 80, 81)).toBe(true);
    expect(isStarterColour(240, 240, 241)).toBe(true);
    expect(isStarterColour(255, 0, 1)).toBe(true); // Project tool red
    expect(isStarterColour(255, 255, 255)).toBe(false);
    expect(isStarterColour(0, 0, 0)).toBe(false);
  });

  it('pure red, and the plain greys, are colours someone picks — not starter shades', () => {
    expect(isStarterColour(255, 0, 0)).toBe(false);
    expect(isStarterColour(160, 0, 0)).toBe(false);
    expect(isStarterColour(80, 80, 80)).toBe(false);
    expect(isStarterColour(240, 240, 240)).toBe(false);
  });
});

describe('convertOldStarterShades', () => {
  /** A tile: pixel 0 an old red starter, pixel 1 an old grey starter, pixel 2 a chosen blue, pixel 3 see-through red. */
  const oldTile = () => {
    const t = new Uint8Array(256);
    t.set([255, 0, 0, 255], 0);
    t.set([80, 80, 80, 255], 4);
    t.set([0, 0, 255, 255], 8);
    t.set([255, 0, 0, 0], 12);
    return t;
  };

  it('moves old starter shades to the new ones, in shared paint and in groups', () => {
    const pack = new Map([[1, oldTile()]]);
    const group = { id: 'g', tileColors: encodeGroupTileColors(new Map([[2, oldTile()]])) };
    const out = convertOldStarterShades(pack, [group], decodeGroupTileColors);
    expect(out.pixels).toBe(4);
    for (const t of [out.pack.get(1), decodeGroupTileColors(out.groups[0]).get(2)]) {
      expect([...t.slice(0, 4)]).toEqual([...STARTER_SHADES[1][3], 255]);
      expect([...t.slice(4, 8)]).toEqual([...STARTER_SHADES[0][1], 255]);
      expect([...t.slice(8, 12)]).toEqual([0, 0, 255, 255]);
      expect([...t.slice(12, 16)]).toEqual([255, 0, 0, 0]);
    }
    expect([...pack.get(1).slice(0, 4)]).toEqual([255, 0, 0, 255]); // the original is untouched
  });

  it('returns the same objects when there is nothing to move', () => {
    const t = new Uint8Array(256);
    t.set([255, 0, 1, 255], 0);
    const pack = new Map([[1, t]]);
    const groups = [{ id: 'g' }];
    const out = convertOldStarterShades(pack, groups, decodeGroupTileColors);
    expect(out.pixels).toBe(0);
    expect(out.pack).toBe(pack);
    expect(out.groups).toBe(groups);
  });
});

describe('keptStarterColour', () => {
  it('turns every starter shade into a look-alike that is neither a starter nor an old starter', () => {
    for (const ramp of STARTER_SHADES) {
      for (const shade of ramp.filter(Boolean)) {
        const kept = keptStarterColour(...shade);
        expect(isStarterColour(...kept)).toBe(false);
        expect(kept.slice(0, 2)).toEqual(shade.slice(0, 2));
        expect(Math.abs(kept[2] - shade[2])).toBe(1);
        // Not an old (pre-Oct 9) starter either, which opening a pack would convert back.
        const t = new Uint8Array(256);
        t.set([...kept, 255], 0);
        expect(convertOldStarterShades(new Map([[1, t]]), [], decodeGroupTileColors).pixels).toBe(0);
      }
    }
  });

  it('leaves a chosen colour alone', () => {
    expect(keptStarterColour(0, 255, 4)).toEqual([0, 255, 4]);
  });
});
