// The right eye of a layer the game draws twice — a left-only world and its right-only twin
// reading another copy of the tiles (src/stereo-twin.js): paint, layer art and touch-ups made on
// the left reach the right eye too.
import { describe, it, expect, beforeEach } from 'vitest';
import { compositeColorFrame, compositeColorFrameForEye, getCompositePixelInfo } from './color-layer.js';
import { activeLayerArts, paintLayerArt, setLayerArtPixels, clearLayerArtPixels } from './layer-art.js';
import { activeTouchUps, touchUpKey } from './touch-up.js';
import { withGroupTileColor } from './group-tile-colors.js';
import { hashTile } from './vip-state.js';

const W = 384;
const H = 224;

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

// Tile 1: every pixel value 3. Tile 2: the right eye's copy — value 3 too, except a top row of 1s.
const PT = (() => {
  const pt = new Uint8Array(2048 * 16);
  pt.fill(0xff, 16, 32);
  pt.fill(0xff, 32, 48);
  pt[32] = 0x55;
  pt[33] = 0x55;
  return pt;
})();
const H1 = hashTile(PT.subarray(16, 32)) >>> 0;

/** World 30 left only, 31 right only (the copy 256 map rows down), END on 29. */
function twinWindows({ gp = 0 } = {}) {
  const win = new Uint8Array(1024);
  for (const [w, hdr, my] of [[30, 0x8005, 0], [31, 0x4005, 256]]) {
    const b = w * 32;
    wr16(win, b, hdr);
    wr16(win, b + 4, gp);
    wr16(win, b + 12, my);
    wr16(win, b + 14, 383);
    wr16(win, b + 16, 223);
  }
  wr16(win, 29 * 32, 0x40);
  return win;
}

