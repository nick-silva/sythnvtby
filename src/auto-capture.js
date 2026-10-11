/**
 * Auto-capture: notice tile patterns that no captured frame shows yet, so the
 * emulator can stop on exactly the frame that has one. You choose what to watch:
 * background tiles, sprite (OBJ) tiles, scaled (affine) tiles, or any mix.
 *
 * "Captured" means the pattern appears in some frame already in the pack — not
 * that it belongs to a group. The mode is meant for after a first manual pass,
 * to catch the poses that are hard to land on by hand. Left eye only: both eyes
 * almost always carry the same tiles, and checking both would double the stops.
 */
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { affineWorlds, sampleAffineWorld } from './affine-world.js';

export const BG_LAYER = 0;
export const AFFINE_LAYER = 1;
export const OBJ_LAYER = 2;
export const AUTO_CAPTURE_EYE = 0;

/** @typedef {'bg'|'obj'|'affine'} CaptureKind */

/** Every kind auto-capture can watch, in the order the chooser lists them. */
export const CAPTURE_KINDS = Object.freeze(/** @type {CaptureKind[]} */ (['bg', 'obj', 'affine']));

/** Words for each kind in the status line and messages. */
export const CAPTURE_KIND_LABELS = Object.freeze({ bg: 'background', obj: 'sprite', affine: 'scaled' });

const TILE_PX = 8;

/**
 * Non-blank tile patterns one draw-list layer shows on one eye, with the draws that show each.
 * @param {{ drawList?: any[], patternTable?: Uint8Array } | null | undefined} state
 * @param {number} layer
 * @param {number} eye
 * @returns {Map<number, any[]>}
 */
function layerTilesByHash(state, layer, eye) {
  /** @type {Map<number, any[]>} */
  const out = new Map();
  if (!state?.drawList?.length || !state.patternTable) return out;
  /** @type {Map<number, number|null>} tile index → hash, or null for a blank tile */
  const byIndex = new Map();
  for (const d of state.drawList) {
    if ((d?.eye ?? 0) !== eye || Number(d.layer) !== layer) continue;
    let h = byIndex.get(d.tileIndex);
    if (h === undefined) {
      const bytes = getTileBytes(state.patternTable, d.tileIndex);
      h = isBlankTile(bytes) ? null : hashTile(bytes) >>> 0;
      byIndex.set(d.tileIndex, h);
    }
    if (h === null) continue;
    const list = out.get(h);
    if (list) list.push(d);
    else out.set(h, [d]);
  }
  return out;
}

/**
 * Non-blank OBJ tile patterns on one eye, with the draws that show each.
 * @param {{ drawList?: any[], patternTable?: Uint8Array } | null | undefined} state
 * @param {number} [eye]
 * @returns {Map<number, any[]>}
 */
export function objTilesByHash(state, eye = AUTO_CAPTURE_EYE) {
  return layerTilesByHash(state, OBJ_LAYER, eye);
}

/**
 * Patterns the scaled (affine) worlds light on one eye. The draw list cannot say this — the core
 * records an affine tile only where a pixel reads its corner — so each world is sampled as the VIP
 * does. A pattern's "draws" are the 8×8 screen cells where it lights a pixel, for the highlight.
 * @param {any} state
 * @param {number} [eye]
 * @returns {Map<number, Array<{ x: number, y: number, world: number, layer: number, tileIndex: number }>>}
 */
export function affineTilesByHash(state, eye = AUTO_CAPTURE_EYE) {
  /** @type {Map<number, any[]>} */
  const out = new Map();
  if (!state?.patternTable) return out;
  /** @type {Map<number, number>} character → hash */
  const hashOfChar = new Map();
  for (const world of affineWorlds(state, eye)) {
    /** @type {Map<number, Set<number>>} character → screen cells (cy * 64 + cx) it lights */
    const cells = new Map();
    sampleAffineWorld(state, world, eye, (x, y, ch, _tx, _ty, pixel) => {
      if (!pixel) return;
      let set = cells.get(ch);
      if (!set) cells.set(ch, (set = new Set()));
      set.add(((y / TILE_PX) | 0) * 64 + ((x / TILE_PX) | 0));
    });
    for (const [ch, set] of cells) {
      let h = hashOfChar.get(ch);
      if (h === undefined) hashOfChar.set(ch, (h = hashTile(getTileBytes(state.patternTable, ch)) >>> 0));
      const list = out.get(h) || [];
      for (const c of set) list.push({ x: (c % 64) * TILE_PX, y: ((c / 64) | 0) * TILE_PX, world, layer: AFFINE_LAYER, tileIndex: ch });
      out.set(h, list);
    }
  }
  return out;
}

