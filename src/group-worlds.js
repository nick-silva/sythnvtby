/**
 * Worlds a group moves between. The Virtual Boy decides what is in front by world number alone,
 * so a game that draws characters with background worlds (Mario's Tennis does, to scale them)
 * reassigns worlds as things pass in front of each other: the same tiles show on world 22 one
 * frame and world 21 the next. A group matches by world as well as by tile, so on the other world
 * its paint drops out and the picture flickers. This finds the other worlds its tiles turn up on.
 */
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';

/** Of the group's tiles on a frame, the share another world must draw to count as the group. */
export const MIN_SHARE = 0.5;

/**
 * How many of a group's patterns a world must draw on one frame to count as the group: a one-tile
 * sprite (a ball) is the group whenever its tile shows; bigger groups need several.
 * @param {any} group
 */
export function minTilesForGroup(group) {
  const c = group?.criteria || {};
  const n = new Set((Array.isArray(c.hashes) ? c.hashes : []).map((h) => Number(h) >>> 0)).size;
  const sprite = Array.isArray(c.layers) && c.layers.map(Number).includes(2);
  return Math.max(sprite ? 1 : 3, Math.min(6, Math.ceil(n * MIN_SHARE)));
}

/**
 * Worlds outside the group's own where its tiles turn up together on captured frames. A world
 * counts on a frame when it draws at least half as many of the group's distinct patterns as the
 * busiest world does there, and at least a few of them — so a couple of plain tiles that other
 * scenery shares do not count.
 * @param {Iterable<any>} states deserialized VIP frames
 * @param {any} group
 * @param {number} [eye]
 * @returns {Array<{ world: number, frames: number }>} most frames first
 */
export function otherWorldsShowingGroup(states, group, eye = 0) {
  const c = group?.criteria || {};
  const want = new Set((Array.isArray(c.hashes) ? c.hashes : []).map((h) => Number(h) >>> 0));
  const own = new Set((Array.isArray(c.windowIds) ? c.windowIds : []).map(Number));
  if (!want.size || !own.size) return [];
  const sprite = Array.isArray(c.layers) && c.layers.map(Number).includes(2);
  const minTiles = minTilesForGroup(group);
  /** @type {Map<number, number>} world → frames */
  const found = new Map();
  for (const st of states) {
    if (!st?.drawList || !st.patternTable) continue;
    /** @type {Map<number, number|null>} */
    const byIndex = new Map();
    /** @type {Map<number, Set<number>>} world → group patterns it draws */
    const perWorld = new Map();
    for (const d of st.drawList) {
      // Sprite groups move between OBJ worlds the same way; look at the group's own kind of tile.
      if ((Number(d.eye) === 1 ? 1 : 0) !== eye || (Number(d.layer) === 2) !== sprite || d.world == null) continue;
      let h = byIndex.get(d.tileIndex);
      if (h === undefined) {
        const bytes = getTileBytes(st.patternTable, d.tileIndex);
        h = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
        byIndex.set(d.tileIndex, h);
      }
      if (h === null || !want.has(h)) continue;
      const w = Number(d.world);
      if (!perWorld.has(w)) perWorld.set(w, new Set());
      perWorld.get(w).add(h);
    }
    const busiest = Math.max(0, ...[...perWorld.values()].map((s) => s.size));
    for (const [w, set] of perWorld) {
      if (own.has(w) || set.size < minTiles || set.size < busiest * MIN_SHARE) continue;
      found.set(w, (found.get(w) || 0) + 1);
    }
  }
  return [...found].map(([world, frames]) => ({ world, frames })).sort((a, b) => b.frames - a.frames || a.world - b.world);
}

/**
 * The group with this world list (sorted, no repeats). An empty list means "any world".
 * @param {any} group @param {Iterable<number>} worlds
 */
export function withWorlds(group, worlds) {
  const list = [...new Set([...worlds].map(Number).filter((w) => Number.isInteger(w) && w >= 0 && w <= 31))].sort((a, b) => a - b);
  return { ...group, criteria: { ...(group.criteria || {}), windowIds: list } };
}
