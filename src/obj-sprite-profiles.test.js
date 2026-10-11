import { describe, it, expect } from 'vitest';
import {
  OBJ_PROFILES_GROUPS_SCHEMA_VERSION,
  LEGACY_POSE_ID,
  isObjGroup,
  normalizePose,
  normalizeTrack,
  normalizeObjProfileFields,
  getEffectivePoses,
  isPoseMacroEligible,
  findAnchorAmbiguity,
  isCaptureClipped,
  buildPoseFromCapture,
  requiredGroupsSchemaVersion,
  nextPoseId,
  addPoseToGroup,
  removePoseFromGroup,
  updatePose,
  reanchorPose,
  suggestProfileIdForHashes,
  chooseAnchorIndex,
  countAnchorTiles,
  buildPoseFromView,
  patternsInNoPose,
  patternsOnlyInPose,
  withoutPatterns,
  unclaimedPatterns,
  poseMoveTargets,
  movePoseBetweenGroups,
} from './obj-sprite-profiles.js';
import { decodeGroupTileColors, encodeGroupTileColors } from './group-tile-colors.js';

const H1 = 0xe33e_1a01;
const H2 = 0x36bb_2d6d;
const H3 = 0x034a_9e0d;

function macroPose(overrides = {}) {
  return {
    poseId: 'pose_walk1',
    name: 'Walk 1',
    tiles: [
      { hash: H1, dx: 0, dy: 0 },
      { hash: H2, dx: 8, dy: 0 },
    ],
    anchorHash: H1,
    ...overrides,
  };
}

describe('isObjGroup', () => {
  it('treats authoringKind obj as OBJ', () => {
    expect(isObjGroup({ authoringKind: 'obj', criteria: { layers: [] } })).toBe(true);
  });

  it('falls back to layer 2 when authoringKind is missing', () => {
    expect(isObjGroup({ criteria: { layers: [2] } })).toBe(true);
    expect(isObjGroup({ criteria: { layers: [0] } })).toBe(false);
  });

  it('lets an explicit bg authoringKind win over layers', () => {
    expect(isObjGroup({ authoringKind: 'bg', criteria: { layers: [2] } })).toBe(false);
  });
});

describe('normalizePose', () => {
  it('returns null without a poseId or tiles', () => {
    expect(normalizePose({ tiles: [{ hash: H1 }] })).toBeNull();
    expect(normalizePose({ poseId: 'p', tiles: [] })).toBeNull();
    expect(normalizePose({ poseId: 'p', tiles: [{ hash: 'nope' }] })).toBeNull();
  });

  it('defaults name, allowFlipMacro and flags', () => {
    const p = normalizePose({ poseId: 'p1', tiles: [{ hash: H1 }] });
    expect(p).toEqual({
      poseId: 'p1',
      name: 'p1',
      tiles: [{ hash: H1 }],
      allowFlipMacro: true,
      anchorFlipH: false,
      anchorFlipV: false,
      clippedAtCapture: false,
    });
  });

  it('coerces hashes to unsigned 32-bit', () => {
    const p = normalizePose({ poseId: 'p', tiles: [{ hash: -1, dx: 0, dy: 0 }], anchorHash: -1 });
    expect(p.tiles[0].hash).toBe(0xffffffff);
    expect(p.anchorHash).toBe(0xffffffff);
  });

  it('keeps dx/dy only when both are finite', () => {
    const p = normalizePose({ poseId: 'p', tiles: [{ hash: H1, dx: 8 }, { hash: H2, dx: 8, dy: 16 }] });
    expect(p.tiles).toEqual([{ hash: H1 }, { hash: H2, dx: 8, dy: 16 }]);
  });

  it('drops exact duplicate tiles but keeps the same hash at different offsets', () => {
    const p = normalizePose({
      poseId: 'p',
      tiles: [
        { hash: H1, dx: 0, dy: 0 },
        { hash: H1, dx: 0, dy: 0 },
        { hash: H1, dx: 8, dy: 0 },
      ],
    });
    expect(p.tiles).toHaveLength(2);
  });

  it('clears an anchorHash that is not one of the pose tiles', () => {
    const p = normalizePose({ poseId: 'p', tiles: [{ hash: H1 }], anchorHash: H3 });
    expect(p.anchorHash).toBeUndefined();
  });

  it('preserves an explicit allowFlipMacro false and capture metadata', () => {
    const p = normalizePose(
      macroPose({ allowFlipMacro: false, anchorFlipH: true, clippedAtCapture: true, sourceFrameId: 'frame_0007' }),
    );
    expect(p.allowFlipMacro).toBe(false);
    expect(p.anchorFlipH).toBe(true);
    expect(p.clippedAtCapture).toBe(true);
    expect(p.sourceFrameId).toBe('frame_0007');
  });

  it('does not mutate its input', () => {
    const raw = macroPose();
    const snapshot = structuredClone(raw);
    normalizePose(raw);
    expect(raw).toEqual(snapshot);
  });
});

