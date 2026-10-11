import { describe, it, expect } from 'vitest';
import {
  OBJ_LAYER,
  objTilesByHash,
  affineTilesByHash,
  tilesByHash,
  addStateToCoverage,
  buildCoverage,
  coverageSize,
  emptyCoverage,
  findUncoveredTiles,
  normalizeCaptureKinds,
  describeCaptureKinds,
  describeUncovered,
} from './auto-capture.js';
import { getTileBytes, hashTile } from './vip-state.js';

const BYTES_PER_TILE = 16;

/** Pattern table where tile i is filled with byte value `fills[i]` (0 = blank). */
function patternTable(fills) {
  const pt = new Uint8Array(fills.length * BYTES_PER_TILE);
  fills.forEach((v, i) => pt.fill(v, i * BYTES_PER_TILE, (i + 1) * BYTES_PER_TILE));
  return pt;
}

const obj = (tileIndex, x = 0, y = 0, eye = 0) => ({ tileIndex, x, y, eye, layer: OBJ_LAYER });
const bg = (tileIndex, x = 0, y = 0) => ({ tileIndex, x, y, eye: 0, layer: 0 });

// Tiles: 0 blank, 1..3 distinct patterns, 4 a copy of 1's pattern.
const pt = patternTable([0, 0x11, 0x22, 0x33, 0x11]);
const hashOf = (i) => hashTile(getTileBytes(pt, i)) >>> 0;

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

