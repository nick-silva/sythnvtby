/**
 * Where paint doesn't cover a frame yet, for auto-capture's "where paint doesn't cover" watch
 * (src/main.js): the emulator stops on the frame, as it does on a new tile, so you can capture it
 * and paint what is missing. Two kinds, left eye only (as the rest of auto-capture):
 * - `unpainted`: a tile pattern with no paint at all (src/uncoloured.js, the Project tool's
 *   uncoloured-tiles measure);
 * - `backdrop`: a group's tiles beside its overpaint picture — the layer scrolled past the part
 *   that was painted, so they show their plain tile paint or none (the Check project rule in
 *   src/project-health.js). Pose pictures are sized to the pose and are left out.
 */
import { unpaintedTileDraws } from './uncoloured.js';
import { groupsForScreen } from './screen-gate.js';
import { picturesOnFrame, pictureCovers, pictureBeside } from './group-order.js';
import { groupMiss, groupLabel } from './pixel-explain.js';
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';

const W = 384;
const H = 224;
const EYE = 0;

/** @typedef {{ kind: 'unpainted', hash: number, draws: any[] } | { kind: 'backdrop', groupId: string, groupName: string, hash: number, draws: any[] }} PaintGap */

/**
 * A group's own picture (not a pose's): the one that scrolls with the map.
 * @param {any} group as picturesOnFrame returns it (pose pictures come as whole-pose groups)
 */
const isBackdropPicture = (group) => !group?.poseOf && group?.wholePose !== true;

/**
 * Tiles of a picture's group beside its picture, by group and pattern.
 * @param {any} state @param {any[]} shown @param {any[]} allGroups
 * @returns {PaintGap[]}
 */
export function backdropGaps(state, shown, allGroups) {
  if (!state?.drawList?.length || !state.patternTable) return [];
  const pictures = picturesOnFrame(state, shown, allGroups, EYE);
  if (!pictures.length) return [];
  /** @type {Map<string, PaintGap>} */
  const out = new Map();
  /** @type {Map<number, number | null>} */
  const hashBySlot = new Map();
  for (const d of state.drawList) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== EYE || Number(d.layer ?? 0) !== 0 || d.world == null) continue;
    const cx = d.x + 4;
    const cy = d.y + 4;
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
    const onLayer = pictures.filter((p) => p.world === Number(d.world));
    if (!onLayer.length || onLayer.some((p) => pictureCovers(p, cx, cy))) continue;
    let hash = hashBySlot.get(d.tileIndex);
    if (hash === undefined) {
      const bytes = getTileBytes(state.patternTable, d.tileIndex);
      hash = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
      hashBySlot.set(d.tileIndex, hash);
    }
    if (hash === null) continue;
    for (const p of onLayer) {
      if (!isBackdropPicture(p.group) || !pictureBeside(p, cx, cy) || groupMiss(d, p.group, hash)) continue;
      const key = `${p.group.id}:${hash}`;
      if (!out.has(key)) out.set(key, { kind: 'backdrop', groupId: p.group.id, groupName: groupLabel(p.group), hash, draws: [] });
      out.get(key).draws.push(d);
    }
  }
  return [...out.values()];
}

/**
 * Everything paint doesn't cover on this frame, minus what was already reported.
 * @param {any} state a VIP frame
 * @param {{ pack?: Map<number, Uint8Array>, overrides?: any[], groups?: any[], gameStatePools?: unknown,
 *   painterV2Rules?: unknown, variantId?: string|null, wram?: Uint8Array|null }} paint what colours the
 *   frame and its memory (as src/uncoloured.js measureUncoloured takes it)
 * @param {Set<string>} [skip] {@link paintGapKey}s to leave out
 * @returns {PaintGap[]}
 */
export function findPaintGaps(state, paint, skip = new Set()) {
  const groups = Array.isArray(paint?.groups) ? paint.groups : [];
  const shown = groupsForScreen(groups, paint?.gameStatePools ?? null, paint?.wram ?? null);
  /** @type {PaintGap[]} */
  const gaps = [];
  for (const [hash, draws] of unpaintedTileDraws(state, paint)) gaps.push({ kind: 'unpainted', hash, draws });
  gaps.push(...backdropGaps(state, shown, groups));
  return gaps.filter((g) => !skip.has(paintGapKey(g)));
}

/** @param {PaintGap} g */
export function paintGapKey(g) {
  return g.kind === 'backdrop' ? `backdrop:${g.groupId}:${g.hash}` : `unpainted:${g.hash}`;
}

/**
 * For the stop message: "3 tile(s) with no paint, MarioBackground past its picture (4 tiles)".
 * @param {PaintGap[]} gaps
 */
export function describePaintGaps(gaps) {
  const parts = [];
  const bare = gaps.filter((g) => g.kind === 'unpainted').length;
  if (bare) parts.push(`${bare} tile(s) with no paint`);
  /** @type {Map<string, number>} */
  const past = new Map();
  for (const g of gaps) if (g.kind === 'backdrop') past.set(g.groupName, (past.get(g.groupName) || 0) + 1);
  for (const [name, n] of past) parts.push(`${name} past its picture (${n} tile${n === 1 ? '' : 's'})`);
  return parts.join(', ');
}
