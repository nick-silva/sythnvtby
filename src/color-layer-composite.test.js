import { describe, it, expect } from 'vitest';
import { compositeColorFrame } from './color-layer.js';
import { hashTile } from './vip-state.js';
import { withGroupTileColor } from './group-tile-colors.js';

const W = 384;

function rgbaTileSolid(r, g, b, a) {
  const u = new Uint8Array(256);
  for (let i = 0; i < 64; i++) {
    const o = i * 4;
    u[o] = r;
    u[o + 1] = g;
    u[o + 2] = b;
    u[o + 3] = a;
  }
  return u;
}

describe('compositeColorFrame no-pack occlusion (Z)', () => {
  it('later no-pack tile with solid mono occludes earlier pack at same pixel', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    patternTable.set([0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);

    const h0 = hashTile(patternTable.subarray(0, 16));
    const packEntries = new Map([[h0, rgbaTileSolid(255, 0, 0, 255)]]);

    const state = {
      patternTable,
      drawList: [
        { tileIndex: 0, x: 100, y: 100, eye: 0, layer: 0 },
        { tileIndex: 1, x: 100, y: 100, eye: 0, layer: 0, world: 1 },
      ],
    };

    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, packEntries, imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });

    const dst = (100 * W + 100) * 4;
    expect(imageData.data[dst]).toBe(80);
    expect(imageData.data[dst + 1]).toBe(80);
    expect(imageData.data[dst + 2]).toBe(80);
    expect(imageData.data[dst + 3]).toBe(255);
  });

  it('emulator mode: an unpainted tile in front clears colour behind it, so the mono picture shows there', () => {
    // Back world 5 is painted red on pixels 0–1; front world 1 is unpainted and lit on pixel 0.
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);
    const packEntries = new Map([[hashTile(patternTable.subarray(0, 16)), rgbaTileSolid(255, 0, 0, 255)]]);
    const state = {
      patternTable,
      drawList: [
        { tileIndex: 1, x: 100, y: 100, eye: 0, layer: 0, world: 1 },
        { tileIndex: 0, x: 100, y: 100, eye: 0, layer: 0, world: 5 },
      ],
    };
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    // The emulator's arguments: no fallback shades, the mono picture is drawn underneath.
    compositeColorFrame(state, packEntries, imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 2, diagnosticMonoFallback: false, renderUnpackedFallback: false });

    const at = (x) => Array.from(imageData.data.subarray((100 * W + x) * 4, (100 * W + x) * 4 + 4));
    expect(at(100)[3]).toBe(0); // front tile's lit pixel: transparent, the mono tile shows
    expect(at(101)).toEqual([255, 0, 0, 255]); // front tile is see-through here: back colour stays
  });

  it('unpainted background pixels take the game’s palette (GPLT); sprites keep the raw value', () => {
    // Pixel 0 of the tile is value 1, pixel 1 is value 3.
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0b1101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);
    const state = {
      patternTable,
      gplt: [0x6c, 0xe4, 0xe4, 0xe4], // palette 0 inverted, as Mario's Tennis sets it: 1 → 3, 3 → 1
      drawList: [
        { tileIndex: 1, x: 0, y: 0, eye: 0, layer: 0, paletteSelector: 0 },
        { tileIndex: 1, x: 16, y: 0, eye: 0, layer: 0, paletteSelector: 1 },
        { tileIndex: 1, x: 32, y: 0, eye: 0, layer: 2, paletteSelector: 0 },
      ],
    };
    const img = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, new Map(), img, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 1, diagnosticMonoFallback: false, renderUnpackedFallback: true });
    const grey = (x) => img.data[x * 4];
    expect([grey(0), grey(1)]).toEqual([240, 80]); // palette 0: value 1 shows brightest, 3 darkest
    expect([grey(16), grey(17)]).toEqual([80, 240]); // palette 1 is the identity
    expect([grey(32), grey(33)]).toEqual([80, 240]); // a sprite: its palettes are not in the frame
  });

  it('paint on a transparent pixel is drawn only when asked (a flagged pack, or the tools)', () => {
    // Pixel 0 is value 1; pixel 1 is transparent but painted green.
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0b01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);
    const rgba = rgbaTileSolid(30, 200, 60, 255);
    const pack = new Map([[hashTile(patternTable.subarray(16, 32)), rgba]]);
    const state = { patternTable, drawList: [{ tileIndex: 1, x: 0, y: 0, eye: 0, layer: 0 }] };
    const run = (on) => {
      const img = { data: new Uint8ClampedArray(384 * 224 * 4) };
      compositeColorFrame(state, pack, img, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 2, diagnosticMonoFallback: false, renderUnpackedFallback: false, monoFallbackGain: 1, drawTransparentPaint: on });
      return [img.data[3], img.data[7]]; // alpha of pixels 0 and 1
    };
    expect(run(false)).toEqual([255, 0]); // as the game draws it: the transparent pixel stays clear
    expect(run(true)).toEqual([255, 255]); // painted transparent pixel drawn, covering what is behind
  });

  it('no-pack mono=3 draws over a pack hole (bottom mono=0) when two layers stack', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);

    const h0 = hashTile(patternTable.subarray(0, 16));
    const packEntries = new Map([[h0, rgbaTileSolid(255, 0, 0, 255)]]);

    const state = {
      patternTable,
      drawList: [
        { tileIndex: 0, x: 50, y: 50, eye: 0, layer: 0 },
        { tileIndex: 1, x: 50, y: 50, eye: 0, layer: 0 },
      ],
    };

    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, packEntries, imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });

    const dst = (50 * W + 50) * 4;
    expect(imageData.data[dst]).toBe(240);
    expect(imageData.data[dst + 1]).toBe(240);
    expect(imageData.data[dst + 2]).toBe(240);
    expect(imageData.data[dst + 3]).toBe(255);
  });

  it('lone no-pack solid stays transparent (no phantom gray when mono is hidden)', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    const packEntries = new Map();
    const state = {
      patternTable,
      drawList: [{ tileIndex: 0, x: 10, y: 10, eye: 0, layer: 0 }],
    };
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, packEntries, imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    const dst = (10 * W + 10) * 4;
    expect(imageData.data[dst + 3]).toBe(0);
  });

  it('can force no-pack pixels fully transparent (main emulator underlay mode)', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    const packEntries = new Map();
    const state = {
      patternTable,
      drawList: [
        { tileIndex: 0, x: 40, y: 40, eye: 0, layer: 0 },
        { tileIndex: 0, x: 40, y: 40, eye: 0, layer: 0 },
      ],
    };
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(
      state,
      packEntries,
      imageData,
      {
        eye: 0,
        overrides: [],
        groups: [],
        brightnessScale: 1,
        stripClip: false,
        objXOffset: 0,
        applyOffsetToAllDraws: false,
        bgXOffset: 0,
        deduplicateDraws: false,
        gameStatePools: null,
        wram: null,
        unpackedMode: 'transparent',
        sortDrawsByWorld: true,
        painterV2Rules: null,
        painterV2VariantId: null,
        unpackedMinCoverage: 2,
        diagnosticMonoFallback: false,
        renderUnpackedFallback: false,
      },
    );
    const dst = (40 * W + 40) * 4;
    expect(imageData.data[dst + 3]).toBe(0);
  });

  it('two no-pack tiles at same origin: later mono wins (coverage ≥2)', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    patternTable.set([0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);
    const packEntries = new Map();
    const state = {
      patternTable,
      drawList: [
        { tileIndex: 0, x: 60, y: 60, eye: 0, layer: 0 },
        { tileIndex: 1, x: 60, y: 60, eye: 0, layer: 0 },
      ],
    };
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, packEntries, imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    const dst = (60 * W + 60) * 4;
    expect(imageData.data[dst]).toBe(80);
    expect(imageData.data[dst + 1]).toBe(80);
    expect(imageData.data[dst + 2]).toBe(80);
    expect(imageData.data[dst + 3]).toBe(255);
  });

  it('three no-pack tiles at same origin: later mono wins (deep parallax)', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    patternTable.set([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);
    patternTable.set([0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 32);
    const packEntries = new Map();
    const state = {
      patternTable,
      drawList: [
        { tileIndex: 0, x: 70, y: 70, eye: 0, layer: 0 },
        { tileIndex: 1, x: 70, y: 70, eye: 0, layer: 0 },
        { tileIndex: 2, x: 70, y: 70, eye: 0, layer: 0 },
      ],
    };
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, packEntries, imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    const dst = (70 * W + 70) * 4;
    expect(imageData.data[dst]).toBe(80);
    expect(imageData.data[dst + 1]).toBe(80);
    expect(imageData.data[dst + 2]).toBe(80);
    expect(imageData.data[dst + 3]).toBe(255);
  });

  it('sortDrawsByWorld: lower world id (front) wins when core list has back world last', () => {
    const patternTable = new Uint8Array(2048 * 16);
    const solidTopLeft = [0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    patternTable.set(solidTopLeft, 0);
    patternTable.set([...solidTopLeft.slice(0, 15), 0x01], 16);
    const h0 = hashTile(patternTable.subarray(0, 16));
    const h1 = hashTile(patternTable.subarray(16, 32));
    const packEntries = new Map([
      [h0, rgbaTileSolid(0, 0, 255, 255)],
      [h1, rgbaTileSolid(255, 0, 0, 255)],
    ]);
    const state = {
      patternTable,
      drawList: [
        { tileIndex: 0, x: 100, y: 100, eye: 0, layer: 0, world: 9 },
        { tileIndex: 1, x: 100, y: 100, eye: 0, layer: 0, world: 10 },
      ],
    };
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, packEntries, imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true });
    const dst = (100 * W + 100) * 4;
    expect(imageData.data[dst]).toBe(0);
    expect(imageData.data[dst + 1]).toBe(0);
    expect(imageData.data[dst + 2]).toBe(255);

    const imageData2 = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, packEntries, imageData2, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: false });
    const dst2 = (100 * W + 100) * 4;
    expect(imageData2.data[dst2]).toBe(255);
    expect(imageData2.data[dst2 + 1]).toBe(0);
    expect(imageData2.data[dst2 + 2]).toBe(0);
  });
});

