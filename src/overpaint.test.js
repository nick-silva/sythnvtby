import { describe, it, expect, afterEach } from 'vitest';
import {
  withOverpaint,
  touchUpMapArea,
  convertToOverpaint,
  paintedBounds,
  cropOverpaint,
  placeOverpaint,
  mapWrap,
  affineOverpaints,
  paintAffineOverpaint,
  seedRepeatedColumns,
} from './overpaint.js';
import { layerArtOf, setLayerArtPixels, clearLayerArtPixels } from './layer-art.js';
import { compositeColorFrame } from './color-layer.js';
import { getTileBytes, hashTile } from './vip-state.js';

const W = 384;
const H = 224;

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

/** World 30 a full-screen normal BG layer scrolled to map (mx, 0), map 512×512 wrapping; world 29 END. */
function plainWindows(mx = 0) {
  const win = new Uint8Array(1024);
  wr16(win, 30 * 32, 0xc000 | 5);
  wr16(win, 30 * 32 + 8, mx);
  wr16(win, 30 * 32 + 14, 383);
  wr16(win, 30 * 32 + 16, 223);
  wr16(win, 29 * 32, 0x40);
  return win;
}

// Tiles 1–4: distinct solid patterns.
const PT = (() => {
  const pt = new Uint8Array(2048 * 16);
  for (let t = 1; t <= 4; t++) {
    pt.fill(0xff, t * 16, t * 16 + 16);
    pt[t * 16] = t;
  }
  return pt;
})();
const H_ = (t) => hashTile(PT.subarray(t * 16, t * 16 + 16)) >>> 0;

const solid = (w, h, rgba) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
};
const red = solid(8, 8, [255, 0, 0, 255]).data;

/** A 2×2 block of tiles 1..4 at x,y in world 30. */
const block = (x, y) => [
  { tileIndex: 1, x, y, world: 30, layer: 0, eye: 0 },
  { tileIndex: 2, x: x + 8, y, world: 30, layer: 0, eye: 0 },
  { tileIndex: 3, x, y: y + 8, world: 30, layer: 0, eye: 0 },
  { tileIndex: 4, x: x + 8, y: y + 8, world: 30, layer: 0, eye: 0 },
];
const plainGroup = (extra = {}) => ({
  id: 'crowd',
  authoringKind: 'bg',
  anchorHash: H_(1),
  criteria: { windowIds: [30], layers: [0], hashes: [H_(1), H_(2), H_(3), H_(4)] },
  ...extra,
});

afterEach(() => {
  clearLayerArtPixels('crowd');
  clearLayerArtPixels('touchup:crowd');
  clearLayerArtPixels('opp');
});

describe('reading overpaint', () => {
  it('reads overpaint (drawn over the tiles) before old layer art (which hides them)', () => {
    const area = { world: 30, bgmapBase: 5, mapX: 8, mapY: 0, width: 16, height: 16, png: '' };
    expect(layerArtOf({ overpaint: { ...area, hideTiles: false } })).toMatchObject({ mapX: 8, hideTiles: false });
    expect(layerArtOf({ layerArt: area })).toMatchObject({ hideTiles: true });
    expect(layerArtOf({ layerArt: area, overpaint: { ...area, mapX: 40, hideTiles: false } })).toMatchObject({ mapX: 40, hideTiles: false });
  });

  it('withOverpaint replaces old layer art and touch-ups, and removes the picture with null', () => {
    const g = withOverpaint({ id: 'a', layerArt: {}, touchUp: {} }, { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 4, height: 4, hideTiles: false });
    expect(g.layerArt).toBeUndefined();
    expect(g.touchUp).toBeUndefined();
    expect(g.overpaint).toMatchObject({ world: 30, png: '', hideTiles: false });
    expect(withOverpaint(g, null).overpaint).toBeUndefined();
  });
});

