import { describe, expect, it } from 'vitest';
import { poseLayoutKey, findNewPoses, findDuplicatePoses, mergeDuplicatePose } from './pose-suggest.js';

/** A pose of `n` tiles in a row starting at (x, y), patterns from `base`. */
const row = (n, { x = 0, y = 0, base = 100 } = {}) => Array.from({ length: n }, (_, i) => ({ hash: base + i, dx: x + i * 8, dy: y }));

describe('poseLayoutKey', () => {
  it('is the same wherever the pose sits and whichever tile is its anchor', () => {
    expect(poseLayoutKey(row(3, { x: -16, y: -8 }))).toBe(poseLayoutKey(row(3)));
    expect(poseLayoutKey([...row(3)].reverse())).toBe(poseLayoutKey(row(3)));
  });

  it('differs when the same tiles are arranged differently', () => {
    const moved = row(3).map((t, i) => (i === 2 ? { ...t, dy: 8 } : t));
    expect(poseLayoutKey(moved)).not.toBe(poseLayoutKey(row(3)));
  });
});

describe('findNewPoses', () => {
  const kept = [{ tiles: row(10) }, { tiles: row(10, { base: 200 }) }];

  it('offers each layout no kept pose has once, from its first frame', () => {
    const hits = [
      { frameIndex: 7, tiles: row(10, { base: 300 }), view: 'v7' },
      { frameIndex: 3, tiles: row(10, { base: 300, x: 40 }), view: 'v3' },
      { frameIndex: 5, tiles: row(10), view: 'kept already' },
    ];
    const found = findNewPoses({ hits, kept });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ tiles: 10, frames: [3, 7], view: 'v3' });
  });

  it('leaves out fragments much smaller than the usual pose', () => {
    const hits = [
      { frameIndex: 1, tiles: row(3, { base: 400 }) },
      { frameIndex: 2, tiles: row(7, { base: 500 }) },
    ];
    expect(findNewPoses({ hits, kept }).map((p) => p.tiles)).toEqual([7]);
  });

  it('works from the frames alone when nothing is kept yet', () => {
    const hits = [
      { frameIndex: 1, tiles: row(10) },
      { frameIndex: 2, tiles: row(10, { base: 200 }) },
      { frameIndex: 3, tiles: row(2, { base: 900 }) },
    ];
    expect(findNewPoses({ hits, kept: [] }).map((p) => p.frames)).toEqual([[1], [2]]);
  });
});

describe('findDuplicatePoses and mergeDuplicatePose', () => {
  const group = {
    poses: [
      { poseId: 'pose_1', name: 'Pose 1', tiles: row(4) },
      { poseId: 'pose_2', name: 'IdleReady', tiles: row(4, { x: 16 }) },
      { poseId: 'pose_3', name: '#12 · InGame – f-abc', tiles: row(4, { y: 8 }) },
      { poseId: 'pose_4', name: 'Pose 4', tiles: row(4, { base: 200 }) },
    ],
    track: [{ poseId: 'pose_1' }, { poseId: 'pose_4' }],
    tracks: [{ name: 'Swing', steps: [{ poseId: 'pose_3' }] }],
  };

  it('finds the set, keeping the pose with a name someone chose', () => {
    expect(findDuplicatePoses(group)).toEqual([{ keep: 'pose_2', drop: ['pose_1', 'pose_3'], safe: true, named: false }]);
  });

  it('says when a pose that would go has a name someone chose', () => {
    const named = { poses: [{ poseId: 'a', name: 'ReadySwing', tiles: row(4) }, { poseId: 'b', name: 'ReadyToReturn', tiles: row(4) }] };
    expect(findDuplicatePoses(named)[0]).toMatchObject({ keep: 'a', drop: ['b'], named: true });
  });

  it('keeps the pose with a picture first, and will not offer a set where two have pictures', () => {
    const withPicture = { ...group, poseOverpaints: [{ id: 'p1', poseId: 'pose_3' }] };
    expect(findDuplicatePoses(withPicture)[0]).toMatchObject({ keep: 'pose_3', safe: true });
    const twoPictures = { ...group, poseOverpaints: [{ id: 'p1', poseId: 'pose_3' }, { id: 'p2', poseId: 'pose_1' }] };
    expect(findDuplicatePoses(twoPictures)[0].safe).toBe(false);
  });

  it('folds a duplicate into its twin: animations and its picture move, the pose goes', () => {
    const g = { ...group, poseOverpaints: [{ id: 'p1', poseId: 'pose_3' }] };
    const merged = mergeDuplicatePose(mergeDuplicatePose(g, 'pose_1', 'pose_2'), 'pose_3', 'pose_2');
    expect(merged.poses.map((p) => p.poseId)).toEqual(['pose_2', 'pose_4']);
    expect(merged.track).toEqual([{ poseId: 'pose_2' }, { poseId: 'pose_4' }]);
    expect(merged.tracks[0].steps).toEqual([{ poseId: 'pose_2' }]);
    expect(merged.poseOverpaints).toEqual([{ id: 'p1', poseId: 'pose_2' }]);
    expect(g.poses).toHaveLength(4);
  });
});
