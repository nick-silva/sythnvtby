/**
 * Learning a game state from the frames already captured — e.g. *Toad on screen* within InGame —
 * so a group's paint can depend on it (src/game-states.js). The quick way; the deep one is a
 * question answered from memory recordings (docs/design/memory-states.md).
 *
 * Captures are rarely labelled that finely (every Mario's Tennis match frame is just "InGame"),
 * so the frames are sorted by what they show instead: the frames where a group is on screen, and
 * the rest of the same screen's frames. A byte of game memory that holds one value on every frame
 * of the first set and a different value on every frame of the second tells them apart — a
 * "who is playing" byte does; a timer or a score does not. One byte is learned: the more frames of
 * each kind there are, the less likely it is a coincidence.
 */

import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { groupMiss } from './pixel-explain.js';
import { normalizeGroupRamConditionsList } from './color-layer.js';
import { newGameStateId } from './game-states.js';

const WRAM_SIZE = 0x10000;
/** Fewest frames on the "shows" side worth learning from. */
export const MIN_INSIDE_FRAMES = 2;
/** At most this many of a group's own patterns must be drawn for it to count as on screen. */
const ON_SCREEN_TILES = 3;

/**
 * A byte equal on every `inside` dump and different from that value on every `outside` one.
 * Prefers a byte that is also steady on the outside (one value there too): that is what a state
 * looks like, where a counter that happens to differ is not.
 * @param {Uint8Array[]} inside @param {Uint8Array[]} outside 64 KiB memory dumps
 * @param {Set<number>} [skip] offsets not to use (the screen's own recipe)
 * @returns {null | { offset: number, expectedValue: number, outsideStable: boolean, alternatives: number }}
 */
export function learnMemoryDifference(inside, outside, skip = new Set()) {
  if (inside.length < MIN_INSIDE_FRAMES || outside.length < 1) return null;
  if ([...inside, ...outside].some((w) => !w || w.byteLength < WRAM_SIZE)) return null;
  let best = null;
  let found = 0;
  for (let off = 0; off < WRAM_SIZE; off++) {
    if (skip.has(off)) continue;
    const v = inside[0][off];
    let ok = true;
    for (let i = 1; ok && i < inside.length; i++) ok = inside[i][off] === v;
    if (!ok) continue;
    const w = outside[0][off];
    let steady = true;
    for (let i = 0; ok && i < outside.length; i++) {
      if (outside[i][off] === v) ok = false;
      else if (outside[i][off] !== w) steady = false;
    }
    if (!ok) continue;
    found++;
    if (!best || (steady && !best.outsideStable)) best = { offset: off, expectedValue: v, outsideStable: steady };
  }
  return best ? { ...best, alternatives: found - 1 } : null;
}

/** group → its patterns no other group lists, per group list. */
const ownCache = new WeakMap();

/**
 * The group's own patterns: the ones no other group includes. When it has none (every pattern is
 * shared), all of them.
 * @param {any} group @param {any[]} allGroups
 * @returns {Set<number>}
 */
export function ownPatterns(group, allGroups) {
  let byGroup = ownCache.get(allGroups);
  if (!byGroup) ownCache.set(allGroups, (byGroup = new WeakMap()));
  if (byGroup.has(group)) return byGroup.get(group);
  const mine = new Set((group?.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  const others = new Set();
  for (const g of allGroups || []) {
    if (g === group || g?.id === group?.id) continue;
    for (const h of g?.criteria?.hashes || []) others.add(Number(h) >>> 0);
  }
  const own = new Set([...mine].filter((h) => !others.has(h)));
  const out = own.size ? own : mine;
  byGroup.set(group, out);
  return out;
}

/**
 * Is the group on screen in this frame in its own right — drawing a few of its own patterns where
 * its criteria claim them — rather than only sharing a pattern with something else?
 * @param {any} state a VIP frame @param {any} group @param {any[]} allGroups @param {number} [eye]
 */
export function groupOnScreen(state, group, allGroups, eye = 0) {
  if (!state?.drawList || !state.patternTable) return false;
  const own = ownPatterns(group, allGroups);
  if (!own.size) return false;
  const need = Math.min(ON_SCREEN_TILES, own.size);
  const seen = new Set();
  /** @type {Map<number, number | null>} */
  const hashBySlot = new Map();
  for (const d of state.drawList) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== eye) continue;
    let hash = hashBySlot.get(d.tileIndex);
    if (hash === undefined) {
      const bytes = getTileBytes(state.patternTable, d.tileIndex);
      hash = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
      hashBySlot.set(d.tileIndex, hash);
    }
    if (hash === null || !own.has(hash) || seen.has(hash) || groupMiss(d, group, hash)) continue;
    seen.add(hash);
    if (seen.size >= need) return true;
  }
  return false;
}

