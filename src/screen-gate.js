/**
 * Which screens a group's paint shows on (`group.screens`) — gating at render time.
 *
 * A group's colours and overpaint normally show wherever its tiles are drawn. A group can instead
 * be limited to some screens — the memory pools that File → Analyze memory recognises by bytes in
 * the game's memory (`gameStatePools[].variants[].ramConditions`):
 *
 *   group.screens = { mode: 'only' | 'except', pools: ['pool-ingame', …] }
 *
 * - `only`: shown on a frame whose memory matches one of the listed screens; hidden elsewhere.
 * - `except`: hidden on a frame matching one of the listed screens; shown elsewhere.
 *
 * When the frame's memory is unknown (no WRAM), every group shows: hiding paint because a dump is
 * missing would look like lost work. A screen with no memory recipe never matches.
 *
 * This is opt-in per group on purpose. A group's own pool (`statePoolId`) is stamped by the tools
 * from whatever screen was active when it was made, and is often wrong, so it never gates paint
 * (see resolveGroupTileRgba in src/color-layer.js).
 */
import { matchPoolVariantsByRam } from './pool-match-by-ram.js';
import { anyGroupConditions, heldProjectGameStates, projectConditionsAllow } from './game-states.js';

export const SCREEN_MODES = Object.freeze(['only', 'except']);

/**
 * @param {any} group
 * @returns {{ mode: 'only'|'except', pools: string[] } | null} null: shows on every screen
 */
export function groupScreensOf(group) {
  const s = group?.screens;
  if (!s || typeof s !== 'object' || !SCREEN_MODES.includes(s.mode)) return null;
  const pools = [...new Set((Array.isArray(s.pools) ? s.pools : [])
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim()))];
  return pools.length ? { mode: s.mode, pools } : null;
}

/**
 * A copy of the group with this screens setting; `null` (or no pools) removes it.
 * @param {any} group
 * @param {{ mode: string, pools: string[] } | null} screens
 */
export function withGroupScreens(group, screens) {
  const { screens: _old, ...rest } = group || {};
  const s = groupScreensOf({ screens });
  return s ? { ...rest, screens: s } : rest;
}

/**
 * Ids of the screens this frame's memory matches.
 * @param {unknown} gameStatePools
 * @param {Uint8Array|null|undefined} wram
 * @returns {Set<string>|null} null when the memory is unknown
 */
export function matchedScreens(gameStatePools, wram) {
  if (!wram || wram.byteLength < 0x10000) return null;
  return new Set(matchPoolVariantsByRam(gameStatePools, wram).map((m) => m.poolId));
}

/**
 * Does the group show on a frame matching these screens?
 * @param {any} group
 * @param {Set<string>|null} matched from matchedScreens; null = unknown memory, shows
 */
export function groupShownOnScreens(group, matched) {
  const s = groupScreensOf(group);
  if (!s || !matched) return true;
  const hit = s.pools.some((p) => matched.has(p));
  return s.mode === 'only' ? hit : !hit;
}

/** groups array → Map(hidden-ids key → filtered array), so the same screen gives the same array. */
const _filteredCache = new WeakMap();

/**
 * The groups whose paint shows on this frame: their screens setting allows it, and so do their
 * conditions on the project's game states (src/game-states.js). Returns `groups` itself when
 * nothing is hidden, and
 * the same filtered array for the same set of hidden groups, so per-array caches downstream
 * (buildGroupTileColorIndex) keep working.
 *
 * @template T
 * @param {T[]} groups
 * @param {unknown} gameStatePools
 * @param {Uint8Array|null|undefined} wram
 * @returns {T[]}
 */
export function groupsForScreen(groups, gameStatePools, wram) {
  if (!Array.isArray(groups)) return groups;
  const screens = groups.some((g) => groupScreensOf(g));
  const conditions = anyGroupConditions(groups);
  if (!screens && !conditions) return groups;
  const matched = screens ? matchedScreens(gameStatePools, wram) : null;
  const held = conditions ? heldProjectGameStates(wram) : null;
  if (!matched && !held) return groups;
  const hidden = [];
  for (let i = 0; i < groups.length; i++) {
    if (!groupShownOnScreens(groups[i], matched) || !projectConditionsAllow(groups[i], held)) hidden.push(i);
  }
  if (!hidden.length) return groups;
  const key = hidden.join(',');
  let byKey = _filteredCache.get(groups);
  if (!byKey) _filteredCache.set(groups, (byKey = new Map()));
  let out = byKey.get(key);
  if (!out) {
    const skip = new Set(hidden);
    out = groups.filter((_, i) => !skip.has(i));
    byKey.set(key, out);
  }
  return out;
}

/** A screen's display name. */
export function screenLabel(gameStatePools, id) {
  const p = (Array.isArray(gameStatePools) ? gameStatePools : []).find((x) => x?.id === id);
  return (typeof p?.label === 'string' && p.label.trim()) || id;
}

/**
 * A short line for the UI, e.g. "Only on InGame" or "Everywhere except GameMenu, Intro".
 * @param {any} group
 * @param {unknown} gameStatePools
 */
export function describeGroupScreens(group, gameStatePools) {
  const s = groupScreensOf(group);
  if (!s) return 'Every screen';
  const labels = s.pools.map((id) => screenLabel(gameStatePools, id));
  return `${s.mode === 'only' ? 'Only on' : 'Everywhere except'} ${labels.join(', ')}`;
}
