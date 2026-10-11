import { describe, it, expect } from 'vitest';
import {
  decodeGroupTileColors,
  encodeGroupTileColors,
  withGroupTileColor,
  withoutGroupTileColor,
  withoutAnyGroupTileColor,
  groupTileColorHashes,
  groupTileColorCount,
  groupWithEncodedTileColors,
  TILE_RGBA_BYTES,
} from './group-tile-colors.js';

function tile(r, g, b, a = 255) {
  const u = new Uint8Array(TILE_RGBA_BYTES);
  for (let i = 0; i < 64; i++) {
    u[i * 4] = r;
    u[i * 4 + 1] = g;
    u[i * 4 + 2] = b;
    u[i * 4 + 3] = a;
  }
  return u;
}

describe('group tile colours', () => {
  it('has none on a plain group', () => {
    const g = { id: 'a', criteria: {} };
    expect(groupTileColorCount(g)).toBe(0);
    expect(decodeGroupTileColors(g).size).toBe(0);
  });

  it('round-trips a painted pattern through the stored form', () => {
    const painted = withGroupTileColor({ id: 'a' }, 0x360779f5, tile(10, 200, 30));
    expect(typeof painted.tileColors[String(0x360779f5)]).toBe('string');

    const back = decodeGroupTileColors(painted).get(0x360779f5);
    expect(back?.length).toBe(TILE_RGBA_BYTES);
    expect(Array.from(back.slice(0, 4))).toEqual([10, 200, 30, 255]);
  });

  it('keys by unsigned hash, so a high-bit pattern survives', () => {
    const high = 0xf0000001;
    const painted = withGroupTileColor({ id: 'a' }, high, tile(1, 2, 3));
    expect(Object.keys(painted.tileColors)).toEqual([String(high >>> 0)]);
    expect(decodeGroupTileColors(painted).has(high >>> 0)).toBe(true);
  });

  it('does not modify the group it is given', () => {
    const g = { id: 'a', criteria: {} };
    const painted = withGroupTileColor(g, 1, tile(9, 9, 9));
    expect(g.tileColors).toBeUndefined();
    expect(painted).not.toBe(g);
    expect(painted.criteria).toBe(g.criteria);
  });

  it('keeps other patterns when one is painted or cleared', () => {
    let g = withGroupTileColor({ id: 'a' }, 1, tile(10, 0, 0));
    g = withGroupTileColor(g, 2, tile(0, 20, 0));
    expect(groupTileColorHashes(g).sort()).toEqual([1, 2]);

    g = withoutGroupTileColor(g, 1);
    expect(groupTileColorHashes(g)).toEqual([2]);
    expect(Array.from(decodeGroupTileColors(g).get(2).slice(0, 3))).toEqual([0, 20, 0]);
  });

  it('drops the field entirely when the last pattern is cleared', () => {
    const one = withGroupTileColor({ id: 'a' }, 7, tile(1, 1, 1));
    const none = withoutGroupTileColor(one, 7);
    expect('tileColors' in none).toBe(false);
  });

  it('returns the same group when clearing a pattern it never painted', () => {
    const g = withGroupTileColor({ id: 'a' }, 7, tile(1, 1, 1));
    expect(withoutGroupTileColor(g, 8)).toBe(g);
  });

  it('clears everything at once', () => {
    let g = withGroupTileColor({ id: 'a' }, 1, tile(1, 1, 1));
    g = withGroupTileColor(g, 2, tile(2, 2, 2));
    expect('tileColors' in withoutAnyGroupTileColor(g)).toBe(false);
  });

  it('ignores entries that are not a full tile', () => {
    const g = { id: 'a', tileColors: { 1: btoa('too short'), 2: 'not base64 !!', 3: null } };
    expect(decodeGroupTileColors(g).size).toBe(0);
  });

  it('refuses to store a tile of the wrong size', () => {
    const g = { id: 'a' };
    expect(withGroupTileColor(g, 1, new Uint8Array(8))).toBe(g);
  });

  it('re-decodes after the stored form changes', () => {
    const one = withGroupTileColor({ id: 'a' }, 1, tile(10, 0, 0));
    expect(Array.from(decodeGroupTileColors(one).get(1).slice(0, 1))).toEqual([10]);
    const two = withGroupTileColor(one, 1, tile(20, 0, 0));
    expect(Array.from(decodeGroupTileColors(two).get(1).slice(0, 1))).toEqual([20]);
  });

  it('reads a live authoring map straight through', () => {
    const live = new Map([[5, tile(7, 8, 9)]]);
    const g = { id: 'a', tileColors: live };
    expect(decodeGroupTileColors(g)).toBe(live);
    expect(groupTileColorCount(g)).toBe(1);
  });

  it('encodes a live authoring map for saving', () => {
    const g = { id: 'a', tileColors: new Map([[5, tile(7, 8, 9)]]) };
    const saved = groupWithEncodedTileColors(g);
    expect(typeof saved.tileColors['5']).toBe('string');
    expect(Array.from(decodeGroupTileColors(saved).get(5).slice(0, 3))).toEqual([7, 8, 9]);
  });

  it('drops an empty live map when saving', () => {
    const saved = groupWithEncodedTileColors({ id: 'a', tileColors: new Map() });
    expect('tileColors' in saved).toBe(false);
  });

  it('leaves an already-stored group alone when saving', () => {
    const g = withGroupTileColor({ id: 'a' }, 1, tile(1, 2, 3));
    expect(groupWithEncodedTileColors(g).tileColors).toEqual(g.tileColors);
  });

  it('encodes only whole tiles', () => {
    const map = new Map([
      [1, tile(5, 5, 5)],
      [2, new Uint8Array(4)],
    ]);
    expect(Object.keys(encodeGroupTileColors(map))).toEqual(['1']);
  });
});
