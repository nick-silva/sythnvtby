import { describe, expect, it } from 'vitest';
import { parseVbcp, vbcpTileToRgba, vbcpPaintedPixels } from './vbcp.js';
import { buildVbcp } from '../tests/fixtures/vbcp.js';

const red = { hash: 0xdeadbeef, mask: 0b101n, rgb: { 0: [255, 0, 0], 2: [0, 0, 255] } };

describe('parseVbcp', () => {
  it('reads tiles, layer, palette and map-cell variants, contexts and the ROM footer', () => {
    const bytes = buildVbcp({
      tiles: [red],
      layers: [{ hash: 7, world: 17, mask: 1n, rgb: { 0: [1, 2, 3] } }],
      left: [{ hash: 9, mask: 3n }],
      palettes: [{ hash: 8, palette: 2, mask: 1n }],
      cells: [{ cell: 0x1234, palette: 1, hash: 5, mask: 2n, keep: 4n }],
      contexts: { groups: [[11, 12]], tiles: [{ hash: 13, group: 0, mask: 1n }] },
      rom: { crc: 0x133e9372, size: 2097152 },
    });
    const v = parseVbcp(bytes);
    expect(v.version).toBe(3);
    expect(v.tiles.get(0xdeadbeef).mask).toBe(0b101n);
    expect(v.layerTiles).toEqual([{ hash: 7, world: 17, tile: expect.objectContaining({ mask: 1n }) }]);
    expect(v.leftUncoloured.get(9)).toBe(3n);
    expect(v.paletteTiles[0]).toMatchObject({ hash: 8, palette: 2 });
    expect(v.cellTiles[0]).toMatchObject({ cell: 0x1234, palette: 1, hash: 5, mask: 2n, keep: 4n });
    expect(v.referenceLevel).toBe(40);
    expect(v.contextGroups).toEqual([[11, 12]]);
    expect(v.contextTiles[0]).toMatchObject({ hash: 13, group: 0 });
    expect(v.rom).toEqual({ crc: 0x133e9372, size: 2097152 });
  });

  it('reads an older version 1 pack (tiles only)', () => {
    const v = parseVbcp(buildVbcp({ version: 1, tiles: [red] }));
    expect(v.version).toBe(1);
    expect(v.tiles.size).toBe(1);
    expect(v.layerTiles).toEqual([]);
  });

  it('refuses a file that is not a pack, or one cut short', () => {
    expect(() => parseVbcp(new TextEncoder().encode('PK not a vbcp file at all'))).toThrow(/Not a VBoy Color pack/);
    expect(() => parseVbcp(buildVbcp({ tiles: [red] }).slice(0, 40))).toThrow(/cut short/);
  });
});

describe('vbcpTileToRgba', () => {
  it('is opaque where painted, clear elsewhere, in the same pixel order as our tile paint', () => {
    const tile = parseVbcp(buildVbcp({ tiles: [red] })).tiles.get(0xdeadbeef);
    const rgba = vbcpTileToRgba(tile);
    expect([...rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...rgba.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...rgba.slice(8, 12)]).toEqual([0, 0, 255, 255]);
    expect(vbcpPaintedPixels(tile)).toBe(2);
  });
});
