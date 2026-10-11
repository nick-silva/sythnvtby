import { describe, it, expect, afterEach } from 'vitest';
import { affineTouchUps, paintAffineTouchUp, touchUpKey } from './touch-up.js';
import { setLayerArtPixels, clearLayerArtPixels } from './layer-art.js';
import { compositeColorFrame } from './color-layer.js';
import { getTileBytes, hashTile } from './vip-state.js';

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

/**
 * World 31 affine on the left eye (world 30 END), zoomed 2×. Map row 0 holds character 1 then
 * character 2; the rest is character 0 (blank). So map pixel (mx, my) shows at screen (2mx, 2my).
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
  wr16(segments[1], 2, 2);
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
  return { windows, segments, patternTable, drawList: [{ tileIndex: 1, x: 0, y: 0, eye: 0, layer: 1, world: 31 }] };
}

const st = affineFrame();
const h = (ch) => hashTile(getTileBytes(st.patternTable, ch)) >>> 0;

/** A touch-up made on base tiles: anchored on character 1, arrangement 1 then 2, 8 px apart. */
function group(layout = [{ dx: 0, dy: 0, hash: h(1) }, { dx: 8, dy: 0, hash: h(2) }]) {
  return {
    id: 'opp',
    authoringKind: 'bg',
    criteria: { windowIds: [31], layers: [0], hashes: [h(1), h(2)] },
    touchUp: { anchorHash: h(1), box: { dx: 0, dy: 0, width: 16, height: 8 }, layout, png: '' },
  };
}

/** Left half (over character 1) green, right half see-through. */
function pixels() {
  const data = new Uint8ClampedArray(16 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) data.set([0, 255, 0, 255], (y * 16 + x) * 4);
  return { width: 16, height: 8, data };
}

afterEach(() => clearLayerArtPixels(touchUpKey('opp')));

describe('affineTouchUps', () => {
  it('finds the anchor among the map cells a scaled world reads', () => {
    setLayerArtPixels(touchUpKey('opp'), pixels());
    const found = affineTouchUps(st, [group()], 0);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ world: 31, placements: [{ mx: 0, my: 0 }] });
  });

  it('skips touch-ups whose arrangement is off the 8 px map grid (not made on base tiles)', () => {
    setLayerArtPixels(touchUpKey('opp'), pixels());
    expect(affineTouchUps(st, [group([{ dx: 0, dy: 0, hash: h(1) }, { dx: 5, dy: 0, hash: h(2) }])], 0)).toEqual([]);
  });

  it('draws the picture scaled with the world: one map pixel covers 2×2 screen pixels', () => {
    setLayerArtPixels(touchUpKey('opp'), pixels());
    const [entry] = affineTouchUps(st, [group()], 0);
    const data = new Uint8ClampedArray(384 * 224 * 4);
    const n = paintAffineTouchUp(data, null, st, 0, entry, 1);
    const green = (x, y) => data[(y * 384 + x) * 4 + 1] === 255 && data[(y * 384 + x) * 4 + 3] === 255;
    expect(n).toBe(16 * 16); // 8×8 map pixels, zoomed 2×
    expect(green(0, 0) && green(15, 15)).toBe(true);
    expect(green(16, 0) || green(0, 16)).toBe(false); // character 2's half is see-through; below is outside the box
  });

  it('is drawn by the compositor over the scaled tiles', () => {
    setLayerArtPixels(touchUpKey('opp'), pixels());
    const img = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(st, new Map(), img, { eye: 0, overrides: [], groups: [group()], brightnessScale: 1.34, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 1, diagnosticMonoFallback: false, renderUnpackedFallback: true });
    const at = (x, y) => [...img.data.subarray((y * 384 + x) * 4, (y * 384 + x) * 4 + 4)];
    expect(at(4, 4)).toEqual([0, 255, 0, 255]);
    expect(at(20, 4)).not.toEqual([0, 255, 0, 255]);
  });
});
