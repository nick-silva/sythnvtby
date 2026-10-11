import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import {
  parseArtPack,
  buildArtPack,
  artPackPartsFromParsed,
  defaultPainterV2Rules,
  PACK_ENTRIES,
} from './art-pack.js';
import {
  buildPoseFromCapture,
  normalizeObjProfileFields,
  requiredGroupsSchemaVersion,
} from './obj-sprite-profiles.js';

describe('painter-v2-rules.json (additive)', () => {
  it('writes and reads a rules document', async () => {
    const rules = { ...defaultPainterV2Rules(), testMarker: 'round-trip' };
    const blob = await buildArtPack({
      manifest: { version: 1, gameId: 'test-pack' },
      painterV2Rules: rules,
    });
    const buf = await blob.arrayBuffer();
    const parsed = await parseArtPack(buf);
    expect(parsed.painterV2Rules).toBeDefined();
    expect(parsed.painterV2Rules.schemaVersion).toBe(1);
    expect(parsed.painterV2Rules.testMarker).toBe('round-trip');
  });

  it('omits the zip entry when painterV2Rules is not passed', async () => {
    const blob = await buildArtPack({ manifest: { version: 1, gameId: 'a' } });
    const buf = await blob.arrayBuffer();
    const parsed = await parseArtPack(buf);
    expect(parsed.painterV2Rules).toBeUndefined();
  });

  it('round-trips rules with a minimal ROM via artPackPartsFromParsed', async () => {
    const rom = new Uint8Array([0x80, 0x00, 0x00]).buffer;
    const blob = await buildArtPack({
      rom,
      manifest: { version: 1, gameId: 'rt' },
      painterV2Rules: { schemaVersion: 1, tile8ByVariant: { demo: {} } },
    });
    const first = await parseArtPack(await blob.arrayBuffer());
    const merged = {
      ...artPackPartsFromParsed(first),
      painterV2Rules: { ...defaultPainterV2Rules(), note: 'merged' },
    };
    const second = await parseArtPack(await (await buildArtPack(merged)).arrayBuffer());
    expect(second.rom?.byteLength).toBe(rom.byteLength);
    expect(second.painterV2Rules?.note).toBe('merged');
    expect(second.painterV2Rules?.schemaVersion).toBe(1);
  });
});

describe('parseArtPack with optional VBPACK_TEST_PATH', () => {
  it('merges defaultPainterV2Rules into an existing vbpack from disk', async () => {
    const p = process.env.VBPACK_TEST_PATH;
    if (!p || String(p).trim() === '') {
      return;
    }
    const buffer = await readFile(String(p).trim());
    const before = await parseArtPack(buffer);
    const blob = await buildArtPack({
      ...artPackPartsFromParsed(before),
      painterV2Rules: {
        ...defaultPainterV2Rules(),
        ...(before.painterV2Rules != null &&
        typeof before.painterV2Rules === 'object' &&
        !Array.isArray(before.painterV2Rules)
          ? before.painterV2Rules
          : {}),
        testInjectedAt: new Date().toISOString(),
      },
    });
    const after = await parseArtPack(await blob.arrayBuffer());
    expect(after.painterV2Rules?.schemaVersion).toBe(1);
    expect(after.painterV2Rules?.testInjectedAt).toBeDefined();
    if (before.rom) {
      expect(after.rom?.byteLength).toBe(before.rom.byteLength);
    }
  });
});

describe('PACK_ENTRIES', () => {
  it('exposes painter v2 rules filename', () => {
    expect(PACK_ENTRIES.PAINTER_V2_RULES).toBe('painter-v2-rules.json');
  });
  it('exposes painter v2 vip overlays filename', () => {
    expect(PACK_ENTRIES.PAINTER_V2_VIP_OVERLAYS).toBe('painter-v2-vip-overlays.json');
  });
});

describe('painter-v2-vip-overlays.json', () => {
  it('round-trips a minimal overlays document', async () => {
    const doc = {
      schemaVersion: 1,
      width: 384,
      height: 224,
      entries: [{ groupId: 'title-bg', eye: 0, rgbaBase64: 'AAAA' }],
    };
    const blob = await buildArtPack({
      manifest: { version: 1, gameId: 'vip-rt' },
      painterV2VipOverlays: JSON.stringify(doc),
    });
    const parsed = await parseArtPack(await blob.arrayBuffer());
    expect(typeof parsed.painterV2VipOverlays).toBe('string');
    const back = JSON.parse(parsed.painterV2VipOverlays || '{}');
    expect(back.schemaVersion).toBe(1);
    expect(back.entries).toHaveLength(1);
    expect(back.entries[0].groupId).toBe('title-bg');
  });

  it('omits the zip entry when painterV2VipOverlays is not passed', async () => {
    const blob = await buildArtPack({ manifest: { version: 1, gameId: 'no-vip' } });
    const parsed = await parseArtPack(await blob.arrayBuffer());
    expect(parsed.painterV2VipOverlays).toBeUndefined();
  });
});

