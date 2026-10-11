import { describe, it, expect } from 'vitest';
import { buildReturnState, readReturnState, frameIndexForReturn, RETURN_STATE_VERSION } from '../tools/shared/project-return.js';

const handle = { name: 'pack.vbpack', createWritable: () => {} };

describe('buildReturnState (Project tool → SpriteStudio)', () => {
  it('keeps what the Project tool needs to come back to, and nothing else', () => {
    const st = buildReturnState({
      packName: 'mario.vbpack',
      displayName: 'mario (editing)',
      fileHandle: handle,
      frameVipFile: 'f-abc.json',
      eye: '1',
      layer: '2',
      selectedGroupId: 'g1',
      viewGroupFilterId: 'g1',
      zoomViewport: { x: 10, y: 20, w: 64, h: 32 },
      unsaved: true,
      somethingElse: 'dropped',
    });
    expect(st).toEqual({
      v: RETURN_STATE_VERSION,
      packName: 'mario.vbpack',
      displayName: 'mario (editing)',
      fileHandle: handle,
      frameVipFile: 'f-abc.json',
      eye: '1',
      layer: '2',
      selectedGroupId: 'g1',
      viewGroupFilterId: 'g1',
      zoomViewport: { x: 10, y: 20, w: 64, h: 32 },
      unsaved: true,
    });
  });

  it('leaves out a zoom that is not a real rectangle', () => {
    expect(buildReturnState({ zoomViewport: { x: 0, y: 0, w: 0, h: 10 } }).zoomViewport).toBeNull();
    expect(buildReturnState({ zoomViewport: null }).zoomViewport).toBeNull();
  });
});

describe('readReturnState (what comes back from SpriteStudio)', () => {
  it('reads a state written by buildReturnState, plus whether SpriteStudio changed anything', () => {
    const raw = { ...buildReturnState({ packName: 'p.vbpack', selectedGroupId: 'g', unsaved: false }), spriteStudioChanged: true };
    expect(readReturnState(raw)).toMatchObject({ packName: 'p.vbpack', selectedGroupId: 'g', unsaved: false, spriteStudioChanged: true });
  });

  it('rejects anything that is not a state of this version', () => {
    expect(readReturnState(null)).toBeNull();
    expect(readReturnState('x')).toBeNull();
    expect(readReturnState({ v: 999, packName: 'p' })).toBeNull();
  });

  it('drops fields of the wrong type instead of trusting them', () => {
    const st = readReturnState({ v: RETURN_STATE_VERSION, packName: 42, eye: 1, selectedGroupId: {}, unsaved: 'yes', fileHandle: 'nope' });
    expect(st).toMatchObject({ packName: null, eye: null, selectedGroupId: null, unsaved: false, fileHandle: null, spriteStudioChanged: false });
  });

  it('keeps only a zoom rectangle inside the frame', () => {
    const base = { v: RETURN_STATE_VERSION };
    expect(readReturnState({ ...base, zoomViewport: { x: 0, y: 0, w: 384, h: 224 } }).zoomViewport).toEqual({ x: 0, y: 0, w: 384, h: 224 });
    expect(readReturnState({ ...base, zoomViewport: { x: 380, y: 0, w: 64, h: 64 } }).zoomViewport).toBeNull();
    expect(readReturnState({ ...base, zoomViewport: { x: 'a', y: 0, w: 8, h: 8 } }).zoomViewport).toBeNull();
  });
});

describe('frameIndexForReturn', () => {
  const frames = [{ vipFile: 'vipstate-current.json' }, { vipFile: 'f-a.json' }, { vipFile: 'F-B.json' }];
  it('finds the frame the Project tool was on', () => {
    expect(frameIndexForReturn(frames, 'f-a.json')).toBe(1);
  });
  it('matches the way frame names are matched elsewhere (case, folder, extension)', () => {
    expect(frameIndexForReturn(frames, 'vipstates/f-b')).toBe(2);
  });
  it('says so when the frame is gone', () => {
    expect(frameIndexForReturn(frames, 'f-zzz.json')).toBe(-1);
    expect(frameIndexForReturn(frames, null)).toBe(-1);
  });
});
