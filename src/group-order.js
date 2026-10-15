/**
 * Which group's paint wins a shared tile, and changing that.
 *
 * When two groups both claim a draw and both have paint for its pattern, the group whose own tiles
 * are next to it colours it (src/shared-tile-owner.js); where nothing next to it tells, the one
 * listed first in groups.json does (resolveGroupTileMatch in src/color-layer.js) and the other's
 * paint for that tile never shows. Nothing marks that on screen, so these helpers name the pairs
 * on a frame and move a group ahead of another.
 */

import { buildGroupTileColorIndex, frameTileOwners } from './color-layer.js';
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { groupMiss } from './pixel-explain.js';
import { getWindowsTableBytesFromState } from './vip-world-clip.js';
import { activeLayerArts, layerGeometry } from './layer-art.js';

/**
 * The pictures (overpaint, pose pictures) showing on this frame's plain layers, each with its
 * layer's screen → map mapping. Where one covers a tile, the tile's own paint does not show.
 * @param {any} state @param {any[]} shown @param {any[]} allGroups @param {number} [eye]
 * @returns {Array<{ group: any, art: any, world: number, geo: any }>}
 */
export function picturesOnFrame(state, shown, allGroups, eye = 0) {
  const windows = getWindowsTableBytesFromState(state);
  if (!windows) return [];
  const out = [];
  for (const a of activeLayerArts(state, shown, eye, allGroups)) {
    const geo = layerGeometry(windows, a.world, eye);
    if (geo) out.push({ group: a.group, art: a.art, world: a.world, geo });
  }
  return out;
}

/** Does this picture cover the screen pixel (x, y) of its layer? */
export function pictureCovers(p, x, y) {
  const mx = p.geo.sx(x);
  const my = p.geo.sy(y);
  return ((mx - p.art.mapX) & p.geo.maskX) < p.art.width && ((my - p.art.mapY) & p.geo.maskY) < p.art.height;
}

/** Beside the picture: past one edge, within its span the other way (where a scroll leads). */
export function pictureBeside(p, x, y) {
  const inX = ((p.geo.sx(x) - p.art.mapX) & p.geo.maskX) < p.art.width;
  const inY = ((p.geo.sy(y) - p.art.mapY) & p.geo.maskY) < p.art.height;
  return inX !== inY;
}

/** A test for draws a picture covers (by the tile's middle), or null when no picture shows. */
export function coveredByPictures(pictures) {
  if (!pictures.length) return null;
  return (d) => Number(d.layer ?? 0) === 0 && pictures.some((p) => p.world === Number(d.world) && pictureCovers(p, d.x + 4, d.y + 4));
}

/**
 * The list with group `id` moved to just before `beforeId`; the same order (a new array) when
 * either is missing or `id` already comes first.
 * @param {any[]} groups @param {string} id @param {string} beforeId
 * @returns {any[]}
 */
export function moveGroupBefore(groups, id, beforeId) {
  const list = Array.isArray(groups) ? groups.slice() : [];
  const from = list.findIndex((g) => g?.id === id);
  const to = list.findIndex((g) => g?.id === beforeId);
  if (from < 0 || to < 0 || from < to) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
}

/**
 * A lit pixel of a draw on screen (its first non-zero pixel), for pointing at the tile; null for a
 * blank tile.
 * @param {{ patternTable: Uint8Array }} state @param {any} d
 * @returns {{ x: number, y: number } | null}
 */
export function litPixelOfDraw(state, d) {
  const bytes = getTileBytes(state.patternTable, d.tileIndex);
  for (let py = 0; py < 8; py++) {
    const row = bytes[py * 2] | (bytes[py * 2 + 1] << 8);
    for (let px = 0; px < 8; px++) {
      if (!((row >> (px * 2)) & 3)) continue;
      const x = d.x + (d.flipH ? 7 - px : px);
      const y = d.y + (d.flipV ? 7 - py : py);
      if (x >= 0 && x < 384 && y >= 0 && y < 224) return { x, y };
    }
  }
  return null;
}

const sameRgba = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Pairs of groups where both claim and paint the same tiles on this frame, with different
 * colours, and nothing beside a tile says whose it is (src/shared-tile-owner.js): the first in
 * `groups` wins, and the other's paint for those tiles never shows.
 * `winnerElsewhere` / `loserElsewhere`: whether that group also paints other tiles on the frame —
 * whether it is really on screen, rather than just sharing a pattern with what is.
 * Tiles a picture covers are left out (`covered`, from coveredByPictures): their paint does not
 * show whichever group wins.
 * @param {any} state a VIP frame
 * @param {any[]} groups the groups shown on this frame, in priority order
 * @param {number} [eye]
 * @param {((d: any) => boolean) | null} [covered]
 * @returns {Array<{ winner: any, loser: any, hashes: Set<number>, example: { x: number, y: number } | null, winnerElsewhere: boolean, loserElsewhere: boolean }>}
 */
export function sharedTileWins(state, groups, eye = 0, covered = null) {
  const index = buildGroupTileColorIndex(groups);
  if (!index || !state?.drawList || !state.patternTable) return [];
  const owners = frameTileOwners(state, index, eye);
  /** @type {Map<string, { winner: any, loser: any, hashes: Set<number>, example: { x: number, y: number } | null, winnerElsewhere: boolean, loserElsewhere: boolean }>} */
  const pairs = new Map();
  /** @type {Map<any, Set<number>>} group → painted patterns it claims on this frame */
  const claimed = new Map();
  /** @type {Map<number, number | null>} */
  const hashBySlot = new Map();
  for (const d of state.drawList) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== eye || covered?.(d)) continue;
    let hash = hashBySlot.get(d.tileIndex);
    if (hash === undefined) {
      const bytes = getTileBytes(state.patternTable, d.tileIndex);
      hash = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
      hashBySlot.set(d.tileIndex, hash);
    }
    if (hash === null) continue;
    const list = index.get(hash);
    if (!list) continue;
    const claiming = list.filter((e) => !groupMiss(d, e.group, hash));
    for (const e of claiming) {
      if (!claimed.has(e.group)) claimed.set(e.group, new Set());
      claimed.get(/** @type {any} */ (e.group)).add(hash);
    }
    // A tile its neighbours give to one group (src/shared-tile-owner.js) is not the order's to decide.
    if (claiming.length > 1 && owners.ownerOfDraw(d, hash)) continue;
    for (let i = 1; i < claiming.length; i++) {
      const win = claiming[0];
      const lose = claiming[i];
      if (sameRgba(win.rgba, lose.rgba)) continue;
      const key = `${win.group.id}\u0000${lose.group.id}`;
      let p = pairs.get(key);
      if (!p) pairs.set(key, (p = { winner: win.group, loser: lose.group, hashes: new Set(), example: null, winnerElsewhere: false, loserElsewhere: false }));
      p.hashes.add(hash);
      if (!p.example) p.example = litPixelOfDraw(state, d);
    }
  }
  // On screen in its own right: it paints a tile here that the other group does not claim.
  const elsewhere = (g, other) => {
    const theirs = claimed.get(other) || new Set();
    return [...(claimed.get(g) || [])].some((h) => !theirs.has(h));
  };
  for (const p of pairs.values()) {
    p.winnerElsewhere = elsewhere(p.winner, p.loser);
    p.loserElsewhere = elsewhere(p.loser, p.winner);
  }
  return [...pairs.values()];
}
