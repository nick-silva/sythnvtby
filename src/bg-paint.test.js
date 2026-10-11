import { describe, it, expect } from 'vitest';
import { paintTargetGroupFor, overlaysJsonWithoutGroup } from '../tools/shared/pack-session.js';

const entry = (groupId, eye) => ({ groupId, eye, rgbaBase64: 'AAAA' });
const doc = (entries) => JSON.stringify({ schemaVersion: 1, width: 384, height: 224, entries });

describe('paintTargetGroupFor (where SpriteStudio paint goes)', () => {
  it('keeps a BG group’s paint on the group', () => {
    const g = { id: 'clouds', authoringKind: 'bg', criteria: { layers: [0] } };
    expect(paintTargetGroupFor(g)).toBe(g);
  });

  it('treats a group with no authoringKind but no OBJ layer as BG too', () => {
    // Older groups carry only criteria; painting them into the shared pack would recolour that
    // pattern on every screen.
    const g = { id: 'old-bg', criteria: { layers: [0], hashes: [1] } };
    expect(paintTargetGroupFor(g)).toBe(g);
  });

  it('sends sprite paint to the shared pack, so every pose using a pattern updates', () => {
    expect(paintTargetGroupFor({ id: 'mario', authoringKind: 'obj' })).toBeNull();
    expect(paintTargetGroupFor({ id: 'old-obj', criteria: { layers: [2] } })).toBeNull();
    expect(paintTargetGroupFor(null)).toBeNull();
  });
});

describe('overlaysJsonWithoutGroup', () => {
  it('drops both eyes of one group and keeps the others', () => {
    const out = JSON.parse(overlaysJsonWithoutGroup(doc([entry('a', 0), entry('b', 0), entry('a', 1)]), 'a'));
    expect(out.entries.map((e) => e.groupId)).toEqual(['b']);
    expect(out).toMatchObject({ schemaVersion: 1, width: 384, height: 224 });
  });

  it('returns an empty string when no overlay is left, so the file is left out of the pack', () => {
    expect(overlaysJsonWithoutGroup(doc([entry('a', 0)]), 'a')).toBe('');
  });

  it('leaves unreadable or empty input alone', () => {
    expect(overlaysJsonWithoutGroup('', 'a')).toBe('');
    expect(overlaysJsonWithoutGroup('not json', 'a')).toBe('not json');
  });

  it('keeps unrelated fields on the document', () => {
    const src = JSON.stringify({ schemaVersion: 1, width: 384, height: 224, note: 'x', entries: [entry('a', 0), entry('b', 1)] });
    expect(JSON.parse(overlaysJsonWithoutGroup(src, 'a')).note).toBe('x');
  });
});
