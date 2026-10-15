/**
 * Sprite suggestions (SpriteStudio's Find sprites and a sprite group's Find poses): the sprites the
 * captured frames show, as poses grouped into characters, for review before anything is made.
 *
 *   1. Each frame's OBJ tiles are clustered into on-screen sprites (touching runs of tiles).
 *   2. One layout is one pose, whichever way it faces: a sprite and its mirror images share a key.
 *   3. Layouts already kept as a pose are left out; so are two sprites that were touching (a layout
 *      made up of smaller layouts seen on their own) and a sprite cut off by the screen's edge (part
 *      of a layout seen whole).
 *   4. Poses sharing two or more tile patterns are one character; a character sharing two or more
 *      patterns with a sprite group is that group's.
 *
 * Measured on Mario Clash's capture (Oct 13 2026): 217 layouts on 158 frames, 30 with a mirror twin.
 */
import { clusterTilePositions } from './tile-clusters.js';
import { poseLayoutKey } from './pose-suggest.js';
import { POSE_ORIENTATIONS } from './pose-mirror.js';
import { isCaptureClipped } from './obj-sprite-profiles.js';

/**
 * A layout key that is the same for a sprite and its mirror images: the smallest of its four.
 * @param {Array<{ hash: number, dx?: number, dy?: number }>} tiles
 */
export function orientedLayoutKey(tiles) {
  let best = '';
  for (const o of POSE_ORIENTATIONS) {
    const key = poseLayoutKey(tiles.map((t) => ({ hash: t.hash, dx: (o.mirrorH ? -1 : 1) * (t.dx || 0), dy: (o.mirrorV ? -1 : 1) * (t.dy || 0) })));
    if (!best || key < best) best = key;
  }
  return best;
}

/** The key a kept pose is known by: any way round, unless its art is not a true mirror image. */
export function keptPoseKey(pose) {
  const tiles = Array.isArray(pose?.tiles) ? pose.tiles : [];
  return pose?.allowFlipMacro === false ? poseLayoutKey(tiles) : orientedLayoutKey(tiles);
}

/**
 * A frame's on-screen sprites: its OBJ draws clustered into runs of touching tiles.
 * @template {{ x: number, y: number }} D
 * @param {D[]} draws
 * @returns {D[][]}
 */
export function spriteInstances(draws) {
  return clusterTilePositions(draws, { gapTiles: 0 }).map((c) => c.indices.map((i) => draws[i]));
}

/**
 * Kept poses ready to be found inside a cluster: biggest first, so a pose is not peeled away in
 * pieces by smaller ones. Poses without offsets (a legacy tile list, a scaled pose) cannot be placed.
 * @param {any[]} groups
 */
function peelersFrom(groups) {
  const out = [];
  for (const g of groups) {
    for (const p of Array.isArray(g?.poses) ? g.poses : []) {
      const tiles = (p.tiles || []).filter((t) => Number.isFinite(t.dx) && Number.isFinite(t.dy));
      if (p.affine || !tiles.length || tiles.length !== (p.tiles || []).length) continue;
      const anchor = tiles.find((t) => t.dx === 0 && t.dy === 0) || tiles[0];
      out.push({ tiles, anchor, orientations: p.allowFlipMacro === false ? POSE_ORIENTATIONS.slice(0, 1) : POSE_ORIENTATIONS });
    }
  }
  return out.sort((a, b) => b.tiles.length - a.tiles.length);
}

/**
 * A cluster with every kept pose found whole inside it taken out (any way round), split again into
 * what is left: Mario touching a turtle leaves the turtle, or nothing when it is kept too.
 * @template {{ hash: number, x: number, y: number }} D
 * @param {D[]} draws @param {ReturnType<typeof peelersFrom>} peelers
 * @returns {{ left: D[][], peeled: number }}
 */
export function peelKeptPoses(draws, peelers) {
  let left = draws;
  let peeled = 0;
  for (const p of peelers) {
    if (left.length < p.tiles.length) continue;
    for (;;) {
      const at = new Map();
      left.forEach((d, i) => {
        const k = `${d.x},${d.y}`;
        if (!at.has(k)) at.set(k, []);
        at.get(k).push(i);
      });
      const found = findPlaced(left, at, p);
      if (!found) break;
      left = left.filter((_, i) => !found.has(i));
      peeled++;
    }
  }
  if (!peeled) return { left: [draws], peeled };
  return { left: left.length ? spriteInstances(left) : [], peeled };
}

