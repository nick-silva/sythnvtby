/**
 * Which group colours a shared tile: the one whose own tiles touch it.
 *
 * A pattern can belong to several groups. Where two allowed groups claim a draw and paint its
 * pattern differently, the group listed first used to colour it (resolveGroupTileMatch in
 * src/color-layer.js) — wrong wherever both are really on screen: DK Jr.'s corner tile took Mario's
 * colours because Mario-PlayingAs comes first, and HARD's letters took NORMAL's. No order fixes
 * that; it only moves the mistake to the other group. Measured on Mario's Tennis (Oct 14 2026, 489
 * frames): 1,553 contested draws; neighbours settle 1,432 of them and change the winner of 635.
 *
 * The rule, for a contested draw:
 *  1. The draws beside it vote — same world and layer, 8 px left, right, up and down; on a scaled
 *     (affine) world, the map cells beside it, since its draw records are not on an 8 px grid. A
 *     neighbour votes for a contesting group when that group claims it and no other contesting group
 *     does, or, when it is itself contested, for the group it was settled to.
 *  2. Contested draws touching each other are settled together, in rounds, each round reading only
 *     the last one's results — so a run of shared tiles is settled from its ends, and the answer does
 *     not depend on which draw was asked about first (the native player must match it exactly).
 *  3. When nothing beside it votes, the corners (diagonals) vote the same way.
 *  4. One group got votes: it colours the draw. None, or two that disagree: the list order decides.
 *
 * Same rule in native/core/src/colorizer.cpp (SharedTileOwners); tests/parity.cpp checks the two.
 */

import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { affineMapReader, affinePixelMap, affineWorlds } from './affine-world.js';

const ORTHO = [[-8, 0], [8, 0], [0, -8], [0, 8]];
const DIAG = [[-8, -8], [8, -8], [-8, 8], [8, 8]];
const ALL = [...ORTHO, ...DIAG];
/** Rounds of passing settled owners on (a run longer than this settles from its ends only so far). */
export const MAX_ROUNDS = 8;
/** A cluster of touching contested draws bigger than this is left to the list order (a whole shared layer). */
export const MAX_CLUSTER = 256;

/** A draw's place as one number: world (unknown → -1), layer, and x / y offset into 0..2047. */
const posKey = (world, layer, x, y) => (((((world ?? -1) + 1) & 63) * 4 + (layer & 3)) * 2048 + ((x + 1024) & 2047)) * 2048 + ((y + 1024) & 2047);

const sameRgba = (a, b) => a === b || (a.length === b.length && a.every((v, i) => v === b[i]));

/** @type {WeakMap<object, Set<number>>} */
const _contestedCache = new WeakMap();
const NONE = new Set();

/**
 * Patterns two or more groups paint differently: the only ones a neighbour can decide.
 * @param {Map<number, Array<{ group: any, rgba: Uint8Array }>> | null} index from buildGroupTileColorIndex
 * @returns {Set<number>}
 */
export function contestedPatterns(index) {
  if (!index) return NONE;
  let set = _contestedCache.get(index);
  if (set) return set;
  set = new Set();
  for (const [hash, list] of index) {
    if (list.length > 1 && list.some((e) => !sameRgba(e.rgba, list[0].rgba))) set.add(hash);
  }
  _contestedCache.set(index, set);
  return set;
}

/**
 * @typedef {{ hash: number, world: number, layer: number, x: number, y: number, m: any, cell: boolean, claim?: any[] | null }} TileNode
 * `x`/`y`: screen position of a draw, or map position (8 px cells) of an affine cell; `m`: the draw
 * as groups match it (a right-eye twin's world as the left one's).
 */

/**
 * The neighbour rule for one eye of one frame. Works lazily: nothing is built until a contested draw
 * is asked about, so a frame without one costs nothing.
 * @param {{
 *   state: any,
 *   eye: number,
 *   index: Map<number, Array<{ group: any, rgba: Uint8Array }>> | null,
 *   matches: (draw: any, group: any, hash: number) => boolean,
 *   drawList?: any[],
 *   matchWorld?: (world: number) => number,
 * }} opts
 */
