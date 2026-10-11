import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { crc32, sha1, romIdentity, sameRom } from './rom-identity.js';
import { buildPlayPack, parsePlayPack, PLAY_PACK_FORMAT } from './play-pack.js';
import { buildArtPack, parseArtPack } from './art-pack.js';

const text = (s) => new TextEncoder().encode(s);

describe('rom identity', () => {
  it('computes CRC32 and SHA-1 (standard check values)', async () => {
    expect(crc32(text('123456789'))).toBe('cbf43926');
    expect(await sha1(text('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await romIdentity(text('abc'))).toEqual({ size: 3, sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d', crc32: '352441c2' });
  });

  it('matches a ROM by SHA-1, else by CRC32 and size', async () => {
    const id = await romIdentity(text('abc'));
    expect(sameRom({ sha1: id.sha1.toUpperCase() }, id)).toBe(true);
    expect(sameRom({ sha1: '0'.repeat(40), crc32: id.crc32 }, id)).toBe(false); // SHA-1 decides when present
    expect(sameRom({ crc32: id.crc32, size: 3 }, id)).toBe(true);
    expect(sameRom({ crc32: id.crc32, size: 4 }, id)).toBe(false);
    expect(sameRom(null, id)).toBe(false);
  });
});

const ROM = text('pretend this is a Virtual Boy ROM');
const parts = () => ({
  rom: ROM.buffer.slice(0),
  vbcolor: new Uint8Array([1, 2, 3, 4]).buffer,
  manifest: { name: 'Test Game', romFileName: 'test.vb', paintOnTransparent: 1, frameRegistry: [{ big: 'authoring data' }] },
  groups: [
    { id: 'a', name: 'Crowd', expanded: true, criteria: { windowIds: [30] }, layerArt: { world: 30, png: 'x' } },
    { id: 'b', name: 'Title', touchUp: { anchorHash: 1 } },
  ],
  gameStatePools: [{ id: 'p' }],
  groupsSchemaVersion: 2,
  overrides: [{ hash: 1 }],
  painterV2Rules: { schemaVersion: 1 },
  painterV2VipOverlays: '{"entries":[]}',
  vipStatesFolder: [
    { name: 'vipstates/a.json', json: '{"masterBrightness":0.5}' },
    { name: 'vipstates/b.json', json: '{"masterBrightness":0.5}' },
    { name: 'vipstates/c.json', json: '{"masterBrightness":1}' },
  ],
});

describe('play packs', () => {
  it('carry the colour and which ROM they are for, never the ROM or the captures', async () => {
    const { bytes, info } = await buildPlayPack(parts(), { title: 'Mario’s Tennis', author: 'Me', now: new Date('2026-10-02T00:00:00Z') });
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toEqual(['color.vbcolor', 'groups.json', 'overrides.json', 'painter-v2-rules.json', 'painter-v2-vip-overlays.json', 'play.json']);
    const id = await romIdentity(ROM);
    expect(info).toMatchObject({
      format: PLAY_PACK_FORMAT,
      version: 1,
      title: 'Mario’s Tennis',
      author: 'Me',
      createdAt: '2026-10-02T00:00:00.000Z',
      rom: { fileName: 'test.vb', size: id.size, sha1: id.sha1, crc32: id.crc32 },
      paintOnTransparent: true,
      brightnessReference: 0.5, // most frames
      features: ['tileColors', 'layerArt', 'touchUps'],
    });
  });

  it('read back what the colour layer needs', async () => {
    const cover = new Uint8Array([137, 80, 78, 71]);
    const { bytes } = await buildPlayPack(parts(), { cover });
    const p = await parsePlayPack(bytes);
    expect([...new Uint8Array(p.vbcolor)]).toEqual([1, 2, 3, 4]);
    expect(p.groups.map((g) => g.id)).toEqual(['a', 'b']);
    expect(p.groups[0].expanded).toBeUndefined(); // authoring only
    expect(p.groups[0].layerArt).toEqual({ world: 30, png: 'x' });
    expect(p).toMatchObject({ gameStatePools: [{ id: 'p' }], groupsSchemaVersion: 2, overrides: [{ hash: 1 }], painterV2Rules: { schemaVersion: 1 }, painterV2VipOverlays: '{"entries":[]}' });
    expect([...p.cover]).toEqual([...cover]);
  });

  it('name the ROM from the manifest when the project no longer holds it', async () => {
    const { rom: _rom, ...noRom } = parts();
    const { info } = await buildPlayPack({ ...noRom, manifest: { ...noRom.manifest, romSha1: 'ab'.repeat(20), romCrc32: '12345678', romSize: 9 } });
    expect(info.rom).toMatchObject({ sha1: 'ab'.repeat(20), crc32: '12345678', size: 9 });
    await expect(buildPlayPack(noRom)).rejects.toThrow(/no ROM/);
  });

  it('refuse projects with no colour, and files that are not play packs', async () => {
    await expect(buildPlayPack({ rom: ROM.buffer.slice(0) })).rejects.toThrow(/no colour/);
    await expect(parsePlayPack(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a play pack/);
    const vbpack = await (await buildArtPack(parts())).arrayBuffer();
    await expect(parsePlayPack(vbpack)).rejects.toThrow(/\.vbpack project/);
    const zip = new JSZip();
    zip.file('play.json', JSON.stringify({ format: PLAY_PACK_FORMAT, version: 99, rom: { sha1: 'x' } }));
    await expect(parsePlayPack(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/newer player/);
  });
});

describe('.vbpack manifest', () => {
  it('records the ROM’s SHA-1, CRC32 and size when the pack holds the ROM', async () => {
    const parsed = await parseArtPack(await (await buildArtPack(parts())).arrayBuffer());
    const id = await romIdentity(ROM);
    expect(parsed.manifest).toMatchObject({ romSha1: id.sha1, romCrc32: id.crc32, romSize: id.size, name: 'Test Game' });
  });
});
