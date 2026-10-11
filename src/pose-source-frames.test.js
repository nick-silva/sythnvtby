import { describe, it, expect } from 'vitest';
import { locatePose, sessionFramesFromParsed } from '../tools/shared/pack-session.js';
import { hashTile } from './vip-state.js';
import {
  CURRENT_FRAME,
  posesMissingSource,
  findPoseSourceFrames,
  withPoseSourceFrames,
  currentFramePromotion,
} from './pose-source-frames.js';

/** A 16-byte tile pattern filled with one byte value, so every seed hashes differently. */
function tile(seed) {
  return new Uint8Array(16).fill(seed);
}

/**
 * A VIP state drawing the given tiles (by seed) at the given positions on both eyes.
 * @param {Array<{ seed: number, x: number, y: number }>} placed
 */
function stateWith(placed) {
  const patternTable = new Uint8Array(16 * placed.length);
  const drawList = [];
  placed.forEach(({ seed, x, y }, i) => {
    patternTable.set(tile(seed), i * 16);
    for (const eye of [0, 1]) drawList.push({ tileIndex: i, x, y, eye, layer: 2, world: 8 });
  });
  return { patternTable, drawList };
}

/** A pose over the given tile seeds, laid out left to right, anchored on the first. */
function pose(poseId, seeds, extra = {}) {
  return {
    poseId,
    name: poseId,
    anchorHash: hashTile(tile(seeds[0])) >>> 0,
    tiles: seeds.map((s, i) => ({ hash: hashTile(tile(s)) >>> 0, dx: i * 8, dy: 0 })),
    ...extra,
  };
}

/** The pose's tiles drawn at (x, y) — what a frame showing that pose contains. */
function drawn(seeds, x = 100, y = 50) {
  return seeds.map((seed, i) => ({ seed, x: x + i * 8, y }));
}

const ROPE = [11, 12, 13];
const THROW = [21, 22, 23];

describe('posesMissingSource', () => {
  it('lists only poses captured without a source frame', () => {
    const groups = [
      { id: 'mario', poses: [pose('rope', ROPE), pose('idle', [1, 2], { sourceFrameId: 'f-idle' })] },
      { id: 'bg' },
    ];
    expect(posesMissingSource(groups)).toEqual([{ groupId: 'mario', poseId: 'rope' }]);
  });
});

describe('findPoseSourceFrames', () => {
  it('points a pose that only the Current frame shows at the Current frame', () => {
    const groups = [{ id: 'mario', poses: [pose('rope', ROPE)] }];
    const found = findPoseSourceFrames({
      groups,
      currentState: stateWith(drawn(ROPE)),
      savedFrames: [{ frameId: 'f-other', getState: () => stateWith(drawn(THROW)) }],
      locate: locatePose,
    });
    expect(found.get('mario').get('rope')).toBe(CURRENT_FRAME);
  });

  it('points a pose the Current frame no longer shows at the saved frame that shows all of it', () => {
    const groups = [{ id: 'mario', poses: [pose('throw', THROW)] }];
    const found = findPoseSourceFrames({
      groups,
      currentState: stateWith(drawn(ROPE)),
      savedFrames: [
        { frameId: 'f-rope', getState: () => stateWith(drawn(ROPE)) },
        { frameId: 'f-throw', getState: () => stateWith(drawn(THROW, 140, 90)) },
      ],
      locate: locatePose,
    });
    expect(found.get('mario').get('throw')).toBe('f-throw');
  });

  it('skips decoding a frame whose pattern list cannot hold a missing pose', () => {
    const groups = [{ id: 'mario', poses: [pose('throw', THROW)] }];
    const decoded = [];
    const frame = (frameId, tiles, patterns) => ({
      frameId,
      patterns,
      getState: () => {
        decoded.push(frameId);
        return stateWith(drawn(tiles, 140, 90));
      },
    });
    const throwHashes = new Set(groups[0].poses[0].tiles.map((t) => t.hash >>> 0));
    const found = findPoseSourceFrames({
      groups,
      currentState: null,
      savedFrames: [frame('f-rope', ROPE, new Set([1, 2, 3])), frame('f-throw', THROW, throwHashes)],
      locate: locatePose,
    });
    expect(found.get('mario').get('throw')).toBe('f-throw');
    expect(decoded).toEqual(['f-throw']);
  });

  it('ignores a frame that shows only part of the pose', () => {
    const groups = [{ id: 'mario', poses: [pose('throw', THROW)] }];
    const found = findPoseSourceFrames({
      groups,
      currentState: stateWith(drawn(THROW.slice(0, 2))),
      savedFrames: [],
      locate: locatePose,
    });
    expect(found.size).toBe(0);
  });

  it('stops reading saved frames once every pose has a source', () => {
    const groups = [{ id: 'mario', poses: [pose('throw', THROW)] }];
    let reads = 0;
    const frame = (frameId) => ({ frameId, getState: () => (reads++, stateWith(drawn(THROW))) });
    findPoseSourceFrames({
      groups,
      currentState: null,
      savedFrames: [frame('f-a'), frame('f-b'), frame('f-c')],
      locate: locatePose,
    });
    expect(reads).toBe(1);
  });

  it('finds a pose captured on the right eye', () => {
    const groups = [{ id: 'mario', poses: [pose('rope', ROPE)] }];
    const rightOnly = stateWith(drawn(ROPE));
    rightOnly.drawList = rightOnly.drawList.filter((d) => d.eye === 1);
    const found = findPoseSourceFrames({ groups, currentState: rightOnly, savedFrames: [], locate: locatePose });
    expect(found.get('mario').get('rope')).toBe(CURRENT_FRAME);
  });
});

