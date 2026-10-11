import { describe, it, expect } from 'vitest';
import { poseTileAtVip } from '../tools/shared/pack-session.js';
import { hashTile } from './vip-state.js';

/**
 * Build a tile pattern from 8 rows of 8 shade digits ('.' = 0), in VB order:
 * 2 bytes per row, 2 bits per pixel, low bits leftmost.
 */
function tile(rows) {
  const bytes = new Uint8Array(16);
  rows.forEach((row, py) => {
    let word = 0;
    for (let px = 0; px < 8; px++) word |= ((row[px] === '.' ? 0 : Number(row[px])) & 3) << (px * 2);
    bytes[py * 2] = word & 0xff;
    bytes[py * 2 + 1] = (word >> 8) & 0xff;
  });
  return bytes;
}

const EMPTY_ROW = '........';
// Mario's shoe tile: solid where the shoes are.
const SHOE = tile(['11111111', '11111111', '11111111', '11111111', '11111111', '11111111', '11111111', '11111111']);
// The shadow that sits in front of it, 4 px lower — and empty across its top rows, exactly
// where the shoes show through (measured on Mario / Walk03, pattern #bbc4c058).
const SHADOW = tile([EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, '.1111111', '11111111', EMPTY_ROW, EMPTY_ROW, EMPTY_ROW]);

/** A VIP state holding the two tiles, the shadow drawn after (so in front of) the shoe. */
function stateWithShoeAndShadow() {
  const patternTable = new Uint8Array(16 * 2);
  patternTable.set(SHOE, 0);
  patternTable.set(SHADOW, 16);
  return {
    patternTable,
    drawList: [
      { tileIndex: 0, x: 119, y: 190, eye: 0, layer: 2, world: 8 },
      { tileIndex: 1, x: 119, y: 194, eye: 0, layer: 2, world: 8 },
    ],
  };
}

const POSE = {
  poseId: 'p1',
  anchorHash: hashTile(SHOE) >>> 0,
  tiles: [
    { hash: hashTile(SHOE) >>> 0, dx: 0, dy: 0 },
    { hash: hashTile(SHADOW) >>> 0, dx: 0, dy: 4 },
  ],
};
const ORIGIN = { x: 119, y: 190 };

describe('poseTileAtVip with overlapping tiles of one sprite', () => {
  const state = stateWithShoeAndShadow();

  it('paints the tile you can see, not the transparent one in front of it', () => {
    // y = 195 is inside both draws; the shadow is in front but empty there.
    const hit = poseTileAtVip(state, POSE, ORIGIN, 122, 195, 0);
    expect(hit).toBeTruthy();
    expect(hit.hash).toBe(hashTile(SHOE) >>> 0);
    expect({ lx: hit.lx, ly: hit.ly }).toEqual({ lx: 3, ly: 5 });
  });

  it('still paints the front tile where the front tile is lit', () => {
    // y = 198 is only inside the shadow, and lit there.
    const hit = poseTileAtVip(state, POSE, ORIGIN, 122, 198, 0);
    expect(hit.hash).toBe(hashTile(SHADOW) >>> 0);
  });

  it('prefers the front tile when both are lit at that pixel', () => {
    const both = stateWithShoeAndShadow();
    both.patternTable.set(SHOE, 16); // the "shadow" draw now holds a solid tile
    const pose = { ...POSE, tiles: [POSE.tiles[0], { hash: hashTile(SHOE) >>> 0, dx: 0, dy: 4 }] };
    const hit = poseTileAtVip(both, pose, ORIGIN, 122, 195, 0);
    expect(hit.draw.y).toBe(194); // the front one
  });

  it('returns nothing outside the pose', () => {
    expect(poseTileAtVip(state, POSE, ORIGIN, 10, 10, 0)).toBeNull();
  });
});
