import { describe, it, expect } from 'vitest';
import { otherWorldsShowingGroup, withWorlds } from './group-worlds.js';
import { getTileBytes, hashTile } from './vip-state.js';

// Tiles 1–8: distinct lit patterns (a character); tile 9: a plain tile other scenery shares.
const pt = new Uint8Array(2048 * 16);
for (let t = 1; t <= 9; t++) pt.fill(t * 17, t * 16, t * 16 + 16);
const h = (t) => hashTile(getTileBytes(pt, t)) >>> 0;

/** A frame drawing `tiles` on `world` (left eye, background layer). */
const frame = (world, tiles, extra = []) => ({
  patternTable: pt,
  drawList: [...tiles.map((t, i) => ({ tileIndex: t, x: i * 8, y: 0, eye: 0, layer: 0, world })), ...extra],
});

const mario = { criteria: { windowIds: [22], hashes: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(h), layers: [0] } };

describe('otherWorldsShowingGroup', () => {
  it('finds the world the game moved the group to, and how many frames', () => {
    const states = [frame(22, [1, 2, 3, 4, 5, 6]), frame(21, [1, 2, 3, 4, 5, 6]), frame(21, [2, 3, 4, 5, 6, 7])];
    expect(otherWorldsShowingGroup(states, mario)).toEqual([{ world: 21, frames: 2 }]);
  });

  it('ignores a couple of shared tiles on another world', () => {
    const scenery = [9, 1].map((t, i) => ({ tileIndex: t, x: 200 + i * 8, y: 0, eye: 0, layer: 0, world: 30 }));
    expect(otherWorldsShowingGroup([frame(22, [1, 2, 3, 4, 5, 6], scenery)], mario)).toEqual([]);
  });

  it('ignores sprites, the other eye, and groups that already match any world', () => {
    const sprite = frame(21, [1, 2, 3, 4, 5, 6]);
    sprite.drawList.forEach((d) => (d.layer = 2));
    const rightEye = frame(21, [1, 2, 3, 4, 5, 6]);
    rightEye.drawList.forEach((d) => (d.eye = 1));
    expect(otherWorldsShowingGroup([sprite, rightEye], mario)).toEqual([]);
    expect(otherWorldsShowingGroup([frame(21, [1, 2, 3, 4, 5, 6])], { criteria: { ...mario.criteria, windowIds: [] } })).toEqual([]);
  });
});

describe('otherWorldsShowingGroup for sprites', () => {
  it('follows a one-tile sprite (a ball) between OBJ worlds, ignoring background tiles', () => {
    const ball = { criteria: { windowIds: [22], hashes: [h(3)], layers: [2] } };
    const obj = (world) => ({ patternTable: pt, drawList: [{ tileIndex: 3, x: 40, y: 40, eye: 0, layer: 2, world }] });
    expect(otherWorldsShowingGroup([obj(22), obj(21)], ball)).toEqual([{ world: 21, frames: 1 }]);
    expect(otherWorldsShowingGroup([frame(21, [3])], ball)).toEqual([]); // a background copy of the tile is not the ball
  });
});

describe('withWorlds', () => {
  it('sets a sorted world list without repeats or bad values, leaving the original alone', () => {
    const next = withWorlds(mario, [22, 21, 22, 40, -1]);
    expect(next.criteria.windowIds).toEqual([21, 22]);
    expect(next.criteria.hashes).toBe(mario.criteria.hashes);
    expect(mario.criteria.windowIds).toEqual([22]);
  });
});
