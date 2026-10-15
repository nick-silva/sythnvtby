import { describe, it, expect } from 'vitest';
import { createTileOwners, contestedPatterns, MAX_CLUSTER } from './shared-tile-owner.js';
import { affineMapReader } from './affine-world.js';
import { compositeColorFrame, frameTileOwners, buildGroupTileColorIndex } from './color-layer.js';
import { hashTile } from './vip-state.js';

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

/** Characters 1..4: every pixel lit, each a different shade pattern so each hashes differently. */
const SHARED = 1;
const A_OWN = 2;
const B_OWN = 3;
const OTHER = 4;
function patternTable() {
  const pt = new Uint8Array(2048 * 16);
  const fill = [0, 0x5555, 0xaaaa, 0xffff, 0x5aa5];
  for (let ch = 1; ch <= 4; ch++) for (let r = 0; r < 8; r++) wr16(pt, ch * 16 + r * 2, fill[ch]);
  return pt;
}
const PT = patternTable();
const hashOfChar = (ch) => hashTile(PT.subarray(ch * 16, ch * 16 + 16)) >>> 0;
const H = { shared: hashOfChar(SHARED), a: hashOfChar(A_OWN), b: hashOfChar(B_OWN), other: hashOfChar(OTHER) };

const rgba = (r) => new Uint8Array(256).fill(r);
const A = { id: 'a', criteria: { hashes: [H.shared, H.a] } };
const B = { id: 'b', criteria: { hashes: [H.shared, H.b] } };
/** B is listed first: the list order alone gives every shared tile to B. */
function indexOf(groups = [B, A], colours = { a: 10, b: 20 }) {
  const index = new Map();
  for (const g of groups) {
    for (const h of g.criteria.hashes) {
      if (!index.has(h)) index.set(h, []);
      index.get(h).push({ group: g, rgba: rgba(colours[g.id]) });
    }
  }
  return index;
}
const matches = (draw, group, hash) => group.criteria.hashes.includes(hash) && (!group.criteria.windowIds || group.criteria.windowIds.includes(draw.world));
const draw = (tileIndex, x, y, world = 31, layer = 0) => ({ tileIndex, x, y, world, layer, eye: 0 });
const owners = (drawList, index = indexOf()) => createTileOwners({ state: { patternTable: PT, drawList }, eye: 0, index, matches });

describe('contestedPatterns', () => {
  it('lists patterns two groups paint differently, not ones painted alike', () => {
    expect([...contestedPatterns(indexOf())]).toEqual([H.shared]);
    expect([...contestedPatterns(indexOf([B, A], { a: 10, b: 10 }))]).toEqual([]);
  });
});

describe('createTileOwners: plain layers', () => {
  it('gives a shared tile to the group whose own tile is beside it, whatever the list order', () => {
    const s = draw(SHARED, 8, 0);
    const o = owners([draw(A_OWN, 0, 0), s]);
    expect(o.ownerOfDraw(s, H.shared).group).toBe(A);
  });

  it('leaves it to the list order when nothing beside it tells', () => {
    const s = draw(SHARED, 8, 0);
    expect(owners([draw(OTHER, 0, 0), s]).ownerOfDraw(s, H.shared)).toBeNull();
  });

  it('leaves it to the list order when both groups touch it', () => {
    const s = draw(SHARED, 8, 0);
    expect(owners([draw(A_OWN, 0, 0), s, draw(B_OWN, 16, 0)]).ownerOfDraw(s, H.shared)).toBeNull();
  });

  it('settles a run of shared tiles from its end, the same whichever is asked first', () => {
    const run = [draw(SHARED, 8, 0), draw(SHARED, 16, 0), draw(SHARED, 24, 0)];
    const list = [draw(A_OWN, 0, 0), ...run];
    const first = owners(list);
    expect(run.map((d) => first.ownerOfDraw(d, H.shared)?.group)).toEqual([A, A, A]);
    const last = owners(list);
    expect([...run].reverse().map((d) => last.ownerOfDraw(d, H.shared)?.group)).toEqual([A, A, A]);
  });

  it('asks the corners when no side tells', () => {
    const s = draw(SHARED, 8, 8);
    expect(owners([draw(B_OWN, 16, 16), s]).ownerOfDraw(s, H.shared).group).toBe(B);
  });

  it('only counts neighbours on the same world and layer', () => {
    const s = draw(SHARED, 8, 0);
    expect(owners([draw(A_OWN, 0, 0, 30), s]).ownerOfDraw(s, H.shared)).toBeNull();
    expect(owners([draw(A_OWN, 0, 0, 31, 2), s]).ownerOfDraw(s, H.shared)).toBeNull();
  });

  it('only decides patterns painted differently', () => {
    const s = draw(SHARED, 8, 0);
    const same = owners([draw(A_OWN, 0, 0), s], indexOf([B, A], { a: 10, b: 10 }));
    expect(same.ownerOfDraw(s, H.shared)).toBeNull();
  });

  it('finds a copy of a frame draw by where it is', () => {
    const s = draw(SHARED, 8, 0);
    const o = owners([draw(A_OWN, 0, 0), s]);
    expect(o.ownerOfDraw({ ...s }, H.shared).group).toBe(A);
  });

  it('leaves a whole layer of shared tiles to the list order', () => {
    const list = [draw(A_OWN, 0, 0)];
    for (let i = 1; i <= MAX_CLUSTER + 1; i++) list.push(draw(SHARED, (i % 40) * 8, Math.floor(i / 40) * 8));
    expect(owners(list).ownerOfDraw(list[1], H.shared)).toBeNull();
  });

  it('matches a right-eye twin world as the left one', () => {
    const left = { ...A, criteria: { ...A.criteria, windowIds: [5] } };
    const right = { ...B, criteria: { ...B.criteria, windowIds: [5] } };
    const s = { ...draw(SHARED, 8, 0, 6), eye: 1 };
    const o = createTileOwners({ state: { patternTable: PT, drawList: [{ ...draw(A_OWN, 0, 0, 6), eye: 1 }, s] }, eye: 1, index: indexOf([right, left]), matches, matchWorld: (w) => (w === 6 ? 5 : w) });
    expect(o.ownerOfDraw(s, H.shared).group).toBe(left);
  });
});

