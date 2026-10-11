import { describe, it, expect } from 'vitest';
import { buildPaintInventory, PAINT_SOURCE } from './paint-inventory.js';
import { withGroupTileColor } from './group-tile-colors.js';
import { hashTile } from './vip-state.js';

function tile(r, g, b) {
  const u = new Uint8Array(256);
  for (let i = 0; i < 64; i++) {
    u[i * 4] = r;
    u[i * 4 + 1] = g;
    u[i * 4 + 2] = b;
    u[i * 4 + 3] = 255;
  }
  return u;
}

/** A pattern table whose tile 0 is lit, plus that tile's hash. */
function frameWithOnePattern(draws) {
  const patternTable = new Uint8Array(2048 * 16);
  patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
  return {
    state: { patternTable, drawList: draws },
    hash: hashTile(patternTable.subarray(0, 16)) >>> 0,
  };
}

describe('buildPaintInventory', () => {
  it('is empty with nothing painted', () => {
    const inv = buildPaintInventory({ pack: new Map(), groups: [] });
    expect(inv.entries).toEqual([]);
    expect(inv.totals).toEqual({ total: 0, group: 0, pack: 0, overlay: 0, orphan: 0, onFrame: 0 });
  });

  it('tolerates being called with nothing at all', () => {
    expect(buildPaintInventory().totals.total).toBe(0);
  });

  it('lists a group colour against its group', () => {
    const g = withGroupTileColor({ id: 'g1', name: 'Clouds', criteria: { hashes: [7] } }, 7, tile(1, 2, 3));
    const inv = buildPaintInventory({ groups: [g] });
    expect(inv.entries).toHaveLength(1);
    expect(inv.entries[0]).toMatchObject({
      hash: 7,
      source: PAINT_SOURCE.GROUP,
      groupId: 'g1',
      groupName: 'Clouds',
      orphan: false,
    });
    expect(inv.totals.group).toBe(1);
  });

  it('marks a pack colour no group names as an orphan', () => {
    const inv = buildPaintInventory({
      pack: new Map([[42, tile(9, 9, 9)]]),
      groups: [{ id: 'g1', name: 'Clouds', criteria: { hashes: [7] } }],
    });
    expect(inv.entries[0]).toMatchObject({ hash: 42, source: PAINT_SOURCE.PACK, orphan: true });
    expect(inv.entries[0].claimedBy).toEqual([]);
    expect(inv.totals.orphan).toBe(1);
  });

  it('is not an orphan when some group’s criteria name it', () => {
    const inv = buildPaintInventory({
      pack: new Map([[7, tile(9, 9, 9)]]),
      groups: [
        { id: 'g1', name: 'Clouds', criteria: { hashes: [7] } },
        { id: 'g2', name: 'Hills', criteria: { hashes: [7, 8] } },
      ],
    });
    expect(inv.entries[0].orphan).toBe(false);
    expect(inv.entries[0].claimedBy.map((c) => c.name)).toEqual(['Clouds', 'Hills']);
    expect(inv.totals.orphan).toBe(0);
  });

  it('counts the draws and worlds a pattern appears in on this frame', () => {
    const { state, hash } = frameWithOnePattern([
      { tileIndex: 0, eye: 0, world: 26, layer: 0 },
      { tileIndex: 0, eye: 0, world: 26, layer: 0 },
      { tileIndex: 0, eye: 0, world: 4, layer: 0 },
      { tileIndex: 0, eye: 1, world: 9, layer: 0 }, // other eye, not counted
    ]);
    const inv = buildPaintInventory({ pack: new Map([[hash, tile(1, 1, 1)]]), state });
    expect(inv.entries[0].draws).toBe(3);
    expect(inv.entries[0].worlds).toEqual([4, 26]);
    expect(inv.totals.onFrame).toBe(1);
  });

  it('reports zero draws for a pattern that is not on this frame', () => {
    const { state } = frameWithOnePattern([{ tileIndex: 0, eye: 0, world: 1, layer: 0 }]);
    const inv = buildPaintInventory({ pack: new Map([[0xdead, tile(1, 1, 1)]]), state });
    expect(inv.entries[0].draws).toBe(0);
    expect(inv.entries[0].worlds).toEqual([]);
    expect(inv.totals.onFrame).toBe(0);
  });

  it('puts orphans first, then what is on screen', () => {
    const { state, hash } = frameWithOnePattern([
      { tileIndex: 0, eye: 0, world: 3, layer: 0 },
      { tileIndex: 0, eye: 0, world: 3, layer: 0 },
    ]);
    const claimed = withGroupTileColor(
      { id: 'g1', name: 'Seen', criteria: { hashes: [hash] } },
      hash,
      tile(1, 1, 1),
    );
    const inv = buildPaintInventory({
      pack: new Map([[0xbeef, tile(2, 2, 2)]]),
      groups: [claimed],
      state,
    });
    expect(inv.entries.map((e) => e.hash)).toEqual([0xbeef, hash]);
    expect(inv.entries[0].orphan).toBe(true);
  });

  it('separates the same pattern painted in a group and in the pack', () => {
    const g = withGroupTileColor({ id: 'g1', name: 'Clouds', criteria: { hashes: [7] } }, 7, tile(1, 2, 3));
    const inv = buildPaintInventory({ pack: new Map([[7, tile(4, 5, 6)]]), groups: [g] });
    expect(inv.totals).toMatchObject({ total: 2, group: 1, pack: 1, orphan: 0 });
    const bySource = Object.fromEntries(inv.entries.map((e) => [e.source, Array.from(e.rgba.slice(0, 3))]));
    expect(bySource.group).toEqual([1, 2, 3]);
    expect(bySource.pack).toEqual([4, 5, 6]);
  });

  it('ignores groups without an id', () => {
    const inv = buildPaintInventory({
      pack: new Map([[7, tile(1, 1, 1)]]),
      groups: [null, {}, { id: 'g1', criteria: { hashes: [7] } }],
    });
    expect(inv.entries[0].claimedBy).toHaveLength(1);
  });
});