/** Indexes into `draws` of one whole copy of the pose, or null. */
function findPlaced(draws, at, p) {
  const anchorHash = p.anchor.hash >>> 0;
  for (const d of draws) {
    if ((d.hash >>> 0) !== anchorHash) continue;
    for (const o of p.orientations) {
      const used = new Set();
      const whole = p.tiles.every((t) => {
        const x = d.x + (o.mirrorH ? -1 : 1) * (t.dx - p.anchor.dx);
        const y = d.y + (o.mirrorV ? -1 : 1) * (t.dy - p.anchor.dy);
        const i = (at.get(`${x},${y}`) || []).find((j) => !used.has(j) && (draws[j].hash >>> 0) === (t.hash >>> 0));
        if (i === undefined) return false;
        used.add(i);
        return true;
      });
      if (whole) return used;
    }
  }
  return null;
}

/** Draws as pose tiles, offsets from the first draw. */
const asTiles = (draws) => draws.map((d) => ({ hash: d.hash >>> 0, dx: d.x - draws[0].x, dy: d.y - draws[0].y }));

/** Pattern → how many tiles use it. */
function countPatterns(hashes) {
  /** @type {Map<number, number>} */
  const m = new Map();
  for (const h of hashes) m.set(h, (m.get(h) || 0) + 1);
  return m;
}

/** True when every pattern in `part` is in `whole` at least as many times. */
function fitsIn(part, whole) {
  for (const [h, n] of part) if ((whole.get(h) || 0) < n) return false;
  return true;
}

/**
 * Two or more smaller layouts, seen on their own, make up this one exactly: sprites that were
 * touching when captured, not a pose of their own.
 */
function isTouchingSprites(layout, others) {
  const left = new Map(layout.patterns);
  let parts = 0;
  const smaller = others.filter((o) => o !== layout && o.size < layout.size && fitsIn(o.patterns, layout.patterns));
  for (const o of smaller.sort((a, b) => b.size - a.size)) {
    if (!fitsIn(o.patterns, left)) continue;
    for (const [h, n] of o.patterns) left.set(h, left.get(h) - n);
    parts++;
  }
  return parts >= 2 && [...left.values()].every((n) => n === 0);
}

/** Distinct patterns two pattern sets share. */
function shared(a, b) {
  let n = 0;
  for (const h of a.keys()) if (b.has(h)) n++;
  return n;
}

/**
 * @typedef {{ hash: number, x: number, y: number, flipH?: boolean, flipV?: boolean, world?: number }} SpriteDraw
 * @typedef {{ key: string, size: number, frames: number[], sample: { frameIndex: number, draws: SpriteDraw[] }, mixed: boolean, others: string[], clipped: boolean }} SuggestedPose
 *   `mixed`: has patterns of other sprite groups (`others`, their ids); `clipped`: only ever seen cut by the screen's edge
 * @typedef {{ groupId: string | null, poses: SuggestedPose[], seen: number }} SuggestedCharacter
 */

/**
 * The sprites the frames show that no group keeps yet, as characters.
 * @param {{
 *   frames: Array<{ frameIndex: number, draws: SpriteDraw[] }>,
 *   groups: any[],
 *   minShared?: number,
 * }} args `groups`: the sprite groups, whose kept poses are left out and whose patterns claim characters
 * @returns {{ sprites: number, keptSeen: number, layouts: number, kept: number, touching: number, cutOff: number, characters: SuggestedCharacter[] }}
 *   `keptSeen`: sprites made up entirely of kept poses
 */
