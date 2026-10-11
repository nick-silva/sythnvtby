import { describe, it, expect } from 'vitest';
import {
  frameDisplayName,
  parseTags,
  frameTags,
  allFrameTags,
  updateFrameEntry,
  filterFrames,
  newReferenceId,
  normalizeReferences,
  addReference,
  removeReference,
  setActiveReference,
  referenceForFrame,
  referencesForFrame,
  referenceFileName,
  referenceFitRect,
} from './frame-metadata.js';

const REGISTRY = [
  { frameId: 'f-1', stateName: 'Level01', subStateName: 'MarioReady' },
  { frameId: 'f-2', stateName: 'Title', subStateName: '', name: 'Title card', tags: ['menu', 'done'] },
  { frameId: 'f-3', stateName: 'Level01', subStateName: 'GameOver', tags: ['Menu'] },
];

describe('frame names and tags', () => {
  it('falls back to the captured state when there is no name', () => {
    expect(frameDisplayName(REGISTRY[0])).toBe('Level01 / MarioReady');
    expect(frameDisplayName(REGISTRY[1])).toBe('Title card');
    expect(frameDisplayName({ frameId: 'f-9' }, 'f-9')).toBe('f-9');
  });

  it('parses tags, dropping blanks and case-duplicates, sorted', () => {
    expect(parseTags(' boss , Boss,, menu \n level-1 ')).toEqual(['boss', 'level-1', 'menu']);
    expect(parseTags('')).toEqual([]);
    expect(frameTags(REGISTRY[1])).toEqual(['done', 'menu']);
    expect(allFrameTags(REGISTRY)).toEqual(['done', 'menu']);
  });

  it('sets a name and tags without touching other frames', () => {
    const next = updateFrameEntry(REGISTRY, 'f-1', { name: '  Mario ready  ', tags: 'hero, HERO, sprite' });
    expect(next[0]).toMatchObject({ frameId: 'f-1', name: 'Mario ready', tags: ['hero', 'sprite'] });
    expect(next[1]).toBe(REGISTRY[1]);
    expect(REGISTRY[0].name).toBeUndefined(); // original untouched
  });

  it('clears a name or tags rather than storing blanks', () => {
    const cleared = updateFrameEntry(REGISTRY, 'f-2', { name: '   ', tags: ' , ' });
    expect(cleared[1].name).toBeUndefined();
    expect(cleared[1].tags).toBeUndefined();
    expect(cleared[1].stateName).toBe('Title');
  });

  it('filters by text, and by tag with a leading #', () => {
    expect(filterFrames(REGISTRY, '').length).toBe(3);
    expect(filterFrames(REGISTRY, 'title').map((f) => f.frameId)).toEqual(['f-2']);
    expect(filterFrames(REGISTRY, '#menu').map((f) => f.frameId)).toEqual(['f-2', 'f-3']);
    expect(filterFrames(REGISTRY, '#menu, done').map((f) => f.frameId)).toEqual(['f-2']);
    expect(filterFrames(REGISTRY, 'nothing')).toEqual([]);
  });
});

describe('reference register', () => {
  const meta = { refId: 'r-1', scope: 'pool', scopeId: 'p-level01', sourceFrameId: 'f-1', importedAt: '2026-09-21T00:00:00Z' };

  it('makes ids that look like frame ids', () => {
    expect(newReferenceId(0, () => 0.5)).toMatch(/^r-0-[a-z0-9]+$/);
  });

  it('adds a reference and makes it active for its scope', () => {
    const refs = addReference(null, meta);
    expect(refs.items).toHaveLength(1);
    expect(refs.items[0]).toMatchObject({ refId: 'r-1', scope: 'pool', scopeId: 'p-level01', importedAt: '2026-09-21T00:00:00Z' });
    expect(refs.active).toEqual({ 'pool:p-level01': 'r-1' });
  });

  it('prefers a frame reference over the state one', () => {
    let refs = addReference(null, meta);
    refs = addReference(refs, { refId: 'r-2', scope: 'frame', scopeId: 'f-1' });
    expect(referenceForFrame(refs, { frameId: 'f-1', poolId: 'p-level01' }).refId).toBe('r-2');
    expect(referenceForFrame(refs, { frameId: 'f-9', poolId: 'p-level01' }).refId).toBe('r-1');
    expect(referenceForFrame(refs, { frameId: 'f-9' })).toBeNull();
    expect(referencesForFrame(refs, { frameId: 'f-1', poolId: 'p-level01' }).map((r) => r.refId)).toEqual(['r-2', 'r-1']);
  });

  it('switches which reference of a scope is active', () => {
    let refs = addReference(addReference(null, meta), { refId: 'r-3', scope: 'pool', scopeId: 'p-level01' });
    expect(referenceForFrame(refs, { poolId: 'p-level01' }).refId).toBe('r-3');
    refs = setActiveReference(refs, 'r-1');
    expect(referenceForFrame(refs, { poolId: 'p-level01' }).refId).toBe('r-1');
    expect(setActiveReference(refs, 'nope').active['pool:p-level01']).toBe('r-1');
  });

  it('removes a reference and its active pointer, falling back to what is left', () => {
    let refs = addReference(addReference(null, meta), { refId: 'r-3', scope: 'pool', scopeId: 'p-level01' });
    refs = removeReference(refs, 'r-3');
    expect(refs.items.map((r) => r.refId)).toEqual(['r-1']);
    expect(refs.active['pool:p-level01']).toBeUndefined();
    expect(referenceForFrame(refs, { poolId: 'p-level01' }).refId).toBe('r-1'); // still found
  });

  it('survives junk in the manifest', () => {
    expect(normalizeReferences(undefined)).toEqual({ items: [], active: {} });
    expect(normalizeReferences({ items: [{ nope: 1 }, { refId: 'r-4' }], active: 'x' })).toEqual({ items: [{ refId: 'r-4' }], active: {} });
  });

  it('names the file after the id, safely', () => {
    expect(referenceFileName('r-abc')).toBe('r-abc.png');
    expect(referenceFileName('r/../etc')).toBe('r-..-etc.png');
  });
});

describe('referenceFitRect', () => {
  it('stretches an image that is within a hair of the frame aspect', () => {
    expect(referenceFitRect(1152, 672)).toMatchObject({ mode: 'stretch', dx: 0, dy: 0, dw: 384, dh: 224 });
    expect(referenceFitRect(385, 224).mode).toBe('stretch'); // the one-pixel-wide case
  });

  it('fits a differently shaped image inside, centred, without cropping', () => {
    const r = referenceFitRect(1344, 768);
    expect(r.mode).toBe('contain');
    expect(r.dw).toBe(384);
    expect(r.dh).toBe(219);
    expect(r.dy).toBe(3);
    expect(r.dx).toBe(0);
  });

  it('handles a tall image and nonsense sizes', () => {
    const tall = referenceFitRect(224, 384);
    expect(tall.mode).toBe('contain');
    expect(tall.dh).toBe(224);
    expect(tall.dx).toBeGreaterThan(0);
    expect(referenceFitRect(0, 0).dw).toBeGreaterThan(0);
  });
});
