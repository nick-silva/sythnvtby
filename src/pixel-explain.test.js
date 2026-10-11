import { describe, it, expect } from 'vitest';
import { compositeColorFrame, getCompositePixelInfo, getCompositeDrawOwners } from './color-layer.js';
import { withGroupTileColor } from './group-tile-colors.js';
import { hashTile } from './vip-state.js';
import { explainPixel } from './pixel-explain.js';
import { setProjectGameStates } from './game-states.js';

const W = 384;
const H = 224;

function wr16(u8, off, v) {
  u8[off] = v & 0xff;
  u8[off + 1] = (v >> 8) & 0xff;
}

// Tile 1: every pixel value 3.
const PT = (() => {
  const pt = new Uint8Array(2048 * 16);
  pt.fill(0xff, 16, 32);
  return pt;
})();
const H1 = hashTile(PT.subarray(16, 32)) >>> 0;

/** One plain world (30) on both eyes, the whole screen; END on 29. */
function windows() {
  const win = new Uint8Array(1024);
  wr16(win, 30 * 32, 0xc000);
  wr16(win, 30 * 32 + 14, 383);
  wr16(win, 30 * 32 + 16, 223);
  wr16(win, 29 * 32, 0x40);
  return win;
}

const solid = (rgba) => {
  const out = new Uint8Array(256);
  for (let i = 0; i < 64; i++) out.set(rgba, i * 4);
  return out;
};
const RED = solid([255, 0, 0, 255]);
const BLUE = solid([0, 0, 255, 255]);

const state = {
  patternTable: PT,
  windows: windows(),
  corePatchLevel: 3,
  drawList: [{ tileIndex: 1, x: 8, y: 8, world: 30, layer: 0, eye: 0 }],
};

/** Composite the left eye, then explain (x, y) the way a tool would right after drawing. */
function explain({ groups = [], allGroups = groups, pack = new Map(), x = 10, y = 10, wram = null } = {}) {
  const img = { data: new Uint8ClampedArray(W * H * 4) };
  compositeColorFrame(state, pack, img, { eye: 0, overrides: [], groups, brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 1, diagnosticMonoFallback: false, renderUnpackedFallback: true, monoFallbackGain: 1, drawTransparentPaint: false });
  return explainPixel({ state, eye: 0, x, y, pack, groups, allGroups, wram, info: getCompositePixelInfo(), owners: getCompositeDrawOwners() });
}

const group = (id, criteria, paint = null) => {
  const g = { id, name: id, criteria: { layers: [0], hashes: [H1], ...criteria } };
  return paint ? withGroupTileColor(g, H1, paint) : g;
};

