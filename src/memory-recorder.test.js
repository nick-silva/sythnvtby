import { describe, it, expect } from 'vitest';
import { createMemoryRecorder, SAMPLE_MS } from './memory-recorder.js';
import { decodeRecording, WRAM_SIZE } from './memory-questions.js';

const Q = { id: 'q-who', name: 'Who is the player?', sides: [{ id: 'luigi', name: 'Luigi' }, { id: 'mario', name: 'Mario' }] };

/** A recorder on a fake clock and memory: `tick()` runs one sample. */
function setup({ manifest = { memoryQuestions: [Q] }, folder = [] } = {}) {
  let wram = new Uint8Array(WRAM_SIZE);
  let fn = null;
  let t = Date.parse('2026-10-09T13:00:00Z');
  const r = createMemoryRecorder({
    getWram: () => wram,
    now: () => new Date(t),
    setTimer: (f) => {
      fn = f;
      return 1;
    },
    clearTimer: () => {
      fn = null;
    },
  });
  r.load(manifest, folder);
  return {
    r,
    tick(change = true) {
      t += SAMPLE_MS;
      if (change) {
        wram = wram.slice();
        wram[0x3000] = (wram[0x3000] + 1) & 0xff;
      }
      fn?.();
    },
    setByte(off, v) {
      wram = wram.slice();
      wram[off] = v;
    },
    running: () => !!fn,
  };
}

describe('createMemoryRecorder', () => {
  it('records a timed recording for a side, and stops by itself', () => {
    const { r, tick, setByte, running } = setup();
    setByte(0x2014, 2);
    expect(r.start('q-who', 'luigi', 2)).toBe(true); // the first sample is taken at once
    tick();
    tick();
    expect(running()).toBe(true);
    tick();
    expect(running()).toBe(false); // 2 s at 2 samples a second: 4 samples
    const [rec] = r.recordings();
    expect(rec).toMatchObject({ question: 'q-who', side: 'luigi', samples: 4, seconds: 2, source: 'record', session: r.session, startedAt: '2026-10-09T13:00:00.000Z' });
    const samples = decodeRecording(r.folder()[0].buffer);
    expect(samples.length).toBe(4);
    expect(samples.every((s) => s[0x2014] === 2)).toBe(true);
  });

  it('skips a sample identical to the one before (the game paused)', () => {
    const { r, tick } = setup();
    r.start('q-who', 'mario', null);
    tick(false);
    tick(false);
    tick(true);
    r.stop();
    expect(r.recordings()[0].samples).toBe(2);
  });

  it('switching side ends the recording and starts the next the same way', () => {
    const { r, tick } = setup();
    r.start('q-who', 'luigi', null);
    tick();
    expect(r.switchSide('mario')).toBe(true);
    tick();
    r.stop();
    expect(r.recordings().map((x) => x.side)).toEqual(['luigi', 'mario']);
    expect(r.counts('q-who')).toEqual({ luigi: { recordings: 1, thisSession: 1 }, mario: { recordings: 1, thisSession: 1 } });
  });

  it('refuses a side the question does not have; a recording with no memory is not kept', () => {
    const { r } = setup();
    expect(r.start('q-who', 'toad')).toBe(false);
    const empty = createMemoryRecorder({ getWram: () => null, setTimer: () => 1, clearTimer: () => {} });
    empty.load({ memoryQuestions: [Q] }, []);
    empty.start('q-who', 'luigi');
    expect(empty.stop()).toBeNull();
    expect(empty.recordings()).toEqual([]);
  });

  it('keeps the pack’s questions and recordings for the next export, and adds its own', () => {
    const old = { id: 'r-old', question: 'q-who', side: 'mario', samples: 3, session: 'p-old' };
    const { r, tick } = setup({ manifest: { memoryQuestions: [Q], memoryRecordings: [old] }, folder: [{ name: 'r-old.bin', buffer: new ArrayBuffer(12) }] });
    const q2 = r.addQuestion('Is it paused?', ['Paused', 'Playing']);
    r.start('q-who', 'luigi', null);
    tick();
    r.stop();
    const fields = r.manifestFields();
    expect(fields.memoryQuestions.map((q) => q.id)).toEqual(['q-who', q2.id]);
    expect(fields.memoryRecordings.map((x) => x.id)[0]).toBe('r-old');
    expect(fields.memoryRecordings).toHaveLength(2);
    expect(r.folder().map((f) => f.name)).toContain('r-old.bin');
    expect(r.folder()).toHaveLength(2);
    expect(r.counts('q-who').mario).toEqual({ recordings: 1, thisSession: 0 });
  });

  it('nothing to export when there is nothing', () => {
    const r = createMemoryRecorder({ getWram: () => null });
    r.load(null, []);
    expect(r.manifestFields()).toEqual({});
    expect(r.folder()).toEqual([]);
  });
});
