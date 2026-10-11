import { describe, it, expect, afterEach } from 'vitest';
import {
  gameStatesOf,
  groupConditionsOf,
  withGroupConditions,
  heldGameStates,
  groupConditionsAllow,
  withGameState,
  withoutGameState,
  newGameStateId,
  setProjectGameStates,
  convertInterimSubStates,
} from './game-states.js';
import { groupsForScreen } from './screen-gate.js';

function wram(bytes) {
  const w = new Uint8Array(0x10000);
  for (const [off, v] of Object.entries(bytes)) w[Number(off)] = v;
  return w;
}
const LUIGI = { id: 'luigi-is-player', name: 'Luigi is the player', conditions: [{ offset: 0x2014, value: 2 }] };
const PAUSED = { id: 'paused', name: 'Paused', conditions: [{ offset: 0x10, value: 1 }, { offset: 0x11, value: 7 }] };

afterEach(() => setProjectGameStates([]));

describe('gameStatesOf', () => {
  it('keeps game states with an id and at least one valid condition, and reads the old field name', () => {
    const list = gameStatesOf([
      LUIGI,
      { id: 'old', conditions: [{ offset: 5, expectedValue: 3 }] },
      { id: 'none', conditions: [] },
      { id: 'bad', conditions: [{ offset: 0x10000, value: 1 }, { offset: 1, value: 300 }] },
      { id: 'luigi-is-player', conditions: [{ offset: 1, value: 1 }] }, // a repeat
    ]);
    expect(list.map((s) => s.id)).toEqual(['luigi-is-player', 'old']);
    expect(list[1]).toEqual({ id: 'old', name: 'old', conditions: [{ offset: 5, value: 3 }] });
  });
});

describe('group conditions', () => {
  it('reads conditions, defaulting to "is", and drops repeats and blanks', () => {
    expect(groupConditionsOf({ conditions: [{ state: 'a' }, { state: 'b', is: false }, { state: 'a', is: false }, { state: '' }] })).toEqual([
      { state: 'a', is: true },
      { state: 'b', is: false },
    ]);
  });

  it('sets them without touching the group, and removes the field when empty', () => {
    const g = { id: 'g' };
    expect(withGroupConditions(g, [{ state: 'a', is: false }])).toEqual({ id: 'g', conditions: [{ state: 'a', is: false }] });
    expect(withGroupConditions({ id: 'g', conditions: [{ state: 'a' }] }, [])).toEqual({ id: 'g' });
    expect(g).toEqual({ id: 'g' });
  });

  it('every condition must hold; is / is not; unknown memory and unknown states allow', () => {
    const states = gameStatesOf([LUIGI, PAUSED]);
    const known = new Set(states.map((s) => s.id));
    const luigiPlaying = heldGameStates(states, wram({ 0x2014: 2 }));
    const luigiPaused = heldGameStates(states, wram({ 0x2014: 2, 0x10: 1, 0x11: 7 }));
    const g = { conditions: [{ state: 'luigi-is-player', is: true }, { state: 'paused', is: false }] };
    expect([...luigiPlaying]).toEqual(['luigi-is-player']);
    expect(groupConditionsAllow(g, luigiPlaying, known)).toBe(true);
    expect(groupConditionsAllow(g, luigiPaused, known)).toBe(false);
    expect(groupConditionsAllow(g, heldGameStates(states, wram({})), known)).toBe(false);
    expect(groupConditionsAllow(g, null, known)).toBe(true);
    expect(groupConditionsAllow({ conditions: [{ state: 'gone' }] }, luigiPlaying, known)).toBe(true);
    expect(heldGameStates(states, new Uint8Array(4))).toBeNull();
  });
});

describe('editing the game states', () => {
  it('adds or replaces by id, and forgets one everywhere it is used', () => {
    const list = withGameState([LUIGI], PAUSED);
    expect(list.map((s) => s.id)).toEqual(['luigi-is-player', 'paused']);
    expect(withGameState(list, { ...LUIGI, name: 'Renamed' })[0].name).toBe('Renamed');
    const groups = [{ id: 'm', conditions: [{ state: 'luigi-is-player', is: false }, { state: 'paused', is: false }] }, { id: 'x' }];
    const out = withoutGameState(list, groups, 'luigi-is-player');
    expect(out.states.map((s) => s.id)).toEqual(['paused']);
    expect(out.groups[0].conditions).toEqual([{ state: 'paused', is: false }]);
    expect(out.groups[1]).toBe(groups[1]);
  });

  it('makes a fresh id from a name', () => {
    expect(newGameStateId([{ id: 'luigi-is-the-player' }], 'Luigi is the player!')).toBe('luigi-is-the-player-2');
    expect(newGameStateId([], '***')).toBe('state');
  });
});