describe('explainPixel', () => {
  it('says nothing is drawn where no tile lights the pixel', () => {
    const e = explain({ x: 100, y: 100 });
    expect(e.status).toBe('nothing');
    expect(e.fix).toBeNull();
  });

  it('a see-through pixel of a drawn tile: says so', () => {
    const pt = PT.slice();
    pt[16] = 0; // top row's first pixels value 0
    const st = { ...state, patternTable: pt };
    const img = { data: new Uint8ClampedArray(W * H * 4) };
    compositeColorFrame(st, new Map(), img, { eye: 0, overrides: [], groups: [], brightnessScale: 1, stripClip: false, objXOffset: 0, applyOffsetToAllDraws: false, bgXOffset: 0, deduplicateDraws: false, gameStatePools: null, wram: null, unpackedMode: 'transparent', sortDrawsByWorld: true, painterV2Rules: null, painterV2VariantId: null, unpackedMinCoverage: 1, diagnosticMonoFallback: false, renderUnpackedFallback: true, monoFallbackGain: 1, drawTransparentPaint: false });
    const e = explainPixel({ state: st, eye: 0, x: 8, y: 8, pack: new Map(), groups: [], info: getCompositePixelInfo(), owners: getCompositeDrawOwners() });
    expect(e.sentence).toMatch(/see-through at this spot/);
  });

  it('names the group whose paint coloured the pixel, and offers to select it', () => {
    const e = explain({ groups: [group('Mario', { windowIds: [30] }, RED)] });
    expect(e.status).toBe('coloured');
    expect(e.sentence).toBe('Coloured by Mario’s paint for this tile.');
    expect(e.fix).toEqual({ kind: 'select-group', groupId: 'Mario', label: 'Select Mario' });
    expect(e.details).toMatchObject({ hash: H1, tileIndex: 1, layer: 0, world: 30 });
  });

  it('says which group wins a shared tile, and why', () => {
    const e = explain({ groups: [group('Mario', {}, RED), group('Luigi', {}, BLUE)] });
    expect(e.sentence).toContain('Mario');
    expect(e.why[0]).toBe('Luigi also paints this tile here; Mario wins because it comes first in the group list.');
    expect(e.reorder).toEqual({ kind: 'move-before', groupId: 'Luigi', beforeId: 'Mario', label: 'Let Luigi win' });
    expect(explain({ groups: [group('Mario', {}, RED)] }).reorder).toBeUndefined();
  });

  it('a group pinned to another world: says so, and offers to add this one', () => {
    const e = explain({ groups: [group('LUIGI text', { windowIds: [17] }, RED)] });
    expect(e.status).toBe('uncoloured');
    expect(e.sentence).toBe('Not coloured: LUIGI text paints this tile, but only on world 17; here it is drawn on world 30.');
    expect(e.fix).toEqual({ kind: 'add-world', groupId: 'LUIGI text', world: 30, label: 'Add world 30 to LUIGI text' });
  });

  it('a group limited to other screens: says so', () => {
    const g = group('Menu', {}, RED);
    const e = explain({ groups: [], allGroups: [g] });
    expect(e.sentence).toBe('Not coloured: Menu paints this tile, but it is limited to some screens and this frame is not one of them.');
    expect(e.fix?.kind).toBe('select-group');
  });

  it('a group whose condition on a game state turns its paint off here: says which', () => {
    setProjectGameStates([{ id: 'luigi', name: 'Luigi is the player', conditions: [{ offset: 0x2014, value: 2 }] }]);
    const g = { ...group('Mario', {}, RED), conditions: [{ state: 'luigi', is: false }] };
    const w = new Uint8Array(0x10000);
    w[0x2014] = 2;
    const e = explain({ groups: [], allGroups: [g], wram: w });
    setProjectGameStates([]);
    expect(e.sentence).toBe('Not coloured: Mario paints this tile, but its paint is off here: “Luigi is the player” holds.');
  });

  it('a tile in a group that is not painted yet', () => {
    const e = explain({ groups: [group('Court', {})] });
    expect(e.sentence).toBe('Not coloured: This tile is in Court, but it is not painted yet.');
    expect(e.fix).toEqual({ kind: 'select-group', groupId: 'Court', label: 'Select Court' });
  });

  it('a tile nobody has: offers a new group', () => {
    const e = explain();
    expect(e.status).toBe('uncoloured');
    expect(e.sentence).toMatch(/^Not coloured: nothing paints this tile \(#[0-9A-F]+\)/);
    expect(e.fix?.kind).toBe('new-group');
  });

  it('shared paint, and the group the tile belongs to', () => {
    const e = explain({ groups: [group('Crowd', {})], pack: new Map([[H1, RED]]) });
    expect(e.status).toBe('coloured');
    expect(e.sentence).toBe('Coloured by this tile’s shared paint (every copy of the pattern).');
    expect(e.fix?.groupId).toBe('Crowd');
  });

  it('a painted tile with this pixel left clear', () => {
    const paint = solid([255, 0, 0, 255]);
    paint[(2 * 8 + 2) * 4 + 3] = 0;
    const e = explain({ groups: [group('Mario', {}, paint)] });
    expect(e.status).toBe('uncoloured');
    expect(e.sentence).toContain('this pixel of it was left clear');
  });
});
