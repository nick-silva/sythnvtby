/**
 * Tests for Phase 1A: tile extraction and vbstate validation.
 * Run: npm test (or npm run test:watch).
 */

import { describe, it, expect } from 'vitest';
import { extractTilesFromDump, extractTilesFromPatternTable, exportTileManifest } from './tile-extractor.js';
import { serializeVIPState, validateVIPState } from './vip-dump.js';
import { hashTile, getTileBytes, BYTES_PER_TILE, PATTERN_TABLE_SIZE } from './vip-state.js';

describe('validateVIPState', () => {
  it('reports invalid for non-object', () => {
    const r = validateVIPState(null);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Not an object');
  });

  it('reports invalid when pattern table is missing', () => {
    const r = validateVIPState({ drawList: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('pattern table'))).toBe(true);
  });

  it('reports valid for minimal vbstate with pattern table and drawList', () => {
    const patternTable = new Uint8Array(PATTERN_TABLE_SIZE);
    patternTable.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 0);
    const obj = {
      patternTableBase64: btoa(String.fromCharCode(...patternTable)),
      drawList: [{ tileIndex: 0, x: 10, y: 20, flipH: false, flipV: false }],
      segmentCount: 16,
    };
    const r = validateVIPState(obj);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('reports warnings for empty drawList', () => {
    const patternTable = new Uint8Array(PATTERN_TABLE_SIZE);
    const obj = {
      patternTableBase64: btoa(String.fromCharCode(...patternTable)),
      drawList: [],
    };
    const r = validateVIPState(obj);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes('empty'))).toBe(true);
  });
});

describe('extractTilesFromDump', () => {
  it('extracts unique tiles from minimal vbstate', () => {
    const patternTable = new Uint8Array(PATTERN_TABLE_SIZE);
    for (let i = 0; i < BYTES_PER_TILE; i++) patternTable[i] = i + 1;
    patternTable.set([0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], BYTES_PER_TILE);
    const state = {
      patternTable,
      oam: new Uint8Array(0),
      segments: [],
      windows: new Uint8Array(0),
      drawList: [{ tileIndex: 0, x: 0, y: 0 }, { tileIndex: 1, x: 8, y: 0 }],
    };
    const serialized = serializeVIPState(state);
    const { tiles, dump } = extractTilesFromDump(serialized);
    expect(dump.patternTable).toBeDefined();
    expect(dump.patternTable.length).toBe(PATTERN_TABLE_SIZE);
    expect(dump.drawList).toHaveLength(2);
    const hash0 = hashTile(getTileBytes(dump.patternTable, 0));
    const hash1 = hashTile(getTileBytes(dump.patternTable, 1));
    expect(tiles.has(hash0)).toBe(true);
    expect(tiles.has(hash1)).toBe(true);
    expect(tiles.size).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates identical tiles by hash', () => {
    const patternTable = new Uint8Array(PATTERN_TABLE_SIZE).fill(0xaa);
    const state = {
      patternTable,
      oam: new Uint8Array(0),
      segments: [],
      windows: new Uint8Array(0),
      drawList: [{ tileIndex: 0, x: 0, y: 0 }, { tileIndex: 1, x: 8, y: 0 }],
    };
    const { tiles } = extractTilesFromDump(serializeVIPState(state));
    expect(tiles.size).toBe(1);
  });
});

describe('exportTileManifest', () => {
  it('produces loadable manifest with hash and dataBase64', () => {
    const patternTable = new Uint8Array(PATTERN_TABLE_SIZE);
    patternTable.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 0);
    const tiles = extractTilesFromPatternTable(patternTable);
    const manifest = exportTileManifest(tiles);
    expect(manifest.version).toBe(1);
    expect(Array.isArray(manifest.tiles)).toBe(true);
    expect(manifest.tiles.length).toBeGreaterThan(0);
    const first = manifest.tiles[0];
    expect(typeof first.hash).toBe('number');
    expect(typeof first.dataBase64).toBe('string');
    const decoded = Uint8Array.from(atob(first.dataBase64), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(16);
  });
});
