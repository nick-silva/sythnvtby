import { describe, it, expect } from 'vitest';
import { paintStamp, uncolouredCountsJson, readUncolouredCounts, savedCountFor } from './uncoloured-counts.js';
import { parseArtPack, buildArtPack, artPackPartsFromParsed } from './art-pack.js';
import { groupPaintProgress, describePaintProgress } from './group-paint-progress.js';
import { summaryPatterns } from './frame-summary.js';
import { hashTile } from './vip-state.js';

describe('paintStamp', () => {
  it('is the same for the same entries and changes with any of them', () => {
    const base = { vbcolor: new Uint8Array([1, 2, 3]).buffer, overrides: '[]', groups: '{"groups":[]}', rules: '{}' };
    expect(paintStamp(base)).toBe(paintStamp({ ...base, vbcolor: new Uint8Array([1, 2, 3]) }));
    expect(paintStamp({ ...base, groups: '{"groups":[1]}' })).not.toBe(paintStamp(base));
    expect(paintStamp({ ...base, vbcolor: new Uint8Array([1, 2, 4]).buffer })).not.toBe(paintStamp(base));
    expect(paintStamp({ ...base, rules: null })).not.toBe(paintStamp(base));
  });
});

describe('readUncolouredCounts / savedCountFor', () => {
  const frames = { 'a.json': [100, 3, 40], 'b.json': [200, 0, 0] };

  it('reads counts made against the same paint, and only for a frame that has not changed', () => {
    const saved = readUncolouredCounts(uncolouredCountsJson('s1', '', frames), 's1');
    expect(saved?.variant).toBe('');
    expect(savedCountFor(saved, 'a.json', 100)).toEqual({ tiles: 3, pixels: 40 });
    expect(savedCountFor(saved, 'a.json', 101)).toBeNull();
    expect(savedCountFor(saved, 'c.json', 100)).toBeNull();
  });

  it('ignores counts made against other paint, or an unreadable file', () => {
    expect(readUncolouredCounts(uncolouredCountsJson('s1', '', frames), 's2')).toBeNull();
    expect(readUncolouredCounts('{not json', 's1')).toBeNull();
    expect(uncolouredCountsJson('s1', '', {})).toBeNull();
  });
});

describe('uncoloured counts in a pack', () => {
  const parts = {
    manifest: { version: 1, gameId: 'g' },
    vbcolor: new Uint8Array([9, 9, 9]).buffer,
    overrides: [],
    groups: [{ id: 'g1', name: 'One', criteria: { hashes: [5] } }],
    uncolouredCounts: { variant: 'v1', frames: { 'f.json': [10, 2, 7] } },
  };

  it('survive a save and reopen while the paint is the same', async () => {
    const parsed = await parseArtPack(await (await buildArtPack(parts)).arrayBuffer());
    expect(parsed.uncolouredCounts).toEqual({ variant: 'v1', frames: { 'f.json': [10, 2, 7] } });
    // Never carried into the next save by itself: only fresh counts are written.
    expect(artPackPartsFromParsed(parsed).uncolouredCounts).toBeUndefined();
  });

  it('are dropped when the groups are not the ones they were counted on', async () => {
    const parsed = await parseArtPack(await (await buildArtPack(parts)).arrayBuffer());
    // Another tool saves new paint and copies the counts file along unchanged.
    const reparts = { ...artPackPartsFromParsed(parsed), groups: [{ id: 'g1', name: 'One', criteria: { hashes: [5, 6] } }] };
    const blob = await buildArtPack(reparts);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const original = await JSZip.loadAsync(await (await buildArtPack(parts)).arrayBuffer());
    zip.file('uncoloured.json', await original.file('uncoloured.json').async('string'));
    const again = await parseArtPack(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(again.uncolouredCounts).toBeUndefined();
  });
});

describe('groupPaintProgress', () => {
  const blank = hashTile(new Uint8Array(16)) >>> 0;

  it('counts the listed patterns with colours, its own or the shared pack’s, leaving out the blank one', () => {
    const g = { criteria: { hashes: [1, 2, 3, 3, blank] }, tileColors: { 1: 'AAAA' } };
    const p = groupPaintProgress(g, new Map([[2, new Uint8Array(256)]]));
    expect(p).toEqual({ painted: 2, total: 3 });
    expect(describePaintProgress(p)).toBe('2 of 3 tiles painted (66%)');
    expect(describePaintProgress({ painted: 3, total: 3 })).toBe('all 3 tiles painted');
    expect(describePaintProgress(groupPaintProgress({ criteria: {} }))).toBe('');
  });
});

describe('summaryPatterns', () => {
  it('gives the left eye’s patterns, with the scaled layers’ when known', () => {
    expect(summaryPatterns({ w: { '1|0': [[1, 2], [0, 1]], '2|0': [[3], [4]] }, a: 0, x: [] })).toEqual(new Set([1, 2, 3]));
    expect(summaryPatterns({ w: { '1|1': [[1], [0]] }, a: 1, x: [9] })).toEqual(new Set([1, 9]));
    expect(summaryPatterns({ w: {}, a: 1, x: null })).toBeNull();
  });
});