describe('compositeColorFrame painter-v2 tile8 rules', () => {
  it('uses v2 tile8 when variant+hash rule exists', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    const h0 = hashTile(patternTable.subarray(0, 16));
    const packEntries = new Map([[h0, rgbaTileSolid(255, 0, 0, 255)]]);
    const state = {
      patternTable,
      drawList: [{ tileIndex: 0, x: 8, y: 8, eye: 0, layer: 0 }],
    };
    const v2Tile = rgbaTileSolid(0, 255, 0, 255);
    const b64 = Buffer.from(v2Tile).toString('base64');
    const painterV2Rules = {
      schemaVersion: 1,
      tile8ByVariant: {
        menu_main: {
          [String(h0)]: { rgbaBase64: b64 },
        },
      },
    };

    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(
      state,
      packEntries,
      imageData,
      {
        eye: 0,
        overrides: [],
        groups: [],
        brightnessScale: 1,
        stripClip: false,
        objXOffset: 0,
        applyOffsetToAllDraws: false,
        bgXOffset: 0,
        deduplicateDraws: false,
        gameStatePools: null,
        wram: null,
        unpackedMode: 'transparent',
        sortDrawsByWorld: true,
        painterV2Rules,
        painterV2VariantId: 'menu_main',
      },
    );
    const dst = (8 * W + 8) * 4;
    expect(imageData.data[dst]).toBe(0);
    expect(imageData.data[dst + 1]).toBe(255);
    expect(imageData.data[dst + 2]).toBe(0);
    expect(imageData.data[dst + 3]).toBe(255);
  });

  it('falls back to pack when variant rule is missing', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    const h0 = hashTile(patternTable.subarray(0, 16));
    const packEntries = new Map([[h0, rgbaTileSolid(255, 0, 0, 255)]]);
    const state = {
      patternTable,
      drawList: [{ tileIndex: 0, x: 9, y: 9, eye: 0, layer: 0 }],
    };
    const painterV2Rules = {
      schemaVersion: 1,
      tile8ByVariant: {
        another_variant: {
          [String(h0)]: { rgbaBase64: Buffer.from(rgbaTileSolid(0, 255, 0, 255)).toString('base64') },
        },
      },
    };
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(
      state,
      packEntries,
      imageData,
      {
        eye: 0,
        overrides: [],
        groups: [],
        brightnessScale: 1,
        stripClip: false,
        objXOffset: 0,
        applyOffsetToAllDraws: false,
        bgXOffset: 0,
        deduplicateDraws: false,
        gameStatePools: null,
        wram: null,
        unpackedMode: 'transparent',
        sortDrawsByWorld: true,
        painterV2Rules,
        painterV2VariantId: 'menu_main',
      },
    );
    const dst = (9 * W + 9) * 4;
    expect(imageData.data[dst]).toBe(255);
    expect(imageData.data[dst + 1]).toBe(0);
    expect(imageData.data[dst + 2]).toBe(0);
    expect(imageData.data[dst + 3]).toBe(255);
  });
});

