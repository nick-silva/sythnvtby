/**
 * Which of a group's patterns switch its overpaint on (src/overpaint.js, src/layer-art.js).
 *
 * A group's picture is drawn on a frame when the group is on that layer. "On the layer" used to
 * mean any of its patterns was drawn there — but a plain fill or "black-out" tile is often shared
 * with other groups on the same layers (a menu strip, another character), and one such tile on
 * screen switched the whole picture on where it did not belong: Toad's overpaint over Mario.
 *
 * So the switch uses the group's own patterns: those no other group on an overlapping world and
 * layer also claims. A group whose patterns are all shared keeps them all (it would otherwise
 * never switch on). Tile colours are unaffected: they stay per pattern.
 *
 * A **whole-pose** group (`wholePose: true`, SpriteStudio's "Overpaint just this pose") is one pose
 * of a character, made so the pose can have a picture of its own. Its picture shows only when every
 * one of its patterns is on the layer, and of two poses shown on the same layer only the one whose
 * patterns hold the other's. Its patterns are its character's too, so they never count as shared.
 */

import { hashTile } from './vip-state.js';

/** A tile of all zero bytes draws nothing and is never counted as on screen. */
const BLANK_HASH = hashTile(new Uint8Array(16)) >>> 0;

/** @param {unknown} arr */
const numList = (arr) => (Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : []);

/** Do two lists overlap, with an empty list meaning "any"? */
function overlaps(a, b) {
  if (!a.length || !b.length) return true;
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

/** Layers a group draws on: a BG group (0) also covers its worlds' scaled draws (1). */
function layersOf(g) {
  const l = numList(g?.criteria?.layers);
  return l.includes(0) && !l.includes(1) ? [...l, 1] : l;
}

/** groups array → Map(group → switch set | null), worked out once per list. */
const _cache = new WeakMap();

/**
 * @param {any} group
 * @param {any[]} groups every group of the pack (the sharing is judged against all of them)
 * @returns {Set<number> | null} the patterns that switch the picture on; null = any of the group's
 */
export function overpaintSwitchHashes(group, groups) {
  if (!group || !Array.isArray(groups)) return null;
  let byGroup = _cache.get(groups);
  if (!byGroup) _cache.set(groups, (byGroup = new Map()));
  if (byGroup.has(group)) return byGroup.get(group);
  const own = numList(group.criteria?.hashes).map((h) => h >>> 0);
  let result = null;
  if (own.length) {
    const worlds = numList(group.criteria?.windowIds);
    const layers = layersOf(group);
    /** @type {Set<number>} */
    const shared = new Set();
    for (const other of groups) {
      if (!other || other === group || (other.id != null && other.id === group.id) || other.wholePose === true) continue;
      if (!overlaps(worlds, numList(other.criteria?.windowIds)) || !overlaps(layers, layersOf(other))) continue;
      for (const h of numList(other.criteria?.hashes)) shared.add(h >>> 0);
    }
    const mine = own.filter((h) => !shared.has(h));
    if (mine.length && mine.length < own.length) result = new Set(mine);
  }
  byGroup.set(group, result);
  return result;
}

/** group → its whole-pose patterns, worked out once per group object. */
const _poseCache = new WeakMap();

/**
 * @param {any} group
 * @returns {Set<number> | null} the patterns that must all be on the layer for a whole-pose group's
 *   picture to show (blank ones left out); null for any other group
 */
export function wholePoseHashes(group) {
  if (!group || group.wholePose !== true) return null;
  if (_poseCache.has(group)) return _poseCache.get(group);
  const set = new Set(numList(group.criteria?.hashes).map((h) => h >>> 0).filter((h) => h !== BLANK_HASH));
  const result = set.size ? set : null;
  _poseCache.set(group, result);
  return result;
}

/**
 * Is a whole-pose group's pose on a layer that shows these patterns?
 * @param {any} group @param {Set<number>} drawn patterns drawn on the layer
 */
export function wholePoseOn(group, drawn) {
  const need = wholePoseHashes(group);
  if (!need) return false;
  for (const h of need) if (!drawn.has(h)) return false;
  return true;
}

/**
 * Of the whole-pose pictures picked for one world, leave out a pose whose patterns another picked
 * pose holds too (a standing pose inside a waving one): only the fullest match is that pose.
 * @template {{ world: number, group: any }} T
 * @param {T[]} entries
 * @returns {T[]}
 */
export function dropCoveredPoses(entries) {
  return entries.filter((e) => {
    const mine = wholePoseHashes(e.group);
    if (!mine) return true;
    return !entries.some((o) => {
      if (o === e || o.world !== e.world) return false;
      const theirs = wholePoseHashes(o.group);
      if (!theirs || theirs.size <= mine.size) return false;
      for (const h of mine) if (!theirs.has(h)) return false;
      return true;
    });
  });
}
