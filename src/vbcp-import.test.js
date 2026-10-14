import { describe, expect, it } from 'vitest';
import { parseVbcp } from './vbcp.js';
import { importVbcp, summarizeVbcp, vbcpRomMatches, describeLeftOut } from './vbcp-import.js';
import { parseVBColorPack, buildVBColorPack } from './vbcolor-pack.js';
import { crc32 } from './rom-identity.js';
import { buildVbcp } from '../tests/fixtures/vbcp.js';

const painted = (rgb) => ({ mask: 1n, rgb: { 0: rgb } });
const pack = parseVbcp(
  buildVbcp({
    tiles: [
      { hash: 1, ...painted([10, 20, 30]) },
      { hash: 2, ...painted([40, 50, 60]) },
    ],
    layers: [{ hash: 2, world: 17, ...painted([1, 2, 3]) }],
    palettes: [{ hash: 3, palette: 1, mask: 1n }],
    contexts: { groups: [[4]], tiles: [{ hash: 5, group: 0, mask: 1n }] },
  }),
);
const now = () => Date.UTC(2026, 9, 13);

describe('importVbcp', () => {
  it('brings the tile colours in as shared colours, makes no groups, and says what it left out', () => {
    const groups = [{ id: 'mine', name: 'Mine' }];
    const { parts, log } = importVbcp({ groups }, pack, { fileName: 'wario.vbcp', now });
    const shared = parseVBColorPack(parts.vbcolor).entries;
    expect([...shared.get(1).slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect([...shared.get(2).slice(0, 4)]).toEqual([40, 50, 60, 255]);
    expect(shared.size).toBe(2);
    expect(parts.groups).toBe(groups);
    expect(log.join(' ')).toMatch(/Not brought in: 1 per-layer, 1 per-palette, 1 per-character tile colour\(s\)/);
    expect(parts.manifest.vbcpImports).toEqual([{ from: expect.stringContaining('VBoy Color'), file: 'wario.vbcp', at: '2026-10-13T00:00:00.000Z', tilesAdded: 2 }]);
  });

  it('never replaces a shared colour the project already has', () => {
    const mine = new Map([[1, new Uint8Array(256).fill(7)]]);
    const { parts } = importVbcp({ vbcolor: buildVBColorPack('wario', mine), manifest: { gameId: 'wario' } }, pack, { now });
    const shared = parseVBColorPack(parts.vbcolor).entries;
    expect(shared.get(1)[0]).toBe(7);
    expect(shared.get(2)[0]).toBe(40);
  });

  it('brings nothing in again, and says so, when every tile already has colours', () => {
    const first = importVbcp({}, pack, { now }).parts;
    const again = importVbcp(first, pack, { now });
    expect(again.parts.vbcolor).toBe(first.vbcolor);
    expect(again.log[0]).toMatch(/Nothing new to bring in/);
    expect(again.parts.manifest.vbcpImports).toHaveLength(2);
  });

  it('does not change the parts it was given', () => {
    const parts = { groups: [], manifest: { gameId: 'x' } };
    importVbcp(parts, pack, { now });
    expect(parts).toEqual({ groups: [], manifest: { gameId: 'x' } });
  });
});

describe('summarizeVbcp, describeLeftOut and the ROM check', () => {
  it('counts what is new and what is left out', () => {
    const s = summarizeVbcp({}, pack);
    expect(s).toMatchObject({ tiles: 2, newTiles: 2, alreadyColoured: 0, pixels: 2, skipped: { layer: 1, palette: 1, cells: 0, characters: 1 }, romMatches: null });
    expect(describeLeftOut(s.skipped)).toBe('1 per-layer, 1 per-palette, 1 per-character tile colour(s)');
    expect(describeLeftOut({ layer: 0, palette: 0, cells: 0, characters: 0 })).toBe('');
  });

  it('matches the ROM by CRC-32 and size', () => {
    const rom = new Uint8Array([1, 2, 3, 4]);
    const crc = parseInt(crc32(rom), 16);
    const made = (r) => parseVbcp(buildVbcp({ tiles: [], rom: r }));
    expect(vbcpRomMatches({ rom }, made({ crc, size: 4 }))).toBe(true);
    expect(vbcpRomMatches({ rom }, made({ crc: (crc ^ 1) >>> 0, size: 4 }))).toBe(false);
    expect(vbcpRomMatches({}, made({ crc, size: 4 }))).toBe(null);
  });
});
