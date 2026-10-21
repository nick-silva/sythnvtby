/**
 * Which frames an edit to the groups can recolour, so a frame list that counts what each frame
 * leaves uncoloured (src/uncoloured.js) recounts only those, not every capture.
 *
 * A group whose criteria list patterns (`criteria.hashes`) only ever colours, pictures or switches
 * on where a frame shows one of them: its paint, its overpaint and pose pictures, which patterns
 * other groups share with it, its screens and game states. So when such groups change, a frame
 * that shows none of their patterns (before or after the edit) comes out the same. Anything else
 * — a group without a pattern list (a whole layer), tile slots, groups reordered — can reach any
 * frame, and the answer is "recount them all" (null).
 */
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { affineStandInDraws } from './affine-world.js';

/** Every pattern a group refers to: its criteria, its poses' tiles, its pose pictures. @returns {number[] | null} null when it has no pattern list or claims tile slots */
function patternsOfGroup(g) {
  const c = g?.criteria || {};
  if (!Array.isArray(c.hashes) || !c.hashes.length) return null;
  if (Array.isArray(c.tileSlots) && c.tileSlots.length) return null;
  const out = c.hashes.map((h) => Number(h) >>> 0);
  for (const p of Array.isArray(g.poses) ? g.poses : []) {
    for (const t of Array.isArray(p?.tiles) ? p.tiles : []) out.push(Number(t?.hash) >>> 0);
  }
  for (const p of Array.isArray(g.poseOverpaints) ? g.poseOverpaints : []) {
    for (const h of Array.isArray(p?.hashes) ? p.hashes : []) out.push(Number(h) >>> 0);
  }
  return out;
}

/**
 * The patterns whose colouring may differ between two versions of the group list, comparing groups
 * by object (edits replace a group, they do not change it in place).
 * @param {any[]} before @param {any[]} after
 * @returns {Set<number> | null} null when the change can reach frames whatever they show
 */
export function changedPatterns(before, after) {
  const was = new Map(before.map((g) => [g?.id, g]));
  const now = new Map(after.map((g) => [g?.id, g]));
  if (was.size !== before.length || now.size !== after.length) return null;
  // Order decides which group colours a shared pattern: the groups both lists have keep theirs.
  const keptOrder = (list, other) => list.filter((g) => other.has(g?.id)).map((g) => g?.id);
  const a = keptOrder(before, now);
  const b = keptOrder(after, was);
  if (a.some((id, i) => id !== b[i])) return null;
  const out = new Set();
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const old = was.get(id);
    const cur = now.get(id);
    if (old === cur) continue;
    for (const g of [old, cur]) {
      if (!g) continue;
      const pats = patternsOfGroup(g);
      if (!pats) return null;
      for (const h of pats) out.add(h);
    }
  }
  return out;
}

/**
 * The patterns a frame shows to the left eye (what src/uncoloured.js measures), the scaled
 * (affine) layers' sampled tiles included. Blank patterns are left out: they light no pixel, so
 * nothing about them changes what is uncoloured, and many groups list one.
 * @param {any} state a deserialized VIP state
 * @returns {Set<number>}
 */
export function framePatterns(state) {
  const out = new Set();
  const pt = state?.patternTable;
  if (!pt) return out;
  const draws = (state.drawList || []).concat(affineStandInDraws(state));
  const seen = new Set();
  for (const d of draws) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== 0 || seen.has(d.tileIndex)) continue;
    seen.add(d.tileIndex);
    const bytes = getTileBytes(pt, d.tileIndex);
    if (!isBlankTile(bytes)) out.add(hashTile(bytes) >>> 0);
  }
  return out;
}

/** Whether a frame showing `shown` (null: not known) can be recoloured by a change to `changed`. */
export function frameTouched(shown, changed) {
  if (!shown) return true;
  for (const h of changed) if (shown.has(h)) return true;
  return false;
}