describe('compositeColorFrame group-scoped tile colour', () => {
  // The intro cinematic case: one solid pattern drawn across several worlds, each needing
  // its own colour. Two draws of the SAME pattern, in different worlds.
  function scene({ groups, packEntries = new Map(), wram = null, pools = null }) {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    const drawList = [
      { tileIndex: 0, x: 10, y: 10, eye: 0, layer: 0, world: 4 },
      { tileIndex: 0, x: 40, y: 10, eye: 0, layer: 0, world: 26 },
    ];
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(
      { patternTable, masterBrightness: 1, drawList }, packEntries, imageData,
      {
        eye: 0,
        overrides: [],
        groups,
        brightnessScale: 1,
        stripClip: false,
        objXOffset: 0,
        applyOffsetToAllDraws: false,
        bgXOffset: 0,
        deduplicateDraws: false,
        gameStatePools: pools,
        wram,
        unpackedMode: 'transparent',
        sortDrawsByWorld: true,
        painterV2Rules: null,
        painterV2VariantId: null,
        unpackedMinCoverage: 2,
        diagnosticMonoFallback: false,
        renderUnpackedFallback: false,
        monoFallbackGain: 1,
      },
    );
    return (x) => Array.from(imageData.data.slice((10 * W + x) * 4, (10 * W + x) * 4 + 4));
  }

  const HASH = hashTile(
    (() => {
      const pt = new Uint8Array(16);
      pt.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      return pt;
    })(),
  );

  function group(id, world, rgba) {
    return withGroupTileColor(
      { id, name: id, criteria: { windowIds: [world], layers: [0], hashes: [HASH] } },
      HASH,
      rgba,
    );
  }

  it('gives one pattern a different colour in each world', () => {
    const at = scene({
      groups: [
        group('clouds', 26, rgbaTileSolid(90, 40, 210, 255)),
        group('hills', 4, rgbaTileSolid(10, 200, 30, 255)),
      ],
    });
    expect(at(10)).toEqual([10, 200, 30, 255]);
    expect(at(40)).toEqual([90, 40, 210, 255]);
  });

  it('beats the global pack colour for draws the group claims', () => {
    const at = scene({
      groups: [group('clouds', 26, rgbaTileSolid(90, 40, 210, 255))],
      packEntries: new Map([[HASH, rgbaTileSolid(200, 200, 0, 255)]]),
    });
    // World 4 is not in the group, so it keeps the pack colour.
    expect(at(10)).toEqual([200, 200, 0, 255]);
    expect(at(40)).toEqual([90, 40, 210, 255]);
  });

  it('leaves draws alone when no group claims them', () => {
    const at = scene({ groups: [group('clouds', 26, rgbaTileSolid(90, 40, 210, 255))] });
    expect(at(10)).toEqual([0, 0, 0, 0]);
  });

  it('respects the layer in a group’s criteria', () => {
    const g = withGroupTileColor(
      { id: 'obj', criteria: { windowIds: [4], layers: [2], hashes: [HASH] } },
      HASH,
      rgbaTileSolid(5, 5, 5, 255),
    );
    // Both draws are layer 0, so a layer-2 group must not colour either.
    const at = scene({ groups: [g] });
    expect(at(10)).toEqual([0, 0, 0, 0]);
    expect(at(40)).toEqual([0, 0, 0, 0]);
  });

  it('picks up a colour painted into a live map after the first render', () => {
    // The tools paint into a Map on the group and keep the same groups array. Caching the
    // index from the first render would freeze the group as unpainted forever.
    const live = new Map();
    const g = { id: 'clouds', criteria: { windowIds: [26], layers: [0], hashes: [HASH] }, tileColors: live };
    const groups = [g];
    expect(scene({ groups })(40)).toEqual([0, 0, 0, 0]);

    live.set(HASH, rgbaTileSolid(90, 40, 210, 255));
    expect(scene({ groups })(40)).toEqual([90, 40, 210, 255]);
  });

  it('paints regardless of the game state the group was authored in', () => {
    // The Project tool stamps the active pool variant onto every new group. Gating colour on
    // it would make paint vanish as soon as the game left that state — including right after
    // Save and Play, which is the authoring loop.
    const gated = {
      ...group('clouds', 26, rgbaTileSolid(90, 40, 210, 255)),
      ramConditions: [{ offset: 0x100, expectedValue: 0x7f }],
    };
    const wram = new Uint8Array(0x10000);
    wram[0x100] = 0x01; // the gate would fail
    expect(scene({ groups: [gated], wram })(40)).toEqual([90, 40, 210, 255]);
    expect(scene({ groups: [gated] })(40)).toEqual([90, 40, 210, 255]);
  });

  it('hides a group limited to other screens, and shows it when the memory is unknown', () => {
    // group.screens (src/screen-gate.js): opt-in gating by the screens Analyze memory recognises.
    const pools = [{ id: 'pool-menu', label: 'GameMenu', variants: [{ id: '__default__', ramConditions: [{ offset: 0x100, expectedValue: 5 }] }] }];
    const g = { ...group('clouds', 26, rgbaTileSolid(90, 40, 210, 255)), screens: { mode: 'except', pools: ['pool-menu'] } };
    const menu = new Uint8Array(0x10000);
    menu[0x100] = 5;
    const game = new Uint8Array(0x10000);
    expect(scene({ groups: [g], wram: menu, pools })(40)).toEqual([0, 0, 0, 0]);
    expect(scene({ groups: [g], wram: game, pools })(40)).toEqual([90, 40, 210, 255]);
    expect(scene({ groups: [g], pools })(40)).toEqual([90, 40, 210, 255]);
  });
});

