import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { sha1, sha1Js, romIdentity } from './rom-identity.js';

const nodeSha1 = (b) => createHash('sha1').update(b).digest('hex');

describe('sha1Js', () => {
  it('matches the reference digest at every padding boundary and for a ROM-sized input', () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 2 * 1024 * 1024]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
      expect(sha1Js(b), `${n} bytes`).toBe(nodeSha1(b));
    }
    expect(sha1Js(new TextEncoder().encode('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
});

describe('sha1 without crypto.subtle (a page opened over plain http on the LAN)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives the same digest, and romIdentity works', async () => {
    const b = new Uint8Array(4096).map((_, i) => i & 0xff);
    const expected = nodeSha1(b);
    vi.stubGlobal('crypto', {});
    expect(await sha1(b)).toBe(expected);
    expect(await romIdentity(b)).toMatchObject({ size: 4096, sha1: expected });
  });
});
