import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { openZip } from './zip-read.js';
import { lazyJsonItem, lazyBufferItem, isLazyItem, ReadOnGetMap, RecentMap } from './lazy-entries.js';
import { parseArtPack } from './art-pack.js';

async function zipOf(files) {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('lazy items', () => {
  it('read their entry when asked, with the size known before', async () => {
    const zip = openZip(await zipOf({ 'vipstates/a.json': '{"x":1}', 'savestates/a.state': new Uint8Array([7, 8, 9]) }));
    const j = lazyJsonItem('a.json', zip.file('vipstates/a.json'));
    const b = lazyBufferItem('a.state', zip.file('savestates/a.state'));
    expect(j.size).toBe(7);
    expect(isLazyItem(j) && isLazyItem(b)).toBe(true);
    expect(JSON.parse(j.json)).toEqual({ x: 1 });
    expect([...new Uint8Array(b.buffer)]).toEqual([7, 8, 9]);
    // A buffer is the reader's own: changing it does not change the next read.
    new Uint8Array(b.buffer)[0] = 0;
    const again = b.buffer;
    new Uint8Array(again)[0] = 0;
    expect([...new Uint8Array(b.buffer)]).toEqual([7, 8, 9]);
    expect(isLazyItem({ name: 'x', json: '{}' })).toBe(false);
  });
});

describe('ReadOnGetMap', () => {
  it('stores items and answers get with what read makes of them', () => {
    let reads = 0;
    const m = new ReadOnGetMap((item) => {
      reads++;
      return item.n * 2;
    });
    m.set('a', { n: 2 });
    m.set('b', { n: 5 });
    expect(reads).toBe(0);
    expect(m.get('b')).toBe(10);
    expect(m.get('missing')).toBeUndefined();
    expect(m.has('a')).toBe(true);
    expect(reads).toBe(1);
  });
});

describe('RecentMap', () => {
  it('keeps the most recently used entries', () => {
    const m = new RecentMap(2);
    m.set('a', 1).set('b', 2);
    m.get('a'); // a is now the most recent
    m.set('c', 3);
    expect([...m.keys()].sort()).toEqual(['a', 'c']);
    expect(m.get('b')).toBeUndefined();
  });
});

describe('parseArtPack', () => {
  it('frames, save states, dumps, screenshots and recordings come back lazy, reading what JSZip reads', async () => {
    const bytes = await zipOf({
      'manifest.json': '{"gameId":"g"}',
      'vipstates/f-1.json': '{"version":1}',
      'savestates/f-1.state': new Uint8Array([1, 2]),
      'ramdumps/f-1.wram.bin': new Uint8Array([3]),
      'screenshots/f-1.png': new Uint8Array([4, 5]),
      'memoryrecordings/r-1.bin': new Uint8Array([6]),
    });
    const parsed = await parseArtPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    for (const key of ['vipStatesFolder', 'saveStatesFolder', 'ramdumpsFolder', 'screenshotsFolder', 'memoryRecordingsFolder']) {
      expect(parsed[key]).toHaveLength(1);
      expect(isLazyItem(parsed[key][0])).toBe(true);
    }
    expect(parsed.vipStatesFolder[0]).toMatchObject({ name: 'f-1.json', json: '{"version":1}' });
    expect([...new Uint8Array(parsed.saveStatesFolder[0].buffer)]).toEqual([1, 2]);
    expect([...new Uint8Array(parsed.memoryRecordingsFolder[0].buffer)]).toEqual([6]);
  });
});