describe('withPoseSourceFrames', () => {
  it('fills in source frames without touching the original groups', () => {
    const groups = [{ id: 'mario', poses: [pose('rope', ROPE), pose('throw', THROW)] }, { id: 'spiny', poses: [] }];
    const found = new Map([['mario', new Map([['rope', CURRENT_FRAME], ['throw', 'f-throw']])]]);
    const next = withPoseSourceFrames(groups, found, 'f-promoted');
    expect(next[0].poses.map((p) => p.sourceFrameId)).toEqual(['f-promoted', 'f-throw']);
    expect(groups[0].poses[0].sourceFrameId).toBeUndefined();
    expect(next[1]).toBe(groups[1]);
  });

  it('leaves Current-frame poses alone when there is no saved frame to point them at', () => {
    const groups = [{ id: 'mario', poses: [pose('rope', ROPE)] }];
    const found = new Map([['mario', new Map([['rope', CURRENT_FRAME]])]]);
    expect(withPoseSourceFrames(groups, found, null)[0]).toBe(groups[0]);
  });
});

describe('currentFramePromotion', () => {
  it('turns the Current frame into an ordinary registered frame', () => {
    const saveState = new Uint8Array([1, 2, 3]).buffer;
    const wram = new Uint8Array(0x10000).fill(7);
    const made = currentFramePromotion({ frameId: 'f-new', vipJson: '{"v":1}', saveState, wram });
    expect(made.vipFile).toEqual({ name: 'f-new.json', json: '{"v":1}' });
    expect(made.saveStateFile.name).toBe('f-new.state');
    expect(new Uint8Array(made.saveStateFile.buffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(made.saveStateFile.buffer).not.toBe(saveState);
    expect(made.ramdumpFile.name).toBe('f-new.wram.bin');
    expect(made.ramdumpFile.buffer.byteLength).toBe(0x10000);
    expect(made.registryEntry).toMatchObject({
      frameId: 'f-new',
      vipStateFile: 'vipstates/f-new.json',
      saveStateFile: 'savestates/f-new.state',
      ramdumpFile: 'ramdumps/f-new.wram.bin',
      screenshotFile: null,
      wramBytes: 0x10000,
      wramCaptureOk: true,
      wramSource: 'savestate',
    });
    expect(made.registryEntry.stateName).toBeTruthy();
  });

  it('registers the frame without a save state or WRAM when the pack has none', () => {
    const made = currentFramePromotion({ frameId: 'f-new', vipJson: '{}', saveState: null, wram: null });
    expect(made.saveStateFile).toBeNull();
    expect(made.ramdumpFile).toBeNull();
    expect(made.registryEntry).toMatchObject({ saveStateFile: null, ramdumpFile: null, wramBytes: 0, wramCaptureOk: false });
    expect(made.registryEntry).not.toHaveProperty('wramSource');
  });
});

describe('SpriteStudio frame list (sessionFramesFromParsed)', () => {
  const saved = { name: 'f-a.json', json: '{"frame":"a"}' };
  const registry = [{ frameId: 'f-a', vipStateFile: 'vipstates/f-a.json', stateName: 'Stage' }];

  it('includes the Current frame, after the saved frames so their indices do not move', () => {
    const frames = sessionFramesFromParsed({ vipState: '{"frame":"live"}', vipStatesFolder: [saved] }, registry);
    expect(frames.map((f) => f.vipFile)).toEqual(['f-a.json', 'vipstate-current.json']);
    expect(frames[1]).toMatchObject({ json: '{"frame":"live"}', registryEntry: null });
    expect(frames[1].label).toMatch(/current/i);
  });

  it('shows a pose captured on the Current frame, which no saved frame contains', () => {
    const rope = pose('rope', ROPE);
    const live = stateWith(drawn(ROPE));
    const frames = sessionFramesFromParsed({ vipState: JSON.stringify({ tag: 'live' }), vipStatesFolder: [saved] }, registry);
    const states = new Map([[frames[0].vipFile, stateWith(drawn(THROW))], [frames[1].vipFile, live]]);
    const shown = frames.filter((f) => locatePose(states.get(f.vipFile), rope, 0)?.matched === ROPE.length);
    expect(shown.map((f) => f.vipFile)).toEqual(['vipstate-current.json']);
  });

  it('leaves the Current frame out when a saved frame is the same snapshot', () => {
    const frames = sessionFramesFromParsed({ vipState: saved.json, vipStatesFolder: [saved] }, registry);
    expect(frames.map((f) => f.vipFile)).toEqual(['f-a.json']);
  });

  it('has no Current frame when the pack has none', () => {
    expect(sessionFramesFromParsed({ vipStatesFolder: [saved] }, registry)).toHaveLength(1);
  });
});
