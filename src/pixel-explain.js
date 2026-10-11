/**
 * "Why isn't this coloured?" — what coloured one pixel of a composited frame, or the reason
 * nothing did, in a sentence a person reads, with at most one fix to offer.
 *
 * It reads the per-pixel record of the composite just drawn (getCompositePixelInfo and
 * getCompositeDrawOwners in src/color-layer.js) and asks the same rules that composite used
 * (group criteria, screen limits, overpaint) which one decided it. Nothing here draws or changes
 * anything; the tools show the answer on demand — the Project tool's inspector, SpriteStudio's Pick
 * tool.
 */

import {
  resolveOverrideRgba,
  buildGroupTileColorIndex,
  resolveGroupTileMatch,
  groupCriteriaSets,
} from './color-layer.js';
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { recoverClippedBgDraws } from './vip-edge-tiles.js';
import { stereoTwins } from './stereo-twin.js';
import { getWindowsTableBytesFromState } from './vip-world-clip.js';
import { groupsForScreen } from './screen-gate.js';
import { decodeGroupTileColors } from './group-tile-colors.js';
import { activeLayerArts, layerArtOf, layerGeometry } from './layer-art.js';
import { posePictureGroups } from './pose-overpaint.js';
import { failingCondition, heldProjectGameStates } from './game-states.js';

const W = 384;
const H = 224;
const LAYER_NAMES = ['background', 'scaled background', 'sprite'];

/** @param {any} g */
export const groupLabel = (g) => String(g?.name || g?.id || 'a group');
const hex = (h) => `#${(h >>> 0).toString(16).toUpperCase()}`;
const listWorlds = (set) => [...set].sort((a, b) => a - b).join(', ');

/**
 * Why a group does not claim a draw, or null when it does — the colour rules' group match, one
 * check at a time so each failure can be named.
 * @param {any} draw @param {any} group @param {number} hash
 * @returns {null | { miss: 'world' | 'pattern' | 'layer', worlds?: Set<number> }}
 */
export function groupMiss(draw, group, hash) {
  const c = groupCriteriaSets(group);
  if (c.worlds && (draw.world == null || !c.worlds.has(Number(draw.world)))) return { miss: 'world', worlds: c.worlds };
  if (c.hashes && !c.hashes.has(hash) && !(c.slots && c.slots.has(Number(draw.tileIndex)))) return { miss: 'pattern' };
  if (c.layers) {
    const L = Number(draw.layer);
    if (draw.layer == null || (!c.layers.has(L) && !(L === 1 && c.layers.has(0)))) return { miss: 'layer' };
  }
  return null;
}

/**
 * @typedef {{ kind: 'select-group', groupId: string, label: string }
 *   | { kind: 'add-world', groupId: string, world: number, label: string }
 *   | { kind: 'new-group', label: string }} ExplainFix
 *
 * @typedef {{
 *   status: 'coloured' | 'uncoloured' | 'nothing',
 *   sentence: string,
 *   why: string[],
 *   fix: ExplainFix | null,
 *   reorder?: { kind: 'move-before', groupId: string, beforeId: string, label: string },
 *   groupId: string | null,
 *   details: null | { hash: number, tileIndex: number, layer: number, world: number | null, drawIndex: number, blank: boolean, eye: number },
 * }} PixelExplanation
 */

/**
 * @param {{
 *   state: any, eye: number, x: number, y: number,
 *   pack: Map<number, Uint8Array>,
 *   groups: any[],
 *   allGroups?: any[],
 *   overrides?: any[],
 *   gameStatePools?: unknown,
 *   wram?: Uint8Array | null,
 *   info: { shade: Uint8Array | null, art: Uint8Array | null, bare: Uint8Array | null, char: Int16Array | null },
 *   owners: Int32Array | null,
 * }} q `groups` as handed to the composite; `allGroups` the whole project (default `groups`), to
 *   tell a group a screen limit hid from one that is not there; `info` and `owners` read right
 *   after compositing this eye.
 * @returns {PixelExplanation}
 */