const solid = (rgba) => {
  const out = new Uint8Array(256);
  for (let i = 0; i < 64; i++) out.set(rgba, i * 4);
  return out;
};
const RED = [255, 0, 0, 255];
const pick = (img, x, y) => Array.from(img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
const frame = () => ({ data: new Uint8ClampedArray(W * H * 4) });
/** compositeColorFrame as the emulator calls it, with `groups` and an optional left eye to borrow from. */
function composite(state, entries, eye, groups, stereoSource = null) {
  const img = frame();
  compositeColorFrame(state, entries, img, { eye, overrides: [], groups, brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 2, diagnosticMonoFallback: false, renderUnpackedFallback: false, monoFallbackGain: 1, drawTransparentPaint: false, stereoSource });
  return img;
}

beforeEach(() => {
  clearLayerArtPixels('bg');
  clearLayerArtPixels(touchUpKey('bg'));
});

describe('tile paint on a stereo twin', () => {
  it("colours the right eye's copy of a left-only layer with the group's paint for that world", () => {
    const group = withGroupTileColor({ id: 'bg', criteria: { windowIds: [30], layers: [0], hashes: [H1] } }, H1, solid(RED));
    const state = {
      patternTable: PT,
      windows: twinWindows(),
      corePatchLevel: 3,
      drawList: [
        { tileIndex: 1, x: 0, y: 0, world: 30, layer: 0, eye: 0 },
        { tileIndex: 1, x: 0, y: 0, world: 31, layer: 0, eye: 1 },
      ],
    };
    expect(pick(composite(state, new Map(), 0, [group]), 3, 3)).toEqual(RED);
    expect(pick(composite(state, new Map(), 1, [group]), 3, 3)).toEqual(RED);
  });

  it('borrows colour from the left eye for patterns only the right copy uses, matching shade', () => {
    const state = {
      patternTable: PT,
      windows: twinWindows(),
      corePatchLevel: 3,
      drawList: [
        { tileIndex: 1, x: 0, y: 0, world: 30, layer: 0, eye: 0 },
        { tileIndex: 2, x: 0, y: 0, world: 31, layer: 0, eye: 1 },
      ],
    };
    const entries = new Map([[H1, solid(RED)]]);
    const left = composite(state, entries, 0, []);
    const info = getCompositePixelInfo();
    const source = { data: left.data, shade: info.shade.slice(), world: info.world.slice() };
    expect(pick(composite(state, entries, 1, []), 3, 3)[3]).toBe(0); // nothing to borrow from: unpainted
    const right = composite(state, entries, 1, [], source);
    expect(pick(right, 3, 3)).toEqual(RED); // shade 3, like the left's red pixels
    expect(pick(right, 3, 0)[3]).toBe(0); // the top row is shade 1: nothing on the left matches
  });
});

describe('compositeColorFrameForEye', () => {
  it("renders the right eye as a tool shows it: the twin borrows from the left without being handed it", () => {
    const state = {
      patternTable: PT,
      windows: twinWindows(),
      corePatchLevel: 3,
      drawList: [
        { tileIndex: 1, x: 0, y: 0, world: 30, layer: 0, eye: 0 },
        { tileIndex: 2, x: 0, y: 0, world: 31, layer: 0, eye: 1 },
      ],
    };
    const img = frame();
    compositeColorFrameForEye(state, new Map([[H1, solid(RED)]]), img, { eye: 1, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 2, diagnosticMonoFallback: false, renderUnpackedFallback: false, monoFallbackGain: 1, drawTransparentPaint: false });
    expect(pick(img, 3, 3)).toEqual(RED);
    expect(getCompositePixelInfo().art[3 * W + 3]).toBe(2); // marked as coloured from the left eye
  });
});

describe('layer art on a stereo twin', () => {
  const group = {
    id: 'bg',
    criteria: { windowIds: [30], layers: [0], hashes: [H1] },
    layerArt: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 384, height: 224, png: '' },
  };
  const state = {
    patternTable: PT,
    windows: twinWindows(),
    drawList: [
      { tileIndex: 1, x: 0, y: 0, world: 30, layer: 0, eye: 0 },
      { tileIndex: 2, x: 0, y: 0, world: 31, layer: 0, eye: 1 },
    ],
  };

  it("draws the left copy's picture on the right twin, from the left world's map", () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([x & 0xff, y, 0, 255], (y * W + x) * 4);
    setLayerArtPixels('bg', { width: W, height: H, data });
    const arts = activeLayerArts(state, [group], 1);
    expect(arts).toHaveLength(1);
    expect(arts[0]).toMatchObject({ world: 31, ownerIndex: 1, twin: { left: 30, shift: 0 } });
    const img = frame();
    expect(paintLayerArt(img.data, null, state.windows, 1, arts[0], 1)).toBe(W * H);
    // The right world reads map rows 256+, which the picture does not cover; through its twin
    // it shows the picture as the left eye does.
    expect(pick(img, 100, 50)).toEqual([100, 50, 0, 255]);
  });

  it('adds nothing on the left eye, or when the group is not on the left world', () => {
    setLayerArtPixels('bg', { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) });
    expect(activeLayerArts(state, [group], 0).map((a) => a.world)).toEqual([30]);
    const away = { ...state, drawList: state.drawList.filter((d) => d.eye === 1) };
    expect(activeLayerArts(away, [group], 1)).toEqual([]);
  });
});

describe('touch-ups on a stereo twin', () => {
  it('places the right eye from the left placement, moved across by the parallax', () => {
    const group = {
      id: 'bg',
      criteria: { windowIds: [30], layers: [0] },
      touchUp: { anchorHash: H1, box: { dx: 0, dy: 0, width: 8, height: 8 }, layout: [{ dx: 0, dy: 0, hash: H1 }], png: '' },
    };
    setLayerArtPixels(touchUpKey('bg'), { width: 8, height: 8, data: new Uint8ClampedArray(256).fill(255) });
    const state = {
      patternTable: PT,
      windows: twinWindows({ gp: 3 }),
      drawList: [
        { tileIndex: 1, x: 40, y: 40, world: 30, layer: 0, eye: 0 },
        { tileIndex: 2, x: 46, y: 40, world: 31, layer: 0, eye: 1 },
      ],
    };
    const [right] = activeTouchUps(state, [group], 1);
    expect(right.world).toBe(31);
    // GP 3 on both: the right eye sees the layer 6 px right of the left eye.
    expect(right.placements).toEqual([expect.objectContaining({ x: 46, y: 40, world: 31, ownerIndex: 1 })]);
  });
});