describe('normalizeTrack', () => {
  it('drops steps for unknown poses and non-positive durations', () => {
    const track = normalizeTrack(
      [
        { poseId: 'a', durationMs: 120 },
        { poseId: 'missing', durationMs: 120 },
        { poseId: 'b', durationMs: 0 },
        { poseId: 'b', durationMs: 90.6 },
      ],
      new Set(['a', 'b']),
    );
    expect(track).toEqual([
      { poseId: 'a', durationMs: 120 },
      { poseId: 'b', durationMs: 91 },
    ]);
  });

  it('returns an empty array for non-array input', () => {
    expect(normalizeTrack(undefined, new Set(['a']))).toEqual([]);
  });
});

describe('normalizeObjProfileFields', () => {
  it('keeps poses a BG group kept, including an affine pose with no offsets', () => {
    const affine = { poseId: 'pose_2', name: 'Swing', affine: true, tiles: [{ hash: H1 }, { hash: H2 }] };
    const out = normalizeObjProfileFields({ authoringKind: 'bg', poses: [macroPose(), affine] });
    expect(out.poses.map((p) => p.poseId)).toEqual(['pose_walk1', 'pose_2']);
    expect(out.poses[1]).toMatchObject({ affine: true, tiles: [{ hash: H1 }, { hash: H2 }] });
    expect(out.poses[0].affine).toBeUndefined();
  });

  it('returns nothing for an OBJ group without valid poses', () => {
    expect(normalizeObjProfileFields({ authoringKind: 'obj', poses: [{ tiles: [] }] })).toEqual({});
  });

  it('keeps valid poses, drops duplicate poseIds, and filters the track', () => {
    const out = normalizeObjProfileFields({
      authoringKind: 'obj',
      poses: [macroPose(), macroPose({ name: 'dupe' }), { poseId: 'pose_walk2', tiles: [{ hash: H3 }] }],
      track: [
        { poseId: 'pose_walk1', durationMs: 120 },
        { poseId: 'gone', durationMs: 120 },
      ],
    });
    expect(out.poses.map((p) => p.name)).toEqual(['Walk 1', 'pose_walk2']);
    expect(out.track).toEqual([{ poseId: 'pose_walk1', durationMs: 120 }]);
  });

  it('omits track when it filters down to nothing', () => {
    const out = normalizeObjProfileFields({ authoringKind: 'obj', poses: [macroPose()], track: [] });
    expect(out).not.toHaveProperty('track');
  });
});

describe('getEffectivePoses', () => {
  it('returns explicit poses when present', () => {
    const g = { authoringKind: 'obj', poses: [macroPose()] };
    expect(getEffectivePoses(g)).toBe(g.poses);
  });

  it('wraps legacy OBJ criteria hashes as one implicit pose without offsets or anchor', () => {
    const poses = getEffectivePoses({ id: 'g', name: 'Mario', authoringKind: 'obj', criteria: { hashes: [H1, H2] } });
    expect(poses).toHaveLength(1);
    expect(poses[0].poseId).toBe(LEGACY_POSE_ID);
    expect(poses[0].tiles).toEqual([{ hash: H1 }, { hash: H2 }]);
    expect(poses[0].anchorHash).toBeUndefined();
    expect(isPoseMacroEligible(poses[0])).toBe(false);
  });

  it('returns the poses a BG group kept', () => {
    const g = { authoringKind: 'bg', criteria: { hashes: [H1] }, poses: [macroPose()] };
    expect(getEffectivePoses(g)).toBe(g.poses);
  });

  it('returns no poses for BG groups without kept poses or OBJ groups without hashes', () => {
    expect(getEffectivePoses({ authoringKind: 'bg', criteria: { hashes: [H1] } })).toEqual([]);
    expect(getEffectivePoses({ authoringKind: 'obj', criteria: { hashes: [] } })).toEqual([]);
  });
});

