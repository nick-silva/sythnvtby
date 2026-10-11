import { describe, it, expect } from 'vitest';
import { tileLocalFromVip, isBlankTile } from './vip-state.js';

describe('tileLocalFromVip', () => {
  const draw = { x: 100, y: 40 };

  it('maps a screen pixel to tile-local coords for an unflipped draw', () => {
    expect(tileLocalFromVip(draw, 101, 46)).toEqual({ lx: 1, ly: 6 });
  });

  it('mirrors x for flipH and y for flipV, matching the compositor', () => {
    expect(tileLocalFromVip({ ...draw, flipH: true }, 101, 46)).toEqual({ lx: 6, ly: 6 });
    expect(tileLocalFromVip({ ...draw, flipV: true }, 101, 46)).toEqual({ lx: 1, ly: 1 });
    expect(tileLocalFromVip({ ...draw, flipH: true, flipV: true }, 100, 40)).toEqual({ lx: 7, ly: 7 });
  });

  it('returns null outside the 8x8 tile', () => {
    expect(tileLocalFromVip(draw, 108, 40)).toBeNull();
    expect(tileLocalFromVip(draw, 99, 40)).toBeNull();
  });
});

describe('isBlankTile', () => {
  it('is true for an all-zero tile and for missing bytes', () => {
    expect(isBlankTile(new Uint8Array(16))).toBe(true);
    expect(isBlankTile(null)).toBe(true);
  });

  it('is false when any pixel is set', () => {
    const tile = new Uint8Array(16);
    tile[7] = 0x01;
    expect(isBlankTile(tile)).toBe(false);
  });
});