describe('compositing overpaint', () => {
  const frame = (mx, draws) => ({ patternTable: PT, windows: plainWindows(mx), corePatchLevel: 3, drawList: draws });
  const composite = (state, group) => {
    const img = { data: new Uint8ClampedArray(W * H * 4) };
    compositeColorFrame(state, new Map([[H_(1), red], [H_(2), red], [H_(3), red], [H_(4), red]]), img, { eye: 0, overrides: [], groups: [group], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    return (x, y) => Array.from(img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
  };
  // A green 4×4 dot at map (102, 52): over the block's first tile when the block sits at 100,50.
  const dot = () => {
    const px = solid(4, 4, [0, 200, 0, 255]);
    setLayerArtPixels('crowd', px);
    return { world: 30, bgmapBase: 5, mapX: 102, mapY: 52, width: 4, height: 4, png: '' };
  };

  it('draws over the tiles, which still show around it', () => {
    const g = withOverpaint(plainGroup(), { ...dot(), hideTiles: false });
    const at = composite(frame(0, block(100, 50)), g);
    expect(at(103, 53)).toEqual([0, 200, 0]);
    expect(at(110, 60)).toEqual([255, 0, 0]);
  });

  it('stays at its place in the map when the layer scrolls — where a touch-up would drop out', () => {
    const g = withOverpaint(plainGroup(), { ...dot(), hideTiles: false });
    // Scrolled 64 px: the block (map 100,50) is now at screen 36,50, and so is the dot.
    const at = composite(frame(64, block(36, 50)), g);
    expect(at(39, 53)).toEqual([0, 200, 0]);
    expect(at(103, 53)).toEqual([0, 0, 0]);
  });

  it('with Hide the tiles, the layer’s tiles go and only the picture shows (old layer art)', () => {
    const g = withOverpaint(plainGroup(), { ...dot(), hideTiles: true });
    const at = composite(frame(0, block(100, 50)), g);
    expect(at(103, 53)).toEqual([0, 200, 0]);
    expect(at(110, 60)).toEqual([0, 0, 0]);
  });
});

describe('converting touch-ups and layer art', () => {
  const tuGroup = () => plainGroup({
    touchUp: {
      anchorHash: H_(1),
      box: { dx: -8, dy: -8, width: 32, height: 32 },
      layout: [{ dx: 0, dy: 0, hash: H_(1) }, { dx: 8, dy: 0, hash: H_(2) }, { dx: 0, dy: 8, hash: H_(3) }, { dx: 8, dy: 8, hash: H_(4) }],
      png: '',
    },
  });

  it('places a touch-up in its layer’s map through the scroll of a frame it shows on', () => {
    // The layer is scrolled 16 px; the block is on screen at 100,50, so in the map at 116,50.
    const frames = [{ patternTable: PT, windows: plainWindows(16), drawList: block(100, 50) }];
    const area = touchUpMapArea({ group: tuGroup(), frameCount: 1, frameAt: (i) => frames[i] });
    expect(area).toEqual({ world: 30, bgmapBase: 5, mapX: 108, mapY: 42, width: 32, height: 32, hideTiles: false });
  });

  it('converts layer art and placed touch-ups; keeps a touch-up no frame places', () => {
    const frames = [{ patternTable: PT, windows: plainWindows(0), drawList: block(100, 50) }];
    const art = { id: 'art', authoringKind: 'bg', criteria: {}, layerArt: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 8, height: 8, png: 'p' } };
    const lost = { ...tuGroup(), id: 'lost', criteria: { ...tuGroup().criteria, windowIds: [9] } };
    const r = convertToOverpaint({
      groups: [art, tuGroup(), lost],
      frameCount: 1,
      frameAt: (i) => frames[i],
      touchUpPixels: () => solid(32, 32, [0, 0, 255, 255]),
    });
    expect(r.layerArt).toEqual(['art']);
    expect(r.touchUps).toEqual(['crowd']);
    expect(r.kept).toEqual(['lost']);
    expect(r.groups[0].overpaint).toMatchObject({ hideTiles: true, png: 'p' });
    expect(r.groups[1].overpaint).toMatchObject({ mapX: 92, mapY: 42, width: 32, hideTiles: false });
    expect(r.groups[1].touchUp).toBeUndefined();
    expect(r.groups[2].touchUp).toBeDefined();
    expect(r.pixels.get('crowd').width).toBe(32);
  });
});

describe('storing and widening the picture', () => {
  it('crops to what is painted, keeping each pixel’s place in the map', () => {
    const px = solid(20, 10, [0, 0, 0, 0]);
    for (const [x, y] of [[5, 3], [7, 4]]) px.data.set([9, 9, 9, 255], (y * 20 + x) * 4);
    expect(paintedBounds(px)).toEqual({ x0: 5, y0: 3, x1: 8, y1: 5 });
    const c = cropOverpaint({ world: 30, bgmapBase: 5, mapX: 500, mapY: 0, width: 20, height: 10, hideTiles: false }, px, { wrapX: 512, wrapY: 512 });
    expect(c.op).toMatchObject({ mapX: 505 % 512, mapY: 3, width: 3, height: 2 });
    expect(cropOverpaint({ mapX: 0, mapY: 0, width: 20, height: 10, hideTiles: false }, solid(20, 10, [0, 0, 0, 0]))).toBeNull();
  });

  it('a picture that hides the tiles is stored whole', () => {
    const px = solid(4, 4, [0, 0, 0, 0]);
    expect(cropOverpaint({ mapX: 0, mapY: 0, width: 4, height: 4, hideTiles: true }, px).pixels).toBe(px);
  });

  it('moves a picture onto a wider area round the map’s wrap', () => {
    const px = solid(4, 1, [1, 2, 3, 255]);
    // Painted at map x 510..513, which wraps to 510, 511, 0, 1 on a 512-wide map.
    const { pixels, dropped } = placeOverpaint({ mapX: 510, mapY: 0 }, px, { mapX: 0, mapY: 0, width: 512, height: 1 }, { wrapX: 512, wrapY: 0 });
    const alpha = (x) => pixels.data[x * 4 + 3];
    expect([alpha(510), alpha(511), alpha(0), alpha(1), alpha(2)]).toEqual([255, 255, 255, 255, 0]);
    expect(dropped).toBe(0);
  });

  it('knows a plain layer’s map wraps at its size', () => {
    expect(mapWrap(plainWindows(0), 30)).toEqual({ wrapX: 512, wrapY: 512 });
  });
});

describe('widening a backdrop over a repeating map', () => {
  // A 48 px wide picture from map x 0: columns 0–23 were painted (red, green, blue per 8 px);
  // the map repeats them, so the new columns 24–47 show the tiles of 8, 16 and an unknown one.
  const keys = { 0: 'a', 1: 'b', 2: 'c', 3: 'b', 4: 'c', 5: 'z' };
  const picture = () => {
    const px = { width: 48, height: 2, data: new Uint8ClampedArray(48 * 2 * 4) };
    const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 24; x++) px.data.set([...colours[x >> 3], 255], (y * 48 + x) * 4);
    return px;
  };
  const at = (px, x, y = 1) => [...px.data.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 4)];

  it('copies the painted column that shows the same tiles into each new one, and leaves the rest clear', () => {
    const before = picture();
    const r = seedRepeatedColumns(before, 0, { x0: 0, x1: 24 }, (cx) => keys[cx] ?? null);
    expect(r.filled).toBe(2);
    expect(r.unmatched).toBe(1);
    expect(at(r.pixels, 24)).toEqual([0, 255, 0, 255]);
    expect(at(r.pixels, 39)).toEqual([0, 0, 255, 255]);
    expect(at(r.pixels, 40)).toEqual([0, 0, 0, 0]);
    expect(at(before, 24)).toEqual([0, 0, 0, 0]); // the picture passed in is not changed
  });

  it('never paints over what is already there, and only copies from columns painted before', () => {
    const before = picture();
    before.data.set([9, 9, 9, 255], (1 * 48 + 30) * 4);
    const r = seedRepeatedColumns(before, 0, { x0: 4, x1: 24 }, (cx) => keys[cx] ?? null);
    expect(at(r.pixels, 30)).toEqual([9, 9, 9, 255]);
    expect(at(r.pixels, 24)).toEqual([0, 255, 0, 255]);
    // Column 0 is only partly inside the painted range, so nothing copies from it.
    expect(seedRepeatedColumns(before, 0, { x0: 4, x1: 24 }, (cx) => (cx === 0 || cx === 5 ? 'a' : null)).filled).toBe(0);
  });
});

