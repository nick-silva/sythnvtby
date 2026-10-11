import { describe, it, expect } from 'vitest';
import { frameGroupIndex, groupInFrame, screensForGroup, framesShowingGroup } from './group-screens.js';
import { hashTile } from './vip-state.js';

/** A pattern table where tiles 1..63 are lit and each has its own hash; tile 0 is blank. */
function patternTable() {
  const pt = new Uint8Array(2048 * 16);
  for (let t = 1; t < 64; t++) {
    pt.fill([0x55, 0xaa, 0xff][t % 3], t * 16, t * 16 + 16);
    pt[t * 16] = t; // make each tile unique
  }
  return pt;
}
const PT = patternTable();
const H = (t) => hashTile(PT.subarray(t * 16, t * 16 + 16)) >>> 0;
const draw = (tileIndex, world, layer = 0, eye = 0) => ({ tileIndex, x: 0, y: 0, world, layer, eye });
const frame = (draws) => ({ patternTable: PT, drawList: draws });

describe('groupInFrame', () => {
  const idx = frameGroupIndex(frame([draw(1, 30), draw(2, 30), draw(3, 5, 2), draw(4, 7, 0, 1)]));

  it('matches a group by pattern within its worlds and layers', () => {
    expect(groupInFrame({ criteria: { windowIds: [30], layers: [0], hashes: [H(1)] } }, idx)).toBe(true);
    expect(groupInFrame({ criteria: { windowIds: [31], layers: [0], hashes: [H(1)] } }, idx)).toBe(false);
    expect(groupInFrame({ criteria: { windowIds: [30], layers: [2], hashes: [H(1)] } }, idx)).toBe(false);
  });

  it('treats an empty world or layer list as any', () => {
    expect(groupInFrame({ criteria: { hashes: [H(3)] } }, idx)).toBe(true);
    expect(groupInFrame({ criteria: { windowIds: [5], hashes: [H(3)] } }, idx)).toBe(true);
  });

  it('matches an animated group by its tile slots whatever pattern is there', () => {
    expect(groupInFrame({ criteria: { windowIds: [30], layers: [0], hashes: [999], tileSlots: [2] } }, idx)).toBe(true);
    expect(groupInFrame({ criteria: { windowIds: [30], layers: [0], hashes: [999], tileSlots: [9] } }, idx)).toBe(false);
  });

  it('a group with no patterns claims anything in its worlds and layers', () => {
    expect(groupInFrame({ criteria: { windowIds: [5], layers: [2] } }, idx)).toBe(true);
    expect(groupInFrame({ criteria: { windowIds: [6], layers: [2] } }, idx)).toBe(false);
  });

  it('looks at one eye only (left by default)', () => {
    expect(groupInFrame({ criteria: { hashes: [H(4)] } }, idx)).toBe(false);
    expect(groupInFrame({ criteria: { hashes: [H(4)] } }, frameGroupIndex(frame([draw(4, 7, 0, 1)]), 1))).toBe(true);
  });

  it('ignores blank tiles', () => {
    const blank = frameGroupIndex(frame([draw(0, 30)]));
    expect(groupInFrame({ criteria: { windowIds: [30], layers: [0] } }, blank)).toBe(false);
  });
});

describe('screensForGroup', () => {
  it('lists the screens a group shows on, most frames first, and counts frames', () => {
    const frames = [
      { screen: 'IntroCin', index: frameGroupIndex(frame([draw(1, 30)])) },
      { screen: 'IntroCin', index: frameGroupIndex(frame([draw(1, 30)])) },
      { screen: 'Title', index: frameGroupIndex(frame([draw(1, 30)])) },
      { screen: 'Level01', index: frameGroupIndex(frame([draw(2, 30)])) },
    ];
    const star = { criteria: { windowIds: [30], layers: [0], hashes: [H(1)] } };
    expect(screensForGroup(star, frames)).toEqual([
      { screen: 'IntroCin', frames: 2 },
      { screen: 'Title', frames: 1 },
    ]);
    expect(screensForGroup({ criteria: { windowIds: [30], hashes: [H(9)] } }, frames)).toEqual([]);
  });

  it('skips frames that belong to no screen', () => {
    const frames = [{ screen: '', index: frameGroupIndex(frame([draw(1, 30)])) }];
    expect(screensForGroup({ criteria: { hashes: [H(1)] } }, frames)).toEqual([]);
  });
});

describe('framesShowingGroup', () => {
  const frames = [
    { screen: 'A', index: frameGroupIndex(frame([draw(1, 30)])) },
    { screen: 'B', index: frameGroupIndex(frame([draw(2, 30)])) },
  ];

  it('counts once per group and frame list; the same answer comes back', () => {
    const g = { criteria: { windowIds: [30], hashes: [H(1)] } };
    const first = framesShowingGroup(g, frames);
    expect(first.map((f) => f.screen)).toEqual(['A']);
    expect(framesShowingGroup(g, frames)).toBe(first);
    expect(framesShowingGroup(g, frames.slice())).not.toBe(first); // a new frame list counts again
  });

  it('counts again when the group’s patterns change, even in place', () => {
    const g = { criteria: { windowIds: [30], hashes: [H(1)] } };
    expect(framesShowingGroup(g, frames)).toHaveLength(1);
    g.criteria.hashes.push(H(2));
    expect(framesShowingGroup(g, frames).map((f) => f.screen)).toEqual(['A', 'B']);
    const moved = { ...g, criteria: { ...g.criteria, windowIds: [31] } };
    expect(framesShowingGroup(moved, frames)).toEqual([]);
  });
});
