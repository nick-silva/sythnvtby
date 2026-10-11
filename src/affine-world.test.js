import { describe, it, expect } from 'vitest';
import { affineWorlds, sampleAffineWorld, coreAffineRecords, affinePixelMap, affineStandInDraws } from './affine-world.js';
import { compositeColorFrame } from './color-layer.js';
import { hashTile } from './vip-state.js';

const W = 384;
const PARAM_H = 0x8000; // parameter table: halfword index into display RAM (segment 8)

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

/**
 * World 31 (drawn first; world 30 is END): affine, left eye, map in segment 1, the whole screen. Map cell (0,0) is character 1,
 * every other cell character 0 (blank). Each scanline zooms 2×: DX = 0.5, MY = y / 2.
 * Character 1: texel (0,0) = 3, texel (1,0) = 2, everything else 1.
 */
function affineFrame({ dy = 0 } = {}) {
  const windows = new Uint8Array(1024);
  const b = 31 * 32;
  wr16(windows, b, 0x8000 | (2 << 12) | 1);
  wr16(windows, b + 14, 383);
  wr16(windows, b + 16, 223);
  wr16(windows, b + 18, PARAM_H);
  wr16(windows, 30 * 32, 0x40); // world 30: END
  const segments = Array.from({ length: 16 }, () => new Uint8Array(0x2000));
  wr16(segments[1], 0, 1); // map cell (0,0) → character 1
  for (let y = 0; y < 224; y++) {
    const p = (PARAM_H + 8 * y - 0x8000) * 2;
    wr16(segments[8], p + 4, y * 4); // MY: y / 2 in 13.3 fixed point
    wr16(segments[8], p + 6, 256); // DX: 0.5 in 7.9
    wr16(segments[8], p + 8, dy); // DY
  }
  const patternTable = new Uint8Array(2048 * 16);
  wr16(patternTable, 16, (0x5555 & ~0xf) | 0b1011); // row 0: texel 0 = 3, texel 1 = 2, rest 1
  for (let r = 1; r < 8; r++) wr16(patternTable, 16 + r * 2, 0x5555);
  return { windows, segments, patternTable };
}

describe('sampleAffineWorld', () => {
  it('finds the affine worlds a frame shows per eye', () => {
    const st = affineFrame();
    expect(affineWorlds(st, 0)).toEqual([31]);
    expect(affineWorlds(st, 1)).toEqual([]); // left eye only
  });

  it('zooms 2×: each texel covers 2×2 screen pixels', () => {
    const got = new Map();
    sampleAffineWorld(affineFrame(), 31, 0, (x, y, ch, tx, ty, px) => {
      if (x < 4 && y < 4) got.set(`${x},${y}`, `${ch}:${tx},${ty}:${px}`);
    });
    expect(got.get('0,0')).toBe('1:0,0:3');
    expect(got.get('1,1')).toBe('1:0,0:3');
    expect(got.get('2,0')).toBe('1:1,0:2');
    expect(got.get('3,1')).toBe('1:1,0:2');
    expect(got.get('0,2')).toBe('1:0,1:1');
  });

  it('reproduces the core’s draw-list records: one per screen pixel on a top-left texel', () => {
    const recs = coreAffineRecords(affineFrame(), 31, 0).filter((r) => r.tileIndex === 1);
    expect(recs.map((r) => `${r.x},${r.y}`).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('takes the rotation path when DY is set, and the core records none there', () => {
    let rotated = 0;
    sampleAffineWorld(affineFrame({ dy: 16 }), 31, 0, (...a) => { if (a[9]) rotated++; });
    expect(rotated).toBeGreaterThan(0);
    expect(coreAffineRecords(affineFrame({ dy: 16 }), 31, 0)).toEqual([]);
  });
});

describe('affinePixelMap', () => {
  it('says which tile and texel each screen pixel reads, per affine world', () => {
    const st = affineFrame();
    const map = affinePixelMap(st, 0);
    expect([...map.keys()]).toEqual([31]);
    const px = map.get(31);
    const at = (x, y) => [px.char[y * W + x], px.tx[y * W + x], px.ty[y * W + x], px.lit[y * W + x]];
    expect(at(3, 1)).toEqual([1, 1, 0, 1]); // texel (1,0) of character 1, doubled
    expect(at(20, 0)).toEqual([0, 2, 0, 0]); // the blank character next to it
    expect(affinePixelMap(st, 0)).toBe(map); // cached per frame and eye
    expect(affinePixelMap(st, 1).size).toBe(0);
  });
});

describe('affineStandInDraws', () => {
  it('adds a record for each shown affine tile the draw list lacks, and none for recorded ones', () => {
    const st = affineFrame();
    const standIns = affineStandInDraws({ ...st, drawList: [] });
    expect(standIns).toEqual([{ tileIndex: 1, x: 0, y: 0, flipH: false, flipV: false, world: 31, eye: 0, layer: 1, paletteSelector: 0, standIn: true }]);
    const recorded = [{ tileIndex: 1, x: 0, y: 0, eye: 0, layer: 1, world: 31 }];
    expect(affineStandInDraws({ ...st, drawList: recorded })).toEqual([]);
  });
});

describe('compositeColorFrame with an affine world', () => {
  it('paints tile colours scaled like the layer, not as rigid 8×8 draw-list tiles', () => {
    const st = affineFrame();
    // Each texel's red channel says which texel it is: 10 × (x + 1).
    const rgba = new Uint8Array(256);
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) rgba.set([10 * (tx + 1), 0, 0, 255], (ty * 8 + tx) * 4);
    const pack = new Map([[hashTile(st.patternTable.subarray(16, 32)), rgba]]);
    // What the core recorded: a rigid tile at (0,0). Drawn as-is it would put texel 7 at x = 7.
    const drawList = [{ tileIndex: 1, x: 0, y: 0, eye: 0, layer: 1, world: 31 }];
    const img = { data: new Uint8ClampedArray(W * 224 * 4) };
    compositeColorFrame({ ...st, drawList }, pack, img, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 2, diagnosticMonoFallback: false, renderUnpackedFallback: false });
    const red = (x, y) => img.data[(y * W + x) * 4];
    expect(red(1, 1)).toBe(10); // texel 0, doubled
    expect(red(2, 0)).toBe(20); // texel 1
    expect(red(7, 0)).toBe(40); // texel 3 (x = 7 / 2), not texel 7
    expect(red(15, 0)).toBe(80); // texel 7 lands at x = 14–15
  });
});