export function suggestSprites({ frames, groups, minShared = 2 }) {
  const known = new Set();
  for (const g of groups) for (const p of Array.isArray(g?.poses) ? g.poses : []) if (!p.affine) known.add(keptPoseKey(p));

  const peelers = peelersFrom(groups);
  /** @type {Map<string, any>} */
  const layouts = new Map();
  let sprites = 0;
  let keptSeen = 0;
  for (const { frameIndex, draws } of [...frames].sort((a, b) => a.frameIndex - b.frameIndex)) {
    const pieces = [];
    for (const inst of spriteInstances(draws)) {
      sprites++;
      const { left } = peelKeptPoses(inst, peelers);
      if (!left.length) keptSeen++;
      pieces.push(...left);
    }
    for (const inst of pieces) {
      const key = orientedLayoutKey(asTiles(inst));
      const clipped = isCaptureClipped(inst);
      let l = layouts.get(key);
      if (!l) {
        l = { key, size: inst.length, frames: [], patterns: countPatterns(inst.map((d) => d.hash >>> 0)), sample: null, allClipped: true, seen: 0 };
        layouts.set(key, l);
      }
      l.seen++;
      if (!l.frames.includes(frameIndex)) l.frames.push(frameIndex);
      // The sample is the first frame showing the sprite whole, not cut by the screen's edge.
      if (!l.sample || (l.allClipped && !clipped)) l.sample = { frameIndex, draws: inst };
      if (!clipped) l.allClipped = false;
    }
  }

  const all = [...layouts.values()];
  let kept = 0;
  let touching = 0;
  let cutOff = 0;
  const fresh = all.filter((l) => {
    if (known.has(l.key)) {
      kept++;
      return false;
    }
    if (isTouchingSprites(l, all)) {
      touching++;
      return false;
    }
    if (l.allClipped && all.some((o) => o !== l && o.size > l.size && fitsIn(l.patterns, o.patterns))) {
      cutOff++;
      return false;
    }
    return true;
  });

  return { sprites, keptSeen, layouts: all.length, kept, touching, cutOff, characters: intoCharacters(fresh, groups, minShared) };
}

/** Union-find over the fresh layouts by shared patterns; a character close enough to a group is its. */
function intoCharacters(fresh, groups, minShared) {
  const parent = fresh.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < fresh.length; i++) {
    for (let j = i + 1; j < fresh.length; j++) {
      if (shared(fresh[i].patterns, fresh[j].patterns) >= minShared) parent[find(i)] = find(j);
    }
  }
  /** @type {Map<number, any[]>} */
  const byRoot = new Map();
  fresh.forEach((l, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(l);
  });

  const groupPatterns = groups.map((g) => {
    const hashes = [...(g?.criteria?.hashes || []), ...(g?.poses || []).flatMap((p) => (p.tiles || []).map((t) => t.hash))];
    return { id: g.id, patterns: new Set(hashes.map((h) => Number(h) >>> 0)) };
  });
  // Each set of poses goes to the group it shares most patterns with, when it shares enough.
  /** @type {Map<string, any[]>} */
  const byGroup = new Map();
  const unclaimed = [];
  for (const members of byRoot.values()) {
    const patterns = new Set(members.flatMap((l) => [...l.patterns.keys()]));
    let groupId = null;
    let best = minShared - 1;
    for (const g of groupPatterns) {
      let n = 0;
      for (const h of patterns) if (g.patterns.has(h)) n++;
      if (n > best) {
        best = n;
        groupId = g.id;
      }
    }
    if (groupId === null) unclaimed.push(members);
    else byGroup.set(groupId, [...(byGroup.get(groupId) || []), ...members]);
  }
  const withOthers = (others) => ({ mixed: others.length > 0, others });
  const character = (groupId, members) => ({
    groupId,
    poses: members
      .sort((a, b) => b.seen - a.seen || a.frames[0] - b.frames[0])
      .map((l) => ({ key: l.key, size: l.size, frames: l.frames, sample: l.sample, ...withOthers(othersWithTiles(l, groupId, groupPatterns, minShared)), clipped: l.allClipped })),
    seen: members.reduce((n, l) => n + l.seen, 0),
  });
  return [...[...byGroup].map(([id, members]) => character(id, members)), ...unclaimed.map((members) => character(null, members))].sort((a, b) => b.seen - a.seen);
}

/**
 * The other sprite groups the layout has `minShared` or more patterns of — patterns its own group
 * does not have, so a tile two groups share anyway does not count: two sprites that were touching
 * more likely than a pose, so it is offered unticked.
 */
function othersWithTiles(layout, groupId, groupPatterns, minShared) {
  const own = groupPatterns.find((g) => g.id === groupId)?.patterns;
  const theirs = [...layout.patterns.keys()].filter((h) => !own?.has(h));
  return groupPatterns.filter((g) => g.id !== groupId && theirs.filter((h) => g.patterns.has(h)).length >= minShared).map((g) => g.id);
}
