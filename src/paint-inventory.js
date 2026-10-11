/**
 * An inventory of every colour in a project and where it lives.
 *
 * Colour ends up in two places. A BG group keeps its own colours in `tileColors`, scoped to
 * the draws its criteria claim. Everything else goes to the shared `.vbcolor` pack, keyed by
 * pattern hash alone, which colours every copy of that pattern on every frame.
 *
 * The second kind is easy to lose track of. A pattern painted with no group selected, or one
 * that no group's criteria mention, belongs to nothing — the group panel's *Clear paint* can
 * never reach it, because that works through a group's hash list. This module finds those, so
 * the tools can show them and offer to clear them.
 */

import { decodeGroupTileColors } from './group-tile-colors.js';
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';

/** @typedef {'group'|'pack'|'overlay'} PaintSource */

export const PAINT_SOURCE = /** @type {const} */ ({ GROUP: 'group', PACK: 'pack', OVERLAY: 'overlay' });

const FRAME_W = 384;
const FRAME_H = 224;

/**
 * What an anchored group's full-frame overlay actually covers: the painted pixels, how many
 * 8×8 cells they land in, and the box around them.
 * @param {Uint8Array} buf RGBA, 384×224
 */
function overlayCoverage(buf) {
  if (!buf || buf.length !== FRAME_W * FRAME_H * 4) return null;
  /** @type {Map<number, number>} cell index → painted pixels in it */
  const cells = new Map();
  let pixels = 0;
  let x0 = FRAME_W;
  let y0 = FRAME_H;
  let x1 = -1;
  let y1 = -1;
  const cols = FRAME_W >> 3;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (buf[(y * FRAME_W + x) * 4 + 3] === 0) continue;
      pixels++;
      const cell = (y >> 3) * cols + (x >> 3);
      cells.set(cell, (cells.get(cell) || 0) + 1);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { pixels, cells, box: { x0, y0, x1, y1 } };
}

/** The hashes a group's criteria name, as a Set of unsigned ints. */
function criteriaHashSet(group) {
  const raw = group?.criteria?.hashes;
  const out = new Set();
  if (!Array.isArray(raw)) return out;
  for (const h of raw) {
    const n = Number(h);
    if (Number.isFinite(n)) out.add(n >>> 0);
  }
  return out;
}

/**
 * Which pattern sits under each 8×8 screen cell, so a positional overlay cell can name the
 * tile it is colouring. Front-most draw wins, matching how the compositor paints.
 *
 * @param {{ patternTable?: Uint8Array, drawList?: Array<any> }|null|undefined} state
 * @param {number} eye
 * @returns {Map<number, number>} cell index (row-major, 48×28) → pattern hash
 */
function hashByCell(state, eye) {
  /** @type {Map<number, number>} */
  const byCell = new Map();
  if (!state?.drawList || !state.patternTable) return byCell;
  const cols = FRAME_W >> 3;
  /** @type {Map<number, number>} */
  const hashByTileIndex = new Map();
  for (const d of state.drawList) {
    if (!d || (d.eye ?? 0) !== eye) continue;
    let h = hashByTileIndex.get(d.tileIndex);
    if (h === undefined) {
      const bytes = getTileBytes(state.patternTable, d.tileIndex);
      h = !bytes || isBlankTile(bytes) ? -1 : hashTile(bytes) >>> 0;
      hashByTileIndex.set(d.tileIndex, h);
    }
    if (h < 0) continue;
    // A draw need not sit on the 8-pixel grid, so it can touch two cells on each axis.
    for (const py of [d.y, d.y + 7]) {
      for (const px of [d.x, d.x + 7]) {
        if (px < 0 || px >= FRAME_W || py < 0 || py >= FRAME_H) continue;
        byCell.set((py >> 3) * cols + (px >> 3), h);
      }
    }
  }
  return byCell;
}

/**
 * Where each pattern is drawn on one frame: how many draws use it, and in which worlds.
 * @param {{ patternTable?: Uint8Array, drawList?: Array<any> }|null|undefined} state
 * @param {number} eye
 */
function drawUsageByHash(state, eye) {
  /** @type {Map<number, { draws: number, worlds: Set<number> }>} */
  const byHash = new Map();
  if (!state?.drawList || !state.patternTable) return byHash;
  /** @type {Map<number, number>} */
  const hashByTileIndex = new Map();
  for (const d of state.drawList) {
    if (!d || (d.eye ?? 0) !== eye) continue;
    let h = hashByTileIndex.get(d.tileIndex);
    if (h === undefined) {
      const bytes = getTileBytes(state.patternTable, d.tileIndex);
      h = !bytes || isBlankTile(bytes) ? -1 : hashTile(bytes) >>> 0;
      hashByTileIndex.set(d.tileIndex, h);
    }
    if (h < 0) continue;
    let row = byHash.get(h);
    if (!row) byHash.set(h, (row = { draws: 0, worlds: new Set() }));
    row.draws++;
    if (d.world !== undefined && d.world !== null) row.worlds.add(Number(d.world));
  }
  return byHash;
}

/**
 * @typedef {{
 *   hash: number,
 *   rgba: Uint8Array,
 *   source: PaintSource,
 *   groupId: string|null,
 *   groupName: string|null,
 *   claimedBy: Array<{ id: string, name: string }>,
 *   orphan: boolean,
 *   draws: number,
 *   worlds: number[],
 * }} PaintInventoryEntry
 */

