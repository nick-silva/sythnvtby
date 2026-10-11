import { describe, it, expect } from 'vitest';
import { moveGroupBefore, sharedTileWins, litPixelOfDraw } from './group-order.js';
import { withGroupTileColor } from './group-tile-colors.js';
import { hashTile } from './vip-state.js';

// Tile 1: every pixel value 3. Tile 2: only its bottom-right pixel lit.
const PT = (() => {
  const pt = new Uint8Array(2048 * 16);
  pt.fill(0xff, 16, 32);
  pt[32 + 15] = 0xc0;
  return pt;
})();
const H1 = hashTile(PT.subarray(16, 32)) >>> 0;

const solid = (rgba) => {
  const out = new Uint8Array(256);
  for (let i = 0; i < 64; i++) out.set(rgba, i * 4);
  return out;
};
const RED = solid([255, 0, 0, 255]);
const BLUE = solid([0, 0, 255, 255]);

const group = (id, paint, criteria = {}) => withGroupTileColor({ id, name: id, criteria: { layers: [0], hashes: [H1], ...criteria } }, H1, paint);
const frame = (draws) => ({ patternTable: PT, drawList: draws.map((d) => ({ layer: 0, eye: 0, world: 30, ...d })) });

describe('moveGroupBefore', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const ids = (l) => l.map((g) => g.id).join('');

  it('moves a group to just before another, leaving the original list alone', () => {
    expect(ids(moveGroupBefore(list, 'd', 'b'))).toBe('adbc');
    expect(ids(list)).toBe('abcd');
  });

  it('keeps the order when the group already comes first or either is missing', () => {
    expect(ids(moveGroupBefore(list, 'a', 'c'))).toBe('abcd');
    expect(ids(moveGroupBefore(list, 'x', 'a'))).toBe('abcd');
    expect(ids(moveGroupBefore(list, 'c', 'x'))).toBe('abcd');
    expect(moveGroupBefore(list, 'a', 'c')).not.toBe(list);
  });
});

describe('litPixelOfDraw', () => {
  it('finds the first lit pixel, following flips', () => {
    expect(litPixelOfDraw({ patternTable: PT }, { tileIndex: 2, x: 16, y: 8 })).toEqual({ x: 23, y: 15 });
    expect(litPixelOfDraw({ patternTable: PT }, { tileIndex: 2, x: 16, y: 8, flipH: true, flipV: true })).toEqual({ x: 16, y: 8 });
    expect(litPixelOfDraw({ patternTable: PT }, { tileIndex: 5, x: 0, y: 0 })).toBeNull();
  });
});

describe('sharedTileWins', () => {
  it('names the first group as the winner where two paint the same tile differently', () => {
    const mario = group('Mario', RED);
    const luigi = group('Luigi', BLUE);
    const [p, ...rest] = sharedTileWins(frame([{ tileIndex: 1, x: 8, y: 8 }]), [mario, luigi]);
    expect(rest).toEqual([]);
    expect(p.winner).toBe(mario);
    expect(p.loser).toBe(luigi);
    expect([...p.hashes]).toEqual([H1]);
    expect(p.example).toEqual({ x: 8, y: 8 });
    expect(sharedTileWins(frame([{ tileIndex: 1, x: 8, y: 8 }]), [luigi, mario])[0].winner).toBe(luigi);
  });

  it('says whether each group is on screen in its own right', () => {
    const PT2 = PT.slice();
    PT2.fill(0x55, 48, 64); // tile 3: Luigi's own
    const H3 = hashTile(PT2.subarray(48, 64)) >>> 0;
    const mario = group('Mario', RED);
    const luigi = withGroupTileColor(group('Luigi', BLUE, { hashes: [H1, H3] }), H3, BLUE);
    const st = { patternTable: PT2, drawList: [{ tileIndex: 1, x: 8, y: 8 }, { tileIndex: 3, x: 16, y: 8 }].map((d) => ({ layer: 0, eye: 0, world: 30, ...d })) };
    const [p] = sharedTileWins(st, [mario, luigi]);
    expect(p).toMatchObject({ winnerElsewhere: false, loserElsewhere: true });
  });

  it('leaves out tiles a picture covers', () => {
    const st = frame([{ tileIndex: 1, x: 8, y: 8 }]);
    expect(sharedTileWins(st, [group('A', RED), group('B', BLUE)], 0, () => true)).toEqual([]);
    expect(sharedTileWins(st, [group('A', RED), group('B', BLUE)], 0, () => false)).toHaveLength(1);
  });

  it('ignores the same colours, groups that do not claim the draw, and the other eye', () => {
    expect(sharedTileWins(frame([{ tileIndex: 1, x: 8, y: 8 }]), [group('A', RED), group('B', RED)])).toEqual([]);
    expect(sharedTileWins(frame([{ tileIndex: 1, x: 8, y: 8 }]), [group('A', RED, { windowIds: [17] }), group('B', BLUE)])).toEqual([]);
    expect(sharedTileWins(frame([{ tileIndex: 1, x: 8, y: 8, eye: 1 }]), [group('A', RED), group('B', BLUE)])).toEqual([]);
  });
});