describe('recovery/ (pictures set aside instead of saved wrong)', () => {
  it('round-trips the set-aside files, and a re-save from parsed parts keeps them', async () => {
    const item = JSON.stringify({ version: 1, id: 'r1', groupId: 'g' });
    const parsed = await parseArtPack(await (await buildArtPack({ manifest: { version: 1 }, recoveryFolder: [{ name: 'r1.json', json: item }] })).arrayBuffer());
    expect(parsed.recoveryFolder).toEqual([{ name: 'r1.json', json: item }]);
    const again = await parseArtPack(await (await buildArtPack(artPackPartsFromParsed(parsed))).arrayBuffer());
    expect(again.recoveryFolder).toEqual([{ name: 'r1.json', json: item }]);
    const none = await parseArtPack(await (await buildArtPack({ manifest: { version: 1 } })).arrayBuffer());
    expect(none.recoveryFolder).toBeUndefined();
  });
});

describe('gameStates (named memory conditions, src/game-states.js)', () => {
  const STATE = { id: 'luigi-is-player', name: 'Luigi is the player', conditions: [{ offset: 8212, value: 2 }], source: 'learned' };
  const GROUP = { id: 'g', criteria: {}, conditions: [{ state: 'luigi-is-player', is: false }] };

  it('round-trips game states and group conditions, and a re-save from parsed parts keeps them', async () => {
    const parsed = await parseArtPack(await (await buildArtPack({ manifest: { version: 1 }, groups: [GROUP], gameStates: [STATE] })).arrayBuffer());
    expect(parsed.gameStates).toEqual([STATE]);
    expect(parsed.groups).toEqual([GROUP]);
    const again = await parseArtPack(await (await buildArtPack(artPackPartsFromParsed(parsed))).arrayBuffer());
    expect(again.gameStates).toEqual([STATE]);
    const none = await parseArtPack(await (await buildArtPack({ manifest: { version: 1 }, groups: [{ id: 'x', criteria: {} }] })).arrayBuffer());
    expect(none.gameStates).toBeUndefined();
  });

  it('converts the interim sub-states on open', async () => {
    const pools = [{ id: 'pool-game', label: 'InGame', variants: [{ id: 'd', ramConditions: [{ offset: 0, expectedValue: 48 }] }], subStates: [{ id: 'sub-l', label: 'Luigi', ramConditions: [{ offset: 8212, expectedValue: 2 }] }] }];
    const groups = [{ id: 'g', criteria: {}, screens: { mode: 'only', pools: ['pool-game::sub-l'] } }];
    const parsed = await parseArtPack(await (await buildArtPack({ manifest: { version: 1 }, groups, gameStatePools: pools })).arrayBuffer());
    expect(parsed.gameStates).toEqual([{ id: 'luigi', name: 'Luigi', conditions: [{ offset: 0, value: 48 }, { offset: 8212, value: 2 }], source: 'learned' }]);
    expect(parsed.groups).toEqual([{ id: 'g', criteria: {}, conditions: [{ state: 'luigi', is: true }] }]);
    expect(parsed.gameStatePools[0].subStates).toBeUndefined();
  });
});

describe('memoryrecordings/ (recordings for questions, src/memory-questions.js)', () => {
  it('round-trips the recordings, and a re-save from parsed parts keeps them', async () => {
    const buffer = new Uint8Array([86, 66, 77, 82, 1, 0, 0, 0, 0, 0, 0, 0]).buffer;
    const parsed = await parseArtPack(await (await buildArtPack({ manifest: { version: 1 }, memoryRecordingsFolder: [{ name: 'r-1.bin', buffer }] })).arrayBuffer());
    expect(parsed.memoryRecordingsFolder.map((f) => [f.name, f.buffer.byteLength])).toEqual([['r-1.bin', 12]]);
    const again = await parseArtPack(await (await buildArtPack(artPackPartsFromParsed(parsed))).arrayBuffer());
    expect(again.memoryRecordingsFolder.map((f) => f.name)).toEqual(['r-1.bin']);
  });
});

