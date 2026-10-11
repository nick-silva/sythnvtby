/**
 * How much of a frame is still uncoloured, measured on the same colour composite the tools show
 * (src/color-layer.js), so group paint, sprite paint, layer art and touch-ups all count:
 * - `tiles`: tile patterns the frame shows that have no paint at all (never coloured);
 * - `pixels`: pixels the game lights that nothing colours (partly painted tiles included).
 * Left eye only, as auto-capture does: both eyes almost always carry the same tiles.
 */
import { compositeColorFrame, getCompositePixelInfo } from './color-layer.js';
import { getTileBytes, hashTile } from './vip-state.js';
import { colourOptions } from './project.js';

const W = 384;
const H = 224;
/** `bare` value for a pixel whose tile has no paint at all (1 is a clear pixel of a painted tile). */
const NO_PAINT = 2;

/** @type {{ data: Uint8ClampedArray, width: number, height: number } | null} */
let scratch = null;
/** Characters (pattern slots) with no paint at all, from the last {@link uncolouredMasks}. */
let lastUnpaintedCharacters = /** @type {Set<number>} */ (new Set());

/**
 * Count from a composite's per-pixel info (getCompositePixelInfo): a pixel counts when its front
 * pattern lights it and neither paint nor a picture (layer art, touch-up) coloured it; a tile
 * counts when its pattern has no paint at all wherever the frame shows it (a painted tile peeking
 * out with one clear pixel does not).
 * @param {any} state @param {{ bare: Uint8Array, char: Int16Array, art?: Uint8Array | null }} info
 * @returns {{ tiles: number, pixels: number }}
 */
export function countUncoloured(state, info) {
  const { tiles, pixels } = uncolouredMasks(state, info);
  return { tiles, pixels };
}

/**
 * Where a composite is uncoloured, per screen pixel (same rules as {@link countUncoloured}):
 * `pixelMask` marks every lit pixel nothing colours; `tileMask` only those of patterns with no
 * paint at all. For the Project tool's Highlight toggle.
 * @param {any} state @param {{ bare: Uint8Array, char: Int16Array, art?: Uint8Array | null }} info
 * @returns {{ pixelMask: Uint8Array, tileMask: Uint8Array, tiles: number, pixels: number }}
 */
export function uncolouredMasks(state, { bare, char, art }) {
  const pixelMask = new Uint8Array(W * H);
  const tileMask = new Uint8Array(W * H);
  /** @type {Map<number, number>} character → pixels the frame shows of it */
  const shown = new Map();
  /** @type {Map<number, number>} character → of those, uncoloured */
  const bareOf = new Map();
  let pixels = 0;
  for (let i = 0; i < W * H; i++) {
    const ch = char[i];
    if (ch < 0) continue;
    shown.set(ch, (shown.get(ch) || 0) + 1);
    if (!bare[i] || (art && art[i])) continue;
    pixels++;
    pixelMask[i] = 1;
    if (bare[i] === NO_PAINT) bareOf.set(ch, (bareOf.get(ch) || 0) + 1);
  }
  const unpainted = new Set();
  const patterns = new Set();
  for (const [ch, n] of shown) {
    if (bareOf.get(ch) !== n) continue;
    unpainted.add(ch);
    patterns.add(hashTile(getTileBytes(state.patternTable, ch)) >>> 0);
  }
  lastUnpaintedCharacters = unpainted;
  if (unpainted.size) {
    for (let i = 0; i < W * H; i++) if (pixelMask[i] && unpainted.has(char[i])) tileMask[i] = 1;
  }
  return { pixelMask, tileMask, tiles: patterns.size, pixels };
}

/** Highlight colour for uncoloured pixels: cyan, which neither paint nor the red "unpainted" ramp tends to use. */
export const HIGHLIGHT_RGB = Object.freeze([0, 255, 255]);
/** How much of everything else's brightness is kept while highlighting. */
const HIGHLIGHT_DIM = 0.3;

/**
 * Mark the masked pixels of a composite in {@link HIGHLIGHT_RGB} (keeping a little of their shading)
 * and dim the rest, so what is missing stands out. Changes `imageData` in place, as the compositor
 * does. Returns the number of pixels marked.
 * @param {{ data: Uint8ClampedArray }} imageData 384×224 RGBA
 * @param {Uint8Array} mask from {@link uncolouredMasks}
 */