describe('isPoseMacroEligible', () => {
  it('accepts a pose with an anchor at (0,0) and offsets on every tile', () => {
    expect(isPoseMacroEligible(macroPose())).toBe(true);
  });

  it('rejects a pose without an anchor', () => {
    expect(isPoseMacroEligible(macroPose({ anchorHash: undefined }))).toBe(false);
  });

  it('rejects a pose where any tile lacks offsets', () => {
    expect(isPoseMacroEligible(macroPose({ tiles: [{ hash: H1, dx: 0, dy: 0 }, { hash: H2 }] }))).toBe(false);
  });

  it('rejects a pose whose anchor tile is not at the origin', () => {
    expect(isPoseMacroEligible(macroPose({ tiles: [{ hash: H1, dx: 8, dy: 0 }, { hash: H2, dx: 0, dy: 0 }] }))).toBe(false);
  });
});

describe('findAnchorAmbiguity', () => {
  it('lists sibling poses that contain this pose anchor hash', () => {
    const group = {
      poses: [
        macroPose(),
        { poseId: 'pose_walk2', name: 'Walk 2', tiles: [{ hash: H1, dx: 0, dy: 8 }, { hash: H3, dx: 0, dy: 0 }] },
        { poseId: 'pose_idle', name: 'Idle', tiles: [{ hash: H3, dx: 0, dy: 0 }] },
      ],
    };
    expect(findAnchorAmbiguity(group, 'pose_walk1')).toEqual([{ poseId: 'pose_walk2', name: 'Walk 2' }]);
  });

  it('returns empty when the pose has no anchor or is unknown', () => {
    const group = { poses: [macroPose({ anchorHash: undefined })] };
    expect(findAnchorAmbiguity(group, 'pose_walk1')).toEqual([]);
    expect(findAnchorAmbiguity(group, 'nope')).toEqual([]);
  });
});

describe('isCaptureClipped', () => {
  it('is false for a sprite well inside the 384x224 eye', () => {
    expect(isCaptureClipped([{ x: 100, y: 100 }, { x: 108, y: 100 }])).toBe(false);
  });

  it('flags tiles within one tile of any edge', () => {
    expect(isCaptureClipped([{ x: 7, y: 100 }])).toBe(true);
    expect(isCaptureClipped([{ x: 100, y: 7 }])).toBe(true);
    expect(isCaptureClipped([{ x: 369, y: 100 }])).toBe(true);
    expect(isCaptureClipped([{ x: 100, y: 209 }])).toBe(true);
    expect(isCaptureClipped([{ x: -4, y: 100 }])).toBe(true);
  });

  it('does not flag tiles exactly one tile in from the edges', () => {
    expect(isCaptureClipped([{ x: 8, y: 8 }, { x: 368, y: 208 }])).toBe(false);
  });
});

