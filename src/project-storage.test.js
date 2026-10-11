import { describe, it, expect } from 'vitest';
import { storageBreakdown, recordingsByQuestion, withoutRecordings } from './project-storage.js';

const buf = (n) => ({ buffer: new ArrayBuffer(n) });
const parts = {
  vipStatesFolder: [{ name: 'a.json', json: 'x'.repeat(600) }, { name: 'b.json', json: 'x'.repeat(400) }],
  screenshotsFolder: [{ name: 'a.png', ...buf(2000) }],
  ramdumpsFolder: [{ name: 'a.wram.bin', ...buf(300) }],
  memoryRecordingsFolder: [{ name: 'r1.bin', ...buf(50) }, { name: 'r2.bin', ...buf(70) }, { name: 'r3.bin', ...buf(5) }],
  groups: [{ id: 'g' }],
  manifest: {
    memoryQuestions: [{ id: 'q1', name: 'Who?', sides: [{ id: 'a' }, { id: 'b' }] }, { id: 'q2', name: 'Paused?', sides: [{ id: 'y' }, { id: 'n' }] }],
    memoryRecordings: [
      { id: 'r1', question: 'q1', side: 'a' },
      { id: 'r2', question: 'q1', side: 'b' },
      { id: 'f1', question: 'q1', side: 'a', source: 'frame', frameId: 'a' },
      { id: 'r3', question: 'q2', side: 'y' },
    ],
  },
};

describe('storageBreakdown', () => {
  it('each kind the pack has, with count and size, biggest first', () => {
    const rows = storageBreakdown(parts);
    expect(rows.map((r) => [r.kind, r.count, r.bytes])).toEqual([
      ['screenshots', 1, 2000],
      ['frames', 2, 1000],
      ['ramdumps', 1, 300],
      ['recordings', 3, 125],
      ['groups', 1, JSON.stringify(parts.groups).length],
    ]);
    expect(rows.every((r) => r.purpose && r.without)).toBe(true);
  });

  it('counts the ROM and the Colorize! frame too', () => {
    const rows = storageBreakdown({ rom: new ArrayBuffer(1024), vipState: 'x'.repeat(10), saveState: new ArrayBuffer(90) });
    expect(rows.map((r) => [r.kind, r.bytes])).toEqual([['rom', 1024], ['current', 100]]);
  });

  it('nothing for an empty pack', () => {
    expect(storageBreakdown({})).toEqual([]);
  });
});

describe('recordings per question', () => {
  it('counts recordings and the bytes of their files (frames cost nothing more)', () => {
    expect(recordingsByQuestion(parts)).toEqual([
      { id: 'q1', name: 'Who?', recordings: 3, bytes: 120 },
      { id: 'q2', name: 'Paused?', recordings: 1, bytes: 5 },
    ]);
  });

  it('takes out one question’s recordings and their files, keeping the rest and the question', () => {
    const out = withoutRecordings(parts, 'q1');
    expect(out.removed).toBe(3);
    expect(out.manifest.memoryRecordings.map((r) => r.id)).toEqual(['r3']);
    expect(out.memoryRecordingsFolder.map((f) => f.name)).toEqual(['r3.bin']);
    expect(out.manifest.memoryQuestions).toHaveLength(2);
    expect(parts.manifest.memoryRecordings).toHaveLength(4); // the original is untouched
  });
});
