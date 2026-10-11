/**
 * Which screens a group shows on.
 *
 * A group's colours are not tied to a screen: they apply wherever its tiles are drawn in its
 * worlds and layers (see `drawMatchesGroup` in tools/painter/zoom-target.js and the compositor), unless its
 * `screens` setting limits them (src/screen-gate.js, by the game's memory). Where it
 * sits in the Project tool's tree is only the screen it was made on. So "is this group shared by
 * several screens?" is answered from the captured frames: index each frame once, then ask per
 * group. Matching follows the same rules as painting: worlds, then layers, then pattern hashes —
 * or, for an animated group, its tile slots — with an empty list meaning any.
 */

import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';

const ANY = '*';

/**
 * @typedef {{ hashes: Set<number>, slots: Set<number> }} WorldLayerTiles
 * @typedef {{ byWorldLayer: Map<string, WorldLayerTiles> }} FrameGroupIndex
 */

/**
 * Index one frame's draws for fast group lookups: per world and layer (and "any" of either), the
 * patterns and tile slots drawn there.
 * @param {{ patternTable?: Uint8Array, drawList?: Array<{ tileIndex: number, world?: number, layer?: number, eye?: number }> }} state
 * @param {number} [eye] 0 left (default), 1 right
 * @returns {FrameGroupIndex}
 */
export function frameGroupIndex(state, eye = 0) {
  /** @type {Map<string, WorldLayerTiles>} */
  const byWorldLayer = new Map();
  const pt = state?.patternTable;
  if (!pt || !Array.isArray(state.drawList)) return { byWorldLayer };
  const slotOf = (wk, lk) => {
    const key = `${wk}|${lk}`;
    let e = byWorldLayer.get(key);
    if (!e) byWorldLayer.set(key, (e = { hashes: new Set(), slots: new Set() }));
    return e;
  };
  /** @type {Map<number, number | null>} tile slot → hash (null when blank) */
  const hashBySlot = new Map();
  for (const d of state.drawList) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== eye) continue;
    let h = hashBySlot.get(d.tileIndex);
    if (h === undefined) {
      const bytes = getTileBytes(pt, d.tileIndex);
      h = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
      hashBySlot.set(d.tileIndex, h);
    }
    if (h === null) continue;
    const w = d.world ?? ANY;
    const l = d.layer ?? ANY;
    for (const wk of w === ANY ? [ANY] : [w, ANY]) {
      for (const lk of l === ANY ? [ANY] : [l, ANY]) {
        const e = slotOf(wk, lk);
        e.hashes.add(h);
        e.slots.add(Number(d.tileIndex));
      }
    }
  }
  return { byWorldLayer };
}

/** A group's criteria as number sets, cached on the criteria object. */
const criteriaSets = new WeakMap();
function setsOf(c) {
  const hashes = Array.isArray(c.hashes) ? c.hashes : [];
  const slots = Array.isArray(c.tileSlots) ? c.tileSlots : [];
  const cached = criteriaSets.get(c);
  if (cached && cached.nh === hashes.length && cached.ns === slots.length) return cached;
  const out = {
    nh: hashes.length,
    ns: slots.length,
    hashes: new Set(hashes.map((h) => Number(h) >>> 0)),
    slots: new Set(slots.map(Number)),
  };
  criteriaSets.set(c, out);
  return out;
}

/** Does any element of one set appear in the other? Walks the smaller. */
function overlaps(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) return true;
  return false;
}

/** @param {unknown} arr */
const listOr = (arr) => (Array.isArray(arr) && arr.length ? arr : [ANY]);

/**
 * @param {{ criteria?: { windowIds?: number[], worldIds?: number[], layers?: number[], hashes?: number[], tileSlots?: number[] } }} group
 * @param {FrameGroupIndex} index from {@link frameGroupIndex}
 * @returns {boolean} whether any draw on the frame belongs to the group
 */
export function groupInFrame(group, index) {
  const c = group?.criteria || {};
  const worlds = listOr(Array.isArray(c.windowIds) && c.windowIds.length ? c.windowIds : c.worldIds);
  const layers = listOr(c.layers);
  const sets = setsOf(c);
  for (const w of worlds) {
    for (const l of layers) {
      const e = index.byWorldLayer.get(`${w}|${l}`);
      if (!e) continue;
      if (!sets.nh && !sets.ns) {
        if (e.hashes.size) return true;
        continue;
      }
      if (sets.nh && overlaps(sets.hashes, e.hashes)) return true;
      if (sets.ns && overlaps(sets.slots, e.slots)) return true;
    }
  }
  return false;
}

/** Per list of indexed frames: per group, the frames showing it (and the criteria it was for). */
const framesCache = new WeakMap();

/**
 * The indexed frames showing a group. Cached per frame list and group; a group whose criteria
 * changed (a new object, or patterns added in place) is counted again. The tools replace the frame
 * list when frames change, which starts a new cache.
 * @template {{ index: FrameGroupIndex }} F
 * @param {Parameters<typeof groupInFrame>[0]} group
 * @param {F[]} frames
 * @returns {F[]}
 */
export function framesShowingGroup(group, frames) {
  let byGroup = framesCache.get(frames);
  if (!byGroup) framesCache.set(frames, (byGroup = new WeakMap()));
  const c = group?.criteria || {};
  const stamp = `${(c.hashes || []).length}|${(c.tileSlots || []).length}|${(c.windowIds || c.worldIds || []).join(',')}|${(c.layers || []).join(',')}`;
  const cached = group && byGroup.get(group);
  if (cached && cached.criteria === c && cached.stamp === stamp) return cached.frames;
  const out = frames.filter((f) => groupInFrame(group, f.index));
  if (group && typeof group === 'object') byGroup.set(group, { criteria: c, stamp, frames: out });
  return out;
}

/**
 * @param {Parameters<typeof groupInFrame>[0]} group
 * @param {Array<{ screen: string, index: FrameGroupIndex }>} frames indexed captured frames
 * @returns {Array<{ screen: string, frames: number }>} screens showing the group, most frames first
 */
export function screensForGroup(group, frames) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const f of framesShowingGroup(group, frames)) {
    if (!f.screen) continue;
    counts.set(f.screen, (counts.get(f.screen) || 0) + 1);
  }
  return [...counts]
    .map(([screen, n]) => ({ screen, frames: n }))
    .sort((a, b) => b.frames - a.frames || a.screen.localeCompare(b.screen));
}