describe('buildPoseFromCapture', () => {
  const draws = [
    { hash: H2, x: 120, y: 64, flipH: false, flipV: false },
    { hash: H1, x: 112, y: 64, flipH: true, flipV: false },
    { hash: H3, x: 112, y: 72, flipH: false, flipV: false },
  ];

  it('stores offsets relative to the anchor draw and its flip flags', () => {
    const pose = buildPoseFromCapture({ poseId: 'pose_walk1', name: 'Walk 1', draws, anchorIndex: 1, sourceFrameId: 'f7' });
    expect(pose).toEqual({
      poseId: 'pose_walk1',
      name: 'Walk 1',
      tiles: [
        { hash: H2, dx: 8, dy: 0 },
        { hash: H1, dx: 0, dy: 0 },
        { hash: H3, dx: 0, dy: 8 },
      ],
      anchorHash: H1,
      allowFlipMacro: true,
      anchorFlipH: true,
      anchorFlipV: false,
      clippedAtCapture: false,
      sourceFrameId: 'f7',
    });
    expect(isPoseMacroEligible(pose)).toBe(true);
  });

  it('defaults the anchor to the first draw', () => {
    const pose = buildPoseFromCapture({ poseId: 'p', draws });
    expect(pose.anchorHash).toBe(H2);
    expect(pose.tiles[0]).toEqual({ hash: H2, dx: 0, dy: 0 });
  });

  it('marks a capture near the screen edge as clipped', () => {
    const pose = buildPoseFromCapture({ poseId: 'p', draws: [{ hash: H1, x: 2, y: 64 }] });
    expect(pose.clippedAtCapture).toBe(true);
  });

  it('returns null for an empty capture or out-of-range anchor', () => {
    expect(buildPoseFromCapture({ poseId: 'p', draws: [] })).toBeNull();
    expect(buildPoseFromCapture({ poseId: 'p', draws, anchorIndex: 9 })).toBeNull();
  });
});

describe('requiredGroupsSchemaVersion', () => {
  it('keeps the loaded version when no group has explicit poses', () => {
    expect(requiredGroupsSchemaVersion([{ authoringKind: 'obj', criteria: { hashes: [H1] } }], 2)).toBe(2);
    expect(requiredGroupsSchemaVersion([], undefined)).toBeUndefined();
  });

  it('bumps to the profiles version once any group has poses', () => {
    const groups = [{ authoringKind: 'obj', poses: [macroPose()] }];
    expect(requiredGroupsSchemaVersion(groups, 2)).toBe(OBJ_PROFILES_GROUPS_SCHEMA_VERSION);
    expect(requiredGroupsSchemaVersion(groups, undefined)).toBe(OBJ_PROFILES_GROUPS_SCHEMA_VERSION);
  });

  it('never downgrades a newer loaded version', () => {
    const groups = [{ authoringKind: 'obj', poses: [macroPose()] }];
    expect(requiredGroupsSchemaVersion(groups, 7)).toBe(7);
  });
});

describe('nextPoseId', () => {
  it('returns the lowest unused pose_N id', () => {
    expect(nextPoseId({})).toBe('pose_1');
    expect(nextPoseId({ poses: [{ poseId: 'pose_1' }, { poseId: 'pose_3' }] })).toBe('pose_2');
  });
});

describe('addPoseToGroup', () => {
  const group = {
    id: 'g',
    name: 'Mario',
    authoringKind: 'obj',
    criteria: { windowIds: [4], hashes: [H1], layers: [2] },
  };

  it('appends the pose and merges its hashes and worlds into criteria', () => {
    const next = addPoseToGroup(group, macroPose(), { windowIds: [4, 7] });
    expect(next.poses).toHaveLength(1);
    expect(next.criteria.hashes).toEqual([H1, H2]);
    expect(next.criteria.windowIds).toEqual([4, 7]);
    expect(group).not.toHaveProperty('poses');
  });

  it('keeps an empty windowIds list empty so the group still matches every world', () => {
    const open = { ...group, criteria: { ...group.criteria, windowIds: [] } };
    expect(addPoseToGroup(open, macroPose(), { windowIds: [9] }).criteria.windowIds).toEqual([]);
  });

  it('renames a colliding poseId instead of overwriting', () => {
    const once = addPoseToGroup(group, macroPose());
    const twice = addPoseToGroup(once, macroPose({ poseId: 'pose_walk1' }));
    expect(twice.poses.map((p) => p.poseId)).toEqual(['pose_walk1', 'pose_1']);
  });
});

