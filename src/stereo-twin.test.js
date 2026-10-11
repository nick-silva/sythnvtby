import { describe, it, expect } from 'vitest';
import { stereoTwins } from './stereo-twin.js';

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

/** A world table; `worlds` maps world → { hdr, gx, gp, gy, mx, mp, my, w, h }. END below the lowest. */
function table(worlds) {
  const win = new Uint8Array(1024);
  for (const [k, f] of Object.entries(worlds)) {
    const b = Number(k) * 32;
    wr16(win, b, f.hdr);
    wr16(win, b + 2, f.gx ?? 0);
    wr16(win, b + 4, f.gp ?? 0);
    wr16(win, b + 6, f.gy ?? 0);
    wr16(win, b + 8, f.mx ?? 0);
    wr16(win, b + 10, f.mp ?? 0);
    wr16(win, b + 12, f.my ?? 0);
    wr16(win, b + 14, f.w ?? 383);
    wr16(win, b + 16, f.h ?? 79);
  }
  const lowest = Math.min(...Object.keys(worlds).map(Number));
  if (lowest > 0) wr16(win, (lowest - 1) * 32, 0x40);
  return win;
}

// Mario's Tennis's crowd: world 30 left only, world 31 right only, the right copy 80 map rows down.
const crowd = {
  30: { hdr: 0x8081, gx: -8 & 0xffff, gp: 6, gy: 16, mx: 112, my: 352, w: 415 },
  31: { hdr: 0x4081, gx: -8 & 0xffff, gp: 6, gy: 16, mx: 112, my: 432, w: 415 },
};

describe('stereoTwins', () => {
  it("pairs a right-only world with the left-only world in front of it (Mario's Tennis crowd)", () => {
    const twins = stereoTwins(table(crowd));
    // Same window and source; parallax GP 6 puts the right eye 12 px right of the left.
    expect([...twins]).toEqual([[31, { left: 30, shift: 12 }]]);
  });

  it('allows each eye its own crop: window and source moved together keep the content in place', () => {
    const twins = stereoTwins(table({
      30: { hdr: 0x8005, gx: 32, mx: 32, my: 0, w: 39 },
      31: { hdr: 0x4005, gx: 56, mx: 56, my: 256, w: 31 },
    }));
    expect(twins.get(31)).toEqual({ left: 30, shift: 0 });
  });

  it('leaves worlds shown on both eyes, different rows or modes, and worlds past END alone', () => {
    expect(stereoTwins(table({ 30: { hdr: 0xc081 }, 31: { hdr: 0x4081 } })).size).toBe(0);
    expect(stereoTwins(table({ 30: { hdr: 0x8081, gy: 0 }, 31: { hdr: 0x4081, gy: 208 } })).size).toBe(0);
    expect(stereoTwins(table({ 30: { hdr: 0x8081 }, 31: { hdr: 0x6081 } })).size).toBe(0);
    const ended = table(crowd);
    wr16(ended, 31 * 32, 0x4081 | 0x40); // END on world 31: nothing below it is drawn
    expect(stereoTwins(ended).size).toBe(0);
  });

  it("pairs the other way round too: the title's left eye in world 28, its right in 27", () => {
    const twins = stereoTwins(table({
      27: { hdr: 0x6002, my: 272, w: 377, h: 126 },
      28: { hdr: 0xa002, mx: 88, my: 176, w: 377, h: 126 },
    }));
    // Scaled (affine) worlds: only the placement counts, and both sit at x 0.
    expect([...twins]).toEqual([[27, { left: 28, shift: 0 }]]);
  });

  it('ignores pairs too far apart across to be one layer', () => {
    expect(stereoTwins(table({ 30: { hdr: 0x8081 }, 31: { hdr: 0x4081, gx: 200 } })).size).toBe(0);
  });
});