/**
 * Every painted pattern, with where its colour is stored and which groups could reach it.
 *
 * `orphan` marks a pack colour that no group's criteria mention: nothing in the group panel
 * can clear it, so the tools have to offer that directly.
 *
 * @param {{
 *   pack?: Map<number, Uint8Array>,
 *   groups?: Array<any>,
 *   state?: any,
 *   eye?: number,
 *   overlays?: Map<string, Map<number, Uint8Array>>,
 * }} opts
 * @returns {{ entries: PaintInventoryEntry[], totals: { total: number, group: number, pack: number, overlay: number, orphan: number, onFrame: number } }}
 */
export function buildPaintInventory({ pack, groups, state, eye = 0, overlays } = {}) {
  const groupList = Array.isArray(groups) ? groups.filter((g) => g && typeof g.id === 'string') : [];
  const usage = drawUsageByHash(state, eye);

  // Which groups name each hash in their criteria — the only route the group panel has to it.
  /** @type {Map<number, Array<{ id: string, name: string }>>} */
  const claimants = new Map();
  for (const g of groupList) {
    const label = { id: g.id, name: g.name || g.id };
    for (const h of criteriaHashSet(g)) {
      const list = claimants.get(h);
      if (list) list.push(label);
      else claimants.set(h, [label]);
    }
  }

  /** @type {PaintInventoryEntry[]} */
  const entries = [];
  const add = (hash, rgba, source, group) => {
    const use = usage.get(hash);
    entries.push({
      hash,
      rgba,
      source,
      groupId: group ? group.id : null,
      groupName: group ? group.name || group.id : null,
      claimedBy: claimants.get(hash) || [],
      orphan: source === PAINT_SOURCE.PACK && !claimants.has(hash),
      draws: use ? use.draws : 0,
      worlds: use ? [...use.worlds].sort((a, b) => a - b) : [],
    });
  };

  for (const g of groupList) {
    for (const [hash, rgba] of decodeGroupTileColors(g)) add(hash, rgba, PAINT_SOURCE.GROUP, g);
  }
  if (pack instanceof Map) {
    for (const [hash, rgba] of pack) add(hash >>> 0, rgba, PAINT_SOURCE.PACK, null);
  }

  // An anchored group paints a positioned full-frame overlay instead of per-pattern colours.
  // There is no pattern to key it by, but leaving it out made a group that had been painted
  // entirely this way look unpainted. One row per group and eye, counted as on-frame when its
  // anchor pattern is here — which is exactly when the overlay renders.
  if (overlays instanceof Map) {
    const cols = FRAME_W >> 3;
    const under = hashByCell(state, eye & 1);
    for (const [groupId, byEye] of overlays) {
      const g = groupList.find((x) => x.id === groupId);
      for (const [overlayEye, buf] of byEye instanceof Map ? byEye : []) {
        if ((overlayEye & 1) !== (eye & 1)) continue;
        const cover = overlayCoverage(buf);
        if (!cover) continue;
        const anchor = typeof g?.anchorHash === 'number' ? g.anchorHash >>> 0 : null;
        const anchorUse = anchor !== null ? usage.get(anchor) : null;
        // One 8×8 cell per painted tile, so every painted tile is addressable on its own
        // even though the overlay itself is one image with no per-pattern structure.
        const cellList = [...cover.cells]
          .map(([cell, pixels]) => ({
            x: (cell % cols) * 8,
            y: ((cell / cols) | 0) * 8,
            pixels,
            hash: under.has(cell) ? under.get(cell) : null,
          }))
          .sort((a, b) => a.y - b.y || a.x - b.x);
        entries.push({
          hash: null,
          rgba: buf,
          source: PAINT_SOURCE.OVERLAY,
          groupId,
          groupName: g ? g.name || g.id : groupId,
          claimedBy: [],
          orphan: false,
          draws: anchorUse ? anchorUse.draws : 0,
          worlds: anchorUse ? [...anchorUse.worlds].sort((a, b) => a - b) : [],
          eye: overlayEye & 1,
          pixels: cover.pixels,
          cells: cover.cells.size,
          cellList,
          box: cover.box,
        });
      }
    }
  }

  // The order someone opening this panel wants: what can I not get at, what is on screen,
  // and — because one overlay row can stand for dozens of painted cells — the whole-group
  // rows above the long tail of individual patterns, where they would otherwise be buried.
  const sourceRank = { [PAINT_SOURCE.OVERLAY]: 0, [PAINT_SOURCE.GROUP]: 1, [PAINT_SOURCE.PACK]: 2 };
  entries.sort((a, b) => {
    if (a.orphan !== b.orphan) return a.orphan ? -1 : 1;
    if ((a.draws > 0) !== (b.draws > 0)) return a.draws > 0 ? -1 : 1;
    if (a.source !== b.source) return sourceRank[a.source] - sourceRank[b.source];
    if (a.draws !== b.draws) return b.draws - a.draws;
    return (a.hash ?? -1) - (b.hash ?? -1);
  });

  return {
    entries,
    totals: {
      total: entries.length,
      group: entries.filter((e) => e.source === PAINT_SOURCE.GROUP).length,
      pack: entries.filter((e) => e.source === PAINT_SOURCE.PACK).length,
      overlay: entries.filter((e) => e.source === PAINT_SOURCE.OVERLAY).length,
      orphan: entries.filter((e) => e.orphan).length,
      onFrame: entries.filter((e) => e.draws > 0).length,
    },
  };
}