describe('removePoseFromGroup', () => {
  it('removes the pose and its track steps, keeping criteria hashes', () => {
    const group = {
      authoringKind: 'obj',
      criteria: { hashes: [H1, H2, H3] },
      poses: [macroPose(), { poseId: 'pose_idle', name: 'Idle', tiles: [{ hash: H3, dx: 0, dy: 0 }], anchorHash: H3 }],
      track: [
        { poseId: 'pose_walk1', durationMs: 100 },
        { poseId: 'pose_idle', durationMs: 100 },
      ],
    };
    const next = removePoseFromGroup(group, 'pose_walk1');
    expect(next.poses.map((p) => p.poseId)).toEqual(['pose_idle']);
    expect(next.track).toEqual([{ poseId: 'pose_idle', durationMs: 100 }]);
    expect(next.criteria.hashes).toEqual([H1, H2, H3]);
  });

  it('removes the pose from named tracks, and drops a track left with no steps', () => {
    const idle = { poseId: 'pose_idle', name: 'Idle', tiles: [{ hash: H3, dx: 0, dy: 0 }], anchorHash: H3 };
    const group = {
      authoringKind: 'obj',
      poses: [macroPose(), idle],
      tracks: [
        { id: 'track-1', name: 'Walk', steps: [{ poseId: 'pose_walk1', holdFrames: 4 }, { poseId: 'pose_idle', holdFrames: 2 }] },
        { id: 'track-2', name: 'Solo', steps: [{ poseId: 'pose_walk1', holdFrames: 4 }] },
      ],
    };
    const next = removePoseFromGroup(group, 'pose_walk1');
    expect(next.tracks).toEqual([{ id: 'track-1', name: 'Walk', steps: [{ poseId: 'pose_idle', holdFrames: 2 }] }]);
    expect(group.tracks[0].steps).toHaveLength(2);
    expect(removePoseFromGroup(next, 'pose_idle')).not.toHaveProperty('tracks');
  });

  it('takes the pose’s own overpaint with it, keeping the other poses’ and unlinked ones', () => {
    const pic = (id, poseId) => ({ id, ...(poseId && { poseId }), hashes: [H1], world: 21, mapX: 0, mapY: 0, width: 1, height: 1, png: '' });
    const group = { poses: [macroPose(), { ...macroPose(), poseId: 'pose_idle' }], poseOverpaints: [pic('a', 'pose_walk1'), pic('b', 'pose_idle'), pic('c')] };
    expect(removePoseFromGroup(group, 'pose_walk1').poseOverpaints.map((p) => p.id)).toEqual(['b', 'c']);
    expect(removePoseFromGroup({ poses: [macroPose()], poseOverpaints: [pic('a', 'pose_walk1')] }, 'pose_walk1')).not.toHaveProperty('poseOverpaints');
  });

  it('drops the poses and track keys when the last pose is removed', () => {
    const next = removePoseFromGroup({ authoringKind: 'obj', poses: [macroPose()], track: [] }, 'pose_walk1');
    expect(next).not.toHaveProperty('poses');
    expect(next).not.toHaveProperty('track');
  });
});

describe('updatePose', () => {
  it('applies name and allowFlipMacro changes without touching other poses', () => {
    const group = { authoringKind: 'obj', poses: [macroPose(), macroPose({ poseId: 'pose_b', name: 'B' })] };
    const next = updatePose(group, 'pose_walk1', { name: '  Jump  ', allowFlipMacro: false });
    expect(next.poses[0].name).toBe('Jump');
    expect(next.poses[0].allowFlipMacro).toBe(false);
    expect(next.poses[1]).toBe(group.poses[1]);
  });

  it('keeps the previous name when the new one is blank', () => {
    const next = updatePose({ authoringKind: 'obj', poses: [macroPose()] }, 'pose_walk1', { name: '   ' });
    expect(next.poses[0].name).toBe('Walk 1');
  });
});

