/**
 * Game states: named memory conditions ("Luigi is the player"), and the conditions a group's paint
 * can depend on (docs/design/memory-states.md §3).
 *
 *   groups.json  "gameStates": [{ id, name, conditions: [{ offset, value }], source?, question?, checkedLive? }]
 *   a group      "conditions": [{ state: "<game state id>", is: true | false }]
 *
 * A game state holds when every one of its bytes has its value. A group's paint shows while every
 * condition holds (`is: true`: the state holds; `is: false`: it does not). Screens
 * (`gameStatePools`, `group.screens`, src/screen-gate.js) are the coarse kind of game state and keep
 * their own data; both must allow the paint. Unknown memory shows the paint, and a condition naming
 * a game state the project does not have is ignored.
 *
 * The project's game states are set per page (setProjectGameStates) when a project is opened or
 * they change — like overpaint pixels (src/layer-art.js) — so the colour rules reach them without
 * every caller passing them along.
 */

/**
 * @typedef {{ offset: number, value: number }} MemoryCondition
 * @typedef {{ id: string, name: string, conditions: MemoryCondition[], source?: string, question?: string, checkedLive?: string }} GameState
 * @typedef {{ state: string, is: boolean }} GroupCondition
 */

const WRAM_SIZE = 0x10000;

/** @param {any} c @returns {MemoryCondition | null} */
function memoryCondition(c) {
  const offset = Number(c?.offset);
  const value = Number(c?.value ?? c?.expectedValue);
  if (!Number.isInteger(offset) || offset < 0 || offset >= WRAM_SIZE) return null;
  if (!Number.isInteger(value) || value < 0 || value > 255) return null;
  return { offset, value };
}

/**
 * The usable game states in a list: an id, a name and at least one memory condition. Other fields
 * are kept as they are.
 * @param {unknown} list
 * @returns {GameState[]}
 */
export function gameStatesOf(list) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const id = typeof s?.id === 'string' ? s.id.trim() : '';
    if (!id || seen.has(id)) continue;
    const conditions = (Array.isArray(s.conditions) ? s.conditions : []).map(memoryCondition).filter(Boolean);
    if (!conditions.length) continue;
    seen.add(id);
    out.push({ ...s, id, name: (typeof s.name === 'string' && s.name.trim()) || id, conditions: /** @type {MemoryCondition[]} */ (conditions) });
  }
  return out;
}

/**
 * A group's conditions: a game state id and whether it must hold. Repeats of a state keep the first.
 * @param {any} group
 * @returns {GroupCondition[]}
 */
export function groupConditionsOf(group) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(group?.conditions) ? group.conditions : []) {
    const state = typeof c?.state === 'string' ? c.state.trim() : '';
    if (!state || seen.has(state)) continue;
    seen.add(state);
    out.push({ state, is: c.is !== false });
  }
  return out;
}

/**
 * A copy of the group with these conditions; an empty list removes them.
 * @param {any} group @param {Array<{ state: string, is?: boolean }>} conditions
 */
export function withGroupConditions(group, conditions) {
  const { conditions: _old, ...rest } = group || {};
  const list = groupConditionsOf({ conditions });
  return list.length ? { ...rest, conditions: list } : rest;
}

/** Does this game state hold for this memory? */
export function gameStateHolds(state, wram) {
  return state.conditions.every((c) => wram[c.offset] === c.value);
}

/**
 * The ids of the game states holding for this memory; null when the memory is unknown.
 * @param {GameState[]} states @param {Uint8Array | null | undefined} wram
 * @returns {Set<string> | null}
 */
export function heldGameStates(states, wram) {
  if (!wram || wram.byteLength < WRAM_SIZE) return null;
  return new Set(states.filter((s) => gameStateHolds(s, wram)).map((s) => s.id));
}

/**
 * Do the group's conditions allow its paint? Unknown memory (`held` null) and conditions naming a
 * game state not in `known` allow it.
 * @param {any} group @param {Set<string> | null} held @param {Set<string>} known ids of the project's game states
 */
export function groupConditionsAllow(group, held, known) {
  if (!held) return true;
  return groupConditionsOf(group).every((c) => !known.has(c.state) || held.has(c.state) === c.is);
}

/** The game states with this one added, or replaced by id. */
export function withGameState(states, state) {
  const list = Array.isArray(states) ? states : [];
  return list.some((s) => s?.id === state.id) ? list.map((s) => (s?.id === state.id ? state : s)) : [...list, state];
}

/**
 * Without one game state, and without every group condition naming it.
 * @param {any[]} states @param {any[]} groups @param {string} id
 */
export function withoutGameState(states, groups, id) {
  return {
    states: (Array.isArray(states) ? states : []).filter((s) => s?.id !== id),
    groups: (Array.isArray(groups) ? groups : []).map((g) => {
      const list = groupConditionsOf(g);
      return list.some((c) => c.state === id) ? withGroupConditions(g, list.filter((c) => c.state !== id)) : g;
    }),
  };
}

