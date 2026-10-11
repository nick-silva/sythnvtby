import { describe, it, expect } from 'vitest';
import { posePictureGroups, expandPoseOverpaints, posePictureKey, withPosePicture, foldPoseGroups, posePictureFor, linkPosePictures, newPosePictureId } from './pose-overpaint.js';

const op = { world: 21, bgmapBase: 0, mapX: 50, mapY: 440, width: 20, height: 10, png: 'abc', hideTiles: false };
const luigi = {
  id: 'luigi',
  name: 'Luigi',
  criteria: { windowIds: [21, 22], layers: [0], hashes: [1, 2, 3, 4] },
  screens: { mode: 'only', pools: ['p'] },
  poseOverpaints: [
    { id: 'stand', name: 'Stand', hashes: [1, 2], ...op },
    { id: 'wave', name: 'Wave', hashes: [1, 2, 3], ...op, mapX: 60 },
    { id: 'broken', name: 'No patterns', hashes: [], ...op },
  ],
};

describe('posePictureGroups', () => {
  it('turns each pose picture into a whole-pose group drawn like one, keyed under the character', () => {
    const [stand, wave] = posePictureGroups(luigi);
    expect(stand).toMatchObject({
      id: posePictureKey('luigi', 'stand'),
      name: 'Luigi · Stand',
      wholePose: true,
      poseOf: 'luigi',
      posePictureId: 'stand',
      criteria: { windowIds: [21, 22], layers: [0], hashes: [1, 2] },
      screens: { mode: 'only', pools: ['p'] },
      overpaint: { world: 21, mapX: 50, mapY: 440, width: 20, height: 10, png: 'abc', hideTiles: false },
    });
    expect(wave.overpaint.mapX).toBe(60);
  });

  it('leaves out pictures with no patterns or no valid place, and keeps the same objects per group', () => {
    expect(posePictureGroups(luigi)).toHaveLength(2);
    expect(posePictureGroups(luigi)[0]).toBe(posePictureGroups(luigi)[0]);
    expect(posePictureGroups({ id: 'x', poseOverpaints: [{ id: 'a', hashes: [1], world: 99 }] })).toEqual([]);
    expect(posePictureGroups({ id: 'plain' })).toEqual([]);
  });
});

describe('expandPoseOverpaints', () => {
  it('puts each character’s pose pictures right after it, and returns the list itself when there are none', () => {
    const other = { id: 'mario', criteria: {} };
    const list = [luigi, other];
    expect(expandPoseOverpaints(list).map((g) => g.id)).toEqual(['luigi', 'luigi#pose:stand', 'luigi#pose:wave', 'mario']);
    expect(expandPoseOverpaints(list)).toBe(expandPoseOverpaints(list));
    const plain = [other];
    expect(expandPoseOverpaints(plain)).toBe(plain);
  });
});

describe('withPosePicture', () => {
  it('replaces, adds and removes a pose picture without changing the group it was given', () => {
    const moved = withPosePicture(luigi, 'stand', { ...op, mapX: 1 });
    expect(moved.poseOverpaints.find((p) => p.id === 'stand').mapX).toBe(1);
    expect(luigi.poseOverpaints[0].mapX).toBe(50);
    const added = withPosePicture({ id: 'g' }, 'new', { ...op, hashes: [7], name: 'New' });
    expect(added.poseOverpaints).toEqual([{ id: 'new', name: 'New', hashes: [7], ...op }]);
    const removed = withPosePicture(luigi, 'wave', null);
    expect(removed.poseOverpaints.map((p) => p.id)).toEqual(['stand', 'broken']);
    expect(withPosePicture({ id: 'g', poseOverpaints: [{ id: 'a', hashes: [1], ...op }] }, 'a', null).poseOverpaints).toBeUndefined();
  });
});

describe('posePictureFor', () => {
  it('finds the pose picture for a card by its patterns, in any order', () => {
    expect(posePictureFor(luigi, [2, 1])?.id).toBe('stand');
    expect(posePictureFor(luigi, [1, 2, 3, 4])).toBeNull();
  });
});

describe('pose pictures tied to a saved pose', () => {
  const group = {
    id: 'g',
    name: 'Luigi',
    criteria: { windowIds: [21], layers: [0], hashes: [1, 2, 3, 4] },
    poses: [
      { poseId: 'p1', name: 'Idle', tiles: [{ hash: 1 }, { hash: 2 }, { hash: 2 }, { hash: 99 }] },
      { poseId: 'p2', name: 'Run', tiles: [{ hash: 3 }, { hash: 4 }] },
    ],
    poseOverpaints: [{ id: 'a', name: 'Idle', poseId: 'p1', hashes: [7], ...op }],
  };

  it('takes its patterns from the pose while it exists (only the group’s), else from its own list', () => {
    expect(posePictureGroups(group)[0].criteria.hashes).toEqual([1, 2]);
    const gone = { ...group, poses: [group.poses[1]] };
    expect(posePictureGroups(gone)[0].criteria.hashes).toEqual([7]);
  });

  it('is found for its pose’s card by pose id first, whatever the card’s patterns', () => {
    expect(posePictureFor(group, [5, 6], 'p1')?.id).toBe('a');
    expect(posePictureFor(group, [1, 2])?.id).toBe('a'); // the patterns, for cards that are not saved poses
    expect(posePictureFor(group, [3, 4], 'p2')).toBeNull();
  });

  it('keeps its pose id through withPosePicture, and pictures made before get linked by their patterns', () => {
    expect(withPosePicture(group, 'a', { ...op, mapX: 3 }).poseOverpaints[0].poseId).toBe('p1');
    const old = { ...group, poseOverpaints: [{ id: 'b', name: 'Run', hashes: [4, 3], ...op }] };
    expect(linkPosePictures(old).poseOverpaints[0].poseId).toBe('p2');
    expect(linkPosePictures(group)).toBe(group);
  });
});

describe('newPosePictureId', () => {
  it('never reuses an id the group has, even within the same millisecond', () => {
    const now = () => 1000;
    const first = newPosePictureId({ poseOverpaints: [] }, now);
    expect(newPosePictureId({ poseOverpaints: [{ id: first }] }, now)).toBe(`${first}-1`);
    expect(newPosePictureId({ poseOverpaints: [{ id: first }, { id: `${first}-1` }] }, now)).toBe(`${first}-2`);
  });
});

describe('foldPoseGroups', () => {
  it('turns whole-pose groups made by Overpaint just this pose into their character’s pose pictures', () => {
    const character = { id: 'c', name: 'Luigi', criteria: { windowIds: [21], layers: [0], hashes: [1, 2, 3] } };
    const pose = { id: 'c-pose-1', name: 'Luigi · Idle', wholePose: true, poseOf: 'c', criteria: { windowIds: [21], layers: [0], hashes: [1, 2] }, overpaint: op };
    const orphan = { id: 'o', name: 'Lost', wholePose: true, poseOf: 'gone', criteria: { hashes: [9] }, overpaint: op };
    const r = foldPoseGroups([character, pose, orphan]);
    expect(r.groups.map((g) => g.id)).toEqual(['c', 'o']);
    expect(r.groups[0].poseOverpaints).toEqual([{ id: 'c-pose-1', name: 'Idle', hashes: [1, 2], ...op }]);
    expect(r.moved).toEqual([{ from: 'c-pose-1', to: posePictureKey('c', 'c-pose-1') }]);
    const none = [character];
    expect(foldPoseGroups(none).groups).toBe(none);
  });
});