describe('reanchorPose', () => {
  it('rebases every offset onto the chosen tile', () => {
    const pose = macroPose({
      tiles: [
        { hash: H1, dx: 0, dy: 0 },
        { hash: H2, dx: 8, dy: 0 },
        { hash: H3, dx: 8, dy: 8 },
      ],
      anchorFlipH: true,
    });
    const next = reanchorPose(pose, 2);
    expect(next.anchorHash).toBe(H3);
    expect(next.tiles).toEqual([
      { hash: H1, dx: -8, dy: -8 },
      { hash: H2, dx: 0, dy: -8 },
      { hash: H3, dx: 0, dy: 0 },
    ]);
    expect(next.anchorFlipH).toBe(true);
    expect(isPoseMacroEligible(next)).toBe(true);
  });

  it('returns null for a bad index or a tile without offsets', () => {
    expect(reanchorPose(macroPose(), 5)).toBeNull();
    expect(reanchorPose(macroPose({ tiles: [{ hash: H1 }] }), 0)).toBeNull();
  });
});

describe('suggestProfileIdForHashes', () => {
  const groups = [
    { id: 'bg', authoringKind: 'bg', criteria: { hashes: [H1, H2, H3] } },
    { id: 'mario', authoringKind: 'obj', criteria: { hashes: [H1] } },
    { id: 'luigi', authoringKind: 'obj', criteria: { hashes: [H2, H3] } },
  ];

  it('picks the OBJ group sharing the most hashes', () => {
    expect(suggestProfileIdForHashes(groups, [H1, H2, H3])).toBe('luigi');
  });

  it('returns null when no OBJ group overlaps', () => {
    expect(suggestProfileIdForHashes(groups, [0x999])).toBeNull();
  });
});

describe('chooseAnchorIndex', () => {
  it('keeps the preferred draw when its hash is unique in the capture', () => {
    expect(chooseAnchorIndex([{ hash: H1 }, { hash: H2 }], 1)).toBe(1);
  });

  it('falls back to the first unique hash when the preferred one repeats', () => {
    expect(chooseAnchorIndex([{ hash: H1 }, { hash: H2 }, { hash: H1 }], 2)).toBe(1);
  });

  it('keeps the preferred draw when no hash is unique', () => {
    expect(chooseAnchorIndex([{ hash: H1 }, { hash: H1 }], 1)).toBe(1);
  });
});

describe('countAnchorTiles', () => {
  it('counts how many tiles in the pose share the anchor hash', () => {
    const pose = macroPose({ tiles: [{ hash: H1, dx: 0, dy: 0 }, { hash: H1, dx: 0, dy: 8 }, { hash: H2, dx: 8, dy: 0 }] });
    expect(countAnchorTiles(pose)).toBe(2);
    expect(countAnchorTiles(macroPose({ anchorHash: undefined }))).toBe(0);
  });
});

describe('buildPoseFromView', () => {
  it('keeps a BG frame view with its offsets, anchor and frame', () => {
    const view = { pose: { poseId: '__frame:3', tiles: [{ hash: H1, dx: 0, dy: 0 }, { hash: H2, dx: 8, dy: 0 }], anchorHash: H1 } };
    const pose = buildPoseFromView({ poseId: 'pose_1', name: 'Title', view, sourceFrameId: 'f3' });
    expect(pose).toMatchObject({ poseId: 'pose_1', name: 'Title', anchorHash: H1, sourceFrameId: 'f3' });
    expect(pose.tiles).toEqual(view.pose.tiles);
    expect(pose.affine).toBeUndefined();
    expect(isPoseMacroEligible(pose)).toBe(true);
  });

  it('keeps an affine view as the patterns it shows, without offsets', () => {
    const view = { pose: { tiles: [{ hash: H1, dx: 0, dy: 0 }], anchorHash: H1, affineWorlds: [26] }, patterns: [H2, H3] };
    const pose = buildPoseFromView({ poseId: 'pose_1', name: 'Opponent', view });
    expect(pose).toMatchObject({ affine: true, tiles: [{ hash: H2 }, { hash: H3 }] });
    expect(pose.anchorHash).toBeUndefined();
  });

  it('returns null without a view', () => {
    expect(buildPoseFromView({ poseId: 'pose_1', view: null })).toBeNull();
  });
});

