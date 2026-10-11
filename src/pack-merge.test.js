import { describe, it, expect } from 'vitest';
import { comparePacks, mergePacks } from './pack-merge.js';
import { decodeGroupTileColors, encodeGroupTileColors } from './group-tile-colors.js';
import { buildVBColorPack, parseVBColorPack } from './vbcolor-pack.js';

const paint = (v) => new Uint8Array(256).fill(v);
const colours = (obj) => encodeGroupTileColors(new Map(Object.entries(obj).map(([h, v]) => [Number(h), paint(v)])));
const sprites = (obj) => buildVBColorPack('game', new Map(Object.entries(obj).map(([h, v]) => [Number(h), paint(v)])));
const pose = (poseId, name = poseId, hashes = [1]) => ({ poseId, name, tiles: hashes.map((hash) => ({ hash, dx: 0, dy: 0 })) });

function mine() {
  return {
    manifest: { gameId: 'game', romSha1: 'abc', frameRegistry: [{ frameId: 'f1' }], references: { items: [{ refId: 'r1' }], active: { 'frame:f1': 'r1' } } },
    groups: [
      { id: 'g1', name: 'Mario', criteria: { hashes: [1, 2], windowIds: [3] }, poses: [pose('pose_1', 'Run')], tileColors: colours({ 1: 10, 2: 20 }) },
      { id: 'g2', name: 'Court', criteria: { hashes: [5] }, tileColors: colours({ 5: 50 }) },
    ],
    vipStatesFolder: [{ name: 'f1.json', json: '{}' }],
    referencesFolder: [{ name: 'r1.png', blob: 'png1' }],
    vbcolor: sprites({ 100: 1 }),
    overrides: [{ hash: 1, dx: 1 }],
  };
}

function theirs() {
  return {
    manifest: {
      gameId: 'game',
      romSha1: 'abc',
      frameRegistry: [{ frameId: 'f1' }, { frameId: 'f2' }],
      references: { items: [{ refId: 'r1' }, { refId: 'r2' }], active: { 'frame:f1': 'r2', 'frame:f2': 'r2' } },
    },
    groups: [
      {
        id: 'g1',
        name: 'Mario',
        criteria: { hashes: [1, 2, 7], windowIds: [3, 4] },
        poses: [pose('pose_1', 'Run'), pose('pose_2', 'Serve', [7]), pose('pose_1-x', 'Jump')],
        tileColors: colours({ 1: 10, 2: 99, 7: 70 }),
      },
      // Same name, different id: still the same group.
      { id: 'g2-other', name: 'Court', criteria: { hashes: [5] }, tileColors: colours({ 5: 50 }), layerArt: { png: 'x' } },
      { id: 'g3', name: 'Net', criteria: { hashes: [8] }, tileColors: colours({ 8: 80 }) },
    ],
    vipStatesFolder: [{ name: 'f1.json', json: '{"other":1}' }, { name: 'f2.json', json: '{}' }],
    saveStatesFolder: [{ name: 'f2.state', buffer: new Uint8Array([1]) }],
    referencesFolder: [{ name: 'r1.png', blob: 'png1' }, { name: 'r2.png', blob: 'png2' }],
    vbcolor: sprites({ 100: 2, 101: 3 }),
    overrides: [{ hash: 1, dx: 1 }, { hash: 2, dx: 2 }],
  };
}

describe('comparePacks', () => {
  it('lists what only the other pack has and what both have differently', () => {
    const c = comparePacks(mine(), theirs());
    expect(c.sameRom).toBe(true);
    expect(c.groupsOnlyTheirs.map((g) => g.name)).toEqual(['Net']);
    const mario = c.groups.find((g) => g.name === 'Mario');
    expect(mario.posesOnlyTheirs).toEqual(['Serve', 'Jump']);
    expect(mario).toMatchObject({ tilesOnlyTheirs: 1, tileClashes: 1, criteriaAdds: 2 });
    expect(c.groups.find((g) => g.name === 'Court').pictures).toEqual([{ key: 'layerArt', clash: false }]);
    expect(c).toMatchObject({ framesOnlyTheirs: 1, referencesOnlyTheirs: 1, spriteColoursOnlyTheirs: 1, spriteColourClashes: 1, overridesOnlyTheirs: 1 });
    expect(c.clashes).toBe(2);
    expect(c.nothingToImport).toBe(false);
  });

  it('says so when there is nothing new, and when the ROMs differ', () => {
    const m = mine();
    expect(comparePacks(m, mine()).nothingToImport).toBe(true);
    expect(comparePacks(m, { ...mine(), manifest: { romSha1: 'zzz' } }).sameRom).toBe(false);
  });
});

