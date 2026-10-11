import { describe, it, expect } from 'vitest';
import { getBgAffineWorldClipRect, getWindowsTableBytesFromState } from './vip-world-clip.js';

describe('getBgAffineWorldClipRect', () => {
  it('returns null for OBJ world (bgm === 3)', () => {
    const windows = new Uint8Array(1024);
    windows[0] = 0;
    windows[1] = 0x30;
    expect(getBgAffineWorldClipRect(windows, 0, 0)).toBeNull();
  });

  it('returns inclusive clip for a minimal valid world record', () => {
    const windows = new Uint8Array(1024);
    const base = 30 * 32;
    windows[base] = 0x00;
    windows[base + 1] = 0x00;
    // gx, gp, gy, destW, destH — use simple positive placement inside frame
    windows[base + 2] = 0;
    windows[base + 3] = 0;
    windows[base + 4] = 0;
    windows[base + 5] = 0;
    windows[base + 6] = 0;
    windows[base + 7] = 0;
    windows[base + 14] = 0x80;
    windows[base + 15] = 0;
    windows[base + 16] = 0x20;
    windows[base + 17] = 0;
    const r = getBgAffineWorldClipRect(windows, 30, 0);
    expect(r).not.toBeNull();
    expect(r.x0).toBeLessThanOrEqual(r.x1);
    expect(r.y0).toBeLessThanOrEqual(r.y1);
  });
});

describe('getWindowsTableBytesFromState', () => {
  it('decodes windowsBase64 when windows is absent', () => {
    const raw = new Uint8Array(1024);
    raw[0] = 0xab;
    let b64 = '';
    for (let i = 0; i < raw.length; i++) b64 += String.fromCharCode(raw[i]);
    if (typeof btoa !== 'undefined') b64 = btoa(b64);
    const got = getWindowsTableBytesFromState({ windowsBase64: b64 });
    expect(got).not.toBeNull();
    expect(got.length).toBe(1024);
    expect(got[0]).toBe(0xab);
  });

  it('uses Uint8Array windows when present', () => {
    const raw = new Uint8Array(1024);
    raw.fill(7);
    expect(getWindowsTableBytesFromState({ windows: raw }).subarray(0, 4)).toEqual(new Uint8Array([7, 7, 7, 7]));
  });
});