describe('cleaning up patterns no pose uses', () => {
  const pose = (poseId, hashes) => ({ poseId, name: poseId, tiles: hashes.map((hash, i) => ({ hash, dx: i * 8, dy: 0 })) });
  const rgba = (v) => new Uint8Array(256).fill(v);
  const group = () => ({
    id: 'mario',
    authoringKind: 'bg',
    criteria: { windowIds: [22], hashes: [1, 2, 3, 4, 5], layers: [0] },
    poses: [pose('a', [1, 2]), pose('b', [2, 3])],
    tileColors: new Map([[1, rgba(1)], [4, rgba(4)], [5, rgba(5)]]),
  });

  it('finds the patterns in the group that no pose uses', () => {
    expect(patternsInNoPose(group())).toEqual([4, 5]);
    expect(patternsInNoPose({ criteria: { hashes: [1] } })).toEqual([]); // no poses: the list is the group
    expect(patternsInNoPose({ ...group(), criteria: { ...group().criteria, tileSlots: [7] } })).toEqual([]);
  });

  it('finds what only one pose uses, but drops nothing with the last pose', () => {
    expect(patternsOnlyInPose(group(), 'a')).toEqual([1]);
    expect(patternsOnlyInPose(group(), 'b')).toEqual([3]);
    expect(patternsOnlyInPose({ ...group(), poses: [pose('a', [1, 2])] }, 'a')).toEqual([]);
  });

  it('takes patterns out of the list and the group’s own paint, leaving the original alone', () => {
    const g = group();
    const next = withoutPatterns(g, [4, 5]);
    expect(next.criteria.hashes).toEqual([1, 2, 3]);
    expect([...next.tileColors.keys()]).toEqual([1]);
    expect(g.criteria.hashes).toEqual([1, 2, 3, 4, 5]);
    expect(g.tileColors.size).toBe(3);
    expect(withoutPatterns(g, [])).toBe(g);
  });

  it('says which patterns no group claims any more', () => {
    const groups = [group(), { criteria: { hashes: [9] }, poses: [pose('x', [8])] }];
    expect(unclaimedPatterns(groups, [1, 8, 9, 42])).toEqual([42]);
  });
});

