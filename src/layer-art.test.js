import { describe, it, expect, beforeEach } from 'vitest';
import {
  layerArtOf,
  layerArtRectForWorld,
  screenToLayerArt,
  setLayerArtPixels,
  clearLayerArtPixels,
  layerArtPixels,
  activeLayerArts,
  paintLayerArt,
  newLayerArt,
  layerArtLoop,
  mapCellDraws,
  placeArtColumns,
  placeArtRows,
  layerArtFullHeight,
  layerArtStageRect,
} from './layer-art.js';
import { compositeColorFrame } from './color-layer.js';
import { measureUncoloured } from './uncoloured.js';
import { hashTile } from './vip-state.js';

const W = 384;
const H = 224;

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

/** A world table with one normal-BG world at `world` (both eyes) and END just below it. */
function windowsWith(world, { gx = 0, gp = 0, gy = 0, mx = 0, mp = 0, my = 0, w = 383, h = 223, base = 5 } = {}) {
  const win = new Uint8Array(1024);
  const b = world * 32;
  wr16(win, b, 0xc000 | (base & 0xf));
  wr16(win, b + 2, gx & 0xffff);
  wr16(win, b + 4, gp & 0xffff);
  wr16(win, b + 6, gy & 0xffff);
  wr16(win, b + 8, mx & 0xffff);
  wr16(win, b + 10, mp & 0xffff);
  wr16(win, b + 12, my & 0xffff);
  wr16(win, b + 14, w & 0xffff);
  wr16(win, b + 16, h & 0xffff);
  if (world > 0) wr16(win, (world - 1) * 32, 0x40);
  return win;
}