describe('references/ (colour reference images)', () => {
  // The app passes a Blob here; under node JSZip wants bytes, and takes either.
  const png = new Uint8Array([137, 80, 78, 71]);
  const references = { items: [{ refId: 'r-test-1', scope: 'pool', scopeId: 'p-1', importedAt: '2026-09-21T00:00:00Z' }], active: { 'pool:p-1': 'r-test-1' } };

  it('round-trips reference images and their manifest block', async () => {
    const blob = await buildArtPack({
      manifest: { version: 1, gameId: 'test-pack', references },
      referencesFolder: [{ name: 'r-test-1.png', blob: png }],
    });
    const parsed = await parseArtPack(await blob.arrayBuffer());
    expect(parsed.referencesFolder).toHaveLength(1);
    expect(parsed.referencesFolder[0].name).toBe('r-test-1.png');
    expect(new Uint8Array(parsed.referencesFolder[0].buffer)).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(parsed.manifest.references).toEqual(references);

    // A re-save from the parsed parts keeps them, like every other pack folder.
    const again = await parseArtPack(await (await buildArtPack(artPackPartsFromParsed(parsed))).arrayBuffer());
    expect(again.referencesFolder).toHaveLength(1);
    expect(again.manifest.references.active).toEqual({ 'pool:p-1': 'r-test-1' });
  });

  it('omits the folder when no references are passed', async () => {
    const parsed = await parseArtPack(await (await buildArtPack({ manifest: { version: 1 } })).arrayBuffer());
    expect(parsed.referencesFolder).toBeUndefined();
  });
});

describe('compression', () => {
  /** Each entry's zip method from its local file header: 0 = stored, 8 = deflated. */
  function zipMethods(bytes) {
    const out = {};
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i + 30 <= bytes.length; i++) {
      if (view.getUint32(i, true) !== 0x04034b50) continue;
      const method = view.getUint16(i + 8, true);
      const nameLen = view.getUint16(i + 26, true);
      out[new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen))] = method;
    }
    return out;
  }

  it('deflates frame snapshots, stores PNGs as they are, and round-trips both', async () => {
    // A frame snapshot is long, repetitive JSON: the bulk of a real project.
    const json = JSON.stringify({ drawList: Array.from({ length: 4000 }, (_, i) => ({ tileIndex: i % 64, x: i % 384, y: 8, world: 30 })) });
    const png = new Uint8Array(4096).map((_, i) => (i * 2654435761) >>> 24);
    const blob = await buildArtPack({
      manifest: { version: 1 },
      vipStatesFolder: [{ name: 'f-a.json', json }],
      screenshotsFolder: [{ name: 'f-a.png', blob: png }],
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const methods = zipMethods(bytes);
    expect(methods['vipstates/f-a.json']).toBe(8);
    expect(methods['screenshots/f-a.png']).toBe(0);
    expect(bytes.length).toBeLessThan(json.length / 5);

    const parsed = await parseArtPack(bytes.buffer);
    expect(parsed.vipStatesFolder[0].json).toBe(json);
    expect(new Uint8Array(parsed.screenshotsFolder[0].buffer)).toEqual(png);
  });
});

describe('parseArtPack groupsJsonInPack', () => {
  it('is false when zip has no groups.json', async () => {
    const blob = await buildArtPack({ manifest: { version: 1, gameId: 'minimal' } });
    const parsed = await parseArtPack(await blob.arrayBuffer());
    expect(parsed.groupsJsonInPack).toBe(false);
  });

  it('is true when zip includes groups.json', async () => {
    const blob = await buildArtPack({
      manifest: { version: 1, gameId: 'g' },
      groups: [{ id: 'a', name: 'A', criteria: { hashes: [] } }],
      groupsSchemaVersion: 2,
    });
    const parsed = await parseArtPack(await blob.arrayBuffer());
    expect(parsed.groupsJsonInPack).toBe(true);
  });
});

describe('groups.json OBJ sprite profiles', () => {
  it('round-trips poses and track and bumps the schema version', async () => {
    const group = {
      id: 'grp_mario',
      name: 'Mario',
      authoringKind: 'obj',
      criteria: { windowIds: [], hashes: [0x11, 0x22], layers: [2] },
      poses: [
        buildPoseFromCapture({
          poseId: 'pose_walk1',
          name: 'Walk 1',
          draws: [
            { hash: 0x11, x: 100, y: 60, flipH: true },
            { hash: 0x22, x: 108, y: 60 },
          ],
          sourceFrameId: 'frame_0001',
        }),
      ],
      track: [{ poseId: 'pose_walk1', durationMs: 120 }],
    };
    const blob = await buildArtPack({
      manifest: { version: 1, gameId: 'profiles' },
      groups: [group],
      groupsSchemaVersion: requiredGroupsSchemaVersion([group], 2),
    });
    const parsed = await parseArtPack(await blob.arrayBuffer());
    expect(parsed.groupsSchemaVersion).toBe(3);
    expect(normalizeObjProfileFields(parsed.groups[0])).toEqual({ poses: group.poses, track: group.track });
  });
});
