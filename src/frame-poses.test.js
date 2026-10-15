import { describe, expect, it } from 'vitest';
import { describeFramePoses, posesOnFrame } from './frame-poses.js';
import { posePictureKey } from './pose-overpaint.js';
import { hashTile } from './vip-state.js';

const pattern = (seed) => new Uint8Array(16).fill(seed);
const hashOf = (seed) => hashTile(pattern(seed)) >>> 0;

/** A frame drawing tiles (by seed) on the left eye: `{ seed, x, y, layer, world }`. */
function frameWith(draws) {
  const seeds = [...new Set(draws.map((d) => d.seed))];
  const patternTable = new Uint8Array(16 * seeds.length);
  seeds.forEach((s, i) => patternTable.set(pattern(s), i * 16));
  return { patternTable, drawList: draws.map((d) => ({ tileIndex: seeds.indexOf(d.seed), x: d.x ?? 0, y: d.y ?? 0, eye: 0, layer: d.layer ?? 0, world: d.world ?? 26 })) };
}

const pose = (poseId, seeds, extra = {}) => ({ poseId, name: poseId, anchorHash: hashOf(seeds[0]), tiles: seeds.map((s, i) => ({ hash: hashOf(s), dx: i * 8, dy: 0 })), ...extra });
const picture = (id, poseId) => ({ id, poseId, name: `pic ${poseId}`, world: 26, mapX: 0, mapY: 0, width: 8, height: 8, png: '' });

describe('posesOnFrame', () => {
  const luigi = {
    id: 'luigi',
    name: 'Luigi',
    criteria: { hashes: [1, 2, 3, 9].map(hashOf), windowIds: [26], layers: [0] },
    poses: [pose('Serve', [1, 2]), pose('ServeHigh', [1, 2, 3]), pose('Run', [3, 9])],
    poseOverpaints: [picture('p1', 'Serve'), picture('p2', 'ServeHigh')],
  };
  const frame = frameWith([{ seed: 1 }, { seed: 2, x: 8 }, { seed: 3, x: 16 }]);

  it('lists a character’s whole poses, and says the fuller pose’s picture wins', () => {
    const drawn = new Set([posePictureKey('luigi', 'p2')]);
    const [c] = posesOnFrame({ state: frame, groups: [luigi], drawn });
    expect(c.poses.map((p) => [p.name, p.where, p.coveredBy, p.picture?.drawn])).toEqual([
      ['Serve', 'world 26', 'ServeHigh', false],
      ['ServeHigh', 'world 26', null, true],
    ]);
    const text = describeFramePoses([c], { frame: 812 }).join('\n');
    expect(text).toMatch(/Frame 812 · left eye/);
    expect(text).toMatch(/“ServeHigh” has all its tiles and more/);
  });

  it('says when two whole poses have exactly the same tiles', () => {
    const twins = { ...luigi, poses: [pose('Idle', [1, 2]), pose('IdleCopy', [2, 1])], poseOverpaints: [] };
    const [c] = posesOnFrame({ state: frame, groups: [twins] });
    expect(c.poses.map((p) => p.sameAs)).toEqual(['IdleCopy', 'Idle']);
    expect(describeFramePoses([c]).join('\n')).toMatch(/same tiles as “IdleCopy” \(if both have a picture, both draw\)/);
  });

  it('says when the screens or game states hide a character', () => {
    const [c] = posesOnFrame({ state: frame, groups: [luigi], shown: new Set() });
    expect(c.shown).toBe(false);
    expect(describeFramePoses([c]).join('\n')).toMatch(/hidden here by its screens or game states/);
  });

  it('finds a sprite’s pose facing the other way', () => {
    const mario = { id: 'mario', name: 'Mario', authoringKind: 'obj', criteria: { layers: [2] }, poses: [pose('Walk', [5, 6])] };
    const mirrored = frameWith([{ seed: 5, x: 100, layer: 2 }, { seed: 6, x: 92, layer: 2 }]);
    const [c] = posesOnFrame({ state: mirrored, groups: [mario] });
    expect(c.poses[0]).toMatchObject({ name: 'Walk', where: 'at 100,0', mirrored: true, picture: null });
  });

  it('lists a picture drawn whose pose is gone, and nothing for a frame without poses', () => {
    const orphan = { ...luigi, poses: [], poseOverpaints: [picture('p9', 'Deleted')] };
    const [c] = posesOnFrame({ state: frame, groups: [orphan], drawn: new Set([posePictureKey('luigi', 'p9')]) });
    expect(c.pictures.map((p) => p.name)).toEqual(['pic Deleted']);
    expect(posesOnFrame({ state: frameWith([{ seed: 40 }]), groups: [luigi] })).toEqual([]);
  });
});
