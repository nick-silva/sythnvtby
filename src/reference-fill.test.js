import { describe, it, expect } from 'vitest';
import {
  referenceColorAt,
  screenPixelForPatternPixel,
  fillTilesFromReference,
  paletteFromTiles,
  transformForGhostBoxes,
  placementsInRect,
  referencePixelsForPlacements,
} from './reference-fill.js';

/** A reference image where every pixel encodes its own position, so sampling is checkable. */
function positionRef(width, height, transform, paint = (x, y) => [x, y, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { data, width, height, transform };
}

/** All 64 pixels lit (shade 2), so nothing is skipped as transparent. */
const SOLID = { shades: new Uint8Array(64).fill(2) };
const solidPattern = () => SOLID;

describe('referenceColorAt', () => {
  it('reads 1:1 when the reference sits on the frame unscaled', () => {
    const ref = positionRef(8, 8, { scale: 1, dx: 0, dy: 0 });
    expect(referenceColorAt(ref, 3, 5)).toEqual([3, 5, 0]);
  });

  it('honours the offset and scale the Project tool stored', () => {
    // Twice as big, shifted: frame (10, 6) → image ((10-4)/2, (6-2)/2) = (3, 2)
    const ref = positionRef(8, 8, { scale: 2, dx: 4, dy: 2 });
    expect(referenceColorAt(ref, 10, 6)).toEqual([3, 2, 0]);
  });

  it('takes the median of the block a frame pixel covers when the reference is bigger', () => {
    // Quarter scale: each frame pixel covers 4x4 image pixels; a stray pixel must not win.
    const ref = positionRef(16, 16, { scale: 0.25, dx: 0, dy: 0 }, (x, y) => (x === 0 && y === 0 ? [255, 255, 255, 255] : [10, 20, 30, 255]));
    expect(referenceColorAt(ref, 0, 0)).toEqual([10, 20, 30]);
  });

  it('returns null outside the image, and ignores fully clear pixels', () => {
    const ref = positionRef(4, 4, { scale: 1, dx: 2, dy: 2 });
    expect(referenceColorAt(ref, 0, 0)).toBeNull(); // left of the image
    expect(referenceColorAt(ref, 99, 99)).toBeNull();
    const clear = positionRef(4, 4, { scale: 1, dx: 0, dy: 0 }, () => [9, 9, 9, 0]);
    expect(referenceColorAt(clear, 1, 1)).toBeNull();
    expect(referenceColorAt(positionRef(4, 4, { scale: 0, dx: 0, dy: 0 }), 1, 1)).toBeNull();
  });
});

describe('screenPixelForPatternPixel', () => {
  it('undoes a flip so a mirrored draw samples the art it mirrors', () => {
    expect(screenPixelForPatternPixel({ x: 10, y: 20 }, 0, 0)).toEqual({ fx: 10, fy: 20 });
    expect(screenPixelForPatternPixel({ x: 10, y: 20, flipH: true }, 0, 0)).toEqual({ fx: 17, fy: 20 });
    expect(screenPixelForPatternPixel({ x: 10, y: 20, flipV: true }, 0, 3)).toEqual({ fx: 10, fy: 24 });
  });
});

describe('fillTilesFromReference', () => {
  const ref = positionRef(64, 64, { scale: 1, dx: 0, dy: 0 }, (x, y) => [x * 4, y * 4, 0, 255]);

  it('fills one tile from the colours under it', () => {
    const out = fillTilesFromReference(ref, [{ hash: 1, x: 8, y: 16 }], solidPattern);
    expect(out.patterns).toBe(1);
    expect(out.skipped).toBe(0);
    const tile = out.tiles.get(1);
    expect([...tile.slice(0, 4)]).toEqual([32, 64, 0, 255]); // pattern (0,0) → frame (8,16)
    const last = 63 * 4;
    expect([...tile.slice(last, last + 4)]).toEqual([60, 92, 0, 255]); // pattern (7,7) → (15,23)
  });

  it('leaves shade-0 pixels clear so VB black stays black', () => {
    const half = { shades: new Uint8Array(64).map((_, i) => (i % 2 ? 2 : 0)) };
    const out = fillTilesFromReference(ref, [{ hash: 7, x: 0, y: 0 }], () => half);
    const tile = out.tiles.get(7);
    expect(tile[3]).toBe(0);
    expect(tile[7]).toBe(255);
  });

  it('agrees copies of one pattern and flags the ones that disagree', () => {
    // Two copies sitting on very different colours → conflict; two on the same → not.
    const split = positionRef(64, 64, { scale: 1, dx: 0, dy: 0 }, (x) => (x < 32 ? [10, 10, 10, 255] : [240, 240, 240, 255]));
    const far = fillTilesFromReference(split, [{ hash: 3, x: 0, y: 0 }, { hash: 3, x: 40, y: 0 }], solidPattern);
    expect(far.patterns).toBe(1);
    expect(far.conflicts).toEqual([3]);
    const near = fillTilesFromReference(split, [{ hash: 3, x: 0, y: 0 }, { hash: 3, x: 8, y: 0 }], solidPattern);
    expect(near.conflicts).toEqual([]);
    expect([...near.tiles.get(3).slice(0, 3)]).toEqual([10, 10, 10]);
  });

  it('counts placements, and skips patterns the reference does not cover', () => {
    const small = positionRef(8, 8, { scale: 1, dx: 0, dy: 0 });
    const out = fillTilesFromReference(small, [{ hash: 1, x: 0, y: 0 }, { hash: 2, x: 300, y: 200 }], solidPattern);
    expect(out.placements).toBe(2);
    expect(out.patterns).toBe(1);
    expect(out.skipped).toBe(1);
    expect(out.tiles.has(2)).toBe(false);
  });

  it('skips a pattern with no shades rather than painting nothing over it', () => {
    const out = fillTilesFromReference(ref, [{ hash: 5, x: 0, y: 0 }], () => null);
    expect(out.patterns).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('samples a flipped copy from the art it mirrors', () => {
    const out = fillTilesFromReference(ref, [{ hash: 9, x: 0, y: 0, flipH: true }], solidPattern);
    // Pattern pixel (0,0) of a flipped draw shows at screen x = 7.
    expect([...out.tiles.get(9).slice(0, 3)]).toEqual([28, 0, 0]);
  });
});

describe('transformForGhostBoxes', () => {
  const base = { scale: 2, dx: 10, dy: 4 };

  it('is a no-op when the two boxes sit on top of each other', () => {
    const box = { x: 20, y: 12, w: 40, h: 24 };
    const t = transformForGhostBoxes(base, box, box);
    expect(t.scale).toBeCloseTo(base.scale, 6);
    expect(t.dx).toBeCloseTo(base.dx, 6);
    expect(t.dy).toBeCloseTo(base.dy, 6);
  });

  it('shifts by the nudge when the reference box is moved', () => {
    const stageRect = { x: 20, y: 12, w: 40, h: 24 };
    const refRect = { x: 26, y: 15, w: 40, h: 24 }; // aimed 6,3 further into the reference
    const t = transformForGhostBoxes(base, refRect, stageRect);
    expect(t.scale).toBeCloseTo(base.scale, 6);
    expect(t.dx).toBeCloseTo(base.dx - 6, 6);
    expect(t.dy).toBeCloseTo(base.dy - 3, 6);
  });

  it('scales when the boxes are different sizes, and lands the corner where asked', () => {
    const stageRect = { x: 0, y: 0, w: 80, h: 48 };
    const refRect = { x: 20, y: 12, w: 40, h: 24 };
    const t = transformForGhostBoxes(base, refRect, stageRect);
    expect(t.scale).toBeCloseTo(4, 6); // twice as big
    // The reference content at refRect's corner must land on stageRect's corner.
    const imageX = (refRect.x - base.dx) / base.scale;
    expect(t.scale * imageX + t.dx).toBeCloseTo(stageRect.x, 6);
    const imageY = (refRect.y - base.dy) / base.scale;
    expect(t.scale * imageY + t.dy).toBeCloseTo(stageRect.y, 6);
  });

  it('returns the placement unchanged for nonsense boxes', () => {
    expect(transformForGhostBoxes(base, { x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 4, h: 4 })).toEqual(base);
  });
});

describe('placementsInRect', () => {
  const tiles = [
    { hash: 1, x: 0, y: 0 },
    { hash: 2, x: 16, y: 16 },
    { hash: 3, x: 80, y: 80 },
  ];

  it('keeps the tiles a box touches, including partial overlap', () => {
    expect(placementsInRect(tiles, { x: 0, y: 0, w: 20, h: 20 }).map((p) => p.hash)).toEqual([1, 2]);
    expect(placementsInRect(tiles, { x: 12, y: 12, w: 2, h: 2 }).map((p) => p.hash)).toEqual([]);
    expect(placementsInRect(tiles, { x: 15, y: 15, w: 2, h: 2 }).map((p) => p.hash)).toEqual([2]);
  });

  it('passes everything through without a box', () => {
    expect(placementsInRect(tiles, null)).toHaveLength(3);
  });
});

describe('paletteFromTiles', () => {
  it('lists the colours used, most common first, ignoring clear pixels', () => {
    const tile = new Uint8ClampedArray(256);
    for (let i = 0; i < 64; i++) {
      const c = i < 40 ? [0, 128, 255] : i < 60 ? [255, 0, 0] : [0, 0, 0];
      tile.set([...c, i < 60 ? 255 : 0], i * 4);
    }
    expect(paletteFromTiles(new Map([[1, tile]]))).toEqual(['#0080ff', '#ff0000']);
    expect(paletteFromTiles(new Map([[1, tile]]), 1)).toEqual(['#0080ff']);
  });
});

describe('referencePixelsForPlacements', () => {
  // Positional paint keeps each copy's own colours, where per-pattern paint has to reduce the
  // copies to one tile. Routing the reference fill through the per-pattern path on an anchored
  // group is what used to split one group's paint across two stores.
  const ref = () => positionRef(64, 64, { scale: 1, dx: 0, dy: 0 }, (x, y) => [x * 4, y * 4, 0, 255]);

  it('gives two copies of one pattern the colours actually over each of them', () => {
    const out = referencePixelsForPlacements(
      ref(),
      [{ hash: 1, x: 0, y: 0 }, { hash: 1, x: 8, y: 0 }],
      solidPattern,
    );
    expect(out.tiles).toBe(2);
    expect(out.pixels).toHaveLength(128);
    const at = (x, y) => out.pixels.find((p) => p.x === x && p.y === y)?.color;
    expect(at(0, 0)).toEqual([0, 0, 0]);
    expect(at(8, 0)).toEqual([32, 0, 0]);
  });

  it('skips a pattern’s transparent pixels', () => {
    const half = { shades: new Uint8Array(64).map((_, i) => (i % 2 ? 2 : 0)) };
    const out = referencePixelsForPlacements(ref(), [{ hash: 1, x: 0, y: 0 }], () => half);
    expect(out.pixels).toHaveLength(32);
  });

  it('undoes a flip, so a mirrored copy samples the right side', () => {
    const plain = referencePixelsForPlacements(ref(), [{ hash: 1, x: 0, y: 0 }], solidPattern);
    const flipped = referencePixelsForPlacements(ref(), [{ hash: 1, x: 0, y: 0, flipH: true }], solidPattern);
    // Same screen pixels are covered either way; only which pattern pixel maps there changes.
    const keys = (o) => o.pixels.map((p) => `${p.x},${p.y}`).sort();
    expect(keys(flipped)).toEqual(keys(plain));
  });

  it('counts a tile the reference does not reach as skipped, not painted', () => {
    const out = referencePixelsForPlacements(ref(), [{ hash: 1, x: 300, y: 200 }], solidPattern);
    expect(out).toMatchObject({ tiles: 0, skipped: 1 });
    expect(out.pixels).toEqual([]);
  });

  it('skips a placement whose pattern is unknown', () => {
    const out = referencePixelsForPlacements(ref(), [{ hash: 9, x: 0, y: 0 }], () => null);
    expect(out).toMatchObject({ tiles: 0, skipped: 1 });
  });
});
