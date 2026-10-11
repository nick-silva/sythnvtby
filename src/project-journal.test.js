import { describe, it, expect } from 'vitest';
import { frameDetailsOf, withFrameDetails, mergeJournalIntoParts, restoreJournalPrompt } from './project-journal.js';

const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe('frame details', () => {
  const registry = [
    { frameId: 'a', stateName: 'InGame', number: 1, name: 'Serve', tags: ['court'] },
    { frameId: 'b', stateName: 'Intro', number: 2 },
  ];

  it('keeps names and tags per frame id, nothing else', () => {
    expect(frameDetailsOf(registry)).toEqual({ a: { name: 'Serve', tags: ['court'] }, b: {} });
    expect(frameDetailsOf(null)).toEqual({});
  });

  it('puts them back on frames still there; new frames keep theirs; a cleared name is cleared', () => {
    const opened = [{ frameId: 'a', stateName: 'InGame', number: 1 }, { frameId: 'b', stateName: 'Intro', number: 2, name: 'Old' }, { frameId: 'c', name: 'New' }];
    const out = withFrameDetails(opened, { a: { name: 'Serve' }, b: {} });
    expect(out).toEqual([{ frameId: 'a', stateName: 'InGame', number: 1, name: 'Serve' }, { frameId: 'b', stateName: 'Intro', number: 2 }, { frameId: 'c', name: 'New' }]);
    expect(opened[1].name).toBe('Old'); // the original is untouched
  });
});

describe('mergeJournalIntoParts', () => {
  const base = {
    rom: new ArrayBuffer(4),
    groups: [{ id: 'old' }],
    vbcolor: new ArrayBuffer(1),
    gameStates: [{ id: 's' }],
    vipStatesFolder: [{ name: 'f.json' }],
    manifest: { gameId: 'g', frameRegistry: [{ frameId: 'a' }] },
  };

  it('the journal’s work over the pack; frames, ROM and the rest stay the pack’s', () => {
    const merged = mergeJournalIntoParts(
      base,
      { groups: [{ id: 'new' }], vbcolor: btoa('\x01\x02\x03'), gameStates: [], overrides: [{ x: 1 }], frameDetails: { a: { name: 'Serve' } } },
      decode,
    );
    expect(merged.groups).toEqual([{ id: 'new' }]);
    expect([...new Uint8Array(merged.vbcolor)]).toEqual([1, 2, 3]);
    expect('gameStates' in merged).toBe(false); // every game state was removed in that session
    expect(merged.overrides).toEqual([{ x: 1 }]);
    expect(merged.rom).toBe(base.rom);
    expect(merged.vipStatesFolder).toBe(base.vipStatesFolder);
    expect(merged.manifest).toEqual({ gameId: 'g', frameRegistry: [{ frameId: 'a', name: 'Serve' }] });
    expect(base.groups).toEqual([{ id: 'old' }]);
  });

  it('parts a journal does not have keep the pack’s', () => {
    expect(mergeJournalIntoParts(base, {}, decode)).toEqual(base);
  });
});

describe('restoreJournalPrompt', () => {
  it('says when, and notes frames added since', () => {
    const j = { savedAt: '2026-10-08T12:00:00Z', frames: 90 };
    expect(restoreJournalPrompt('Tennis.vbpack', j, 90)).toMatch(/unsaved work for Tennis\.vbpack .*Restore it\?/s);
    expect(restoreJournalPrompt('Tennis.vbpack', j, 90)).not.toMatch(/frame\(s\) now/);
    expect(restoreJournalPrompt('Tennis.vbpack', j, 92)).toMatch(/92 frame\(s\) now, 90 then/);
  });
});