/** World 31 affine (world 30 END), map in segment 1, 1:1 scale; map cells set from `cells`. */
function affineFrame(cells, scy = 0) {
  const PARAM_H = 0x8000;
  const windows = new Uint8Array(1024);
  const base = scy ? 2 : 1; // a map of 2 segments starts on an even one: the VIP ORs the base in
  wr16(windows, 31 * 32, 0x8000 | (2 << 12) | (scy << 8) | base);
  wr16(windows, 31 * 32 + 14, 383);
  wr16(windows, 31 * 32 + 16, 223);
  wr16(windows, 31 * 32 + 18, PARAM_H);
  wr16(windows, 30 * 32, 0x40);
  const segments = Array.from({ length: 16 }, () => new Uint8Array(0x2000));
  for (const [cx, cy, ch] of cells) wr16(segments[base + (cy >> 6)], ((cy & 63) * 64 + cx) * 2, ch);
  for (let y = 0; y < 224; y++) {
    const p = (PARAM_H + 8 * y - 0x8000) * 2;
    wr16(segments[8], p + 4, y * 8); // MY = y
    wr16(segments[8], p + 6, 512); // DX = 1
  }
  return { windows, segments, patternTable: PT, drawList: [] };
}

describe('scaled (affine) layers', () => {
  it('reads the map cell by cell, across segments', () => {
    const r = affineMapReader(affineFrame([[0, 0, A_OWN], [1, 0, SHARED], [0, 64, B_OWN]], 1), 31);
    expect([r.charAt(0, 0), r.charAt(1, 0), r.charAt(0, 64), r.charAt(-1, 0), r.charAt(0, 128)]).toEqual([A_OWN, SHARED, B_OWN, -1, -1]);
  });

  it('decides a shared cell by the map cells beside it', () => {
    const st = affineFrame([[0, 0, A_OWN], [1, 0, SHARED], [5, 0, SHARED]]);
    const o = createTileOwners({ state: st, eye: 0, index: indexOf(), matches });
    expect(o.ownerOfCell(31, 1, H.shared).group).toBe(A);
    expect(o.ownerOfCell(31, 5, H.shared)).toBeNull();
  });
});

describe('compositeColorFrame', () => {
  const live = (g, colours) => ({ ...g, tileColors: new Map(g.criteria.hashes.map((h) => [h, rgba(colours)])) });

  it('colours a shared tile with its neighbour’s group, not the first in the list', () => {
    const groups = [live(B, 20), live(A, 10)];
    const state = { patternTable: PT, drawList: [draw(A_OWN, 0, 0), draw(SHARED, 8, 0), draw(SHARED, 100, 0)] };
    const img = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(state, new Map(), img, { groups });
    expect(img.data[(0 * 384 + 9) * 4]).toBe(10); // beside A's own tile: A's colour
    expect(img.data[(0 * 384 + 101) * 4]).toBe(20); // alone: the list order (B)
    expect(frameTileOwners(state, buildGroupTileColorIndex(groups)).ownerOfDraw(state.drawList[1], H.shared).group.id).toBe('a');
  });

  it('colours a shared cell of a scaled layer by the cells beside it', () => {
    const groups = [live(B, 20), live(A, 10)];
    const st = affineFrame([[0, 0, A_OWN], [1, 0, SHARED], [5, 0, SHARED]]);
    const img = { data: new Uint8ClampedArray(384 * 224 * 4) };
    compositeColorFrame(st, new Map(), img, { groups });
    expect(img.data[(0 * 384 + 9) * 4]).toBe(10);
    expect(img.data[(0 * 384 + 41) * 4]).toBe(20);
  });
});
