import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { ZipWriter, crc32 } from './zip-write.js';
import { openZip } from './zip-read.js';
import { parseArtPack, buildArtPack, artPackPartsFromParsed } from './art-pack.js';

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('ZipWriter', () => {
  it('writes a zip both readers open, CRCs checked', async () => {
    const w = new ZipWriter();
    w.add('manifest.json', JSON.stringify({ name: 'Mário' }));
    w.add('vipstates/a.json', 'y'.repeat(4000));
    w.add('screenshots/a.png', new Uint8Array([137, 80, 78, 71]), { store: true });
    w.add('empty.bin', new Uint8Array(0));
    const out = await bytesOf(await w.toBlob());
    const z = await JSZip.loadAsync(out, { checkCRC32: true });
    expect(JSON.parse(await z.file('manifest.json').async('string'))).toEqual({ name: 'Mário' });
    expect(await z.file('vipstates/a.json').async('string')).toBe('y'.repeat(4000));
    const n = openZip(out);
    expect([...(await n.file('screenshots/a.png').async('uint8array'))]).toEqual([137, 80, 78, 71]);
    expect((await n.file('empty.bin').async('uint8array')).length).toBe(0);
  });

  it('copies a stored entry from another zip as is, without inflating it', async () => {
    const first = new ZipWriter();
    first.add('vipstates/a.json', 'z'.repeat(9000));
    const src = openZip(await bytesOf(await first.toBlob()));
    const entry = src.file('vipstates/a.json');
    const stored = entry.stored();
    const second = new ZipWriter();
    second.addStored('vipstates/a.json', stored);
    second.add('groups.json', '{}');
    const out = await bytesOf(await second.toBlob());
    const z = await JSZip.loadAsync(out, { checkCRC32: true });
    expect(await z.file('vipstates/a.json').async('string')).toBe('z'.repeat(9000));
    expect(openZip(out).file('vipstates/a.json').stored().raw).toEqual(stored.raw);
  });

  it('reports progress per entry, ending at 100', async () => {
    const w = new ZipWriter();
    w.add('a', 'a');
    w.add('b', 'b');
    const seen = [];
    await w.toBlob((p) => seen.push(p.percent));
    expect(seen).toEqual([0, 50, 100]);
  });
});

describe('buildArtPack', () => {
  it('a pack opened and saved again keeps every entry; unchanged frames are copied as stored', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ gameId: 'g' }));
    zip.file('vipstates/f-1.json', JSON.stringify({ version: 1, pad: 'x'.repeat(3000) }));
    zip.file('savestates/f-1.state', new Uint8Array(500).fill(7));
    zip.file('ramdumps/f-1.wram.bin', new Uint8Array(65536).fill(1));
    zip.file('memoryrecordings/r-1.bin', new Uint8Array([1, 2, 3]));
    zip.file('screenshots/f-1.png', new Uint8Array([137, 80, 78, 71]));
    const original = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const parsed = await parseArtPack(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength));
    const saved = await bytesOf(await buildArtPack(artPackPartsFromParsed(parsed)));
    const a = openZip(original);
    const b = openZip(saved);
    for (const name of Object.keys(a.files)) {
      expect(b.file(name), name).not.toBeNull();
      if (name === 'manifest.json') continue; // written again (pretty-printed): compared as JSON below
      expect(await b.file(name).async('uint8array'), name).toEqual(await a.file(name).async('uint8array'));
    }
    expect(JSON.parse(await b.file('manifest.json').async('string'))).toMatchObject({ gameId: 'g' });
    for (const name of ['vipstates/f-1.json', 'savestates/f-1.state', 'ramdumps/f-1.wram.bin', 'memoryrecordings/r-1.bin', 'screenshots/f-1.png']) {
      expect(b.file(name).stored().raw, name).toEqual(a.file(name).stored().raw);
    }
    await JSZip.loadAsync(saved, { checkCRC32: true });
  });
});