describe('mergePacks', () => {
  it('adds what the open project lacks and keeps its own work on a clash', () => {
    const before = mine();
    const { parts, log } = mergePacks(before, theirs());
    const mario = parts.groups.find((g) => g.id === 'g1');
    expect(mario.poses.map((p) => p.name)).toEqual(['Run', 'Serve', 'Jump']);
    expect(mario.criteria).toEqual({ hashes: [1, 2, 7], windowIds: [3, 4] });
    const paintMap = decodeGroupTileColors(mario);
    expect(paintMap.get(2)[0]).toBe(20);
    expect(paintMap.get(7)[0]).toBe(70);
    expect(parts.groups.find((g) => g.id === 'g2').layerArt).toEqual({ png: 'x' });
    expect(parts.groups.map((g) => g.name)).toEqual(['Mario', 'Court', 'Net']);
    expect(parts.vipStatesFolder.map((f) => f.name)).toEqual(['f1.json', 'f2.json']);
    expect(parts.vipStatesFolder[0].json).toBe('{}');
    expect(parts.saveStatesFolder.map((f) => f.name)).toEqual(['f2.state']);
    expect(parts.manifest.frameRegistry.map((r) => r.frameId)).toEqual(['f1', 'f2']);
    expect(parts.manifest.references.items.map((r) => r.refId)).toEqual(['r1', 'r2']);
    expect(parts.manifest.references.active).toEqual({ 'frame:f1': 'r1', 'frame:f2': 'r2' });
    expect(parts.referencesFolder.map((r) => r.name)).toEqual(['r1.png', 'r2.png']);
    const v = parseVBColorPack(parts.vbcolor).entries;
    expect(v.get(100)[0]).toBe(1);
    expect(v.get(101)[0]).toBe(3);
    expect(parts.overrides).toHaveLength(2);
    expect(log.some((l) => l.includes('New group “Net”'))).toBe(true);
    // The open project's parts are not changed.
    expect(before.groups[0].poses).toHaveLength(1);
    expect(before.vipStatesFolder).toHaveLength(1);
  });

  it('takes the other pack’s version of a clash when asked', () => {
    const { parts } = mergePacks(mine(), theirs(), { clash: 'theirs' });
    expect(decodeGroupTileColors(parts.groups[0]).get(2)[0]).toBe(99);
    expect(parseVBColorPack(parts.vbcolor).entries.get(100)[0]).toBe(2);
  });

  it('keeps both of two different poses that share an id', () => {
    const t = theirs();
    t.groups[0].poses = [pose('pose_1', 'Swing')];
    const { parts, log } = mergePacks(mine(), t);
    const poses = parts.groups[0].poses;
    expect(poses.map((p) => p.name)).toEqual(['Run', 'Swing']);
    expect(new Set(poses.map((p) => p.poseId)).size).toBe(2);
    expect(log.some((l) => l.includes('shared an id'))).toBe(true);
  });

  it('does not add a pose it already has under another id', () => {
    const m = mine();
    m.groups[0].poses = [pose('pose_1', 'Run'), pose('pose_1-b', 'Serve', [7])];
    const t = theirs();
    t.groups[0].poses = [pose('pose_1', 'Serve', [7])];
    expect(comparePacks(m, t).groups.find((g) => g.name === 'Mario')?.posesSharingAnId ?? []).toEqual([]);
    expect(mergePacks(m, t).parts.groups[0].poses).toHaveLength(2);
  });

  it('brings animations the group lacks, pointed at the poses as they are named here', () => {
    const m = mine();
    m.groups[0].poses = [pose('pose_1', 'Run'), pose('pose_1-b', 'Serve', [7])];
    const t = theirs();
    t.groups[0].poses = [pose('pose_1', 'Serve', [7]), pose('pose_3', 'Jump', [9])];
    t.groups[0].tracks = [{ id: 'tr', name: 'Serve', steps: [{ poseId: 'pose_1', holdFrames: 2 }, { poseId: 'pose_3', holdFrames: 3 }, { poseId: 'gone', holdFrames: 1 }] }];
    expect(comparePacks(m, t).groups[0].tracksOnlyTheirs).toBe(1);
    const g = mergePacks(m, t).parts.groups[0];
    expect(g.tracks).toHaveLength(1);
    expect(g.tracks[0].steps.map((st) => st.poseId)).toEqual(['pose_1-b', 'pose_3']);
  });

  it('never gives two groups the same id', () => {
    const m = mine();
    const t = theirs();
    t.groups = [
      { id: 'g1', name: 'Mario', criteria: { hashes: [1] } },
      { id: 'g1', name: 'Luigi', criteria: { hashes: [9] } },
    ];
    const ids = mergePacks(m, t).parts.groups.map((g) => g.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('reports nothing new when the packs match', () => {
    expect(mergePacks(mine(), mine()).log).toEqual(['Nothing new to bring in.']);
  });
});