describe('moving a pose between groups', () => {
  const paint = (v) => new Uint8Array(256).fill(v);
  const flat = (poseId, hashes) => ({ poseId, name: poseId, tiles: hashes.map((hash, i) => ({ hash, dx: i * 8, dy: 0 })) });
  const affine = (poseId, hashes) => ({ poseId, name: poseId, affine: true, tiles: hashes.map((hash) => ({ hash })) });
  const bg = (id, poses, painted = {}, extra = {}) => ({
    id,
    name: id,
    authoringKind: 'bg',
    criteria: { hashes: [...new Set(poses.flatMap((p) => p.tiles.map((t) => t.hash)))], windowIds: extra.windowIds ?? [] },
    poses,
    tileColors: encodeGroupTileColors(new Map(Object.entries(painted).map(([h, v]) => [Number(h), paint(v)]))),
    ...extra,
  });

  // Like Mario-PlayingAs (flat poses plus one stray affine pose) and IntroMario (affine poses).
  const playing = bg('playing', [flat('run', [1, 2]), flat('serve', [2, 3]), affine('intro', [3, 4, 5])], { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 }, { windowIds: [21, 29] });
  const intro = bg('intro', [affine('pose_1', [6]), affine('pose_2', [7])], { 6: 60 }, { windowIds: [29] });
  const court = bg('court', [], {}, {});
  const anim = bg('anim', [], {}, { criteria: { hashes: [9], tileSlots: [{ index: 1 }] } });
  const ball = { id: 'ball', name: 'ball', authoringKind: 'obj', criteria: { hashes: [8] }, poses: [flat('b1', [8])] };
  const groups = [playing, intro, court, anim, ball];

  it('offers groups of the same kind, whatever form their poses are', () => {
    expect(poseMoveTargets(groups, 'playing', 'intro').map((g) => g.id)).toEqual(['intro', 'court']);
    expect(poseMoveTargets(groups, 'playing', 'run').map((g) => g.id)).toEqual(['intro', 'court']);
    // Into a group that mixes affine and flat poses (IntroMario → Mario-PlayingAs).
    expect(poseMoveTargets(groups, 'intro', 'pose_1').map((g) => g.id)).toEqual(['playing', 'court']);
    expect(poseMoveTargets(groups, 'ball', 'b1')).toEqual([]);
    expect(poseMoveTargets(groups, 'playing', 'nope')).toEqual([]);
  });

  it('carries the pose and its patterns; only the patterns that leave take their paint (shared ones keep theirs at home)', () => {
    const r = movePoseBetweenGroups(groups, 'playing', 'intro', 'intro', { windowIds: [29] });
    const from = r.groups.find((g) => g.id === 'playing');
    const to = r.groups.find((g) => g.id === 'intro');
    expect(from.poses.map((p) => p.poseId)).toEqual(['run', 'serve']);
    expect(from.criteria.hashes).toEqual([1, 2, 3]);
    expect([...decodeGroupTileColors(from).keys()].sort()).toEqual([1, 2, 3]);
    expect(to.poses.map((p) => p.name)).toEqual(['pose_1', 'pose_2', 'intro']);
    expect(to.criteria.hashes).toEqual([6, 7, 3, 4, 5]);
    // Pattern 3 is shared with the source's other poses: the target lists it, but gets no copy of
    // the source's paint for it (no colours from another group's painting).
    expect([...decodeGroupTileColors(to).keys()].sort()).toEqual([4, 5, 6]);
    expect(decodeGroupTileColors(to).get(4)[0]).toBe(40);
    expect(r).toMatchObject({ carried: 2, left: 2, shared: 1 });
    // Inputs untouched.
    expect(playing.poses).toHaveLength(3);
    expect(decodeGroupTileColors(intro).size).toBe(1);
  });

  it('keeps the target’s own paint where it already has some', () => {
    const target = bg('intro', [affine('pose_1', [4])], { 4: 99 });
    const r = movePoseBetweenGroups([playing, target], 'playing', 'intro', 'intro');
    expect(decodeGroupTileColors(r.groups[1]).get(4)[0]).toBe(99);
    expect(r.carried).toBe(1);
  });

  it('renumbers the pose when the target already has its id', () => {
    const target = bg('intro', [affine('intro', [6])]);
    const r = movePoseBetweenGroups([playing, target], 'playing', 'intro', 'intro');
    expect(r.poseId).not.toBe('intro');
    expect(r.groups[1].poses.map((p) => p.poseId)).toContain(r.poseId);
  });

  it('drops the pose’s animation steps from the source', () => {
    const withTrack = { ...playing, tracks: [{ id: 't', name: 'T', steps: [{ poseId: 'intro', holdFrames: 2 }, { poseId: 'run', holdFrames: 2 }] }] };
    const r = movePoseBetweenGroups([withTrack, intro], 'playing', 'intro', 'intro');
    expect(r.groups[0].tracks[0].steps.map((s) => s.poseId)).toEqual(['run']);
  });

  it('moves a flat pose into a group of affine poses (groups can mix the two)', () => {
    const r = movePoseBetweenGroups(groups, 'playing', 'intro', 'run');
    expect(r.groups.find((g) => g.id === 'intro').poses.map((p) => p.name)).toContain('run');
  });

  it('refuses a move to an incompatible group', () => {
    expect(movePoseBetweenGroups(groups, 'playing', 'ball', 'intro')).toBeNull();
    expect(movePoseBetweenGroups(groups, 'playing', 'anim', 'intro')).toBeNull();
  });

  it('a sprite pose moves without touching paint (sprite paint is shared)', () => {
    const other = { id: 'ball2', name: 'ball2', authoringKind: 'obj', criteria: { hashes: [] }, poses: [] };
    const two = { ...ball, poses: [flat('b1', [8]), flat('b2', [8, 11])], criteria: { hashes: [8, 11] } };
    const r = movePoseBetweenGroups([two, other], 'ball', 'ball2', 'b2');
    expect(r.groups[0].criteria.hashes).toEqual([8]);
    expect(r.groups[1].criteria.hashes).toEqual([8, 11]);
    expect(r.carried).toBe(0);
  });
});
