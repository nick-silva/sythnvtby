import { describe, it, expect } from 'vitest';
import {
  normalizeTracks,
  getEffectiveTracks,
  nextTrackId,
  addTrackToGroup,
  removeTrackFromGroup,
  updateTrack,
  trackLengthFrames,
  trackStepAtFrame,
  normalizeObjProfileFields,
} from './obj-sprite-profiles.js';

const poseIds = new Set(['pose_1', 'pose_2', 'pose_3']);
const walk = {
  id: 'track-1',
  name: 'Walk',
  steps: [
    { poseId: 'pose_1', holdFrames: 6 },
    { poseId: 'pose_2', holdFrames: 3 },
  ],
};

const objGroup = (extra = {}) => ({
  id: 'g1',
  authoringKind: 'obj',
  criteria: { layers: [2], hashes: [1, 2] },
  poses: [
    { poseId: 'pose_1', name: 'A', tiles: [{ hash: 1, dx: 0, dy: 0 }], anchorHash: 1 },
    { poseId: 'pose_2', name: 'B', tiles: [{ hash: 2, dx: 0, dy: 0 }], anchorHash: 2 },
  ],
  ...extra,
});

describe('normalizeTracks', () => {
  it('keeps well-formed tracks', () => {
    expect(normalizeTracks([walk], poseIds)).toEqual([walk]);
  });

  it('drops steps whose pose is gone, and tracks left with none', () => {
    const tracks = normalizeTracks(
      [{ id: 't', name: 'T', steps: [{ poseId: 'pose_1', holdFrames: 2 }, { poseId: 'ghost', holdFrames: 4 }] }],
      poseIds,
    );
    expect(tracks[0].steps).toEqual([{ poseId: 'pose_1', holdFrames: 2 }]);
    expect(normalizeTracks([{ id: 't', steps: [{ poseId: 'ghost', holdFrames: 1 }] }], poseIds)).toEqual([]);
  });

  it('forces a hold of at least one whole frame', () => {
    const [t] = normalizeTracks(
      [{ id: 't', steps: [{ poseId: 'pose_1', holdFrames: 0 }, { poseId: 'pose_2', holdFrames: 2.6 }] }],
      poseIds,
    );
    expect(t.steps.map((s) => s.holdFrames)).toEqual([1, 3]);
  });

  it('ignores unusable input: no id, duplicate ids, non-arrays', () => {
    expect(normalizeTracks(null, poseIds)).toEqual([]);
    expect(normalizeTracks([{ steps: [{ poseId: 'pose_1', holdFrames: 1 }] }], poseIds)).toEqual([]);
    const dup = normalizeTracks([walk, { ...walk, name: 'Copy' }], poseIds);
    expect(dup.length).toBe(1);
    expect(dup[0].name).toBe('Walk');
  });

  it('keeps a mirrored step, and omits the flag when it is off', () => {
    const [t] = normalizeTracks(
      [
        {
          id: 't',
          steps: [
            { poseId: 'pose_1', holdFrames: 4, flipH: true },
            { poseId: 'pose_1', holdFrames: 4, flipH: false },
            { poseId: 'pose_2', holdFrames: 4, flipH: 'yes' },
          ],
        },
      ],
      poseIds,
    );
    expect(t.steps[0]).toEqual({ poseId: 'pose_1', holdFrames: 4, flipH: true });
    expect('flipH' in t.steps[1]).toBe(false);
    expect('flipH' in t.steps[2]).toBe(false);
  });

  it('falls back to the id when a track has no name', () => {
    const [t] = normalizeTracks([{ id: 'track-9', steps: [{ poseId: 'pose_1', holdFrames: 1 }] }], poseIds);
    expect(t.name).toBe('track-9');
  });
});

describe('getEffectiveTracks', () => {
  it('returns named tracks when present', () => {
    expect(getEffectiveTracks(objGroup({ tracks: [walk] }))).toEqual([walk]);
  });

  it('converts a legacy ms track into frames', () => {
    const tracks = getEffectiveTracks(objGroup({ track: [{ poseId: 'pose_1', durationMs: 120 }] }));
    expect(tracks[0].steps).toEqual([{ poseId: 'pose_1', holdFrames: 6 }]);
  });

  it('is empty for BG groups and for OBJ groups with no animation', () => {
    expect(getEffectiveTracks({ authoringKind: 'bg', tracks: [walk] })).toEqual([]);
    expect(getEffectiveTracks(objGroup())).toEqual([]);
  });
});

describe('track editing', () => {
  it('adds, renames, re-steps and removes without mutating the input', () => {
    const g = objGroup();
    const withTrack = addTrackToGroup(g, { name: 'Walk', steps: walk.steps });
    expect(g.tracks).toBeUndefined();
    expect(withTrack.tracks[0]).toMatchObject({ id: 'track-1', name: 'Walk' });

    const renamed = updateTrack(withTrack, 'track-1', { name: 'Run' });
    expect(renamed.tracks[0].name).toBe('Run');
    expect(withTrack.tracks[0].name).toBe('Walk');

    const restepped = updateTrack(renamed, 'track-1', { steps: [{ poseId: 'pose_2', holdFrames: 9 }] });
    expect(restepped.tracks[0].steps).toEqual([{ poseId: 'pose_2', holdFrames: 9 }]);

    const removed = removeTrackFromGroup(restepped, 'track-1');
    expect(removed.tracks).toBeUndefined();
  });

  it('hands out unused ids', () => {
    expect(nextTrackId(objGroup())).toBe('track-1');
    expect(nextTrackId(objGroup({ tracks: [walk] }))).toBe('track-2');
  });

  it('replaces a track added again under the same id', () => {
    const g = addTrackToGroup(objGroup({ tracks: [walk] }), { id: 'track-1', name: 'Walk v2', steps: [] });
    expect(g.tracks.length).toBe(1);
    expect(g.tracks[0].name).toBe('Walk v2');
  });
});

describe('track timing', () => {
  it('measures a track in frames', () => {
    expect(trackLengthFrames(walk)).toBe(9);
    expect(trackLengthFrames({ steps: [] })).toBe(0);
  });

  it('maps a frame to the pose showing at that moment', () => {
    expect(trackStepAtFrame(walk, 0)).toMatchObject({ index: 0, startFrame: 0 });
    expect(trackStepAtFrame(walk, 5)).toMatchObject({ index: 0 });
    expect(trackStepAtFrame(walk, 6)).toMatchObject({ index: 1, startFrame: 6 });
    expect(trackStepAtFrame(walk, 8)).toMatchObject({ index: 1 });
  });

  it('wraps past the end and before the start', () => {
    expect(trackStepAtFrame(walk, 9)).toMatchObject({ index: 0 });
    expect(trackStepAtFrame(walk, 15)).toMatchObject({ index: 1 });
    expect(trackStepAtFrame(walk, -1)).toMatchObject({ index: 1 });
  });

  it('returns null for an empty track', () => {
    expect(trackStepAtFrame({ steps: [] }, 0)).toBeNull();
  });
});

describe('normalizeObjProfileFields with tracks', () => {
  it('round-trips tracks alongside poses', () => {
    const fields = normalizeObjProfileFields(objGroup({ tracks: [walk] }));
    expect(fields.tracks).toEqual([walk]);
    expect(fields.poses.length).toBe(2);
  });

  it('leaves BG groups untouched', () => {
    expect(normalizeObjProfileFields({ authoringKind: 'bg', tracks: [walk] })).toEqual({});
  });

  it('omits tracks entirely when there are none', () => {
    expect('tracks' in normalizeObjProfileFields(objGroup())).toBe(false);
  });
});
