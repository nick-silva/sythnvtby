import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
vi.mock('./handoff-store.js', () => ({
  putHandoff: async (k, v) => void store.set(k, v),
  getHandoff: async (k) => store.get(k) ?? null,
  deleteHandoff: async (k) => void store.delete(k),
}));

const { writeJournal, readJournal, clearJournal, bytesToBase64, base64ToBytes, JOURNAL_VERSION } = await import('./work-journal.js');

describe('work journal', () => {
  beforeEach(() => store.clear());

  it('reads back what was written, per tool and pack', async () => {
    await writeJournal('sprite-studio', 'a.vbpack', { frames: 3, groups: [{ id: 'g1' }] });
    expect(await readJournal('sprite-studio', 'a.vbpack')).toEqual({ frames: 3, groups: [{ id: 'g1' }], version: JOURNAL_VERSION });
    expect(await readJournal('sprite-studio', 'b.vbpack')).toBeNull();
    expect(await readJournal('project', 'a.vbpack')).toBeNull();
  });

  it('is gone after a clear', async () => {
    await writeJournal('sprite-studio', 'a.vbpack', { frames: 1 });
    await clearJournal('sprite-studio', 'a.vbpack');
    expect(await readJournal('sprite-studio', 'a.vbpack')).toBeNull();
  });

  it('ignores a journal it cannot read or from another version', async () => {
    store.set('journal:sprite-studio:x', new TextEncoder().encode('{not json').buffer);
    expect(await readJournal('sprite-studio', 'x')).toBeNull();
    store.set('journal:sprite-studio:y', new TextEncoder().encode(JSON.stringify({ version: 99 })).buffer);
    expect(await readJournal('sprite-studio', 'y')).toBeNull();
  });

  it('base64 round-trips binary, including large buffers', () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 7) & 255);
    expect([...base64ToBytes(bytesToBase64(bytes.buffer))]).toEqual([...bytes]);
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });
});