/** Solid-colour art, or a gradient when `grad` (red = x, green = y). */
function artPixels(width, height, rgba = [0, 200, 0, 255], grad = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(grad ? [x & 0xff, y & 0xff, 0, 255] : rgba, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const PT = (() => {
  const pt = new Uint8Array(2048 * 16);
  pt.fill(0xff, 16, 32); // tile 1: solid shade 3
  return pt;
})();
const H1 = hashTile(PT.subarray(16, 32)) >>> 0;

beforeEach(() => {
  clearLayerArtPixels('bg');
});

describe('layerArtOf', () => {
  it('reads a valid layerArt and rejects broken ones', () => {
    expect(layerArtOf({ layerArt: { world: 30, bgmapBase: 5, mapX: 32, mapY: 0, width: 296, height: 160, png: 'x' } })).toMatchObject({ world: 30, width: 296 });
    expect(layerArtOf({})).toBeNull();
    expect(layerArtOf({ layerArt: { world: 30, mapX: 0, mapY: 0, width: 0, height: 10 } })).toBeNull();
    expect(layerArtOf({ layerArt: { world: 40, mapX: 0, mapY: 0, width: 10, height: 10 } })).toBeNull();
  });
});

describe('layerArtRectForWorld', () => {
  it('is the map region the window shows (Level 1 backdrop: 296×160 at map 32,0)', () => {
    const win = windowsWith(30, { gx: 32, mx: 32, w: 295, h: 159 });
    expect(layerArtRectForWorld(win, 30)).toEqual({ world: 30, bgmapBase: 5, mapX: 32, mapY: 0, width: 296, height: 160 });
  });

  it('clips to the screen when the window hangs off it', () => {
    const win = windowsWith(30, { gx: -10, gy: -4, mx: 0, my: 0, w: 399, h: 239 });
    expect(layerArtRectForWorld(win, 30)).toEqual({ world: 30, bgmapBase: 5, mapX: 10, mapY: 4, width: 384, height: 224 });
  });

  it('refuses worlds that are not normal backgrounds', () => {
    const win = windowsWith(30);
    wr16(win, 30 * 32, 0xc000 | (2 << 12)); // affine
    expect(layerArtRectForWorld(win, 30)).toBeNull();
  });
});

describe('screenToLayerArt', () => {
  it('maps a screen pixel to the art pixel under it, following scroll', () => {
    const art = { world: 30, bgmapBase: 5, mapX: 32, mapY: 0, width: 296, height: 160 };
    const win = windowsWith(30, { gx: 32, mx: 32, w: 295, h: 159 });
    expect(screenToLayerArt(win, 30, 0, 32, 0, art)).toEqual({ ax: 0, ay: 0 });
    expect(screenToLayerArt(win, 30, 0, 100, 50, art)).toEqual({ ax: 68, ay: 50 });
    expect(screenToLayerArt(win, 30, 0, 10, 10, art)).toBeNull(); // outside the window
    // The layer scrolled 8 px in the map: the same screen pixel now shows art x + 8.
    const scrolled = windowsWith(30, { gx: 32, mx: 40, w: 295, h: 159 });
    expect(screenToLayerArt(scrolled, 30, 0, 100, 50, art)).toEqual({ ax: 76, ay: 50 });
  });
});

describe('paintLayerArt', () => {
  it('paints the art across the window, in map space', () => {
    const art = { world: 30, bgmapBase: 5, mapX: 32, mapY: 0, width: 296, height: 160 };
    const win = windowsWith(30, { gx: 32, mx: 32, w: 295, h: 159 });
    const data = new Uint8ClampedArray(W * H * 4);
    const owner = new Int32Array(W * H).fill(-1);
    const n = paintLayerArt(data, owner, win, 0, { world: 30, art, pixels: artPixels(296, 160, null, true), ownerIndex: 7 }, 1);
    expect(n).toBe(296 * 160);
    const at = (x, y) => Array.from(data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
    expect(at(32, 0)).toEqual([0, 0, 0, 255]);
    expect(at(100, 50)).toEqual([68, 50, 0, 255]);
    expect(at(10, 10)).toEqual([0, 0, 0, 0]); // outside the window
    expect(owner[50 * W + 100]).toBe(7);
  });

  it('shifts with stereo parallax per eye, so each eye sees the art where the game puts the layer', () => {
    const art = { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 384, height: 224 };
    const win = windowsWith(30, { gx: 0, gp: 4, mx: 0, w: 383, h: 223 });
    const left = new Uint8ClampedArray(W * H * 4);
    const right = new Uint8ClampedArray(W * H * 4);
    const px = artPixels(384, 224, null, true);
    paintLayerArt(left, new Int32Array(W * H).fill(-1), win, 0, { world: 30, art, pixels: px, ownerIndex: 0 }, 1);
    paintLayerArt(right, new Int32Array(W * H).fill(-1), win, 1, { world: 30, art, pixels: px, ownerIndex: 0 }, 1);
    // Left eye draws the layer 4 px left (DestX = GX - GP), right eye 4 px right.
    expect(left[(10 * W + 20) * 4]).toBe(24);
    expect(right[(10 * W + 20) * 4]).toBe(16);
  });

  it('dims with the scene and leaves transparent art pixels alone', () => {
    const art = { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 2, height: 1 };
    const win = windowsWith(30, { w: 383, h: 223 });
    const px = { width: 2, height: 1, data: new Uint8ClampedArray([200, 100, 50, 255, 9, 9, 9, 0]) };
    const data = new Uint8ClampedArray(W * H * 4);
    data.set([1, 2, 3, 255], 4); // something already drawn behind at (1,0)
    paintLayerArt(data, new Int32Array(W * H).fill(-1), win, 0, { world: 30, art, pixels: px, ownerIndex: 0 }, 0.5);
    expect(Array.from(data.subarray(0, 4))).toEqual([100, 50, 25, 255]);
    expect(Array.from(data.subarray(4, 8))).toEqual([1, 2, 3, 255]);
  });
});

describe('activeLayerArts', () => {
  const group = {
    id: 'bg',
    criteria: { windowIds: [30], layers: [0], hashes: [H1] },
    layerArt: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 384, height: 224, png: '' },
  };
  const state = (world, base = 5) => ({
    patternTable: PT,
    windows: windowsWith(world, { base }),
    drawList: [{ tileIndex: 1, x: 0, y: 0, world, layer: 0, eye: 0 }],
  });

  it('is active when the group is on screen in a world that draws from the art’s map', () => {
    setLayerArtPixels('bg', artPixels(384, 224));
    const [a] = activeLayerArts(state(30), [group], 0);
    expect(a).toMatchObject({ world: 30, ownerIndex: 0 });
    expect(a.group).toBe(group);
  });

  it('needs pixels, the group on screen, and the same background map', () => {
    expect(activeLayerArts(state(30), [group], 0)).toEqual([]); // no pixels yet
    setLayerArtPixels('bg', artPixels(384, 224));
    expect(activeLayerArts(state(30, 6), [group], 0)).toEqual([]); // another map: a twin world
    expect(activeLayerArts({ ...state(30), drawList: [] }, [group], 0)).toEqual([]);
    expect(activeLayerArts(state(30), [group], 1)).toEqual([]); // the group is only on the left eye
  });

  it('prefers live pixels by group id', () => {
    const px = artPixels(4, 4);
    setLayerArtPixels('bg', px);
    expect(layerArtPixels(group)).toBe(px);
  });
});

describe('activeLayerArts with whole-pose groups', () => {
  const pt = new Uint8Array(2048 * 16);
  pt.fill(0xff, 16, 32); // tile 1
  pt.fill(0x55, 32, 48); // tile 2
  pt.fill(0xaa, 48, 64); // tile 3
  const h = (i) => hashTile(pt.subarray(i * 16, i * 16 + 16)) >>> 0;
  const art = { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 384, height: 224, png: '' };
  const character = { id: 'luigi', criteria: { windowIds: [30], layers: [0], hashes: [h(1), h(2), h(3)] } };
  const standing = { id: 'stand', wholePose: true, criteria: { windowIds: [30], layers: [0], hashes: [h(1), h(2)] }, overpaint: art };
  const waving = { id: 'wave', wholePose: true, criteria: { windowIds: [30], layers: [0], hashes: [h(1), h(2), h(3)] }, overpaint: art };
  const frame = (tiles) => ({
    patternTable: pt,
    windows: windowsWith(30),
    drawList: tiles.map((tileIndex, i) => ({ tileIndex, x: i * 8, y: 0, world: 30, layer: 0, eye: 0 })),
  });
  const shown = (tiles, groups) => activeLayerArts(frame(tiles), groups, 0).map((e) => e.group.id);

  beforeEach(() => {
    setLayerArtPixels('stand', artPixels(384, 224));
    setLayerArtPixels('wave', artPixels(384, 224));
  });

  it('shows a pose’s picture only when all of its tiles are on screen', () => {
    expect(shown([1, 2], [character, standing])).toEqual(['stand']);
    expect(shown([1], [character, standing])).toEqual([]);
    expect(shown([3], [character, standing])).toEqual([]);
  });

  it('shows only the fullest pose when one pose’s tiles are all part of another', () => {
    expect(shown([1, 2, 3], [character, standing, waving])).toEqual(['wave']);
    expect(shown([1, 2], [character, standing, waving])).toEqual(['stand']);
  });

  it('draws pose pictures kept inside the character’s group the same way', () => {
    const inside = {
      ...character,
      poseOverpaints: [
        { id: 'stand', name: 'Stand', hashes: [h(1), h(2)], ...art },
        { id: 'wave', name: 'Wave', hashes: [h(1), h(2), h(3)], ...art },
      ],
    };
    setLayerArtPixels('luigi#pose:stand', artPixels(384, 224));
    setLayerArtPixels('luigi#pose:wave', artPixels(384, 224));
    expect(shown([1, 2], [inside])).toEqual(['luigi#pose:stand']);
    expect(shown([1, 2, 3], [inside])).toEqual(['luigi#pose:wave']);
    expect(shown([3], [inside])).toEqual([]);
  });
});

describe('newLayerArt', () => {
  it('starts art from the layer as it looks now', () => {
    const win = windowsWith(30, { gx: 32, mx: 32, w: 295, h: 159 });
    const rendered = new Uint8ClampedArray(W * H * 4);
    rendered.set([9, 8, 7, 255], (5 * W + 40) * 4);
    const made = newLayerArt(win, 30, rendered);
    expect(made.art).toEqual({ world: 30, bgmapBase: 5, mapX: 32, mapY: 0, width: 296, height: 160 });
    expect(Array.from(made.pixels.data.subarray((5 * 296 + 8) * 4, (5 * 296 + 8) * 4 + 4))).toEqual([9, 8, 7, 255]);
  });
});

describe('compositeColorFrame with layer art', () => {
  it('replaces the layer’s tiles with the art, behind a world in front', () => {
    // World 30: the replaced layer. Worlds 29..1 off. World 0 in front, also normal BG.
    const win = windowsWith(30, { w: 383, h: 223 });
    for (let w = 29; w >= 1; w--) wr16(win, w * 32, 0x0000);
    wr16(win, 0, 0xc000 | 5);
    wr16(win, 14, 383);
    wr16(win, 16, 223);
    const group = {
      id: 'bg',
      criteria: { windowIds: [30], layers: [0], hashes: [H1] },
      layerArt: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 384, height: 224, png: '' },
    };
    setLayerArtPixels('bg', artPixels(384, 224, [0, 200, 0, 255]));
    const state = {
      patternTable: PT,
      windows: win,
      corePatchLevel: 3,
      drawList: [
        { tileIndex: 1, x: 0, y: 0, world: 30, layer: 0, eye: 0 },
        { tileIndex: 1, x: 100, y: 100, world: 0, layer: 0, eye: 0 },
      ],
    };
    const red = new Uint8Array(256);
    for (let i = 0; i < 64; i++) red.set([255, 0, 0, 255], i * 4);
    const img = { data: new Uint8ClampedArray(W * H * 4) };
    compositeColorFrame(state, new Map([[H1, red]]), img, { eye: 0, overrides: [], groups: [group], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    const at = (x, y) => Array.from(img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
    expect(at(3, 3)).toEqual([0, 200, 0]); // the art, not world 30's red tile
    expect(at(200, 150)).toEqual([0, 200, 0]); // the art fills the layer beyond its tiles
    expect(at(103, 103)).toEqual([255, 0, 0]); // world 0 still draws in front
  });

  it('an unpainted tile in front of the art still counts as uncoloured', () => {
    // The art marks every pixel it draws; a tile drawn over it later owns those pixels again.
    const win = windowsWith(30, { w: 383, h: 223 });
    for (let w = 29; w >= 1; w--) wr16(win, w * 32, 0x0000);
    wr16(win, 0, 0xc000 | 5);
    wr16(win, 14, 383);
    wr16(win, 16, 223);
    const pt = Uint8Array.from(PT);
    pt.fill(0xff, 32, 48);
    pt[47] = 0x0f; // tile 2: another pattern (2 pixels of its last row dark), never painted
    const group = {
      id: 'bg',
      criteria: { windowIds: [30], layers: [0], hashes: [H1] },
      layerArt: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 384, height: 224, png: '' },
    };
    setLayerArtPixels('bg', artPixels(384, 224, [0, 200, 0, 255]));
    const state = {
      patternTable: pt,
      windows: win,
      corePatchLevel: 3,
      drawList: [
        { tileIndex: 1, x: 0, y: 0, world: 30, layer: 0, eye: 0 },
        { tileIndex: 2, x: 100, y: 100, world: 0, layer: 0, eye: 0 },
      ],
    };
    expect(measureUncoloured(state, { groups: [group] })).toEqual({ tiles: 1, pixels: 62 });
  });
});

describe('the whole map loop', () => {
  it("covers a wrapping map's whole width from map X 0, whatever column this frame starts at", () => {
    const win = windowsWith(10, { mx: 112, w: 383, h: 79, my: 352, base: 1 });
    expect(layerArtLoop(win, 10)).toMatchObject({ world: 10, mapX: 0, mapY: 352, width: 512, height: 80 });
  });

  it('covers an overplane map plus one window of filler beyond its edge', () => {
    const win = windowsWith(10, { mx: 112, w: 383, h: 79, my: 352, base: 1 });
    win[10 * 32] |= 0x80; // OVER
    expect(layerArtLoop(win, 10)).toMatchObject({ mapX: 0, width: 512 + 384 });
  });

  it("samples a picture across the map's wrap point", () => {
    // Window starts at map X 500: screen x 12 is map X 0 again.
    const win = windowsWith(10, { mx: 500 });
    expect(screenToLayerArt(win, 10, 0, 12, 0, { mapX: 0, mapY: 0, width: 512, height: 224 })).toEqual({ ax: 0, ay: 0 });
    expect(screenToLayerArt(win, 10, 0, 0, 0, { mapX: 0, mapY: 0, width: 512, height: 224 })).toEqual({ ax: 500, ay: 0 });
    // Art that does not reach map X 500 shows nothing there.
    expect(screenToLayerArt(win, 10, 0, 0, 0, { mapX: 14, mapY: 0, width: 384, height: 224 })).toBeNull();
  });

  it('lists the map cells under an area, wrapping, and the overplane filler past an overplane map', () => {
    const segments = Array.from({ length: 16 }, () => new Uint8Array(0x2000));
    wr16(segments[1], 0, 7 | 0x2000); // cell (0,0): character 7, flipped across
    wr16(segments[1], 63 * 2, 9); // cell (63,0): character 9
    wr16(segments[2], 0, 5); // the overplane word lives at halfword 0x2000 (segment 2)
    const wrap = { windows: windowsWith(10, { base: 1 }), segments };
    const cells = mapCellDraws(wrap, { world: 10, mapX: 504, mapY: 0, width: 16, height: 8 });
    expect(cells.map((d) => [d.tileIndex, d.x])).toEqual([[9, 0], [7, 8]]); // cell 63, then cell 0 again
    expect(cells[1].flipH).toBe(true);
    const overWin = windowsWith(10, { base: 1 });
    overWin[10 * 32] |= 0x80;
    wr16(overWin, 10 * 32 + 20, 0x2000);
    const past = mapCellDraws({ windows: overWin, segments }, { world: 10, mapX: 504, mapY: 0, width: 16, height: 8 });
    expect(past.map((d) => d.tileIndex)).toEqual([9, 5]); // the map's last cell, then filler
  });

  it('moves painted columns to their place in a wider picture', () => {
    const old = { width: 2, height: 1, data: new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255]) };
    const base = { width: 8, height: 1, data: new Uint8ClampedArray(32) };
    placeArtColumns(old, { mapX: 3 }, base, { mapX: 0 }, 8);
    expect([...base.data.subarray(12, 20)]).toEqual([1, 1, 1, 255, 2, 2, 2, 255]);
    const wrapped = { width: 8, height: 1, data: new Uint8ClampedArray(32) };
    placeArtColumns(old, { mapX: 7 }, wrapped, { mapX: 0 }, 8); // column 2 wraps to map X 0
    expect(wrapped.data[28]).toBe(1);
    expect(wrapped.data[0]).toBe(2);
  });
});

describe("filling the screen's height", () => {
  // A crowd strip: window rows 40-119 show map rows 352-431; the sky above and grass below show
  // nothing of the layer.
  const strip = () => windowsWith(10, { gy: 40, w: 383, h: 79, my: 352, base: 1 });

  it('covers from the map row screen row 0 would show, 224 rows down', () => {
    expect(layerArtFullHeight(strip(), 10)).toEqual({ mapY: 312, height: H });
  });

  it('maps and paints rows above and below the window when the art reaches them', () => {
    const tall = { world: 10, bgmapBase: 1, mapX: 0, mapY: 312, width: 512, height: H };
    expect(screenToLayerArt(strip(), 10, 0, 5, 0, tall)).toEqual({ ax: 5, ay: 0 });
    expect(screenToLayerArt(strip(), 10, 0, 5, 200, tall)).toEqual({ ax: 5, ay: 200 });
    // Art the window's height draws nothing above it.
    const short = { ...tall, mapY: 352, height: 80 };
    expect(screenToLayerArt(strip(), 10, 0, 5, 10, short)).toBeNull();
    const data = new Uint8ClampedArray(W * H * 4);
    const owner = new Int32Array(W * H).fill(-1);
    const n = paintLayerArt(data, owner, strip(), 0, { world: 10, art: tall, pixels: artPixels(512, H), ownerIndex: 1 }, 1);
    expect(n).toBe(W * H);
  });

  it('frames the stage on the rows the art covers', () => {
    expect(layerArtStageRect(strip(), 10, 0, { mapY: 352, height: 80 })).toEqual({ x0: 0, y0: 40, x1: W, y1: 120 });
    expect(layerArtStageRect(strip(), 10, 0, { mapY: 312, height: H })).toEqual({ x0: 0, y0: 0, x1: W, y1: H });
  });

  it('moves painted rows to their place in a taller picture', () => {
    const old = { width: 1, height: 2, data: new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255]) };
    const base = { width: 1, height: 6, data: new Uint8ClampedArray(24) };
    placeArtRows(old, { mapY: 352 }, base, { mapY: 350 }, 511);
    expect([...base.data.subarray(8, 16)]).toEqual([1, 1, 1, 255, 2, 2, 2, 255]);
    expect(base.data[0]).toBe(0); // new rows start see-through
    // Across the map's wrap: rows from map 510 up to map 2.
    const wrapped = { width: 1, height: 6, data: new Uint8ClampedArray(24) };
    placeArtRows({ width: 1, height: 1, data: new Uint8ClampedArray([9, 9, 9, 255]) }, { mapY: 0 }, wrapped, { mapY: 510 }, 511);
    expect(wrapped.data[8]).toBe(9);
  });
});