describe('groupsForScreen with conditions', () => {
  const mario = { id: 'mario', conditions: [{ state: 'luigi-is-player', is: false }] };
  const luigi = { id: 'luigi', conditions: [{ state: 'luigi-is-player', is: true }] };
  const court = { id: 'court' };
  const groups = [mario, luigi, court];

  it('hides groups whose conditions do not hold, against the project’s game states', () => {
    setProjectGameStates([LUIGI]);
    expect(groupsForScreen(groups, [], wram({ 0x2014: 2 })).map((g) => g.id)).toEqual(['luigi', 'court']);
    expect(groupsForScreen(groups, [], wram({})).map((g) => g.id)).toEqual(['mario', 'court']);
  });

  it('shows everything when the memory is unknown or the project has no such game state', () => {
    setProjectGameStates([LUIGI]);
    expect(groupsForScreen(groups, [], null)).toBe(groups);
    setProjectGameStates([]);
    expect(groupsForScreen(groups, [], wram({ 0x2014: 2 }))).toBe(groups);
  });

  it('screens and conditions both have to allow it', () => {
    setProjectGameStates([LUIGI]);
    const pools = [{ id: 'pool-menu', variants: [{ id: 'd', ramConditions: [{ offset: 9, expectedValue: 5 }] }] }];
    const notMenu = { id: 'luigi-not-menu', screens: { mode: 'except', pools: ['pool-menu'] }, conditions: [{ state: 'luigi-is-player' }] };
    expect(groupsForScreen([notMenu], pools, wram({ 0x2014: 2 })).length).toBe(1);
    expect(groupsForScreen([notMenu], pools, wram({ 0x2014: 2, 9: 5 })).length).toBe(0);
    expect(groupsForScreen([notMenu], pools, wram({})).length).toBe(0);
  });
});

describe('convertInterimSubStates', () => {
  const pools = [
    {
      id: 'pool-game',
      label: 'InGame',
      variants: [{ id: '__default__', ramConditions: [{ offset: 0, expectedValue: 48 }] }],
      subStates: [{ id: 'sub-luigi', label: 'Luigi on screen', ramConditions: [{ offset: 0x2014, expectedValue: 2, source: 'learned' }] }],
    },
    { id: 'pool-menu', variants: [] },
  ];
  const groups = [
    { id: 'luigi', screens: { mode: 'only', pools: ['pool-game::sub-luigi'] } },
    { id: 'mario', screens: { mode: 'except', pools: ['pool-menu', 'pool-game::sub-luigi'] } },
    { id: 'court' },
  ];

  it('turns each sub-state into a game state and each mention into a condition', () => {
    const out = convertInterimSubStates({ gameStatePools: pools, groups });
    expect(out.changed).toBe(true);
    expect(out.gameStates).toEqual([
      { id: 'luigi-on-screen', name: 'Luigi on screen', conditions: [{ offset: 0, value: 48 }, { offset: 0x2014, value: 2 }], source: 'learned' },
    ]);
    expect(out.gameStatePools[0].subStates).toBeUndefined();
    expect(out.gameStatePools[1]).toBe(pools[1]);
    expect(out.groups[0]).toEqual({ id: 'luigi', conditions: [{ state: 'luigi-on-screen', is: true }] });
    expect(out.groups[1]).toEqual({ id: 'mario', screens: { mode: 'except', pools: ['pool-menu'] }, conditions: [{ state: 'luigi-on-screen', is: false }] });
    expect(out.groups[2]).toBe(groups[2]);
  });

  it('changes nothing in a pack without them', () => {
    const doc = { gameStatePools: [pools[1]], groups };
    const out = convertInterimSubStates(doc);
    expect(out.changed).toBe(false);
    expect(out.groups).toBe(groups);
  });
});
