import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { openZip, ZipUnsupported, canReadZipNatively } from './zip-read.js';

async function sampleZip(compression) {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ name: 'Mário ✓', n: 1 }));
  zip.file('vipstates/f-a.json', 'x'.repeat(5000));
  zip.file('savestates/f-a.state', new Uint8Array([1, 2, 3, 250]));
  zip.folder('empty');
  return zip.generateAsync({ type: 'uint8array', compression });
}

describe('openZip', () => {
  it('this platform inflates natively (Node 18+, every current browser)', () => {
    expect(canReadZipNatively()).toBe(true);
  });

  for (const compression of ['DEFLATE', 'STORE']) {
    it(`reads what JSZip writes (${compression}): text, bytes, names, folders left out`, async () => {
      const zip = openZip(await sampleZip(compression));
      expect(Object.keys(zip.files).sort()).toEqual(['manifest.json', 'savestates/f-a.state', 'vipstates/f-a.json']);
      expect(JSON.parse(await zip.file('manifest.json').async('string'))).toEqual({ name: 'Mário ✓', n: 1 });
      expect(await zip.file('vipstates/f-a.json').async('string')).toBe('x'.repeat(5000));
      expect([...new Uint8Array(await zip.file('savestates/f-a.state').async('arraybuffer'))]).toEqual([1, 2, 3, 250]);
      expect(zip.filter((p) => p.startsWith('vipstates/')).map((e) => e.name)).toEqual(['vipstates/f-a.json']);
      expect(zip.file('missing')).toBeNull();
    });
  }

  it('says when it cannot read a file, so the caller can fall back', () => {
    expect(() => openZip(new Uint8Array(100))).toThrow(ZipUnsupported);
  });
});
