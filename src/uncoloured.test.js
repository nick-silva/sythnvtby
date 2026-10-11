import { describe, it, expect } from 'vitest';
import { measureUncoloured, UNCOLOURED_FILTERS, describeUncoloured, uncolouredMasks, highlightUncoloured, HIGHLIGHT_RGB } from './uncoloured.js';
import { getCompositePixelInfo } from './color-layer.js';
import { hashTile } from './vip-state.js';

/** RGBA paint for one tile: `paintedPixels` (row 0, from the left) opaque red, the rest left clear. */
function paint(paintedPixels) {
  const u = new Uint8Array(256);
  for (let i = 0; i < 64; i++) {
    if (i >= paintedPixels) continue;
    u.set([255, 0, 0, 255], i * 4);
  }
  return u;
}

/** Three tiles, each lighting pixels 0–3 of row 0 at shade 3: painted, unpainted, half painted. */
function frame() {
  const patternTable = new Uint8Array(2048 * 16);
  for (let t = 0; t < 3; t++) patternTable.set([0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, t], t * 16);
  const hash = (t) => hashTile(patternTable.subarray(t * 16, t * 16 + 16)) >>> 0;
  const state = {
    patternTable,
    drawList: [0, 1, 2].map((t) => ({ tileIndex: t, x: 40 + t * 16, y: 40, eye: 0, layer: 0, world: 1 })),
  };
  const pack = new Map([
    [hash(0), paint(64)],
    [hash(2), paint(2)],
  ]);
  return { state, pack };
}

describe('measureUncoloured', () => {
  it('counts tiles with no colour at all, and every lit pixel nothing colours', () => {
    const { state, pack } = frame();
    const m = measureUncoloured(state, { pack });
    // Tiles 1 and 2 also light one pixel on row 7 (the byte that tells their patterns apart).
    // Tile 1: all 5 lit pixels bare, so it counts as a tile; tile 2: 3 of its 5 bare.
    expect(m).toEqual({ tiles: 1, pixels: 8 });
  });

  it('a fully painted frame has nothing uncoloured', () => {
    const { state } = frame();
    const full = new Map(state.drawList.map((d) => [hashTile(state.patternTable.subarray(d.tileIndex * 16, d.tileIndex * 16 + 16)) >>> 0, paint(64)]));
    expect(measureUncoloured(state, { pack: full })).toEqual({ tiles: 0, pixels: 0 });
  });

  it('masks: every uncoloured pixel, and separately those of tiles with no paint at all', () => {
    const { state, pack } = frame();
    measureUncoloured(state, { pack });
    const m = uncolouredMasks(state, getCompositePixelInfo());
    const at = (mask, x, y) => mask[y * 384 + x];
    expect(m.pixels).toBe(8);
    expect(m.tiles).toBe(1);
    expect(m.pixelMask.reduce((a, b) => a + b, 0)).toBe(8);
    expect(m.tileMask.reduce((a, b) => a + b, 0)).toBe(5);
    // Tile 1 (x 56) is unpainted: in both masks. Tile 2 (x 72) is half painted: pixels 2–3 only.
    expect([at(m.tileMask, 56, 40), at(m.pixelMask, 56, 40)]).toEqual([1, 1]);
    expect([at(m.pixelMask, 72, 40), at(m.pixelMask, 74, 40), at(m.tileMask, 74, 40)]).toEqual([0, 1, 0]);
    expect(at(m.pixelMask, 40, 40)).toBe(0);
  });

  it('highlight marks the masked pixels and dims the rest, without touching the mask', () => {
    const img = { data: new Uint8ClampedArray(384 * 224 * 4).fill(200) };
    const mask = new Uint8Array(384 * 224);
    mask[5] = 1;
    expect(highlightUncoloured(img, mask)).toBe(1);
    expect(img.data[5 * 4 + 1]).toBeGreaterThan(200);
    expect(img.data[5 * 4]).toBe(HIGHLIGHT_RGB[0]);
    expect(img.data[0]).toBe(60);
  });

  it('an empty frame measures zero', () => {
    expect(measureUncoloured({ drawList: [], patternTable: new Uint8Array(16) }, {})).toEqual({ tiles: 0, pixels: 0 });
  });
});

describe('filters and notes', () => {
  it('keeps frames by uncoloured tiles or pixels', () => {
    const partly = { tiles: 0, pixels: 5 };
    expect(UNCOLOURED_FILTERS.tiles.keep(partly)).toBe(false);
    expect(UNCOLOURED_FILTERS.pixels.keep(partly)).toBe(true);
    expect(UNCOLOURED_FILTERS.all.keep({ tiles: 0, pixels: 0 })).toBe(true);
    expect(describeUncoloured({ tiles: 2, pixels: 40 })).toBe('2 uncoloured tiles · 40 uncoloured px');
    expect(describeUncoloured({ tiles: 0, pixels: 0 })).toBe('fully coloured');
  });
});
