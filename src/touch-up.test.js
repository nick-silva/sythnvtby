import { describe, it, expect, beforeEach } from 'vitest';
import {
  touchUpOf,
  touchUpKey,
  buildTouchUp,
  defaultTouchUpBox,
  touchUpPlacements,
  paintTouchUp,
  screenToTouchUp,
  overlayToTouchUp,
  anchorDrawsFor,
  reboxPixels,
} from './touch-up.js';
import { setLayerArtPixels, clearLayerArtPixels } from './layer-art.js';
import { compositeColorFrame } from './color-layer.js';
import { hashTile } from './vip-state.js';

const W = 384;
const H = 224;

// Tiles 1–4: distinct lit patterns (a pipe corner and its neighbours). Tile 0 is blank.
const PT = (() => {
  const pt = new Uint8Array(2048 * 16);
  for (let t = 1; t <= 4; t++) {
    pt.fill(0xff, t * 16, t * 16 + 16);
    pt[t * 16] = t;
  }
  return pt;
})();
const H_ = (t) => hashTile(PT.subarray(t * 16, t * 16 + 16)) >>> 0;

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}
/** World 14 and world 0 (in front), both normal BG over the whole screen; worlds between off. */
function windows() {
  const win = new Uint8Array(1024);
  for (const w of [14, 0]) {
    wr16(win, w * 32, 0xc000);
    wr16(win, w * 32 + 14, 383);
    wr16(win, w * 32 + 16, 223);
  }
  return win;
}

/** A 2×2 "pipe corner" (tiles 1..4) at x,y in world 14, and a blank tile right of it. */
function pipeAt(x, y, eye = 0) {
  return [
    { tileIndex: 1, x, y, world: 14, layer: 0, eye },
    { tileIndex: 2, x: x + 8, y, world: 14, layer: 0, eye },
    { tileIndex: 3, x, y: y + 8, world: 14, layer: 0, eye },
    { tileIndex: 4, x: x + 8, y: y + 8, world: 14, layer: 0, eye },
    { tileIndex: 0, x: x + 16, y, world: 14, layer: 0, eye },
  ];
}
const group = (extra = {}) => ({
  id: 'pipe',
  anchorHash: H_(1),
  criteria: { windowIds: [14], layers: [0], hashes: [H_(1), H_(2), H_(3), H_(4)] },
  ...extra,
});
const state = (draws) => ({ patternTable: PT, windows: windows(), drawList: draws });
const solid = (w, h, rgba) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
};
const BOX = { dx: -8, dy: -8, width: 32, height: 32 };

beforeEach(() => clearLayerArtPixels(touchUpKey('pipe')));

describe('buildTouchUp / defaultTouchUpBox', () => {
  it('records the arrangement around the anchor and a box around the group’s tiles', () => {
    const st = state(pipeAt(100, 50));
    const anchor = st.drawList[0];
    expect(defaultTouchUpBox(st, group(), 0, anchor, 8)).toEqual(BOX);
    const tu = buildTouchUp(st, group(), 0, anchor, BOX);
    expect(tu.anchorHash).toBe(H_(1));
    expect(tu.layout).toHaveLength(4); // blank tiles are not part of the arrangement
    expect(tu.layout).toContainEqual({ dx: 8, dy: 8, hash: H_(4) });
  });
});

describe('touchUpPlacements', () => {
  const st0 = state(pipeAt(100, 50));
  const tu = buildTouchUp(st0, group(), 0, st0.drawList[0], BOX);

  it('finds every copy of the arrangement, wherever it moved', () => {
    const st = state([...pipeAt(40, 20), ...pipeAt(200, 120)]);
    expect(touchUpPlacements(st, group({ touchUp: tu }), 0).map((p) => [p.x, p.y])).toEqual([[40, 20], [200, 120]]);
  });

  it('skips the anchor tile where the rest of the arrangement differs (another pipe configuration)', () => {
    const lone = [
      { tileIndex: 1, x: 60, y: 60, world: 14, layer: 0, eye: 0 },
      { tileIndex: 3, x: 68, y: 60, world: 14, layer: 0, eye: 0 },
    ];
    expect(touchUpPlacements(state(lone), group({ touchUp: tu }), 0)).toEqual([]);
  });

  it('only looks at the group’s own worlds', () => {
    const elsewhere = pipeAt(40, 20).map((d) => ({ ...d, world: 16 }));
    expect(touchUpPlacements(state(elsewhere), group({ touchUp: tu }), 0)).toEqual([]);
  });
});