/**
 * Patterns of one kind on one eye, with where each shows.
 * @param {any} state @param {CaptureKind} kind @param {number} [eye]
 * @returns {Map<number, any[]>}
 */
export function tilesByHash(state, kind, eye = AUTO_CAPTURE_EYE) {
  if (kind === 'affine') return affineTilesByHash(state, eye);
  return layerTilesByHash(state, kind === 'obj' ? OBJ_LAYER : BG_LAYER, eye);
}

/** @typedef {Record<CaptureKind, Set<number>>} Coverage */

/** @returns {Coverage} */
export function emptyCoverage() {
  return { bg: new Set(), obj: new Set(), affine: new Set() };
}

/** Total patterns a coverage holds for the given kinds. */
export function coverageSize(coverage, kinds = CAPTURE_KINDS) {
  return kinds.reduce((n, k) => n + (coverage?.[k]?.size ?? 0), 0);
}

/**
 * Add the patterns a frame shows to the coverage. Every kind is recorded, watched or not, so
 * switching what you watch later still knows what was captured. Returns how many were new.
 * @param {Coverage} coverage @param {any} state @param {number} [eye]
 */
export function addStateToCoverage(coverage, state, eye = AUTO_CAPTURE_EYE) {
  let added = 0;
  for (const kind of CAPTURE_KINDS) {
    for (const h of tilesByHash(state, kind, eye).keys()) {
      if (coverage[kind].has(h)) continue;
      coverage[kind].add(h);
      added++;
    }
  }
  return added;
}

/**
 * Coverage from frames already captured.
 * @param {Array<any>} states deserialized VIP states
 * @returns {Coverage}
 */
export function buildCoverage(states, eye = AUTO_CAPTURE_EYE) {
  const coverage = emptyCoverage();
  for (const s of Array.isArray(states) ? states : []) addStateToCoverage(coverage, s, eye);
  return coverage;
}

/**
 * Patterns of the watched kinds on this frame that no captured frame shows yet.
 * @param {any} state @param {Coverage} coverage @param {readonly CaptureKind[]} [kinds]
 * @returns {Array<{ kind: CaptureKind, hash: number, draws: any[] }>}
 */
export function findUncoveredTiles(state, coverage, kinds = ['obj'], eye = AUTO_CAPTURE_EYE) {
  const out = [];
  for (const kind of kinds) {
    for (const [hash, draws] of tilesByHash(state, kind, eye)) {
      if (!coverage[kind].has(hash)) out.push({ kind, hash, draws });
    }
  }
  return out;
}

/**
 * The kinds to watch, cleaned up: known kinds only, in chooser order, never empty (sprites, as
 * before the chooser existed).
 * @param {unknown} raw
 * @returns {CaptureKind[]}
 */
export function normalizeCaptureKinds(raw) {
  const wanted = new Set(Array.isArray(raw) ? raw : []);
  const kinds = CAPTURE_KINDS.filter((k) => wanted.has(k));
  return kinds.length ? kinds : ['obj'];
}

/**
 * "sprite", "background and sprite", "background, sprite and scaled" — for messages.
 * @param {readonly CaptureKind[]} kinds
 */
export function describeCaptureKinds(kinds) {
  const words = kinds.map((k) => CAPTURE_KIND_LABELS[k]);
  if (words.length <= 1) return words[0] || '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * How many new patterns of each kind, for the stop message: "2 new sprite tile(s), 1 new scaled tile(s)".
 * @param {Array<{ kind: CaptureKind }>} uncovered
 */
export function describeUncovered(uncovered) {
  const counts = new Map();
  for (const u of uncovered) counts.set(u.kind, (counts.get(u.kind) || 0) + 1);
  return CAPTURE_KINDS.filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} new ${CAPTURE_KIND_LABELS[k]} tile(s)`)
    .join(', ');
}