/**
 * @typedef {{ index: number, wram: Uint8Array | null, matched: Set<string> | null }} LearnFrame
 *   `matched`: the screens (pool ids) the frame's memory matches (src/screen-gate.js matchedScreens)
 *
 * @typedef {{ ok: true, poolId: string, state: import('./game-states.js').GameState, learned: { offset: number, value: number }, inside: number, outside: number, alternatives: number }
 *   | { ok: false, reason: string }} SubStatePlan
 */

/**
 * A game state that holds on the `inside` frames and not on the `outside` ones, within the screen
 * most of the inside frames are on: that screen's recipe plus the byte learned (it was only checked
 * on that screen's frames). Frames with no memory, or on another screen, are left out.
 * @param {{ inside: LearnFrame[], outside: LearnFrame[], pools: any[], states?: any[], label: string, describe?: string }} q
 *   `states`: the project's game states, for a new id
 *   `describe`: how to name the inside frames in a reason ("frames showing Luigi")
 * @returns {SubStatePlan}
 */
export function planSubState({ inside, outside, pools, states = [], label, describe = 'frames it should show on' }) {
  const withMemory = (list) => list.filter((f) => f.wram && f.matched);
  const ins = withMemory(inside);
  const votes = new Map();
  for (const f of ins) {
    for (const id of /** @type {Set<string>} */ (f.matched)) {
      if (!id.includes('::')) votes.set(id, (votes.get(id) || 0) + 1);
    }
  }
  const [poolId] = [...votes].sort((a, b) => b[1] - a[1])[0] || [];
  const pool = (pools || []).find((p) => p?.id === poolId);
  if (!pool) {
    return { ok: false, reason: ins.length ? `none of the ${describe} is recognised as a screen — run Project ▸ Analyze memory… first` : `none of the ${describe} has its game memory captured` };
  }
  const onScreen = (f) => f.matched?.has(poolId);
  const a = ins.filter(onScreen);
  const b = withMemory(outside).filter(onScreen);
  const screen = (typeof pool.label === 'string' && pool.label.trim()) || poolId;
  if (a.length < MIN_INSIDE_FRAMES) return { ok: false, reason: `only ${a.length} of the ${describe} on ${screen} has its memory captured — capture at least ${MIN_INSIDE_FRAMES}` };
  if (!b.length) return { ok: false, reason: `every captured ${screen} frame is one of the ${describe}, so there is nothing to tell apart` };
  const recipe = (pool.variants || []).map((v) => normalizeGroupRamConditionsList({ ramConditions: v?.ramConditions }) || []).find((list) => list.length) || [];
  const skip = new Set();
  for (const v of pool.variants || []) for (const c of normalizeGroupRamConditionsList({ ramConditions: v?.ramConditions }) || []) skip.add(c.offset);
  const found = learnMemoryDifference(a.map((f) => /** @type {Uint8Array} */ (f.wram)), b.map((f) => /** @type {Uint8Array} */ (f.wram)), skip);
  if (!found) return { ok: false, reason: `no byte of game memory is the same on all ${a.length} ${describe} and different on the other ${b.length} ${screen} frames` };
  const learned = { offset: found.offset, value: found.expectedValue };
  return {
    ok: true,
    poolId,
    state: {
      id: newGameStateId(states, label),
      name: label,
      conditions: [...recipe.map((c) => ({ offset: c.offset, value: c.expectedValue })), learned],
      source: 'learned',
    },
    learned,
    inside: a.length,
    outside: b.length,
    alternatives: found.alternatives,
  };
}
