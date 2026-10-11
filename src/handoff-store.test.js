import { describe, it, expect } from 'vitest';
import { toStorable, fromStored } from './handoff-store.js';

describe('handoff values (large packs go through IndexedDB as Blobs)', () => {
  it('stores binary data as a Blob, which Chrome keeps outside its per-value size limit', () => {
    const packed = toStorable(new Uint8Array([1, 2, 3]).buffer);
    expect(packed).toBeInstanceOf(Blob);
    expect(toStorable(new Uint8Array([1, 2, 3]))).toBeInstanceOf(Blob);
  });

  it('gives callers an ArrayBuffer back, as before', async () => {
    const back = await fromStored(toStorable(new Uint8Array([7, 8, 9]).buffer));
    expect(back).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(back)]).toEqual([7, 8, 9]);
  });

  it('leaves everything else alone (names, state objects, file handles)', async () => {
    const state = { v: 1, packName: 'p.vbpack' };
    expect(toStorable('name.vbpack')).toBe('name.vbpack');
    expect(toStorable(state)).toBe(state);
    expect(await fromStored(state)).toBe(state);
    expect(await fromStored(null)).toBeNull();
  });

  it('still reads an ArrayBuffer stored before this change', async () => {
    const old = new Uint8Array([4, 5]).buffer;
    expect(await fromStored(old)).toBe(old);
  });
});