export function explainPixel(q) {
  const { state, eye, x, y, info, owners } = q;
  const pack = q.pack || new Map();
  const allGroups = q.allGroups || q.groups || [];
  const shown = groupsForScreen(q.groups || [], q.gameStatePools ?? null, q.wram ?? null);
  const result = (status, sentence, extra = {}) => ({ status, sentence, why: [], fix: null, groupId: null, details: null, ...extra });
  if (!state?.drawList || !state.patternTable || !info?.shade || !owners || x < 0 || y < 0 || x >= W || y >= H) {
    return result('nothing', 'Nothing to explain here.');
  }
  const p = y * W + x;
  const owner = owners[p];
  const art = info.art ? info.art[p] : 0;
  const recovered = recoverClippedBgDraws(state, eye);
  const drawList = recovered.length ? state.drawList.concat(recovered) : state.drawList;
  if (owner < 0) {
    const under = drawList.some((c) => (Number(c.eye) === 1 ? 1 : 0) === eye && x >= c.x && x < c.x + 8 && y >= c.y && y < c.y + 8 && !isBlankTile(getTileBytes(state.patternTable, c.tileIndex)));
    return result('nothing', under
      ? 'Nothing lights this pixel: the tile drawn here is see-through at this spot, and nothing behind it is lit.'
      : 'Nothing is drawn here: the game leaves this pixel dark.');
  }
  const d = drawList[owner];
  if (!d) return result('nothing', 'Nothing to explain here.');
  const tileIndex = info.char && info.char[p] >= 0 ? info.char[p] : d.tileIndex;
  const tileBytes = getTileBytes(state.patternTable, tileIndex);
  const hash = hashTile(tileBytes) >>> 0;
  const windows = getWindowsTableBytesFromState(state);
  const twin = eye === 1 && windows ? stereoTwins(windows).get(d.world) : undefined;
  const matchDraw = { ...d, tileIndex, world: twin ? twin.left : d.world };
  const details = { hash, tileIndex, layer: Number(d.layer ?? 0), world: d.world ?? null, drawIndex: owner, blank: isBlankTile(tileBytes), eye };
  const layerName = LAYER_NAMES[details.layer] || 'layer';
  const select = (g) => ({ kind: /** @type {const} */ ('select-group'), groupId: g.id, label: `Select ${groupLabel(g)}` });
  // A group left out of `shown`: a condition on a game state, or a screen limit.
  const held = heldProjectGameStates(q.wram ?? null);
  const offHere = (g) => {
    const c = failingCondition(g, held);
    return c ? `its paint is off here: “${c.name}” ${c.is ? 'does not hold' : 'holds'}` : 'it is limited to some screens and this frame is not one of them';
  };
  const arts = () => activeLayerArts({ patternTable: state.patternTable, windows, drawList }, shown, eye, allGroups);

  if (art === 2) {
    return result('coloured', 'Coloured from the left eye: the game draws this layer once per eye, and the right copy takes the left one’s colours.', { details });
  }
  if (art === 1) {
    const all = arts();
    const by = all.filter((a) => a.ownerIndex === owner).pop() || all.find((a) => a.world === d.world);
    const parent = by ? allGroups.find((g) => g.id === (by.group.poseOf || by.group.id)) || by.group : null;
    return result('coloured', by ? `Coloured by the overpaint of ${groupLabel(by.group)}.` : 'Coloured by a picture painted over this layer (overpaint).', {
      details,
      groupId: parent?.id ?? null,
      fix: parent ? select(parent) : null,
    });
  }

  const match = resolveGroupTileMatch(buildGroupTileColorIndex(shown), matchDraw, hash);
  const override = !match && q.overrides?.length
    ? resolveOverrideRgba(q.overrides, hash, d.x, d.y, pack, d.layer, matchDraw, allGroups, q.gameStatePools ?? null, q.wram ?? null)
    : null;
  const ramp = !match && !override
    ? shown.find((g) => Array.isArray(g?.shadeRamp) && groupCriteriaSets(g).slots?.has(Number(tileIndex)) && !groupMiss(matchDraw, g, hash))
    : null;
  const shared = pack.has(hash);
  const members = allGroups.filter((g) => !groupMiss(matchDraw, g, hash));
  const paintsTile = (g) => decodeGroupTileColors(g).has(hash);
  const clearPixel = info.bare ? info.bare[p] === 1 : false;

  if (match || override || ramp || shared) {
    const g = match?.group || ramp || null;
    const why = [];
    const rivals = match ? members.filter((o) => o !== match.group && shown.includes(o) && paintsTile(o)) : [];
    if (rivals.length) {
      why.push(`${rivals.map(groupLabel).join(', ')} also ${rivals.length === 1 ? 'paints' : 'paint'} this tile here; ${groupLabel(match.group)} wins because it comes first in the group list.`);
    }
    if (match && shared) why.push('This tile also has shared paint (every copy of the pattern); the group’s own paint comes first.');
    if (!g && members.length) why.push(`It belongs to ${members.map(groupLabel).join(', ')}.`);
    const source = override
      ? 'a position override (an older per-position colour)'
      : match
        ? `${groupLabel(match.group)}’s paint for this tile`
        : ramp
          ? `${groupLabel(ramp)}’s shade ramp (animated tiles)`
          : 'this tile’s shared paint (every copy of the pattern)';
    const owning = g || members[0] || null;
    const extra = { details, why, fix: owning ? select(owning) : null, groupId: owning?.id ?? null };
    // The order decides it: offer to let the runner-up win (src/group-order.js moves it ahead).
    if (rivals.length) {
      extra.reorder = { kind: 'move-before', groupId: rivals[0].id, beforeId: match.group.id, label: `Let ${groupLabel(rivals[0])} win` };
    }
    if (clearPixel) return result('uncoloured', `Not coloured: the tile is painted (by ${source}), but this pixel of it was left clear.`, extra);
    return result('coloured', `Coloured by ${source}.`, extra);
  }

  // Nothing coloured it: name the reasons, most useful first.
  /** @type {Array<{ text: string, fix: ExplainFix | null, groupId: string | null }>} */
  const reasons = [];
  for (const g of allGroups) {
    if (!paintsTile(g)) continue;
    const miss = groupMiss(matchDraw, g, hash);
    if (!miss) {
      if (!shown.includes(g)) reasons.push({ text: `${groupLabel(g)} paints this tile, but ${offHere(g)}.`, fix: select(g), groupId: g.id });
      continue;
    }
    if (miss.miss === 'world' && matchDraw.world != null && miss.worlds) {
      reasons.push({
        text: `${groupLabel(g)} paints this tile, but only on world ${listWorlds(miss.worlds)}; here it is drawn on world ${matchDraw.world}.`,
        fix: { kind: 'add-world', groupId: g.id, world: Number(matchDraw.world), label: `Add world ${matchDraw.world} to ${groupLabel(g)}` },
        groupId: g.id,
      });
    } else if (miss.miss === 'layer') {
      reasons.push({ text: `${groupLabel(g)} paints this tile, but on another kind of layer; here it is drawn as a ${layerName}.`, fix: select(g), groupId: g.id });
    } else if (miss.miss === 'pattern') {
      reasons.push({ text: `${groupLabel(g)} has paint for this tile but does not include it.`, fix: select(g), groupId: g.id });
    }
  }
  for (const g of members) {
    if (!paintsTile(g)) reasons.push({ text: `This tile is in ${groupLabel(g)}, but it is not painted yet.`, fix: select(g), groupId: g.id });
  }
  // Overpaint on this layer that is off on this frame, or does not reach this spot.
  if (windows && details.layer === 0) {
    const active = arts();
    for (const a of active.filter((e) => e.world === d.world)) {
      const geo = layerGeometry(windows, a.world, eye);
      if (!geo) continue;
      const mx = geo.sx(x);
      const my = geo.sy(y);
      if (((mx - a.art.mapX) & geo.maskX) < a.art.width && ((my - a.art.mapY) & geo.maskY) < a.art.height) continue;
      const parent = allGroups.find((g) => g.id === (a.group.poseOf || a.group.id)) || a.group;
      reasons.push({
        text: `${groupLabel(a.group)}’s overpaint is on this layer but does not reach here: it covers map x ${a.art.mapX}–${a.art.mapX + a.art.width - 1}, y ${a.art.mapY}–${a.art.mapY + a.art.height - 1}; this spot is map x ${mx}, y ${my}.`,
        fix: select(parent),
        groupId: parent.id,
      });
    }
    const showing = new Set(active.map((a) => a.group.id));
    for (const g of members) {
      const own = layerArtOf(g);
      if (own && own.world === matchDraw.world && !showing.has(g.id)) {
        reasons.push({
          text: shown.includes(g)
            ? `${groupLabel(g)} has overpaint on this layer, but none of its own tiles are on screen here, so it is off.`
            : `${groupLabel(g)} has overpaint on this layer, but ${offHere(g)}.`,
          fix: select(g),
          groupId: g.id,
        });
      }
      const poses = posePictureGroups(g).filter((pg) => layerArtOf(pg)?.world === matchDraw.world);
      if (poses.length && !poses.some((pg) => showing.has(pg.id))) {
        reasons.push({ text: `${groupLabel(g)} has ${poses.length} pose picture(s) on this layer, but no saved pose of it is wholly on screen here.`, fix: select(g), groupId: g.id });
      }
    }
  }
  if (!reasons.length) {
    reasons.push({
      text: `nothing paints this tile (${hex(hash)}): no group includes it, and it has no shared paint.`,
      fix: { kind: 'new-group', label: 'New group from this tile…' },
      groupId: null,
    });
  }
  const why = reasons.slice(1).map((r) => r.text);
  if (twin) why.push('This is the right eye’s copy of a layer: where the left eye is coloured, it takes the left eye’s colour.');
  return result('uncoloured', `Not coloured: ${reasons[0].text}`, { details, why, fix: reasons[0].fix, groupId: reasons[0].groupId });
}