export function createTileOwners({ state, eye, index, matches, drawList = state?.drawList || [], matchWorld = (w) => w }) {
  const contested = contestedPatterns(index);
  const e = eye ? 1 : 0;
  // Pattern per character slot: 0 = not read yet, 1 = blank, else 2 + index into `hashes`.
  const slotCode = new Int32Array(2048);
  const hashes = [];
  const hashOf = (tileIndex) => {
    const slot = tileIndex & 0x7ff;
    let c = slotCode[slot];
    if (!c) {
      const bytes = getTileBytes(state.patternTable, slot);
      if (isBlankTile(bytes)) c = 1;
      else {
        hashes.push(hashTile(bytes) >>> 0);
        c = hashes.length + 1;
      }
      slotCode[slot] = c;
    }
    return c === 1 ? null : hashes[c - 2];
  };
  /** @type {Map<number, any[]> | null} the eye's non-blank draws by place (posKey) */
  let byPos = null;
  /** @type {Map<any, TileNode>} */
  const drawNodes = new Map();
  /** @type {Map<string, TileNode | null>} */
  const cellNodes = new Map();
  /** @type {Map<number, ReturnType<typeof affineMapReader>>} */
  const readers = new Map();
  /** @type {Map<TileNode, any>} node → winning entry, or null for the list order */
  const settled = new Map();
  /** Scaled worlds this eye: their draw records stand for map cells (see ownerOfDraw). */
  const affine = new Set(affineWorlds(state, e));

  const asMatch = (d) => {
    const w = d.world == null ? d.world : matchWorld(d.world);
    return w === d.world ? d : { ...d, world: w };
  };
  const nodeOfDraw = (d, hash) => {
    let n = drawNodes.get(d);
    if (!n) drawNodes.set(d, (n = { hash, world: d.world, layer: Number(d.layer ?? 0), x: d.x, y: d.y, m: asMatch(d), cell: false }));
    return n;
  };
  const buildPositions = () => {
    byPos = new Map();
    for (const d of drawList) {
      if ((d.eye ?? 0) !== e || (d.layer === 1 && affine.has(d.world))) continue;
      const h = hashOf(d.tileIndex);
      if (h === null) continue;
      const k = posKey(d.world, Number(d.layer ?? 0), d.x, d.y);
      let list = byPos.get(k);
      if (!list) byPos.set(k, (list = []));
      list.push(d);
    }
  };
  const readerOf = (world) => {
    if (!readers.has(world)) readers.set(world, affineMapReader(state, world));
    return readers.get(world);
  };
  const nodeOfCell = (world, cx, cy) => {
    const k = `${world}|${cx}|${cy}`;
    let n = cellNodes.get(k);
    if (n !== undefined) return n;
    const ch = readerOf(world)?.charAt(cx, cy) ?? -1;
    const hash = ch < 0 ? null : hashOf(ch);
    n = hash === null ? null : { hash, world, layer: 1, x: cx * 8, y: cy * 8, m: { world: matchWorld(world), layer: 1, tileIndex: ch }, cell: true };
    cellNodes.set(k, n);
    return n;
  };
  /** @returns {TileNode[]} */
  const neighbours = (n, dirs) => {
    const out = [];
    for (const [dx, dy] of dirs) {
      if (n.cell) {
        const c = nodeOfCell(n.world, (n.x + dx) / 8, (n.y + dy) / 8);
        if (c) out.push(c);
      } else {
        const list = byPos.get(posKey(n.world, n.layer, n.x + dx, n.y + dy));
        if (list) for (const d of list) out.push(nodeOfDraw(d, /** @type {number} */ (hashOf(d.tileIndex))));
      }
    }
    return out;
  };
  /** The entries of the groups contesting this node, in list order; null when it is not contested. */
  const claimOf = (n) => {
    if (n.claim !== undefined) return n.claim;
    let claim = null;
    if (contested.has(n.hash)) {
      const list = index.get(n.hash).filter((x) => matches(n.m, x.group, n.hash));
      if (list.length > 1 && list.some((x) => !sameRgba(x.rgba, list[0].rgba))) claim = list;
    }
    n.claim = claim;
    return claim;
  };
  const CONFLICT = Symbol('conflict');
  /** The group the neighbours in `dirs` agree on, CONFLICT, or null when none votes. */
  const vote = (n, dirs, owner) => {
    const claim = claimOf(n);
    const votes = new Set();
    for (const nb of neighbours(n, dirs)) {
      const mine = claim.filter((x) => matches(nb.m, x.group, nb.hash));
      if (mine.length === 1) votes.add(mine[0].group);
      else if (mine.length > 1) {
        const o = owner.get(nb);
        if (o && claim.some((x) => x.group === o)) votes.add(o);
      }
    }
    if (votes.size === 1) return [...votes][0];
    return votes.size ? CONFLICT : null;
  };
  /**
   * Every contested node touching this one, and those touching them. `big`: more than MAX_CLUSTER
   * (those found so far are in the same cluster, so all of them are left to the list order).
   */
  const clusterOf = (start) => {
    const queue = [start];
    const seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      for (const nb of neighbours(queue[i], ALL)) {
        if (seen.has(nb) || !claimOf(nb)) continue;
        if (seen.size >= MAX_CLUSTER) return { nodes: queue, big: true };
        seen.add(nb);
        queue.push(nb);
      }
    }
    return { nodes: queue, big: false };
  };
  const settle = (start) => {
    const { nodes: cluster, big } = clusterOf(start);
    if (big) {
      for (const n of cluster) settled.set(n, null);
      return;
    }
    /** @type {Map<TileNode, any>} node → its group, once settled */
    let owner = new Map();
    const conflict = new Set();
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const next = new Map(owner);
      let changed = false;
      for (const n of cluster) {
        if (owner.has(n)) continue;
        const g = vote(n, ORTHO, owner);
        if (g === CONFLICT) conflict.add(n);
        else if (g) {
          conflict.delete(n);
          next.set(n, g);
          changed = true;
        }
      }
      owner = next;
      if (!changed) break;
    }
    const final = new Map(owner);
    for (const n of cluster) {
      if (owner.has(n) || conflict.has(n)) continue;
      const g = vote(n, DIAG, owner);
      if (g && g !== CONFLICT) final.set(n, g);
    }
    for (const n of cluster) {
      const g = final.get(n);
      settled.set(n, g ? claimOf(n).find((x) => x.group === g) : null);
    }
  };
  const ownerOf = (n) => {
    if (!claimOf(n)) return null;
    if (!settled.has(n)) settle(n);
    return settled.get(n);
  };
  /**
   * The group entry the neighbours give one map cell of an affine world (`cell` as
   * src/affine-world.js gives it: cellY * 1024 + cellX); null when they do not decide it.
   * @param {number} world @param {number} cell @param {number} hash
   */
  const ownerOfCell = (world, cell, hash) => {
    if (cell < 0 || !contested.has(hash >>> 0)) return null;
    const n = nodeOfCell(world, cell % 1024, Math.floor(cell / 1024));
    return n ? ownerOf(n) : null;
  };

  return {
    /**
     * The group entry the neighbours give this draw; null when they do not decide it (the list
     * order does). `hash`: the draw's pattern.
     * @param {any} draw @param {number} hash
     */
    ownerOfDraw(draw, hash) {
      if (!contested.has(hash >>> 0)) return null;
      // The core's record of a scaled tile sits where a screen pixel reads its top-left texel:
      // that pixel names the map cell.
      if (draw.layer === 1 && affine.has(draw.world)) {
        const px = affinePixelMap(state, e).get(draw.world);
        const x = draw.x + (draw.flipH ? 7 : 0);
        const y = draw.y + (draw.flipV ? 7 : 0);
        const i = y * 384 + x;
        if (!px || x < 0 || x >= 384 || y < 0 || y >= 224 || px.mx[i] < 0) return null;
        return ownerOfCell(draw.world, (px.my[i] >> 3) * 1024 + (px.mx[i] >> 3), hash);
      }
      if (!byPos) buildPositions();
      const h = hashOf(draw.tileIndex) ?? hash >>> 0;
      // A copy of a frame's draw (the tools pass one) is the draw at its place with its pattern.
      const n = drawNodes.get(draw)
        || nodeOfDraw(byPos.get(posKey(draw.world, Number(draw.layer ?? 0), draw.x, draw.y))?.find((d) => hashOf(d.tileIndex) === h) || draw, h);
      return ownerOf(n);
    },
    /**
     * The same for one map cell of an affine world (`cell` as src/affine-world.js gives it:
     * cellY * 1024 + cellX).
     * @param {number} world @param {number} cell @param {number} hash
     */
    ownerOfCell,
    /** Is this pattern one the neighbours may decide? (Painted differently by two groups.) */
    isContested(hash) {
      return contested.has(hash >>> 0);
    },
  };
}