/**
 * World 31 affine on the left eye (world 30 END), zoomed 2×: map cell (0,0) is character 1, the
 * rest character 0 (blank). Character 1 then covers screen pixels 0–15 × 0–15: four 8×8 cells.
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
  for (let y = 0; y < 224; y++) {
    const p = (PARAM_H + 8 * y - 0x8000) * 2;
    wr16(segments[8], p + 4, y * 4);
    wr16(segments[8], p + 6, 256);
  }
  const table = new Uint8Array(2048 * 16);
  for (let r = 0; r < 8; r++) wr16(table, 16 + r * 2, 0x5555);
  return { windows, segments, patternTable: table, drawList: [] };
}

describe('objTilesByHash', () => {
  it('collects OBJ patterns on the left eye, skipping blanks and BG', () => {
    const state = { patternTable: pt, drawList: [obj(0), obj(1), obj(2), bg(3)] };
    const m = objTilesByHash(state);
    expect([...m.keys()].sort()).toEqual([hashOf(1), hashOf(2)].sort());
  });

  it('treats two tile slots holding the same pixels as one pattern', () => {
    const state = { patternTable: pt, drawList: [obj(1, 0, 0), obj(4, 8, 0)] };
    const m = objTilesByHash(state);
    expect(m.size).toBe(1);
    expect(m.get(hashOf(1)).length).toBe(2);
  });

  it('ignores the right eye', () => {
    const state = { patternTable: pt, drawList: [obj(1, 0, 0, 1)] };
    expect(objTilesByHash(state).size).toBe(0);
  });

  it('handles an empty or partial state', () => {
    expect(objTilesByHash(null).size).toBe(0);
    expect(objTilesByHash({ drawList: [obj(1)] }).size).toBe(0);
  });
});

describe('tilesByHash', () => {
  it('collects background patterns from the BG layer only', () => {
    const state = { patternTable: pt, drawList: [bg(1), bg(0), obj(2)] };
    expect([...tilesByHash(state, 'bg').keys()]).toEqual([hashOf(1)]);
    expect([...tilesByHash(state, 'obj').keys()]).toEqual([hashOf(2)]);
  });

  it('finds scaled (affine) patterns by sampling the world, with the screen cells they light', () => {
    const st = affineFrame();
    const m = affineTilesByHash(st);
    const h1 = hashTile(getTileBytes(st.patternTable, 1)) >>> 0;
    expect([...m.keys()]).toEqual([h1]);
    expect(m.get(h1).map((d) => `${d.x},${d.y}`).sort()).toEqual(['0,0', '0,8', '8,0', '8,8']);
    expect(tilesByHash(st, 'affine').size).toBe(1);
  });

  it('finds no affine patterns on a frame without affine worlds', () => {
    expect(affineTilesByHash({ patternTable: pt, drawList: [bg(1)] }).size).toBe(0);
  });
});

describe('coverage', () => {
  it('builds from captured frames, per kind, and reports what was new', () => {
    const a = { patternTable: pt, drawList: [obj(1), obj(2), bg(3)] };
    const b = { patternTable: pt, drawList: [obj(2), obj(3)] };
    const coverage = buildCoverage([a]);
    expect(coverage.obj.size).toBe(2);
    expect(coverage.bg.size).toBe(1);
    expect(coverageSize(coverage)).toBe(3);
    expect(coverageSize(coverage, ['obj'])).toBe(2);
    expect(addStateToCoverage(coverage, b)).toBe(1);
    expect(coverage.obj.has(hashOf(3))).toBe(true);
  });

  it('builds an empty coverage from nothing', () => {
    expect(coverageSize(buildCoverage([]))).toBe(0);
    expect(coverageSize(buildCoverage(null))).toBe(0);
    expect(coverageSize(emptyCoverage())).toBe(0);
  });
});

describe('findUncoveredTiles', () => {
  const captured = buildCoverage([{ patternTable: pt, drawList: [obj(1)] }]);

  it('finds only patterns no captured frame shows', () => {
    const live = { patternTable: pt, drawList: [obj(1), obj(2, 16, 8), obj(3, 24, 8)] };
    const hits = findUncoveredTiles(live, captured, ['obj']);
    expect(hits.map((h) => h.hash).sort()).toEqual([hashOf(2), hashOf(3)].sort());
    expect(hits.find((h) => h.hash === hashOf(2))).toMatchObject({ kind: 'obj', draws: [{ x: 16, y: 8 }] });
  });

  it('watches only the kinds asked for', () => {
    const live = { patternTable: pt, drawList: [bg(2), obj(3)] };
    expect(findUncoveredTiles(live, captured, ['obj']).map((h) => h.kind)).toEqual(['obj']);
    expect(findUncoveredTiles(live, captured, ['bg']).map((h) => h.kind)).toEqual(['bg']);
    expect(findUncoveredTiles(live, captured, ['bg', 'obj']).length).toBe(2);
  });

  it('keeps kinds apart: a pattern captured as a sprite is still new as a background tile', () => {
    const live = { patternTable: pt, drawList: [bg(1)] };
    expect(findUncoveredTiles(live, captured, ['bg']).map((h) => h.hash)).toEqual([hashOf(1)]);
  });

  it('is quiet on a frame whose sprites are all captured, or that has none', () => {
    expect(findUncoveredTiles({ patternTable: pt, drawList: [obj(1), obj(4)] }, captured)).toEqual([]);
    expect(findUncoveredTiles({ patternTable: pt, drawList: [bg(2), obj(0)] }, captured)).toEqual([]);
  });

  it('stops reporting a pattern once it is added — so a dismissed tile does not re-trigger', () => {
    const coverage = buildCoverage([{ patternTable: pt, drawList: [obj(1)] }]);
    const live = { patternTable: pt, drawList: [obj(2)] };
    expect(findUncoveredTiles(live, coverage).length).toBe(1);
    addStateToCoverage(coverage, live);
    expect(findUncoveredTiles(live, coverage)).toEqual([]);
  });
});

describe('capture kinds', () => {
  it('cleans up a stored choice: known kinds, chooser order, sprites when empty', () => {
    expect(normalizeCaptureKinds(['affine', 'bg', 'nope'])).toEqual(['bg', 'affine']);
    expect(normalizeCaptureKinds([])).toEqual(['obj']);
    expect(normalizeCaptureKinds('obj')).toEqual(['obj']);
  });

  it('describes the kinds and what was new in words', () => {
    expect(describeCaptureKinds(['obj'])).toBe('sprite');
    expect(describeCaptureKinds(['bg', 'obj', 'affine'])).toBe('background, sprite and scaled');
    expect(describeUncovered([{ kind: 'affine' }, { kind: 'obj' }, { kind: 'obj' }])).toBe('2 new sprite tile(s), 1 new scaled tile(s)');
  });
});