export function highlightUncoloured(imageData, mask) {
  const d = imageData.data;
  const [hr, hg, hb] = HIGHLIGHT_RGB;
  let marked = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (mask[i]) {
      const shade = 0.55 + (0.45 * (d[o] + d[o + 1] + d[o + 2])) / 765;
      d[o] = hr * shade;
      d[o + 1] = hg * shade;
      d[o + 2] = hb * shade;
      d[o + 3] = 255;
      marked++;
    } else {
      d[o] *= HIGHLIGHT_DIM;
      d[o + 1] *= HIGHLIGHT_DIM;
      d[o + 2] *= HIGHLIGHT_DIM;
    }
  }
  return marked;
}

/**
 * @param {any} state deserialized VIP state
 * @param {{ pack?: Map<number, Uint8Array>, overrides?: any[], groups?: any[], gameStatePools?: unknown,
 *   painterV2Rules?: unknown, variantId?: string|null, wram?: Uint8Array|null }} [paint] what colours the frame, as the tools
 *   hold it, and the frame's memory (for groups limited to some screens)
 * @returns {{ tiles: number, pixels: number }}
 */
export function measureUncoloured(state, paint = {}) {
  if (!state?.drawList?.length || !state.patternTable) return { tiles: 0, pixels: 0 };
  compositeForMeasure(state, paint);
  const { bare, char, art } = getCompositePixelInfo();
  return countUncoloured(state, { bare, char, art });
}

/**
 * The frame's draws (left eye) whose pattern has no paint at all, by pattern — what
 * {@link measureUncoloured} counts as `tiles`, with where each shows. For auto-capture's
 * "where paint doesn't cover" watch (src/paint-gaps.js).
 * @param {any} state @param {Parameters<typeof measureUncoloured>[1]} [paint]
 * @returns {Map<number, any[]>} pattern hash → draws
 */
export function unpaintedTileDraws(state, paint = {}) {
  const out = new Map();
  if (!state?.drawList?.length || !state.patternTable) return out;
  compositeForMeasure(state, paint);
  const { bare, char, art } = getCompositePixelInfo();
  uncolouredMasks(state, { bare, char, art });
  if (!lastUnpaintedCharacters.size) return out;
  for (const d of state.drawList) {
    if ((Number(d.eye) === 1 ? 1 : 0) !== 0 || !lastUnpaintedCharacters.has(d.tileIndex)) continue;
    const h = hashTile(getTileBytes(state.patternTable, d.tileIndex)) >>> 0;
    if (!out.has(h)) out.set(h, []);
    out.get(h).push(d);
  }
  return out;
}

/** Composite the frame's left eye the way the tools show it, filling getCompositePixelInfo. */
function compositeForMeasure(state, { pack, overrides = [], groups = [], gameStatePools = null, painterV2Rules = null, variantId = null, wram = null } = {}) {
  scratch ||= { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  // Measured the way every app draws (src/project.js, view `measure`): the frame's memory picks its
  // screens and game states, so groups limited to other screens leave their tiles uncoloured here.
  compositeColorFrame(state, pack || new Map(), scratch, colourOptions({ overrides, groups, gameStatePools, painterV2Rules }, 'measure', { wram, painterV2VariantId: variantId }));

}

/** Frame list filters: which frames each one keeps. */
export const UNCOLOURED_FILTERS = Object.freeze({
  all: { label: 'All frames', keep: () => true },
  tiles: { label: 'Frames with uncoloured tiles', keep: (m) => m.tiles > 0 },
  pixels: { label: 'Frames with uncoloured pixels', keep: (m) => m.pixels > 0 },
});

/** A short note for a frame's measurement, e.g. "3 uncoloured tiles · 412 px". */
export function describeUncoloured(m) {
  if (!m) return '';
  if (!m.pixels) return 'fully coloured';
  const tiles = m.tiles ? `${m.tiles} uncoloured tile${m.tiles === 1 ? '' : 's'} · ` : '';
  return `${tiles}${m.pixels} uncoloured px`;
}