describe('compositeColorFrame: groups that follow the game palette', () => {
  // Mario's Tennis menu: the selected option is drawn with palette 0 (pixel value 1 → shade 3),
  // the rest with palette 1 (pixel value 1 → shade 1). GPLT entries: 2 bits per pixel value.
  const GPLT = [3 << 2, 1 << 2, 0, 0];
  function menu(followPalette) {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0); // pixel 0,0 = value 1
    const hash = hashTile(patternTable.subarray(0, 16));
    const g = withGroupTileColor({ id: 'text', criteria: { windowIds: [31], layers: [0], hashes: [hash] }, ...(followPalette && { followPalette: true }) }, hash, rgbaTileSolid(255, 255, 255, 255));
    const state = {
      patternTable, gplt: GPLT, masterBrightness: 1,
      drawList: [
        { tileIndex: 0, x: 10, y: 10, eye: 0, layer: 0, world: 31, paletteSelector: 0 },
        { tileIndex: 0, x: 40, y: 10, eye: 0, layer: 0, world: 31, paletteSelector: 1 },
      ],
    };
    const img = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, new Map(), img, { eye: 0, overrides: [], groups: [g], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 2, diagnosticMonoFallback: false, renderUnpackedFallback: false, monoFallbackGain: 1 });
    return (x) => Array.from(img.data.slice((10 * W + x) * 4, (10 * W + x) * 4 + 4));
  }

  it('dims paint drawn with a dimmer palette than the brightest the layer uses', () => {
    const at = menu(true);
    expect(at(10)).toEqual([255, 255, 255, 255]); // selected: shade 3 of 3
    expect(at(40)).toEqual([85, 85, 85, 255]); // unselected: shade 1 of 3
  });

  it('leaves paint alone without the option', () => {
    const at = menu(false);
    expect(at(10)).toEqual([255, 255, 255, 255]);
    expect(at(40)).toEqual([255, 255, 255, 255]);
  });
});

