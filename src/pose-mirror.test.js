import { describe, expect, it } from 'vitest';
import { POSE_ORIENTATIONS, isMirrored, placePoseTile, poseOrientations } from './pose-mirror.js';
import { locatePose, poseBounds, poseDraws } from '../tools/shared/pack-session.js';
import { hashTile } from './vip-state.js';

const pattern = (seed) => new Uint8Array(16).fill(seed);
const hashOf = (seed) => hashTile(pattern(seed)) >>> 0;

/** A frame drawing tiles (by seed) at the given places on the left eye. */
function stateWith(placed) {
  const patternTable = new Uint8Array(16 * placed.length);
  const drawList = placed.map(({ seed, x, y, flipH = false }, i) => {
    patternTable.set(pattern(seed), i * 16);
    return { tileIndex: i, x, y, eye: 0, layer: 2, world: 8, flipH };
  });
  return { patternTable, drawList };
}

/** An L-shaped sprite: a head over a body, with an arm to the right. Anchored on the head. */
const sprite = (extra = {}) => ({
  poseId: 'walk',
  anchorHash: hashOf(1),
  tiles: [
    { hash: hashOf(1), dx: 0, dy: 0 },
    { hash: hashOf(2), dx: 0, dy: 8 },
    { hash: hashOf(3), dx: 8, dy: 8 },
  ],
  ...extra,
});

describe('placePoseTile', () => {
  it('places a tile beside the anchor as captured, and on the other side mirrored', () => {
    const tile = { dx: 8, dy: 16 };
    expect(placePoseTile(tile, { x: 100, y: 50 })).toEqual({ x: 108, y: 66 });
    expect(placePoseTile(tile, { x: 100, y: 50, mirrorH: true })).toEqual({ x: 92, y: 66 });
    expect(placePoseTile(tile, { x: 100, y: 50, mirrorV: true })).toEqual({ x: 108, y: 34 });
    expect(isMirrored({ x: 0, y: 0, mirrorV: true })).toBe(true);
    expect(isMirrored({ x: 0, y: 0 })).toBe(false);
  });

  it('offers every orientation unless Mirror OK is off or the pose is scaled', () => {
    expect(poseOrientations(sprite())).toHaveLength(4);
    expect(poseOrientations(sprite({ allowFlipMacro: false }))).toEqual([POSE_ORIENTATIONS[0]]);
    expect(poseOrientations(sprite({ affine: true }))).toHaveLength(1);
  });
});

describe('locatePose with mirrored sprites', () => {
  const facingLeft = stateWith([
    { seed: 1, x: 100, y: 50, flipH: true },
    { seed: 2, x: 100, y: 58, flipH: true },
    { seed: 3, x: 92, y: 58, flipH: true },
  ]);

  it('finds a sprite facing the other way, and its draws and bounds follow', () => {
    const hit = locatePose(facingLeft, sprite());
    expect(hit).toMatchObject({ x: 100, y: 50, matched: 3, total: 3, mirrorH: true, mirrorV: false });
    expect(poseDraws(facingLeft, sprite(), hit)).toHaveLength(3);
    expect(poseBounds(sprite(), hit)).toEqual({ x0: 92, y0: 50, x1: 108, y1: 66 });
  });

  it('finds one knocked upside down', () => {
    const flipped = stateWith([
      { seed: 1, x: 100, y: 50 },
      { seed: 2, x: 100, y: 42 },
      { seed: 3, x: 108, y: 42 },
    ]);
    expect(locatePose(flipped, sprite())).toMatchObject({ matched: 3, mirrorH: false, mirrorV: true });
  });

  it('keeps the pose as captured when it is all there', () => {
    const plain = stateWith([
      { seed: 1, x: 100, y: 50 },
      { seed: 2, x: 100, y: 58 },
      { seed: 3, x: 108, y: 58 },
    ]);
    expect(locatePose(plain, sprite())).toMatchObject({ matched: 3, mirrorH: false, mirrorV: false });
  });

  it('does not look for a mirror image when Mirror OK is off', () => {
    expect(locatePose(facingLeft, sprite({ allowFlipMacro: false }))).toMatchObject({ matched: 2, mirrorH: false });
  });
});