describe('anchored overlays in the inventory', () => {
  /** A full-frame overlay with a painted rectangle. */
  function overlay(x0, y0, x1, y1) {
    const buf = new Uint8Array(384 * 224 * 4);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const o = (y * 384 + x) * 4;
        buf[o] = 30;
        buf[o + 1] = 90;
        buf[o + 2] = 200;
        buf[o + 3] = 255;
      }
    }
    return buf;
  }

  it('lists a group painted only through its overlay', () => {
    // The bug this covers: a group painted entirely by anchored overlay had no per-pattern
    // colours, so it looked unpainted in the inventory.
    const { state, hash } = frameWithOnePattern([{ tileIndex: 0, eye: 0, world: 31, layer: 0 }]);
    const g = { id: 'g1', name: 'EnglishSafetyText', authoringKind: 'bg', anchorHash: hash, criteria: { hashes: [hash] } };
    const inv = buildPaintInventory({
      groups: [g],
      state,
      overlays: new Map([['g1', new Map([[0, overlay(16, 24, 31, 39)]])]]),
    });
    expect(inv.totals).toMatchObject({ total: 1, overlay: 1, group: 0, pack: 0 });
    expect(inv.entries[0]).toMatchObject({
      source: PAINT_SOURCE.OVERLAY,
      groupId: 'g1',
      groupName: 'EnglishSafetyText',
      hash: null,
      eye: 0,
      cells: 4,
      draws: 1,
    });
    expect(inv.entries[0].box).toEqual({ x0: 16, y0: 24, x1: 31, y1: 39 });
    expect(inv.entries[0].pixels).toBe(16 * 16);
  });

  it('sorts a whole-group overlay above the long tail of single patterns', () => {
    // One overlay row can stand for dozens of painted cells. Sorted below the per-pattern
    // rows it ends up off the bottom of the list, which is how a group painted entirely by
    // overlay looked missing even after it was being listed.
    const { state, hash } = frameWithOnePattern([
      { tileIndex: 0, eye: 0, world: 31, layer: 0 },
      { tileIndex: 0, eye: 0, world: 31, layer: 0 },
      { tileIndex: 0, eye: 0, world: 31, layer: 0 },
    ]);
    const g = { id: 'g1', name: 'EnglishSafetyText', anchorHash: hash, criteria: { hashes: [hash] } };
    const inv = buildPaintInventory({
      pack: new Map([[hash, tile(1, 1, 1)]]),
      groups: [g],
      state,
      overlays: new Map([['g1', new Map([[0, overlay(0, 0, 7, 7)]])]]),
    });
    // The pack row has more draws, but the overlay still comes first.
    expect(inv.entries.map((e) => e.source)).toEqual([PAINT_SOURCE.OVERLAY, PAINT_SOURCE.PACK]);
  });

  it('still keeps anything off this frame below what is on it', () => {
    const { state, hash } = frameWithOnePattern([{ tileIndex: 0, eye: 0, world: 31, layer: 0 }]);
    const offFrame = { id: 'g2', name: 'Elsewhere', anchorHash: 0xdead, criteria: {} };
    const inv = buildPaintInventory({
      pack: new Map([[hash, tile(1, 1, 1)]]),
      groups: [offFrame],
      state,
      overlays: new Map([['g2', new Map([[0, overlay(0, 0, 7, 7)]])]]),
    });
    // The on-frame pack colour beats the off-frame overlay, despite the source ranking.
    expect(inv.entries.map((e) => e.source)).toEqual([PAINT_SOURCE.PACK, PAINT_SOURCE.OVERLAY]);
  });

  it('breaks an overlay into one entry per painted tile, naming the pattern under each', () => {
    // What the inventory is for: every painted tile addressable on its own, with the group
    // it belongs to, even when the paint is one positional image with no per-tile structure.
    const patternTable = new Uint8Array(2048 * 16);
    patternTable.set([0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    const h = hashTile(patternTable.subarray(0, 16)) >>> 0;
    const state = {
      patternTable,
      drawList: [
        { tileIndex: 0, x: 16, y: 24, eye: 0, world: 31, layer: 0 },
        { tileIndex: 0, x: 24, y: 24, eye: 0, world: 31, layer: 0 },
      ],
    };
    const g = { id: 'g1', name: 'EnglishSafetyText', anchorHash: h, criteria: { hashes: [h] } };
    const inv = buildPaintInventory({
      groups: [g],
      state,
      overlays: new Map([['g1', new Map([[0, overlay(16, 24, 31, 31)]])]]),
    });
    const e = inv.entries[0];
    expect(e.cells).toBe(2);
    expect(e.cellList).toEqual([
      { x: 16, y: 24, pixels: 64, hash: h },
      { x: 24, y: 24, pixels: 64, hash: h },
    ]);
  });

  it('reports no pattern for an overlay tile with nothing drawn under it', () => {
    const { state } = frameWithOnePattern([{ tileIndex: 0, eye: 0, world: 31, layer: 0 }]);
    const g = { id: 'g1', name: 'Floating', criteria: {} };
    const inv = buildPaintInventory({
      groups: [g],
      state,
      // Aligned to the 8-pixel grid, so this is exactly one cell.
      overlays: new Map([['g1', new Map([[0, overlay(200, 96, 207, 103)]])]]),
    });
    expect(inv.entries[0].cellList).toEqual([{ x: 200, y: 96, pixels: 64, hash: null }]);
  });

  it('orders overlay tiles top-to-bottom, left-to-right', () => {
    const buf = overlay(24, 32, 31, 39);
    for (let y = 8; y < 16; y++) for (let x = 40; x < 48; x++) {
      const o = (y * 384 + x) * 4;
      buf[o + 3] = 255;
    }
    const inv = buildPaintInventory({
      groups: [{ id: 'g1', name: 'Two', criteria: {} }],
      overlays: new Map([['g1', new Map([[0, buf]])]]),
    });
    expect(inv.entries[0].cellList.map((c) => [c.x, c.y])).toEqual([[40, 8], [24, 32]]);
  });

  it('counts an overlay as off-frame when its anchor is absent', () => {
    const { state } = frameWithOnePattern([{ tileIndex: 0, eye: 0, world: 31, layer: 0 }]);
    const g = { id: 'g1', name: 'Elsewhere', anchorHash: 0xdead, criteria: {} };
    const inv = buildPaintInventory({
      groups: [g],
      state,
      overlays: new Map([['g1', new Map([[0, overlay(0, 0, 7, 7)]])]]),
    });
    expect(inv.entries[0].draws).toBe(0);
    expect(inv.totals.onFrame).toBe(0);
  });

  it('skips an empty overlay and the other eye', () => {
    const g = { id: 'g1', name: 'Blank', criteria: {} };
    const empty = buildPaintInventory({ groups: [g], overlays: new Map([['g1', new Map([[0, new Uint8Array(384 * 224 * 4)]])]]) });
    expect(empty.totals.overlay).toBe(0);

    const otherEye = buildPaintInventory({ groups: [g], eye: 0, overlays: new Map([['g1', new Map([[1, overlay(0, 0, 7, 7)]])]]) });
    expect(otherEye.totals.overlay).toBe(0);
  });
});