describe('paintTouchUp', () => {
  const st0 = state(pipeAt(100, 50));
  const tu = buildTouchUp(st0, group(), 0, st0.drawList[0], BOX);

  it('paints the whole box, transparent and blank pixels included, at each copy', () => {
    const data = new Uint8ClampedArray(W * H * 4);
    const owner = new Int32Array(W * H).fill(-1);
    const st = state(pipeAt(40, 20));
    const placements = touchUpPlacements(st, group({ touchUp: tu }), 0);
    const n = paintTouchUp(data, owner, st.windows, 0, { world: 14, tu, pixels: solid(32, 32, [9, 99, 199, 255]), placements }, 1);
    expect(n).toBe(32 * 32);
    const at = (x, y) => Array.from(data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
    expect(at(32, 12)).toEqual([9, 99, 199]); // box corner, outside any tile
    expect(at(58, 22)).toEqual([9, 99, 199]); // over the blank tile
    expect(at(31, 12)).toEqual([0, 0, 0]);
    expect(owner[22 * W + 45]).toBe(placements[0].ownerIndex);
  });

  it('reaches past the layer’s window: its box is its only limit (full-screen touch-ups)', () => {
    const win = windows();
    wr16(win, 14 * 32 + 14, 49); // world 14 now only 50 px wide
    const st = { ...state(pipeAt(40, 20)), windows: win };
    const placements = touchUpPlacements(st, group({ touchUp: tu }), 0);
    const n = paintTouchUp(new Uint8ClampedArray(W * H * 4), null, win, 0, { world: 14, tu, pixels: solid(32, 32, [1, 2, 3, 255]), placements }, 1);
    expect(n).toBe(32 * 32);
  });
});

describe('screenToTouchUp', () => {
  it('maps a screen pixel to the touch-up pixel under it', () => {
    const st0 = state(pipeAt(100, 50));
    const tu = buildTouchUp(st0, group(), 0, st0.drawList[0], BOX);
    const st = state(pipeAt(40, 20));
    expect(screenToTouchUp(st, group({ touchUp: tu }), 0, 40, 20)).toMatchObject({ tx: 8, ty: 8 });
    expect(screenToTouchUp(st, group({ touchUp: tu }), 0, 5, 5)).toBeNull();
  });
});

describe('overlayToTouchUp', () => {
  it('turns a screen-pinned overlay into a touch-up anchored where it was painted', () => {
    const st = state(pipeAt(100, 50));
    const overlay = new Uint8Array(W * H * 4);
    for (let y = 48; y < 60; y++) for (let x = 96; x < 120; x++) overlay.set([200, 10, 10, 255], (y * W + x) * 4);
    const made = overlayToTouchUp(st, group(), overlay, 0);
    expect(made.touchUp.box).toEqual({ dx: -4, dy: -2, width: 24, height: 12 });
    expect(made.pixels.width).toBe(24);
    expect(Array.from(made.pixels.data.subarray(0, 4))).toEqual([200, 10, 10, 255]);
    expect(made.touchUp.layout.length).toBeGreaterThan(0);
    expect(overlayToTouchUp(state([]), group(), overlay, 0)).toBeNull(); // anchor not on this frame
  });
});

describe('touchUpOf', () => {
  it('validates the stored shape', () => {
    expect(touchUpOf({ touchUp: { anchorHash: 5, box: { dx: 0, dy: 0, width: 8, height: 8 }, layout: [{ dx: 0, dy: 0, hash: 5 }], png: '' } })).not.toBeNull();
    expect(touchUpOf({ touchUp: { anchorHash: 5, box: { dx: 0, dy: 0, width: 0, height: 8 }, layout: [] } })).toBeNull();
    expect(touchUpOf({})).toBeNull();
  });
});

describe('compositeColorFrame with a touch-up', () => {
  it('draws the touch-up over the group’s tiles and under a painted tile in a world in front', () => {
    const st0 = state(pipeAt(100, 50));
    const tu = buildTouchUp(st0, group(), 0, st0.drawList[0], BOX);
    // Paint only a strip right of the corner, x 116–123 and y 50–65 on screen.
    const px = solid(32, 32, [0, 0, 0, 0]);
    for (let y = 8; y < 24; y++) for (let x = 24; x < 32; x++) px.data.set([0, 180, 0, 255], (y * 32 + x) * 4);
    setLayerArtPixels(touchUpKey('pipe'), px);
    // World 0 (in front) draws a painted tile over the top of that strip: x 116–123, y 50–57.
    const draws = [...pipeAt(100, 50), { tileIndex: 2, x: 116, y: 50, world: 0, layer: 0, eye: 0 }];
    const colour = (rgb) => {
      const t = new Uint8Array(256);
      for (let i = 0; i < 64; i++) t.set([...rgb, 255], i * 4);
      return t;
    };
    const pack = new Map([[H_(1), colour([255, 0, 0])], [H_(2), colour([0, 0, 255])]]);
    const img = { data: new Uint8ClampedArray(W * H * 4) };
    compositeColorFrame({ ...state(draws), corePatchLevel: 3 }, pack, img, { eye: 0, overrides: [], groups: [group({ touchUp: tu })], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    const at = (x, y) => Array.from(img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
    expect(at(117, 60)).toEqual([0, 180, 0]); // the touch-up, where nothing else is drawn
    expect(at(101, 51)).toEqual([255, 0, 0]); // the corner's tile paint shows where the touch-up is empty
    expect(at(117, 52)).toEqual([0, 0, 255]); // world 0 in front covers the touch-up
  });
});

describe('anchorDrawsFor / reboxPixels', () => {
  it('finds the anchor tiles of the group on the frame', () => {
    const st = state([...pipeAt(40, 20), ...pipeAt(200, 120)]);
    expect(anchorDrawsFor(st, group(), 0).map((d) => [d.x, d.y])).toEqual([[40, 20], [200, 120]]);
    expect(anchorDrawsFor(st, group(), 1)).toEqual([]);
  });

  it('keeps the paint where it was on screen when the box grows or shrinks', () => {
    const px = solid(4, 4, [0, 0, 0, 0]);
    px.data.set([7, 7, 7, 255], (1 * 4 + 2) * 4); // pixel (2,1)
    const grown = reboxPixels(px, { dx: 0, dy: 0, width: 4, height: 4 }, { dx: -8, dy: -8, width: 20, height: 20 });
    expect(grown.width).toBe(20);
    expect(Array.from(grown.data.subarray((9 * 20 + 10) * 4, (9 * 20 + 10) * 4 + 4))).toEqual([7, 7, 7, 255]);
    const shrunk = reboxPixels(grown, { dx: -8, dy: -8, width: 20, height: 20 }, { dx: 1, dy: 1, width: 2, height: 2 });
    expect(Array.from(shrunk.data.subarray((0 * 2 + 1) * 4, (0 * 2 + 1) * 4 + 4))).toEqual([7, 7, 7, 255]);
  });
});
