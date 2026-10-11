import { describe, it, expect } from 'vitest';
import {
  framesInParts,
  frameBytes,
  planFrameCleanup,
  splitFrames,
  archivePackParts,
  withArchivedCoverage,
  addArchivedCoverage,
} from './frame-cleanup.js';
import { emptyCoverage } from './auto-capture.js';
import { buildArtPack, parseArtPack, artPackPartsFromParsed } from './art-pack.js';
import { mergePacks } from './pack-merge.js';

const keys = (...k) => new Set(k);

function parts() {
  const reg = (id) => ({
    frameId: id,
    stateName: 'InGame',
    vipStateFile: `vipstates/${id}.json`,
    saveStateFile: `savestates/${id}.state`,
    screenshotFile: `screenshots/${id}.png`,
  });
  return {
    manifest: {
      gameId: 'game',
      romSha1: 'abc',
      frameRegistry: ['f1', 'f2', 'f3'].map(reg),
      references: { items: [{ refId: 'r1' }], active: { 'frame:f2': 'r1', group: 'r1' } },
      painterV2LastVipFile: 'f3.json',
    },
    groups: [{ id: 'g', name: 'Mario', poses: [{ poseId: 'pose_1', name: 'Run', sourceFrameId: 'f1', tiles: [] }] }],
    vipStatesFolder: ['f1', 'f2', 'f3'].map((id) => ({ name: `${id}.json`, json: `{"id":"${id}"}` })),
    saveStatesFolder: ['f1', 'f2', 'f3'].map((id) => ({ name: `${id}.state`, buffer: new Uint8Array(10) })),
    screenshotsFolder: [{ name: 'f3.png', blob: new Blob([new Uint8Array(5)]) }],
  };
}

describe('framesInParts / frameBytes', () => {
  it('lists each captured frame with its registry entry and size across its files', () => {
    const p = parts();
    expect(framesInParts(p).map((f) => [f.frameId, f.entry?.stateName])).toEqual([['f1', 'InGame'], ['f2', 'InGame'], ['f3', 'InGame']]);
    expect(frameBytes(p, 'f3')).toBe('{"id":"f3"}'.length + 10 + 5);
  });
});

describe('planFrameCleanup', () => {
  it('keeps pose sources and referenced frames, and suggests frames whose patterns other frames show', () => {
    const { rows, suggested } = planFrameCleanup({
      frames: [
        { frameId: 'f1', keys: keys('InGame|bg:1') },
        { frameId: 'f2', keys: keys('InGame|bg:2') },
        { frameId: 'f3', keys: keys('InGame|bg:1', 'InGame|bg:2') },
        { frameId: 'f4', keys: keys('InGame|bg:1') },
        { frameId: 'f5', keys: keys('Intro|bg:1') },
      ],
      groups: parts().groups,
      references: parts().manifest.references,
    });
    expect(rows.find((r) => r.frameId === 'f1')).toMatchObject({ protected: true, poses: ['Mario › Run'] });
    expect(rows.find((r) => r.frameId === 'f2')).toMatchObject({ protected: true, hasReference: true });
    // f4 only repeats f1; f3 repeats f1 + f2; f5 is the only Intro frame showing pattern 1.
    expect([...suggested].sort()).toEqual(['f3', 'f4']);
    expect(rows.find((r) => r.frameId === 'f5').unique).toBe(1);
  });

  it('never suggests both of two frames that only show each other’s patterns', () => {
    const { suggested } = planFrameCleanup({
      frames: [
        { frameId: 'a', keys: keys('S|obj:9') },
        { frameId: 'b', keys: keys('S|obj:9') },
      ],
      groups: [],
    });
    expect(suggested.size).toBe(1);
  });

  it('flags frames identical to an earlier one', () => {
    const { rows } = planFrameCleanup({
      frames: [
        { frameId: 'a', json: '{"x":1}', keys: keys() },
        { frameId: 'b', json: '{"x":1}', keys: keys() },
      ],
      groups: [],
    });
    expect(rows[1].duplicateOf).toBe('a');
  });
});

describe('splitFrames', () => {
  it('takes a frame’s files, registry entry and reference link out, without changing the input', () => {
    const p = parts();
    const { kept, removed, count } = splitFrames(p, ['f2', 'F3']);
    expect(count).toBe(2);
    expect(kept.vipStatesFolder.map((f) => f.name)).toEqual(['f1.json']);
    expect(kept.saveStatesFolder.map((f) => f.name)).toEqual(['f1.state']);
    expect(kept.screenshotsFolder).toBeUndefined();
    expect(kept.manifest.frameRegistry.map((e) => e.frameId)).toEqual(['f1']);
    expect(kept.manifest.references.active).toEqual({ group: 'r1' });
    expect(kept.manifest.painterV2LastVipFile).toBeUndefined();
    expect(removed.frameRegistry.map((e) => e.frameId)).toEqual(['f2', 'f3']);
    expect(removed.screenshotsFolder.map((f) => f.name)).toEqual(['f3.png']);
    expect(p.vipStatesFolder).toHaveLength(3);
    expect(p.manifest.frameRegistry).toHaveLength(3);
  });
});

describe('archive packs', () => {
  it('builds an archive pack that Import from another pack brings back', async () => {
    const p = parts();
    const { kept, removed } = splitFrames(p, ['f3']);
    const archive = archivePackParts(p.manifest, removed, { from: 'game.vbpack', at: '2026-10-03T00:00:00Z' });
    expect(archive.manifest).toMatchObject({ gameId: 'game', romSha1: 'abc', archivedFrames: { from: 'game.vbpack', count: 1 } });
    const blob = await buildArtPack(archive);
    const back = artPackPartsFromParsed(await parseArtPack(await blob.arrayBuffer()));
    expect(back.vipStatesFolder.map((f) => f.name)).toEqual(['f3.json']);
    const { parts: merged } = mergePacks(kept, back);
    expect(merged.vipStatesFolder.map((f) => f.name).sort()).toEqual(['f1.json', 'f2.json', 'f3.json']);
    expect(merged.manifest.frameRegistry.map((e) => e.frameId).sort()).toEqual(['f1', 'f2', 'f3']);
  });
});

describe('archived coverage', () => {
  it('remembers what removed frames showed, and adds it to auto-capture coverage', () => {
    const cov = emptyCoverage();
    cov.bg.add(5);
    cov.obj.add(0xffffffff);
    const m1 = withArchivedCoverage({ gameId: 'g' }, cov);
    const m2 = withArchivedCoverage(m1, { bg: new Set([3, 5]), obj: new Set(), affine: new Set([7]) });
    expect(m2.archivedCoverage).toEqual({ bg: [3, 5], obj: [0xffffffff], affine: [7] });
    expect(m2.gameId).toBe('g');
    const live = addArchivedCoverage(emptyCoverage(), m2.archivedCoverage);
    expect([...live.bg]).toEqual([3, 5]);
    expect(live.affine.has(7)).toBe(true);
  });
});
