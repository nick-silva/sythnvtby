import { describe, expect, it } from 'vitest';
import { keptPoseKey, orientedLayoutKey, peelKeptPoses, spriteInstances, suggestSprites } from './sprite-suggest.js';

/** Draws of a sprite: `rows` of pattern numbers (0 = no tile), top-left at (x, y), mirrored if asked. */
function sprite(rows, { x = 100, y = 80, mirror = false } = {}) {
  const out = [];
  rows.forEach((row, r) => {
    row.forEach((hash, c) => {
      if (!hash) return;
      const col = mirror ? row.length - 1 - c : c;
      out.push({ hash, x: x + col * 8, y: y + r * 8, flipH: mirror });
    });
  });
  return out;
}

/** A kept pose made from a sprite's draws, anchored on its first tile. */
function keptPose(draws, extra = {}) {
  return { poseId: `p${draws[0].hash}`, anchorHash: draws[0].hash, tiles: draws.map((d) => ({ hash: d.hash, dx: d.x - draws[0].x, dy: d.y - draws[0].y })), ...extra };
}

const WALK = [[1, 2], [3, 4]];
const JUMP = [[1, 2], [5, 6]];
const SHELL = [[20, 21]];

describe('orientedLayoutKey', () => {
  it('is the same for a sprite and its mirror images, and differs for another layout', () => {
    const tiles = (draws) => draws.map((d) => ({ hash: d.hash, dx: d.x, dy: d.y }));
    expect(orientedLayoutKey(tiles(sprite(WALK, { mirror: true })))).toBe(orientedLayoutKey(tiles(sprite(WALK))));
    expect(orientedLayoutKey(tiles(sprite(JUMP)))).not.toBe(orientedLayoutKey(tiles(sprite(WALK))));
  });

  it('knows a kept pose only as captured when Mirror OK is off', () => {
    const plain = keptPose(sprite(WALK));
    const mirrored = keptPose(sprite(WALK, { mirror: true }));
    expect(keptPoseKey(plain)).toBe(keptPoseKey(mirrored));
    expect(keptPoseKey({ ...plain, allowFlipMacro: false })).not.toBe(keptPoseKey({ ...mirrored, allowFlipMacro: false }));
  });
});

describe('spriteInstances and peelKeptPoses', () => {
  it('splits a frame into sprites that do not touch', () => {
    const frame = [...sprite(WALK), ...sprite(SHELL, { x: 200 })];
    expect(spriteInstances(frame).map((s) => s.length).sort()).toEqual([2, 4]);
  });

  it('takes a kept pose out of a cluster, even mirrored, leaving the sprite it touched', () => {
    const peelers = [{ tiles: keptPose(sprite(WALK)).tiles, anchor: keptPose(sprite(WALK)).tiles[0], orientations: [{ mirrorH: false, mirrorV: false }, { mirrorH: true, mirrorV: false }] }];
    const touching = [...sprite(WALK, { mirror: true }), ...sprite(SHELL, { x: 116, y: 88 })];
    const { left, peeled } = peelKeptPoses(touching, peelers);
    expect(peeled).toBe(1);
    expect(left).toHaveLength(1);
    expect(left[0].map((d) => d.hash).sort()).toEqual([20, 21]);
  });
});

describe('suggestSprites', () => {
  it('offers what no group keeps, one pose per layout whichever way it faces', () => {
    const frames = [
      { frameIndex: 0, draws: sprite(WALK) },
      { frameIndex: 1, draws: sprite(WALK, { mirror: true, x: 40 }) },
      { frameIndex: 2, draws: sprite(JUMP) },
    ];
    const r = suggestSprites({ frames, groups: [] });
    expect(r.characters).toHaveLength(1);
    expect(r.characters[0]).toMatchObject({ groupId: null, seen: 3 });
    expect(r.characters[0].poses.map((p) => p.frames)).toEqual([[0, 1], [2]]);
  });

  it('leaves out kept poses, and gives a group the new poses that share its patterns', () => {
    const mario = { id: 'mario', criteria: { hashes: [1, 2, 3, 4], layers: [2] }, poses: [keptPose(sprite(WALK))] };
    const frames = [
      { frameIndex: 0, draws: sprite(WALK, { mirror: true }) },
      { frameIndex: 1, draws: sprite(JUMP) },
    ];
    const r = suggestSprites({ frames, groups: [mario] });
    expect(r.keptSeen).toBe(1);
    expect(r.characters).toEqual([expect.objectContaining({ groupId: 'mario', poses: [expect.objectContaining({ frames: [1], mixed: false })] })]);
  });

  it('drops two sprites that were touching and a sprite cut off by the screen edge', () => {
    const frames = [
      { frameIndex: 0, draws: sprite(WALK) },
      { frameIndex: 1, draws: sprite(SHELL, { x: 200 }) },
      { frameIndex: 2, draws: [...sprite(WALK), ...sprite(SHELL, { x: 116, y: 88 })] },
      // At the screen's left edge, only the right half shows.
      { frameIndex: 3, draws: sprite([[2], [4]], { x: 0 }) },
    ];
    const r = suggestSprites({ frames, groups: [] });
    expect(r.touching).toBe(1);
    expect(r.cutOff).toBe(1);
    expect(r.characters.flatMap((c) => c.poses.map((p) => p.size)).sort()).toEqual([2, 4]);
  });

  it('marks a pose only ever seen cut by the screen’s edge', () => {
    const frames = [
      { frameIndex: 0, draws: sprite(JUMP, { x: 0 }) },
      { frameIndex: 1, draws: sprite(WALK) },
    ];
    const poses = suggestSprites({ frames, groups: [] }).characters.flatMap((c) => c.poses);
    expect(poses.map((p) => [p.frames[0], p.clipped])).toEqual([[0, true], [1, false]]);
  });

  it('marks a pose that takes another group’s tiles', () => {
    const mario = { id: 'mario', criteria: { hashes: [1, 2, 5], layers: [2] }, poses: [] };
    const turtle = { id: 'turtle', criteria: { hashes: [20, 21], layers: [2] }, poses: [] };
    const frames = [{ frameIndex: 0, draws: [...sprite(JUMP), ...sprite(SHELL, { x: 116, y: 88 })] }];
    const r = suggestSprites({ frames, groups: [mario, turtle] });
    expect(r.characters[0]).toMatchObject({ groupId: 'mario' });
    expect(r.characters[0].poses[0].mixed).toBe(true);
  });
});
