import { describe, it, expect, beforeEach } from 'vitest';
import { findPaintGaps, backdropGaps, paintGapKey, describePaintGaps } from './paint-gaps.js';
import { withGroupTileColor } from './group-tile-colors.js';
import { setLayerArtPixels, clearLayerArtPixels } from './layer-art.js';
import { getTileBytes, hashTile } from './vip-state.js';

// Tiles 1–8: distinct lit patterns.
const PT = new Uint8Array(2048 * 16);
for (let t = 1; t <= 8; t++) PT.fill(t * 17, t * 16, t * 16 + 16);
const h = (t) => hashTile(getTileBytes(PT, t)) >>> 0;
const RED = (() => {
  const out = new Uint8Array(256);
  for (let i = 0; i < 64; i++) out.set([255, 0, 0, 255], i * 4);
  return out;
})();

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}
/** One plain BG world over the whole screen, map 5; END below it. */
function windows(world) {
  const win = new Uint8Array(1024);
  wr16(win, world * 32, 0xc005);
  wr16(win, world * 32 + 14, 383);
  wr16(win, world * 32 + 16, 223);
  wr16(win, (world - 1) * 32, 0x40);
  return win;
}
const frame = (draws) => ({
  patternTable: PT,
  windows: windows(30),
  drawList: draws.map(([t, x, y]) => ({ tileIndex: t, x, y, eye: 0, layer: 0, world: 30 })),
});
const painted = (g, tiles) => tiles.reduce((acc, t) => withGroupTileColor(acc, h(t), RED), g);
const group = (id, tiles, extra = {}) => ({ id, name: id, criteria: { layers: [0], hashes: tiles.map(h), windowIds: [30] }, ...extra });
const crowd = () => ({
  ...painted(group('Crowd', [1, 2]), [1, 2]),
  overpaint: { world: 30, bgmapBase: 5, mapX: 0, mapY: 0, width: 16, height: 8, png: '' },
});

beforeEach(() => {
  clearLayerArtPixels('Crowd');
  setLayerArtPixels('Crowd', { width: 16, height: 8, data: new Uint8ClampedArray(16 * 8 * 4).fill(255) });
});

describe('backdropGaps', () => {
  it('a backdrop group’s tiles beside its picture — where the layer scrolled past it — painted or not', () => {
    const g = crowd();
    const state = frame([[1, 0, 0], [2, 8, 0], [2, 200, 0], [1, 200, 100]]); // inside, inside, beside, away
    const gaps = backdropGaps(state, [g], [g]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ kind: 'backdrop', groupId: 'Crowd', groupName: 'Crowd', hash: h(2) });
    expect(gaps[0].draws.map((d) => d.x)).toEqual([200]);
  });

  it('nothing without a picture, and other groups’ tiles beside it are not its gap', () => {
    const plain = painted(group('Plain', [1]), [1]);
    expect(backdropGaps(frame([[1, 200, 0]]), [plain], [plain])).toEqual([]);
    const g = crowd();
    const other = painted(group('Other', [3]), [3]);
    expect(backdropGaps(frame([[1, 0, 0], [3, 200, 0]]), [g, other], [g, other])).toEqual([]);
  });
});

describe('findPaintGaps', () => {
  it('tiles with no paint at all, and the backdrop past its picture, minus what was reported', () => {
    const g = crowd();
    const state = frame([[1, 0, 0], [2, 200, 0], [5, 100, 100]]);
    const gaps = findPaintGaps(state, { groups: [g] });
    expect(gaps.map(paintGapKey).sort()).toEqual([`backdrop:Crowd:${h(2)}`, `unpainted:${h(5)}`].sort());
    expect(describePaintGaps(gaps)).toBe('1 tile(s) with no paint, Crowd past its picture (1 tile)');
    expect(findPaintGaps(state, { groups: [g] }, new Set(gaps.map(paintGapKey)))).toEqual([]);
  });

  it('a fully painted frame has no gaps', () => {
    const g = painted(group('All', [1, 2]), [1, 2]);
    expect(findPaintGaps(frame([[1, 0, 0], [2, 8, 0]]), { groups: [g] })).toEqual([]);
    expect(describePaintGaps([])).toBe('');
  });
});
