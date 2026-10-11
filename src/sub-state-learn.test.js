import { describe, it, expect } from 'vitest';
import { learnMemoryDifference, ownPatterns, groupOnScreen, planSubState } from './sub-state-learn.js';
import { matchedScreens } from './screen-gate.js';
import { getTileBytes, hashTile } from './vip-state.js';

/** A memory dump with these bytes set (and a frame counter that differs on every dump). */
let tick = 0;
function wram(bytes) {
  const w = new Uint8Array(0x10000);
  for (const [off, v] of Object.entries(bytes)) w[Number(off)] = v;
  w[0x3000] = tick++ & 0xff;
  return w;
}

const PLAYER = 0x2000; // who is playing: 0 Mario, 2 Luigi
const POOLS = [{ id: 'pool-game', label: 'InGame', variants: [{ id: '__default__', ramConditions: [{ offset: 0, expectedValue: 48 }] }] }];

describe('learnMemoryDifference', () => {
  it('finds the byte steady on both sides, not a counter', () => {
    const luigi = [wram({ [PLAYER]: 2 }), wram({ [PLAYER]: 2 })];
    const mario = [wram({ [PLAYER]: 0 }), wram({ [PLAYER]: 0 }), wram({ [PLAYER]: 0 })];
    expect(learnMemoryDifference(luigi, mario)).toMatchObject({ offset: PLAYER, expectedValue: 2, outsideStable: true });
  });

  it('skips the offsets it is told to', () => {
    const a = [wram({ 5: 1, [PLAYER]: 2 }), wram({ 5: 1, [PLAYER]: 2 })];
    const b = [wram({ 5: 0, [PLAYER]: 0 })];
    expect(learnMemoryDifference(a, b, new Set([5]))?.offset).toBe(PLAYER);
  });

  it('nothing when no byte tells them apart, or there are too few frames', () => {
    const same = () => wram({ [PLAYER]: 2 });
    // Every byte that is steady on the inside also takes that value outside (the counter differs
    // everywhere, so it is not steady on the inside).
    const inside = [same(), same()];
    const outside = [same()];
    outside[0][0x3000] = inside[0][0x3000];
    expect(learnMemoryDifference(inside, outside)).toBeNull();
    expect(learnMemoryDifference([same()], [wram({})])).toBeNull();
    expect(learnMemoryDifference([same(), same()], [])).toBeNull();
  });
});

// Tiles 1–4: 1 and 2 shared by Mario and Luigi, 3 Luigi's own, 4 Mario's own.
const PT = new Uint8Array(2048 * 16);
for (let t = 1; t <= 4; t++) PT.fill(t * 17, t * 16, t * 16 + 16);
const h = (t) => hashTile(getTileBytes(PT, t)) >>> 0;
const group = (id, tiles) => ({ id, name: id, criteria: { layers: [0], hashes: tiles.map(h) } });
const mario = group('Mario', [1, 2, 4]);
const luigi = group('Luigi', [1, 2, 3]);
const ALL = [mario, luigi];
const frame = (tiles) => ({ patternTable: PT, drawList: tiles.map((t, i) => ({ tileIndex: t, x: i * 8, y: 0, eye: 0, layer: 0, world: 30 })) });

describe('groupOnScreen', () => {
  it('counts a group on screen by its own patterns, not by what it shares', () => {
    expect([...ownPatterns(luigi, ALL)]).toEqual([h(3)]);
    expect(groupOnScreen(frame([1, 2, 3]), luigi, ALL)).toBe(true);
    expect(groupOnScreen(frame([1, 2, 4]), luigi, ALL)).toBe(false);
    expect(groupOnScreen(frame([1, 2, 4]), mario, ALL)).toBe(true);
  });

  it('a group with only shared patterns counts by all of them', () => {
    const shy = group('Shy', [1, 2]);
    expect(groupOnScreen(frame([1, 2]), shy, [shy, mario])).toBe(true);
  });
});

describe('planSubState', () => {
  const f = (index, bytes) => {
    const w = wram({ 0: 48, ...bytes });
    return { index, wram: w, matched: matchedScreens(POOLS, w) };
  };

  it('learns the sub-state inside the screen the frames are on', () => {
    const plan = planSubState({
      inside: [f(0, { [PLAYER]: 2 }), f(1, { [PLAYER]: 2 })],
      outside: [f(2, { [PLAYER]: 0 }), f(3, { [PLAYER]: 0 })],
      pools: POOLS,
      label: 'Luigi without Mario',
    });
    expect(plan).toEqual({
      ok: true,
      poolId: 'pool-game',
      state: { id: 'luigi-without-mario', name: 'Luigi without Mario', conditions: [{ offset: 0, value: 48 }, { offset: PLAYER, value: 2 }], source: 'learned' },
      learned: { offset: PLAYER, value: 2 },
      inside: 2,
      outside: 2,
      alternatives: 0,
    });
  });

  it('gives a new id when the project already has a game state by that name', () => {
    const plan = planSubState({ inside: [f(0, { [PLAYER]: 2 }), f(1, { [PLAYER]: 2 })], outside: [f(2, {})], pools: POOLS, states: [{ id: 'luigi' }], label: 'Luigi' });
    expect(plan.ok && plan.state.id).toBe('luigi-2');
  });

  it('says why it cannot: no screen, too few frames, nothing to compare with, no byte', () => {
    const unknown = { index: 0, wram: wram({}), matched: new Set() };
    expect(planSubState({ inside: [unknown, unknown], outside: [], pools: POOLS, label: 'x' })).toMatchObject({ ok: false, reason: expect.stringMatching(/Analyze memory/) });
    expect(planSubState({ inside: [f(0, {})], outside: [f(1, {})], pools: POOLS, label: 'x' })).toMatchObject({ ok: false, reason: expect.stringMatching(/capture at least 2/) });
    expect(planSubState({ inside: [f(0, {}), f(1, {})], outside: [], pools: POOLS, label: 'x' })).toMatchObject({ ok: false, reason: expect.stringMatching(/nothing to tell apart/) });
    const twin = f(0, { [PLAYER]: 2 });
    const copy = { ...twin, wram: twin.wram.slice() };
    const out = { ...twin, index: 2, wram: twin.wram.slice() };
    expect(planSubState({ inside: [twin, copy], outside: [out], pools: POOLS, label: 'x' })).toMatchObject({ ok: false, reason: expect.stringMatching(/no byte of game memory/) });
  });
});