describe('overpaint on a scaled (affine) layer', () => {
  /** World 31 affine, zoomed 2×: map pixel (mx, my) shows at screen (2mx, 2my); row 0 holds chars 1, 2. */
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
  const opp = (extra = {}) => ({ id: 'opp', authoringKind: 'bg', criteria: { windowIds: [31], layers: [0], hashes: [h(1), h(2)] }, ...extra });

  it('draws the picture scaled with the layer, at its map place', () => {
    // A green 4×4 dot at map (8, 2): over character 2, which the 2× zoom shows from screen x 16.
    setLayerArtPixels('opp', solid(4, 4, [0, 255, 0, 255]));
    const g = withOverpaint(opp(), { world: 31, bgmapBase: 1, mapX: 8, mapY: 2, width: 4, height: 4, hideTiles: false });
    const [entry] = affineOverpaints(st, [g], 0);
    expect(entry).toMatchObject({ world: 31 });
    const data = new Uint8ClampedArray(W * H * 4);
    const n = paintAffineOverpaint(data, null, st, 0, entry, 1);
    const green = (x, y) => data[(y * W + x) * 4 + 1] === 255;
    expect(n).toBe(64); // 4×4 map pixels, each 2×2 on screen
    expect(green(16, 4) && green(23, 11)).toBe(true);
    expect(green(15, 4) || green(24, 4)).toBe(false);
  });

  it('is not drawn where the layer reads none of the group’s tiles, or draws another map', () => {
    setLayerArtPixels('opp', solid(4, 4, [0, 255, 0, 255]));
    const area = { world: 31, bgmapBase: 1, mapX: 8, mapY: 2, width: 4, height: 4, hideTiles: false };
    expect(affineOverpaints(st, [withOverpaint(opp({ criteria: { windowIds: [31], hashes: [12345] } }), area)], 0)).toEqual([]);
    expect(affineOverpaints(st, [withOverpaint(opp(), { ...area, bgmapBase: 3 })], 0)).toEqual([]);
  });

  it('the compositor draws it over the scaled tiles', () => {
    setLayerArtPixels('opp', solid(4, 4, [0, 255, 0, 255]));
    const g = withOverpaint(opp(), { world: 31, bgmapBase: 1, mapX: 8, mapY: 2, width: 4, height: 4, hideTiles: false });
    const img = { data: new Uint8ClampedArray(W * H * 4) };
    compositeColorFrame(st, new Map(), img, { eye: 0, overrides: [], groups: [g], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    const px = (x, y) => Array.from(img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
    expect(px(18, 6)).toEqual([0, 255, 0]);
    expect(px(26, 6)).not.toEqual([0, 255, 0]);
  });
});

describe('converting a scaled-layer touch-up that reaches past the map’s origin', () => {
  it('keeps the part inside the map and leaves out what can never be drawn', async () => {
    // Reuse the scaled frame: anchor on character 1 at map cell (0, 0), box starting 4 px up-left.
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
    const st = { windows, segments, patternTable, drawList: [{ tileIndex: 1, x: 0, y: 0, eye: 0, layer: 1, world: 31 }] };
    const h = (ch) => hashTile(getTileBytes(patternTable, ch)) >>> 0;
    const group = {
      id: 'title',
      authoringKind: 'bg',
      criteria: { windowIds: [31], hashes: [h(1), h(2)] },
      touchUp: { anchorHash: h(1), box: { dx: -4, dy: -4, width: 20, height: 12 }, layout: [{ dx: 0, dy: 0, hash: h(1) }, { dx: 8, dy: 0, hash: h(2) }], png: '' },
    };
    const px = solid(20, 12, [0, 0, 0, 0]);
    px.data.set([9, 9, 9, 255], (4 * 20 + 4) * 4); // the pixel at map (0, 0)
    // As when a pack opens, the touch-up's pixels are loaded before converting.
    setLayerArtPixels('touchup:title', px);
    const r = convertToOverpaint({ groups: [group], frameCount: 1, frameAt: () => st, touchUpPixels: () => px });
    clearLayerArtPixels('touchup:title');
    expect(r.touchUps).toEqual(['title']);
    expect(r.groups[0].overpaint).toMatchObject({ mapX: 0, mapY: 0, width: 16, height: 8 });
    expect(r.pixels.get('title').data[3]).toBe(255);
  });
});

describe('two groups on one layer', () => {
  afterEach(() => clearLayerArtPixels('other'));
  it('draws both groups’ overpaint; the group higher in the list on top; only one may hide the tiles', async () => {
    const { activeLayerArts } = await import('./layer-art.js');
    const st = { patternTable: PT, windows: plainWindows(0), drawList: block(100, 50) };
    setLayerArtPixels('crowd', solid(4, 4, [0, 200, 0, 255]));
    setLayerArtPixels('other', solid(4, 4, [200, 0, 0, 255]));
    const area = { world: 30, bgmapBase: 5, mapX: 102, mapY: 52, width: 4, height: 4 };
    const a = withOverpaint(plainGroup(), { ...area, hideTiles: false });
    const b = withOverpaint({ ...plainGroup(), id: 'other' }, { ...area, hideTiles: false });
    const both = activeLayerArts(st, [a, b], 0);
    expect(both.map((e) => e.group.id)).toEqual(['other', 'crowd']); // drawn in this order: crowd on top
    const img = { data: new Uint8ClampedArray(W * H * 4) };
    compositeColorFrame({ ...st, corePatchLevel: 3 }, new Map(), img, { eye: 0, overrides: [], groups: [a, b], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    expect(Array.from(img.data.subarray((53 * W + 103) * 4, (53 * W + 103) * 4 + 3))).toEqual([0, 200, 0]);
    const hideA = withOverpaint(plainGroup(), { ...area, hideTiles: true });
    const hideB = withOverpaint({ ...plainGroup(), id: 'other' }, { ...area, hideTiles: true });
    expect(activeLayerArts(st, [hideA, hideB], 0).map((e) => e.group.id)).toEqual(['crowd']);
  });
});
