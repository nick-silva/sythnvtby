import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GROUP_FIELDS, AUTHORING_ONLY_GROUP_FIELDS, normalizeGroup } from './group-schema.js';

describe('normalizeGroup', () => {
  it('keeps fields it does not know, at the top and in criteria', () => {
    const g = normalizeGroup({ id: 'g', criteria: { hashes: [1], futureCrit: 'x' }, futureField: { a: 1 } });
    expect(g.futureField).toEqual({ a: 1 });
    expect(g.criteria.futureCrit).toBe('x');
  });

  it('keeps every field SpriteStudio and the Project tool write', () => {
    const g = normalizeGroup({
      id: 'g',
      name: 'Mario',
      criteria: { windowIds: [3], hashes: [5], layers: [2] },
      folder: 'Players',
      screens: { mode: 'only', pools: ['p'] },
      conditions: [{ state: 's', is: false }],
      followPalette: true,
      wholePose: true,
      poseOf: 'parent',
      authoringKind: 'obj',
      anchorHash: 5,
      tileColors: { 5: 'AAAA' },
      poses: [{ poseId: 'a', name: 'Stand', tiles: [{ hash: 5, dx: 0, dy: 0 }] }],
    });
    expect(g).toMatchObject({
      folder: 'Players',
      screens: { mode: 'only', pools: ['p'] },
      conditions: [{ state: 's', is: false }],
      followPalette: true,
      wholePose: true,
      poseOf: 'parent',
      authoringKind: 'obj',
      anchorHash: 5,
      tileColors: { 5: 'AAAA' },
    });
    expect(g.poses.map((p) => p.poseId)).toEqual(['a']);
  });

  it('folds the old worldIds into windowIds and gives defaults', () => {
    const g = normalizeGroup({ criteria: { worldIds: [7] } });
    expect(g.criteria).toEqual({ windowIds: [7], hashes: [], layers: [] });
    expect(g.id).toMatch(/^group-/);
    expect(g.name).toBe('Group');
    expect(g.visible).toBe(true);
    expect(g.expanded).toBe(false);
  });

  it('drops a known field that is malformed', () => {
    const g = normalizeGroup({
      id: 'g',
      criteria: {},
      authoringKind: 'sprite',
      anchorHash: 'x',
      followPalette: 'yes',
      tileColors: {},
      poses: 'none',
      overpaint: { world: 99 },
    });
    for (const k of ['authoringKind', 'anchorHash', 'followPalette', 'tileColors', 'poses', 'overpaint', 'layerArt']) expect(g).not.toHaveProperty(k);
  });

  it('does not change the group it is given', () => {
    const input = { id: 'g', criteria: { worldIds: [1], hashes: [2] }, extra: [1] };
    const copy = structuredClone(input);
    normalizeGroup(input);
    expect(input).toEqual(copy);
  });

  it('keeps a live Map of paint while a stroke is in progress', () => {
    const paint = new Map([[5, new Uint8Array(256)]]);
    expect(normalizeGroup({ id: 'g', tileColors: paint }).tileColors).toBe(paint);
    expect(normalizeGroup({ id: 'g', tileColors: new Map() })).not.toHaveProperty('tileColors');
  });
});

describe('GROUP_FIELDS', () => {
  it('leaves only authoring state out of a play pack', () => {
    expect(AUTHORING_ONLY_GROUP_FIELDS).toEqual(['expanded']);
  });

  it('every documented field has a row in the format table (§6.4)', () => {
    const doc = readFileSync(new URL('../docs/reference/art-pack-file-format.md', import.meta.url), 'utf8');
    const section = doc.slice(doc.indexOf('### 6.4 `groups[]`'), doc.indexOf('### 6.5'));
    // A row's first cell names one field or several (`visible`, `expanded`).
    const firstCells = [...section.matchAll(/^\| (`[^|]+) \|/gm)].map((m) => m[1]);
    const rows = new Set(firstCells.flatMap((cell) => [...cell.matchAll(/`([A-Za-z_]+)`/g)].map((m) => m[1])));
    const missing = GROUP_FIELDS.filter((f) => !f.internal && !rows.has(f.key)).map((f) => f.key);
    expect(missing).toEqual([]);
  });
});