describe('compositeColorFrame animated tiles (the game rewrites a slot each step)', () => {
  // IntroCin's starfield: the same tile slot drawn in the same place, its pixels rewritten per
  // twinkle step. Phase A was painted; phase B is the same slot a step later.
  const PHASE_A = [0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // pixel 0,0 = shade 3
  const PHASE_B = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // pixel 0,0 = shade 2
  const HASH_A = hashTile(new Uint8Array(PHASE_A));
  const RAMP = [null, '#102030', '#405060', '#708090'];

  function starfield(extra = {}) {
    return withGroupTileColor(
      { id: 'stars', criteria: { windowIds: [30], layers: [0], hashes: [HASH_A], tileSlots: [5] }, shadeRamp: RAMP, ...extra },
      HASH_A,
      rgbaTileSolid(250, 240, 10, 255),
    );
  }

  /** Draw slot 5 (holding `content`) in world 30, plus the same content in slot 6 and in world 4. */
  function frame(content, groups) {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set(content, 5 * 16);
    patternTable.set(content, 6 * 16);
    const drawList = [
      { tileIndex: 5, x: 10, y: 10, eye: 0, layer: 0, world: 30 },
      { tileIndex: 6, x: 40, y: 10, eye: 0, layer: 0, world: 30 },
      { tileIndex: 5, x: 70, y: 10, eye: 0, layer: 0, world: 4 },
    ];
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(
      { patternTable, masterBrightness: 1, drawList }, new Map(), imageData,
      {
        eye: 0,
        overrides: [],
        groups,
        brightnessScale: 1,
        stripClip: false,
        objXOffset: 0,
        applyOffsetToAllDraws: false,
        bgXOffset: 0,
        deduplicateDraws: false,
        gameStatePools: null,
        wram: null,
        unpackedMode: 'transparent',
        sortDrawsByWorld: true,
        painterV2Rules: null,
        painterV2VariantId: null,
        unpackedMinCoverage: 2,
        diagnosticMonoFallback: false,
        renderUnpackedFallback: false,
        monoFallbackGain: 1,
      },
    );
    return (x) => Array.from(imageData.data.slice((10 * W + x) * 4, (10 * W + x) * 4 + 4));
  }

  it('keeps the exact paint on the phase that was painted', () => {
    expect(frame(PHASE_A, [starfield()])(10)).toEqual([250, 240, 10, 255]);
  });

  it('colours a phase nobody painted from the ramp, by its shades', () => {
    expect(frame(PHASE_B, [starfield()])(10)).toEqual([0x40, 0x50, 0x60, 255]);
  });

  it('claims only its own slots, in its own worlds', () => {
    const at = frame(PHASE_B, [starfield()]);
    expect(at(40)).not.toEqual([0x40, 0x50, 0x60, 255]); // slot 6
    expect(at(70)).not.toEqual([0x40, 0x50, 0x60, 255]); // world 4
  });

  it('does nothing for a group that is not animated', () => {
    const plain = starfield();
    delete plain.criteria.tileSlots;
    expect(frame(PHASE_B, [plain])(10)).not.toEqual([0x40, 0x50, 0x60, 255]);
  });

  it('fades the ramp colour with the frame, like painted tiles', () => {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set(PHASE_B, 5 * 16);
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(
      { patternTable, masterBrightness: 0.5, drawList: [{ tileIndex: 5, x: 10, y: 10, eye: 0, layer: 0, world: 30 }] },
      new Map(), imageData,
      {
        eye: 0,
        overrides: [],
        groups: [starfield()],
        brightnessScale: 1,
        stripClip: false,
        objXOffset: 0,
        applyOffsetToAllDraws: false,
        bgXOffset: 0,
        deduplicateDraws: false,
        gameStatePools: null,
        wram: null,
        unpackedMode: 'transparent',
        sortDrawsByWorld: true,
        painterV2Rules: null,
        painterV2VariantId: null,
        unpackedMinCoverage: 2,
        diagnosticMonoFallback: false,
        renderUnpackedFallback: false,
        monoFallbackGain: 1,
      },
    );
    expect(Array.from(imageData.data.slice((10 * W + 10) * 4, (10 * W + 10) * 4 + 3))).toEqual([0x20, 0x28, 0x30]);
  });
});

describe('compositeColorFrame coverage prepass', () => {
  // The prepass is skipped when no draw can reach the unpainted-tile path. These pin the
  // cases where that decision must not change what gets drawn.
  function frame({ packAll, minCoverage, drawList }) {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);
    patternTable.set([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 32);
    const h0 = hashTile(patternTable.subarray(0, 16));
    const h2 = hashTile(patternTable.subarray(32, 48));
    const packEntries = new Map([[h0, rgbaTileSolid(10, 200, 30, 255)]]);
    if (packAll) packEntries.set(h2, rgbaTileSolid(90, 40, 210, 255));
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(
      { patternTable, masterBrightness: 1, drawList }, packEntries, imageData,
      {
        eye: 0,
        overrides: [],
        groups: [],
        brightnessScale: 1,
        stripClip: false,
        objXOffset: 0,
        applyOffsetToAllDraws: false,
        bgXOffset: 0,
        deduplicateDraws: false,
        gameStatePools: null,
        wram: null,
        unpackedMode: 'transparent',
        sortDrawsByWorld: true,
        painterV2Rules: null,
        painterV2VariantId: null,
        unpackedMinCoverage: minCoverage,
        diagnosticMonoFallback: false,
        renderUnpackedFallback: true,
        monoFallbackGain: 1,
      },
    );
    return (x, y) => Array.from(imageData.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
  }

  it('paints every pattern the same when the pack covers them all', () => {
    const at = frame({
      packAll: true,
      minCoverage: 2,
      drawList: [
        { tileIndex: 0, x: 10, y: 10, eye: 0, layer: 0 },
        { tileIndex: 2, x: 40, y: 10, eye: 0, layer: 0 },
      ],
    });
    expect(at(10, 10)).toEqual([10, 200, 30, 255]);
    expect(at(40, 10)).toEqual([90, 40, 210, 255]);
  });

  it('still applies the coverage floor when a pattern is unpainted', () => {
    // One draw covers this pixel, below the floor of 2, so the mono fallback stays off.
    const thin = frame({
      packAll: false,
      minCoverage: 2,
      drawList: [{ tileIndex: 2, x: 40, y: 10, eye: 0, layer: 0 }],
    });
    expect(thin(40, 10)).toEqual([0, 0, 0, 0]);

    // Two draws stack on it, so it clears the floor and the fallback renders.
    const stacked = frame({
      packAll: false,
      minCoverage: 2,
      drawList: [
        { tileIndex: 2, x: 40, y: 10, eye: 0, layer: 0 },
        { tileIndex: 2, x: 41, y: 10, eye: 0, layer: 0 },
      ],
    });
    expect(stacked(41, 10)[3]).toBe(255);
  });

  it('renders an unpainted tile at a floor of 1', () => {
    const at = frame({
      packAll: false,
      minCoverage: 1,
      drawList: [{ tileIndex: 2, x: 40, y: 10, eye: 0, layer: 0 }],
    });
    expect(at(40, 10)[3]).toBe(255);
  });
});

describe('compositeColorFrame monoFallbackGain', () => {
  function run(gain) {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x0e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    patternTable.set([0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);
    const packed = hashTile(patternTable.subarray(16, 32));
    const state = {
      patternTable,
      masterBrightness: 0.5,
      drawList: [
        { tileIndex: 0, x: 10, y: 10, eye: 0, layer: 2 },
        { tileIndex: 1, x: 40, y: 10, eye: 0, layer: 2 },
      ],
    };
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    const packEntries = new Map([[packed, rgbaTileSolid(100, 60, 20, 255)]]);
    compositeColorFrame(
      state, packEntries, imageData,
      {
        eye: 0,
        overrides: [],
        groups: [],
        brightnessScale: 1,
        stripClip: false,
        objXOffset: 0,
        applyOffsetToAllDraws: false,
        bgXOffset: 0,
        deduplicateDraws: false,
        gameStatePools: null,
        wram: null,
        unpackedMode: 'transparent',
        sortDrawsByWorld: true,
        painterV2Rules: null,
        painterV2VariantId: null,
        unpackedMinCoverage: 1,
        diagnosticMonoFallback: true,
        renderUnpackedFallback: true,
        monoFallbackGain: gain,
      },
    );
    const px = (x) => Array.from(imageData.data.slice((10 * W + x) * 4, (10 * W + x) * 4 + 4));
    return { monoLevel2: px(10), monoLevel3: px(11), painted: px(40) };
  }

  it('leaves the preview unchanged at the default gain', () => {
    const out = run(undefined);
    expect(out.monoLevel2).toEqual([80, 0, 0, 255]);
    expect(out.monoLevel3).toEqual([127, 0, 0, 255]);
  });

  it('brightens unpainted mono pixels and clamps at 255', () => {
    const out = run(3);
    expect(out.monoLevel2).toEqual([240, 0, 0, 255]);
    expect(out.monoLevel3).toEqual([255, 0, 0, 255]);
  });

  it('does not change painted pack colors', () => {
    expect(run(3).painted).toEqual(run(1).painted);
  });
});

describe('compositeColorFrame: BG tiles cut by the top of their window', () => {
  // The core records a BG tile only on its top scanline, so a tile hanging off the top of
  // the screen is missing from the draw list even though the mono frame shows its lower rows.
  function stateWithWorldAbove(gy) {
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.fill(0xff, 16, 32); // tile 1: every pixel shade 3
    const windows = new Uint8Array(1024);
    const wr = (off, v) => {
      windows[off] = v & 0xff;
      windows[off + 1] = (v >> 8) & 0xff;
    };
    const b = 31 * 32;
    wr(b, 0xc000); // both eyes, normal BG, map segment 0
    wr(b + 6, gy & 0xffff);
    wr(b + 14, 383);
    wr(b + 16, 223);
    wr(30 * 32, 0x40); // END
    const segments = Array.from({ length: 16 }, () => new Uint8Array(0x2000));
    for (let i = 0; i < 0x1000; i++) segments[0][i * 2] = 1; // every map cell → tile 1
    // What the core records: every tile whose top row is on screen, none of the cut row.
    const drawList = [];
    for (let y = gy + 8; y <= 223; y += 8) {
      for (let x = 0; x < 384; x += 8) drawList.push({ tileIndex: 1, x, y, eye: 0, world: 31, layer: 0, strip: y >> 3 });
    }
    return { patternTable, windows, segments, drawList };
  }

  it('colours the visible rows of the cut tiles, like the mono frame shows them', () => {
    const state = stateWithWorldAbove(-3);
    const h1 = hashTile(state.patternTable.subarray(16, 32));
    const packEntries = new Map([[h1, rgbaTileSolid(0, 200, 0, 255)]]);
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, packEntries, imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    for (const [x, y] of [[0, 0], [100, 2], [383, 4]]) {
      const dst = (y * W + x) * 4;
      expect([imageData.data[dst], imageData.data[dst + 1], imageData.data[dst + 3]], `pixel ${x},${y}`).toEqual([0, 200, 255]);
    }
  });

  it('does not add anything to the draw list the caller passed in', () => {
    const state = stateWithWorldAbove(-3);
    const before = state.drawList.length;
    const imageData = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, new Map(), imageData, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent' });
    expect(state.drawList.length).toBe(before);
  });
});
