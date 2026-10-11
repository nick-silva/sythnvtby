import { describe, it, expect } from 'vitest';
import { findFrameWram, frameStem, WRAM_BYTES } from './frame-wram.js';

const wram = (fill) => new Uint8Array(WRAM_BYTES).fill(fill);
// A stand-in save state: its first byte says which memory it holds.
const state = (fill) => new Uint8Array([fill, 1, 2, 3]);
const extract = (s) => wram(s[0]);
const base = { ramDumpsByStem: new Map(), saveStatesByStem: new Map(), rootSaveState: null, isCurrent: false, extract };

describe('frameStem', () => {
  it('drops folders and extensions, case-insensitively', () => {
    expect(frameStem('ramdumps/F-A.wram.bin')).toBe('f-a');
    expect(frameStem('vipstates/f-a.json')).toBe('f-a');
    expect(frameStem('savestates/f-a.state')).toBe('f-a');
  });
});

describe('findFrameWram', () => {
  it('prefers the frame’s RAM dump', () => {
    const got = findFrameWram({ ...base, names: ['vipstates/f-a.json'], ramDumpsByStem: new Map([['f-a', wram(7)]]), saveStatesByStem: new Map([['f-a', state(9)]]) });
    expect(got.source).toBe('ramdump');
    expect(got.wram[0]).toBe(7);
  });

  it('reads the memory out of the frame’s own save state when it has no dump', () => {
    const got = findFrameWram({ ...base, names: ['f-b.json'], saveStatesByStem: new Map([['f-b', state(9)]]) });
    expect(got).toMatchObject({ source: 'savestate' });
    expect(got.wram[0]).toBe(9);
  });

  it('reads the Current (Colorize!) frame from the pack’s root save state', () => {
    const got = findFrameWram({ ...base, names: ['vipstate-current.json'], isCurrent: true, rootSaveState: state(5) });
    expect(got).toMatchObject({ source: 'current-savestate' });
    expect(got.wram[0]).toBe(5);
  });

  it('never gives a captured frame the root save state (that is the Current moment, not this frame)', () => {
    expect(findFrameWram({ ...base, names: ['f-c.json'], rootSaveState: state(5) })).toBeNull();
  });

  it('is null when a save state holds no readable memory', () => {
    expect(findFrameWram({ ...base, names: ['f-d.json'], saveStatesByStem: new Map([['f-d', state(1)]]), extract: () => null })).toBeNull();
  });
});