/** A new id for a game state named `name`, not one of `states`. */
export function newGameStateId(states, name) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'state';
  const taken = new Set((Array.isArray(states) ? states : []).map((s) => s?.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// --- The project's game states, per page ---

/** @type {GameState[]} */
let projectStates = [];
let projectIds = new Set();

/** Set the game states of the project this page has open (validated; an empty list clears them). */
export function setProjectGameStates(list) {
  projectStates = gameStatesOf(list);
  projectIds = new Set(projectStates.map((s) => s.id));
}

/** @returns {GameState[]} */
export function projectGameStates() {
  return projectStates;
}

/** Does any group have a condition on one of the project's game states? */
export function anyGroupConditions(groups) {
  return projectIds.size > 0 && groups.some((g) => groupConditionsOf(g).some((c) => projectIds.has(c.state)));
}

/**
 * Do the group's conditions allow its paint on this memory, against the project's game states?
 * @param {any} group @param {Set<string> | null} held from heldProjectGameStates
 */
export function projectConditionsAllow(group, held) {
  return groupConditionsAllow(group, held, projectIds);
}

/** The project's game states holding for this memory; null when the memory is unknown. */
export function heldProjectGameStates(wram) {
  return heldGameStates(projectStates, wram);
}

/** The name of one of the project's game states (its id when it has none or is unknown). */
export function gameStateName(id) {
  return projectStates.find((s) => s.id === id)?.name || id;
}

/**
 * The first of the group's conditions that turns its paint off for this memory, or null.
 * @param {any} group @param {Set<string> | null} held
 * @returns {{ state: string, is: boolean, name: string } | null}
 */
export function failingCondition(group, held) {
  if (!held) return null;
  const c = groupConditionsOf(group).find((x) => projectIds.has(x.state) && held.has(x.state) !== x.is);
  return c ? { ...c, name: gameStateName(c.state) } : null;
}

/** A short line for the UI, e.g. "while Luigi is the player and not while Paused"; '' for none. */
export function describeGroupConditions(group) {
  const list = groupConditionsOf(group).filter((c) => projectIds.has(c.state));
  return list.map((c) => `${c.is ? 'while' : 'not while'} ${gameStateName(c.state)}`).join(' and ');
}

// --- The interim format (Oct 8 2026, commit be778c4) ---

/**
 * Packs saved between Oct 8 and the game-states format kept learned sub-states inside a screen
 * (`gameStatePools[].subStates`) and named them `"<pool>::<sub>"` in `group.screens.pools`. Each
 * becomes a game state (its screen's recipe plus its own bytes) and each mention a group condition
 * (`only` → is, `except` → is not). Nothing else changes; `changed` is false when there was none.
 * @param {{ gameStatePools?: any[], groups?: any[], gameStates?: any[] }} doc
 * @returns {{ gameStatePools: any[], groups: any[], gameStates: any[], changed: boolean }}
 */
export function convertInterimSubStates(doc) {
  const pools = Array.isArray(doc?.gameStatePools) ? doc.gameStatePools : [];
  const groups = Array.isArray(doc?.groups) ? doc.groups : [];
  let states = Array.isArray(doc?.gameStates) ? doc.gameStates : [];
  if (!pools.some((p) => Array.isArray(p?.subStates))) return { gameStatePools: pools, groups, gameStates: states, changed: false };
  /** @type {Map<string, string>} "pool::sub" → game state id */
  const idByRef = new Map();
  for (const p of pools) {
    if (!Array.isArray(p?.subStates)) continue;
    const recipe = (Array.isArray(p.variants) ? p.variants : []).find((v) => Array.isArray(v?.ramConditions) && v.ramConditions.length);
    const screen = (recipe?.ramConditions || []).map(memoryCondition).filter(Boolean);
    for (const sub of p.subStates) {
      const own = (Array.isArray(sub?.ramConditions) ? sub.ramConditions : []).map(memoryCondition).filter(Boolean);
      if (typeof sub?.id !== 'string' || !own.length) continue;
      const id = newGameStateId(states, sub.label || sub.id);
      states = [...states, { id, name: (typeof sub.label === 'string' && sub.label.trim()) || sub.id, conditions: [...screen, ...own], source: 'learned' }];
      idByRef.set(`${p.id}::${sub.id}`, id);
    }
  }
  const nextPools = pools.map((p) => {
    if (!Array.isArray(p?.subStates)) return p;
    const { subStates: _sub, ...rest } = p;
    return rest;
  });
  const nextGroups = groups.map((g) => {
    const s = g?.screens;
    const listed = Array.isArray(s?.pools) ? s.pools.filter((x) => typeof x === 'string') : [];
    if (!listed.some((x) => x.includes('::'))) return g;
    const is = s.mode !== 'except';
    const added = listed.filter((x) => x.includes('::')).map((x) => idByRef.get(x.trim())).filter(Boolean).map((state) => ({ state, is }));
    const plain = listed.filter((x) => !x.includes('::'));
    const { screens: _old, ...rest } = g;
    const next = plain.length ? { ...rest, screens: { ...s, pools: plain } } : rest;
    return withGroupConditions(next, [...groupConditionsOf(g), ...added]);
  });
  return { gameStatePools: nextPools, groups: nextGroups, gameStates: states, changed: true };
}
