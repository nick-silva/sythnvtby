import { describe, it, expect } from 'vitest';
import { affineBaseDraws, affineBaseState } from './affine-base.js';
import { compositeColorFrame } from './color-layer.js';
import { getTileBytes, hashTile } from './vip-state.js';

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

/**
 * World 31 affine on the left eye (world 30 END), zoomed 2×. Map row 0 holds character 1 then
 * character 2 (palette 1, flipped across), the rest character 0 (blank). Character 1 is all value
 * 1, character 2 all value 3.
 */
function affineFrame() {
  const PARAM_H = 0x8000;
  const windows = new Uint8Array(1024);
  wr16(windows, 31 * 32, 0x8000 | (2 << 12) | 1);
  wr16(windows, 31 * 32 + 14, 383);
  wr16(windows, 31 * 32 + 16, 223);
  wr16(windows, 31 * 32 + 18, PARAM_H);
  wr16(windows, 30 * 32, 0x40);
  const segments = Array.from({ length: 16 }, () => new Uint8Array(0x2000));
  wr16(segments[1], 0, 1);
  wr16(segments[1], 2, 2 | 0x2000 | (1 << 14));
  for (let y = 0; y < 224; y++) {
    const p = (PARAM_H + 8 * y - 0x8000) * 2;
    wr16(segments[8], p + 4, y * 4);
    wr16(segments[8], p + 6, 256);
  }
  const patternTable = new Uint8Array(2048 * 16);
  for (let r = 0; r < 8; r++) {
    wr16(patternTable, 16 + r * 2, 0x5555);
    wr16(patternTable, 32 + r * 2, 0xffff);
  }
  return { windows, segments, patternTable, drawList: [], gplt: [0xe4, 0xe4, 0xe4, 0xe4], masterBrightness: 0.4, brightnessReference: 0.4 };
}

const hashOf = (st, ch) => hashTile(getTileBytes(st.patternTable, ch)) >>> 0;

describe('affineBaseDraws', () => {
  it('lays the wanted map cells out unscaled, side by side as in the map, centred', () => {
    const st = affineFrame();
    const draws = affineBaseDraws(st, 0, [31], new Set([hashOf(st, 1), hashOf(st, 2)]));
    expect(draws.map((d) => d.tileIndex)).toEqual([1, 2]);
    expect(draws[1].x - draws[0].x).toBe(8); // one map cell apart, though on screen they are 16 px apart
    expect(draws[0].y).toBe(draws[1].y);
    expect(draws[0].x).toBe(184); // two cells centred in 48
    expect(draws[1]).toMatchObject({ flipH: true, paletteSelector: 1, world: 31, layer: 0, eye: 0 });
  });

  it('keeps only the wanted patterns, and nothing from worlds the frame does not show', () => {
    const st = affineFrame();
    expect(affineBaseDraws(st, 0, [31], new Set([hashOf(st, 2)])).map((d) => d.tileIndex)).toEqual([2]);
    expect(affineBaseDraws(st, 0, [5], new Set([hashOf(st, 2)]))).toEqual([]);
    expect(affineBaseDraws(st, 1, [31], new Set([hashOf(st, 2)]))).toEqual([]); // left eye only
  });
});

describe('affineBaseState', () => {
  it('renders the base tiles as plain backgrounds at full size', () => {
    const st = affineFrame();
    const draws = affineBaseDraws(st, 0, [31], new Set([hashOf(st, 1)]));
    const base = affineBaseState(st, draws);
    expect(base.drawList).toHaveLength(2); // both eyes
    const img = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(base, new Map(), img, { eye: 0, overrides: [], groups: [], brightnessScale: 1.34, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 1, diagnosticMonoFallback: false, renderUnpackedFallback: true });
    const lit = (x, y) => img.data[(y * 384 + x) * 4 + 3] > 0;
    const { x, y } = draws[0];
    expect(lit(x, y) && lit(x + 7, y + 7)).toBe(true);
    expect(lit(x + 8, y) || lit(x, y + 8)).toBe(false); // one 8×8 tile, not zoomed
  });
});
