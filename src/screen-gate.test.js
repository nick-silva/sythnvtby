import { describe, it, expect } from 'vitest';
import {
  groupScreensOf,
  withGroupScreens,
  matchedScreens,
  groupShownOnScreens,
  groupsForScreen,
  describeGroupScreens,
} from './screen-gate.js';

const POOLS = [
  { id: 'pool-menu', label: 'GameMenu', variants: [{ id: '__default__', ramConditions: [{ offset: 10, expectedValue: 5 }] }] },
  { id: 'pool-game', label: 'InGame', variants: [{ id: '__default__', ramConditions: [{ offset: 0, expectedValue: 48 }] }] },
  { id: 'pool-blank', label: 'NoRecipe', variants: [{ id: '__default__' }] },
];

function wramWith(bytes) {
  const w = new Uint8Array(0x10000);
  for (const [off, v] of Object.entries(bytes)) w[Number(off)] = v;
  return w;
}
const MENU = wramWith({ 10: 5 });
const GAME = wramWith({ 0: 48 });

describe('groupScreensOf', () => {
  it('returns null for a group with no setting, a bad mode or no pools', () => {
    expect(groupScreensOf({})).toBeNull();
    expect(groupScreensOf({ screens: { mode: 'sometimes', pools: ['pool-menu'] } })).toBeNull();
    expect(groupScreensOf({ screens: { mode: 'only', pools: [] } })).toBeNull();
  });

  it('trims and de-duplicates pool ids', () => {
    expect(groupScreensOf({ screens: { mode: 'except', pools: [' pool-menu', 'pool-menu', '', 3] } })).toEqual({ mode: 'except', pools: ['pool-menu'] });
  });
});

describe('withGroupScreens', () => {
  it('sets the setting without touching the original', () => {
    const g = { id: 'a', name: 'A' };
    const next = withGroupScreens(g, { mode: 'only', pools: ['pool-game'] });
    expect(next).toEqual({ id: 'a', name: 'A', screens: { mode: 'only', pools: ['pool-game'] } });
    expect(g).toEqual({ id: 'a', name: 'A' });
  });

  it('removes the setting for null or an empty pool list', () => {
    const g = { id: 'a', screens: { mode: 'only', pools: ['pool-game'] } };
    expect(withGroupScreens(g, null)).toEqual({ id: 'a' });
    expect(withGroupScreens(g, { mode: 'only', pools: [] })).toEqual({ id: 'a' });
  });
});

describe('matchedScreens', () => {
  it('lists the screens whose memory recipe holds, never a screen without one', () => {
    expect([...matchedScreens(POOLS, MENU)]).toEqual(['pool-menu']);
    expect([...matchedScreens(POOLS, wramWith({}))]).toEqual([]);
  });

  it('returns null when the memory is unknown', () => {
    expect(matchedScreens(POOLS, null)).toBeNull();
    expect(matchedScreens(POOLS, new Uint8Array(16))).toBeNull();
  });
});

describe('groupShownOnScreens', () => {
  const only = { screens: { mode: 'only', pools: ['pool-game'] } };
  const except = { screens: { mode: 'except', pools: ['pool-menu'] } };

  it('only: shown on a listed screen, hidden elsewhere', () => {
    expect(groupShownOnScreens(only, new Set(['pool-game']))).toBe(true);
    expect(groupShownOnScreens(only, new Set(['pool-menu']))).toBe(false);
    expect(groupShownOnScreens(only, new Set())).toBe(false);
  });

  it('except: hidden on a listed screen, shown elsewhere — including unrecognised frames', () => {
    expect(groupShownOnScreens(except, new Set(['pool-menu']))).toBe(false);
    expect(groupShownOnScreens(except, new Set(['pool-game']))).toBe(true);
    expect(groupShownOnScreens(except, new Set())).toBe(true);
  });

  it('shows every group when the memory is unknown, and groups without a setting always', () => {
    expect(groupShownOnScreens(only, null)).toBe(true);
    expect(groupShownOnScreens({}, new Set())).toBe(true);
  });
});

describe('groupsForScreen', () => {
  const a = { id: 'a' };
  const koopa = { id: 'koopa', screens: { mode: 'except', pools: ['pool-menu'] } };
  const groups = [a, koopa];

  it('returns the same array when no group has a setting', () => {
    const plain = [a, { id: 'b' }];
    expect(groupsForScreen(plain, POOLS, MENU)).toBe(plain);
  });

  it('returns the same array when nothing is hidden or the memory is unknown', () => {
    expect(groupsForScreen(groups, POOLS, GAME)).toBe(groups);
    expect(groupsForScreen(groups, POOLS, null)).toBe(groups);
  });

  it('leaves hidden groups out, and gives the same array for the same screen', () => {
    const onMenu = groupsForScreen(groups, POOLS, MENU);
    expect(onMenu).toEqual([a]);
    expect(groupsForScreen(groups, POOLS, MENU)).toBe(onMenu);
  });
});

describe('describeGroupScreens', () => {
  it('names the screens by label', () => {
    expect(describeGroupScreens({}, POOLS)).toBe('Every screen');
    expect(describeGroupScreens({ screens: { mode: 'except', pools: ['pool-menu', 'pool-x'] } }, POOLS)).toBe('Everywhere except GameMenu, pool-x');
    expect(describeGroupScreens({ screens: { mode: 'only', pools: ['pool-game'] } }, POOLS)).toBe('Only on InGame');
  });
});
