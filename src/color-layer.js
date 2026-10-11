/**
 * Colorization layer: given VIP state and a .vbcolor pack, composite a 384×224 RGB framebuffer.
 * Uses optional state.drawList from a patched core; without drawList no color output.
 * Supports position-based overrides (same hash, different color in a rectangle).
 */

import { setProjectGameStates } from './game-states.js';
import { stereoTwins } from './stereo-twin.js';
import { rgbaFromShadeRamp } from './shade-ramp.js';
import { getTileBytes, hashTile, isBlankTile, BYTES_PER_TILE } from './vip-state.js';
import { parseVBColorPack } from './vbcolor-pack.js';
import { compositeStereo, getStereoOutputSize } from './stereo-output.js';
import { tryCopyVBSystemRamFromEmulator } from './vb-emulator-ram.js';
import { getBgAffineWorldClipRect, getWindowsTableBytesFromState } from './vip-world-clip.js';
import { affineWorlds, sampleAffineWorld } from './affine-world.js';

/** Pattern hash of a tile with every pixel see-through. */
const BLANK_TILE_HASH = hashTile(new Uint8Array(16)) >>> 0;
import { recoverClippedBgDraws } from './vip-edge-tiles.js';
import { activeLayerArts, paintLayerArt } from './layer-art.js';
import { activeTouchUps, paintTouchUp, affineTouchUps, paintAffineTouchUp } from './touch-up.js';
import { affineOverpaints, paintAffineOverpaint } from './overpaint.js';
import { groupsForScreen } from './screen-gate.js';
import { parsePainterV2VipOverlaysJson, blendPainterV2VipOverlaysIntoImageData } from './painter-v2-vip-overlay.js';
import { decodeGroupTileColors } from './group-tile-colors.js';
import { fadeFactor, FADE_RESPONSE_DEFAULT } from './fade.js';
// project.js imports this module too; colourOptions is only called while drawing, after both load.
import { colourOptions } from './project.js';

const W = 384;
const H = 224;

/** Recycled per-frame: how many draw calls cover each pixel after VIP clips (for no-pack Z fallback). */
let _drawCoverageScratch = /** @type {Uint16Array | null} */ (null);

/**
 * Recycled per-frame: the index of the front-most lit draw at each pixel, or -1.
 *
 * Anchored overlays are blended after the frame is composited, so without this they paint over
 * whatever is in front of them — a sprite walking behind a foreground platform came out hidden
 * by the platform's paint. Filled here because the draw loop already visits every lit pixel in
 * back-to-front order, so the last writer is by definition the front-most one.
 */
let _drawOwnerScratch = /** @type {Int32Array | null} */ (null);

/**
 * Who owns each pixel of the frame just composited. Valid until the next
 * {@link compositeColorFrame} call, which is why the caller blends overlays for one eye before
 * compositing the other.
 *
 * @returns {Int32Array | null} indices into that frame's `drawList`, or -1 where nothing lit it
 */
export function getCompositeDrawOwners() {
  return _drawOwnerScratch;
}

/**
 * Per pixel of the last composite: the front shade (0–3, +STEREO_UNPAINTED when no paint
 * coloured it, 0xff where nothing lit it) and the world that drew it (−1 for none). The right
 * eye borrows colour from the left through these (see `stereoSource` on compositeColorFrame).
 */
let _pixShadeScratch = /** @type {Uint8Array | null} */ (null);
let _pixWorldScratch = /** @type {Int8Array | null} */ (null);
/** 1 where layer art or a touch-up drew, 2 where the right eye took colour from the left; last composite. */
let _pixArtScratch = /** @type {Uint8Array | null} */ (null);
/**
 * Per pixel of the last composite, for measuring what is left to colour (src/uncoloured.js):
 * where the frame's front pixel is lit but no paint coloured it, 2 when its tile has no paint at
 * all and 1 for a clear pixel of a painted tile (0 otherwise); and the pattern (character) that
 * drew it, −1 for none.
 * Recorded only; nothing reads them while compositing.
 */
let _pixBareScratch = /** @type {Uint8Array | null} */ (null);
let _pixCharScratch = /** @type {Int16Array | null} */ (null);
/** Worlds that had a touch-up drawn on them, last composite. */
let _touchedWorlds = /** @type {Set<number>} */ (new Set());
/** Flag in a pixel's shade: no paint coloured it. */
export const STEREO_UNPAINTED = 0x80;
/** How far across, either way, to look for the left copy's pixel (the art's depth inside a layer). */
const STEREO_SEARCH = 8;

/** @returns {{ shade: Uint8Array | null, world: Int8Array | null, art: Uint8Array | null, touched: Set<number>, bare: Uint8Array | null, char: Int16Array | null }} */
export function getCompositePixelInfo() {
  return { shade: _pixShadeScratch, world: _pixWorldScratch, art: _pixArtScratch, touched: _touchedWorlds, bare: _pixBareScratch, char: _pixCharScratch };
}

/** Cleared at start of each `compositeColorFrame`; maps tileIndex → fnv hash for that invocation. */
let _tileHashValid = /** @type {Uint8Array | null} */ (null);
let _tileHashVal = /** @type {Uint32Array | null} */ (null);

/** Same per-invocation caching for "is this tile entirely palette 0" (most BG cells are). */
let _tileBlankValid = /** @type {Uint8Array | null} */ (null);
let _tileBlankVal = /** @type {Uint8Array | null} */ (null);

/** Default scale for core masterBrightness so color layer matches mono fade. Use in main app, paint tool, and viewer. */
export const DEFAULT_FADE_RESPONSE = FADE_RESPONSE_DEFAULT;

/**
 * Unpainted pixels in the tools' preview, per VB shade: the same greys a tile's paint starts from
 * in SpriteStudio (src/starter-paint.js), so the first stroke on a tile changes only that pixel.
 */
const FALLBACK_GREYS = Object.freeze([0, 80, 160, 240]);

/** First variant id from schema v2 `gameStatePools` (Painter v2 `tile8ByVariant` bucket when none selected in UI). */
export function suggestedPainterV2VariantId(gameStatePools) {
  const pools = Array.isArray(gameStatePools) ? gameStatePools : [];
  for (const p of pools) {
    const variants = p?.variants;
    if (!Array.isArray(variants) || variants.length === 0) continue;
    const v = variants[0];
    const id = typeof v?.id === 'string' ? v.id.trim() : '';
    if (id) return id;
  }
  return '__default__';
}

/**
 * @typedef {{
 *   hash: number,
 *   xMin: number,
 *   yMin: number,
 *   xMax: number,
 *   yMax: number,
 *   layer?: number,
 *   groupId?: string,
 *   ramConditions?: Array<{ offset: number, expectedValue: number, stateName?: string, source?: string }>,
 *   rgba?: Uint8Array,
 *   alternateHash?: number
 * }} PositionOverride
 * layer: 0=BG, 1=Affine, 2=OBJ; when set, override applies only when draw.layer === layer.
 * groupId: when set, override applies only when draw is in that group (evaluated in paint tool / app when groups are loaded).
 */

/**
 * Parse a position-override list from JSON (e.g. from .vbcolor-overrides.json).
 * Each entry: { hash, xMin, yMin, xMax, yMax, rgbaBase64?, alternateHash? }.
 * Returns array of PositionOverride with rgba decoded when rgbaBase64 present.
 *
 * @param {unknown} json
 * @returns {PositionOverride[]}
 */
export function parsePositionOverrides(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const item of json) {
    if (!item || typeof item.hash !== 'number') continue;
    const hash = item.hash >>> 0;
    const xMin = Number(item.xMin) || 0;
    const yMin = Number(item.yMin) || 0;
    const xMax = Number(item.xMax) ?? W;
    const yMax = Number(item.yMax) ?? H;
    let rgba;
    if (typeof item.rgbaBase64 === 'string' && item.rgbaBase64) {
      try {
        const bin = atob(item.rgbaBase64);
        const u8 = new Uint8Array(256);
        for (let i = 0; i < 256 && i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        rgba = u8;
      } catch (_) {
        continue;
      }
    }
    const alternateHash = typeof item.alternateHash === 'number' ? item.alternateHash >>> 0 : undefined;
    if (!rgba && alternateHash === undefined) continue;
    const layer = item.layer !== undefined && item.layer !== null ? (Number(item.layer) | 0) : undefined;
    const layerFilter = (layer === 0 || layer === 1 || layer === 2) ? layer : undefined;
    const groupId = typeof item.groupId === 'string' && item.groupId ? item.groupId : undefined;
    let ramConditions;
    if (Array.isArray(item.ramConditions)) {
      ramConditions = item.ramConditions
        .map((rc) => ({
          offset: Number(rc?.offset) | 0,
          expectedValue: Number(rc?.expectedValue) & 0xff,
          ...(typeof rc?.stateName === 'string' && rc.stateName ? { stateName: rc.stateName } : {}),
          ...(typeof rc?.source === 'string' && rc.source ? { source: rc.source } : {}),
        }))
        .filter((rc) => Number.isFinite(rc.offset) && rc.offset >= 0 && rc.offset < 0x10000 && Number.isFinite(rc.expectedValue));
      if (!ramConditions.length) ramConditions = undefined;
    }
    out.push({ hash, xMin, yMin, xMax, yMax, layer: layerFilter, groupId, ...(ramConditions && { ramConditions }), rgba, alternateHash });
  }
  return out;
}

/**
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   criteria?: { windowIds?: number[], worldIds?: number[], hashes?: number[], layers?: number[] },
 *   ramConditions?: Array<{ offset: number, expectedValue: number, stateName?: string, source?: string }> | Record<string, number>,
 *   statePoolId?: string,
 *   stateVariantId?: string
 * }} Group
 */

/** Non-empty conditions that never satisfy readable WRAM (invalid pool/variant ref). */
const RAM_CONDITIONS_FAIL_CLOSED = [{ offset: -1, expectedValue: 0 }];

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   universal?: boolean,
 *   analysisStateKey?: string,
 *   analysisSource?: string,
 *   variants: Array<{ id: string, label: string, ramConditions?: unknown[], analysisStateKey?: string }>
 * }} GameStatePool
 */

/**
 * Resolve WRAM recipe for a group: variant (schema v2) or legacy group.ramConditions.
 *
 * @param {Group|null|undefined} group
 * @param {unknown} gameStatePools
 * @returns {Array<{ offset: number, expectedValue: number }>|null} null = no gate; RAM_CONDITIONS_FAIL_CLOSED pattern = invalid refs (fail closed)
 */
export function resolveEffectiveRamConditionsForGroup(group, gameStatePools) {
  if (!group) return null;
  const pools = Array.isArray(gameStatePools) ? gameStatePools : [];
  const sid = typeof group.statePoolId === 'string' ? group.statePoolId.trim() : '';
  const vid = typeof group.stateVariantId === 'string' ? group.stateVariantId.trim() : '';
  if (sid && vid) {
    const pool = pools.find((p) => p && typeof p.id === 'string' && p.id === sid);
    const variant = pool?.variants?.find((v) => v && typeof v.id === 'string' && v.id === vid);
    if (!variant) return RAM_CONDITIONS_FAIL_CLOSED;
    const fromVariant = normalizeGroupRamConditionsList({ ramConditions: variant.ramConditions });
    if (fromVariant?.length) return fromVariant;
    return null;
  }
  return normalizeGroupRamConditionsList(group);
}

/**
 * Normalize group.ramConditions to a flat list (vbpack array form or legacy string-key map).
 * @param {Group|null|undefined} group
 * @returns {Array<{ offset: number, expectedValue: number }>|null}
 */
export function normalizeGroupRamConditionsList(group) {
  const rc = group?.ramConditions;
  if (Array.isArray(rc) && rc.length > 0) {
    const out = [];
    for (const c of rc) {
      const offset = Number(c?.offset) | 0;
      const expectedValue = Number(c?.expectedValue) & 0xff;
      if (Number.isFinite(offset) && offset >= 0 && offset < 0x10000) out.push({ offset, expectedValue });
    }
    return out.length ? out : null;
  }
  if (rc && typeof rc === 'object' && !Array.isArray(rc)) {
    const out = [];
    for (const [k, v] of Object.entries(rc)) {
      const ks = String(k).trim();
      const offset = /^0x[0-9a-f]+$/i.test(ks)
        ? parseInt(ks, 16) | 0
        : (Number(ks) | 0);
      if (offset >= 0 && offset < 0x10000) out.push({ offset, expectedValue: Number(v) & 0xff });
    }
    return out.length ? out : null;
  }
  return null;
}

/**
 * True when every condition matches WRAM (64 KiB CPU WRAM offsets 0..0xFFFF).
 * Empty conditions → true. Non-empty + missing/short wram → false.
 *
 * @param {Uint8Array|null|undefined} wram
 * @param {Array<{ offset: number, expectedValue: number }>|null|undefined} conditions
 */
export function ramConditionsSatisfied(wram, conditions) {
  if (!conditions || conditions.length === 0) return true;
  if (!wram || wram.byteLength < 0x10000) return false;
  for (const c of conditions) {
    const off = Number(c.offset) | 0;
    const ev = Number(c.expectedValue) & 0xff;
    if (off < 0 || off >= 0x10000) return false;
    if ((wram[off] & 0xff) !== ev) return false;
  }
  return true;
}

/**
 * @param {PositionOverride} o
 * @param {Group[]} groups
 * @param {unknown} [gameStatePools]
 */
function effectiveRamConditions(o, groups, gameStatePools) {
  if (o.groupId) {
    const g = Array.isArray(groups) ? groups.find((gr) => gr && gr.id === o.groupId) : null;
    const fromPool = resolveEffectiveRamConditionsForGroup(g, gameStatePools);
    if (fromPool === RAM_CONDITIONS_FAIL_CLOSED) return fromPool;
    if (fromPool?.length) return fromPool;
    const fromO = o.ramConditions;
    if (Array.isArray(fromO) && fromO.length > 0) {
      const out = [];
      for (const c of fromO) {
        const offset = Number(c?.offset) | 0;
        const expectedValue = Number(c?.expectedValue) & 0xff;
        if (Number.isFinite(offset) && offset >= 0 && offset < 0x10000) out.push({ offset, expectedValue });
      }
      return out.length ? out : null;
    }
    return null;
  }
  if (Array.isArray(o.ramConditions) && o.ramConditions.length > 0) return o.ramConditions;
  return null;
}

/**
 * @param {import('./vip-state.js').DrawCall} draw
 * @param {Group} group
 * @param {number} hash
 */
function drawMatchesGroup(draw, group, hash) {
  const c = normalizedCriteria(group);
  if (c.worlds) {
    const w = draw.world;
    if (w === undefined || w === null || !c.worlds.has(Number(w))) return false;
  }
  // An animated-tiles group also claims its tile slots, whatever pattern the game wrote there.
  if (c.hashes && !c.hashes.has(hash) && !(c.slots && c.slots.has(Number(draw.tileIndex)))) return false;
  if (c.layers) {
    const L = draw.layer;
    if (L === undefined || L === null) return false;
    // A background group also covers its worlds when the game scales them (affine, layer 1):
    // the same tiles switch between the two modes (the Clash Tower zoom).
    if (!c.layers.has(Number(L)) && !(Number(L) === 1 && c.layers.has(0))) return false;
  }
  return true;
}

/**
 * A group's criteria as Sets, cached on the group object.
 *
 * This runs once per draw per candidate group — thousands of times a frame in a scene of
 * repeating tiles — so it must not parse or allocate. A world-sized group holds hundreds of
 * hashes; scanning that array each time is what made whole-layer groups too slow to use.
 */
const _criteriaCache = new WeakMap();
function normalizedCriteria(group) {
  const raw = group?.criteria || null;
  let entry = _criteriaCache.get(group || EMPTY_CRITERIA_KEY);
  if (entry && entry.source === raw && entry.worldsSrc === raw?.windowIds && entry.hashesSrc === raw?.hashes && entry.layersSrc === raw?.layers && entry.slotsSrc === raw?.tileSlots) {
    return entry.value;
  }
  const toNumSet = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const out = new Set();
    for (const v of arr) {
      if (typeof v === 'number') {
        if (Number.isFinite(v)) out.add(v);
        continue;
      }
      const s = String(v ?? '').trim();
      const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : Number(s);
      if (Number.isFinite(n)) out.add(n);
    }
    return out.size ? out : null;
  };
  const value = {
    worlds: toNumSet(raw?.windowIds) ?? toNumSet(raw?.worldIds),
    hashes: toNumSet(raw?.hashes),
    layers: toNumSet(raw?.layers),
    slots: toNumSet(raw?.tileSlots),
  };
  entry = { source: raw, worldsSrc: raw?.windowIds, hashesSrc: raw?.hashes, layersSrc: raw?.layers, slotsSrc: raw?.tileSlots, value };
  if (group) _criteriaCache.set(group, entry);
  return value;
}
const EMPTY_CRITERIA_KEY = Object.freeze({});

/**
 * A group's criteria as the colour rules read them — `{ worlds, hashes, layers, slots }`, each a
 * Set or null for "any" (src/pixel-explain.js says why a group did or did not claim a draw).
 * @param {Group} group
 */
export function groupCriteriaSets(group) {
  return normalizedCriteria(group);
}

/**
 * Find first override that matches (hash, x, y, drawLayer). Returns override's RGBA or null.
 * When drawLayer is provided, overrides with o.layer set only match when o.layer === drawLayer.
 *
 * @param {PositionOverride[]} overrides
 * @param {number} hash
 * @param {number} x
 * @param {number} y
 * @param {Map<number, Uint8Array>} packEntries
 * @param {number} [drawLayer] - 0=BG, 1=Affine, 2=OBJ; when present, layer-conditioned overrides are filtered
 * @param {import('./vip-state.js').DrawCall} [draw] - required when override has groupId
 * @param {Group[]} [groups] - required when override has groupId
 * @param {unknown} [gameStatePools] - schema v2 pools from groups.json
 * @param {Uint8Array|null} [wram] - live 64 KiB WRAM for game-state gates (null = gated overrides do not apply)
 * @returns {Uint8Array | null}
 */
export function resolveOverrideRgba(overrides, hash, x, y, packEntries, drawLayer, draw, groups, gameStatePools, wram, index) {
  if (!overrides.length) return null;
  // The caller normally hands in a per-frame index; without one this rebuilds it, which is
  // why it used to cost a Map of every group on *every draw* of every frame.
  const groupById = index?.groupById ?? buildGroupIndex(groups).groupById;
  // Only the overrides that mention this pattern can match, so skip the rest of the list.
  const candidates = index ? index.byHash.get(hash) : overrides.filter((o) => o.hash === hash);
  if (!candidates || candidates.length === 0) return null;
  const tryRam = (o) => {
    const ramCond = effectiveRamConditions(o, groups || [], gameStatePools);
    if (!ramConditionsSatisfied(wram ?? null, ramCond)) return null;
    if (o.rgba) return o.rgba;
    if (o.alternateHash != null) return packEntries.get(o.alternateHash) ?? null;
    return null;
  };
  for (let i = candidates.length - 1; i >= 0; i--) {
    const o = candidates[i];
    if (o.layer !== undefined && o.layer !== null && drawLayer !== o.layer) continue;
    if (x < o.xMin || x >= o.xMax || y < o.yMin || y >= o.yMax) continue;
    if (!o.groupId) continue;
    const g = groupById?.get(o.groupId);
    if (!g || !draw || !drawMatchesGroup(draw, g, hash)) continue;
    const got = tryRam(o);
    if (got) return got;
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const o = candidates[i];
    if (o.layer !== undefined && o.layer !== null && drawLayer !== o.layer) continue;
    if (x < o.xMin || x >= o.xMax || y < o.yMin || y >= o.yMax) continue;
    if (o.groupId) continue;
    const got = tryRam(o);
    if (got) return got;
  }
  return null;
}

/**
 * True when every draw on this eye already has colour, so none can fall through to the
 * unpainted-tile path and the coverage prepass is dead work.
 *
 * Checks the pack and each draw's own group, which is exact for both. Conservative about
 * position overrides and Painter v2 rules: ignoring them only means the prepass runs when it
 * did not have to. It warms the shared blank/hash caches that the main loop reads, so it
 * nearly pays for itself.
 *
 * @param {Array<any>} drawList
 * @param {number[]} eyeIdx
 * @param {Uint8Array} patternTable
 * @param {Map<number, Uint8Array>} packEntries
 * @param {ReturnType<typeof buildGroupTileColorIndex>} groupTileColors
 */
function everyDrawHasColor(drawList, eyeIdx, patternTable, packEntries, groupTileColors) {
  const hasPack = packEntries && packEntries.size > 0;
  if (!hasPack && !groupTileColors) return false;
  for (const i of eyeIdx) {
    const call = drawList[i];
    const tIdx = call.tileIndex | 0;
    if (tIdx < 0 || tIdx >= 2048) return false;
    if (!_tileBlankValid[tIdx]) {
      _tileBlankVal[tIdx] = isBlankTile(getTileBytes(patternTable, tIdx)) ? 1 : 0;
      _tileBlankValid[tIdx] = 1;
    }
    if (_tileBlankVal[tIdx]) continue;
    if (!_tileHashValid[tIdx]) {
      _tileHashVal[tIdx] = hashTile(getTileBytes(patternTable, tIdx));
      _tileHashValid[tIdx] = 1;
    }
    const hash = _tileHashVal[tIdx];
    if (hasPack && packEntries.has(hash)) continue;
    if (!resolveGroupTileRgba(groupTileColors, call, hash)) return false;
  }
  return true;
}

/** Group tile colours bucketed by pattern, cached per groups array. */
const _groupTileColorIndexCache = new WeakMap();

/**
 * Patterns painted by groups, as `hash → [{ group, rgba }]`.
 *
 * Cached against the groups array itself: both tools replace the array whenever a group
 * changes, so a new array means new colours and the same array means nothing moved.
 *
 * @param {Array<Group>|null|undefined} groups
 * @returns {Map<number, Array<{ group: Group, rgba: Uint8Array }>>|null} null when no group paints
 */
export function buildGroupTileColorIndex(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return null;
  // A live Map means a tool is painting into this group, and a pattern can appear (or a buffer be
  // swapped, by undo) without the array changing. Then the index is reused only while every live
  // Map still holds the same patterns and buffers — a walk of the painted groups, much cheaper
  // than rebuilding for every group on every composite (SpriteStudio draws dozens of thumbnails).
  // This has to be decided before reading the plain cache, or a `null` cached from before the
  // first stroke sticks forever.
  /** @type {Map<number, Uint8Array>[]} */
  const live = [];
  for (const g of groups) if (g && g.tileColors instanceof Map) live.push(g.tileColors);
  if (!live.length) {
    const cached = _groupTileColorIndexCache.get(groups);
    if (cached !== undefined) return cached;
  } else {
    const cached = _liveIndexCache.get(groups);
    if (cached && liveMapsUnchanged(cached.live, live)) return cached.index;
  }
  /** @type {Map<number, Array<{ group: Group, rgba: Uint8Array }>>|null} */
  let index = null;
  for (const g of groups) {
    const colors = decodeGroupTileColors(g);
    if (colors.size === 0) continue;
    if (!index) index = new Map();
    for (const [hash, rgba] of colors) {
      const list = index.get(hash);
      if (list) list.push({ group: g, rgba });
      else index.set(hash, [{ group: g, rgba }]);
    }
  }
  if (!live.length) _groupTileColorIndexCache.set(groups, index);
  else _liveIndexCache.set(groups, { index, live: live.map((m) => ({ map: m, entries: [...m] })) });
  return index;
}

/** Index built while groups were being painted, with what their live Maps held then. */
const _liveIndexCache = new WeakMap();

/**
 * @param {Array<{ map: Map<number, Uint8Array>, entries: Array<[number, Uint8Array]> }>} then
 * @param {Map<number, Uint8Array>[]} now
 */
function liveMapsUnchanged(then, now) {
  if (then.length !== now.length) return false;
  for (let i = 0; i < now.length; i++) {
    const { map, entries } = then[i];
    if (map !== now[i] || map.size !== entries.length) return false;
    let j = 0;
    for (const [hash, rgba] of map) {
      const e = entries[j++];
      if (e[0] !== hash || e[1] !== rgba) return false;
    }
  }
  return true;
}

/**
 * Colour for this draw from the first group that both paints the pattern and claims the draw.
 *
 * This is what lets one pattern be a different colour in each world: the group's criteria
 * decide which copies it owns, so a solid fill tile shared by a dozen layers can be coloured
 * once per layer.
 *
 * Not gated on the group's own pool, unlike position overrides (a group can opt in to screen
 * gating with `group.screens`, applied before this — src/screen-gate.js). A group's pool and variant
 * say which state it was authored in, and the Project tool stamps the active one onto every
 * new group — so gating colour on it would make paint vanish the moment the game left that
 * state, including immediately after Save and Play. An override swaps artwork and has to be
 * state-aware; a colour is appearance, and belongs to the criteria (world, layer, pattern),
 * which do not change with game state.
 *
 * @param {ReturnType<typeof buildGroupTileColorIndex>} index
 * @param {import('./vip-state.js').DrawCall} draw
 * @param {number} hash
 * @returns {Uint8Array | null}
 */
export function resolveGroupTileRgba(index, draw, hash) {
  return resolveGroupTileMatch(index, draw, hash)?.rgba ?? null;
}

/**
 * Like {@link resolveGroupTileRgba}, with the group the colour came from.
 * @param {ReturnType<typeof buildGroupTileColorIndex>} index
 * @param {import('./vip-state.js').DrawCall} draw
 * @param {number} hash
 * @returns {{ group: Group, rgba: Uint8Array } | null}
 */
export function resolveGroupTileMatch(index, draw, hash) {
  if (!index) return null;
  const list = index.get(hash);
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    if (drawMatchesGroup(draw, list[i].group, hash)) return list[i];
  }
  return null;
}

/**
 * Brightness factors for groups that follow the game's palette (`group.followPalette`), per world:
 * a Float64Array indexed `palette * 4 + pixelValue`. A pixel's paint is scaled by the shade the
 * game gives it under the palette its tile is drawn with, over the brightest shade that pixel value
 * takes under any palette the same world uses on this frame (lit plain-BG tiles, this eye) — so
 * text the game highlights with a brighter palette keeps its painted colour, and the dimmed rest
 * dims with it. Shades count 0–3 (frames do not always carry the VIP's brightness levels). Worlds
 * drawing with one palette are left out: nothing to compare.
 * @param {{ patternTable: Uint8Array }} state @param {any[]} drawList @param {number} eye
 * @param {number[]} gplt the four BG palettes
 * @returns {Map<number, Float64Array>}
 */
export function paletteFollowFactors(state, drawList, eye, gplt) {
  /** @type {Map<number, Set<number>>} */
  const used = new Map();
  for (const d of drawList) {
    if ((d.eye ?? 0) !== eye || (d.layer ?? 0) !== 0 || d.world == null) continue;
    if (isBlankTile(getTileBytes(state.patternTable, d.tileIndex))) continue;
    let set = used.get(d.world);
    if (!set) used.set(d.world, (set = new Set()));
    set.add((d.paletteSelector ?? 0) & 3);
  }
  const shade = (p, v) => (Number(gplt[p & 3]) >> (v * 2)) & 3;
  const out = new Map();
  for (const [world, pals] of used) {
    if (pals.size < 2) continue;
    const t = new Float64Array(16).fill(1);
    for (let v = 1; v < 4; v++) {
      let max = 0;
      for (const p of pals) max = Math.max(max, shade(p, v));
      if (!max) continue;
      for (let p = 0; p < 4; p++) t[p * 4 + v] = Math.min(1, shade(p, v) / max);
    }
    out.set(world, t);
  }
  return out;
}

/**
 * Groups that claim tile slots and have a shade ramp to colour them with; null when none do,
 * which is nearly always, so the draw loop pays nothing for the feature.
 * @param {Array<Group>|null|undefined} groups
 */
function animatedGroupsOf(groups) {
  if (!Array.isArray(groups)) return null;
  const out = groups.filter((g) => Array.isArray(g?.criteria?.tileSlots) && g.criteria.tileSlots.length > 0 && Array.isArray(g.shadeRamp));
  return out.length ? out : null;
}

/** group → { ramp, byHash }: ramp-coloured tiles, rebuilt when the ramp array changes. */
const _shadeRampTileCache = new WeakMap();

/**
 * A step of an animated tile that nobody painted, coloured from its group's shade ramp.
 * @param {Array<Group>} animated @param {any} draw @param {number} hash @param {Uint8Array} tileBytes
 * @returns {Uint8Array|null}
 */
function resolveShadeRampRgba(animated, draw, hash, tileBytes) {
  for (const g of animated) {
    if (!normalizedCriteria(g).slots?.has(Number(draw.tileIndex)) || !drawMatchesGroup(draw, g, hash)) continue;
    let entry = _shadeRampTileCache.get(g);
    if (!entry || entry.ramp !== g.shadeRamp) {
      entry = { ramp: g.shadeRamp, byHash: new Map() };
      _shadeRampTileCache.set(g, entry);
    }
    let rgba = entry.byHash.get(hash);
    if (rgba === undefined) {
      rgba = rgbaFromShadeRamp(tileBytes, g.shadeRamp);
      entry.byHash.set(hash, rgba);
    }
    if (rgba) return rgba;
  }
  return null;
}

/**
 * Per-frame lookup tables for the draw loop: groups by id, and overrides bucketed by the
 * pattern they colour. Building these once a frame instead of once a draw is the difference
 * between a scene of repeating tiles being cheap or quadratic.
 * @param {Array<Group>|null|undefined} groups
 * @param {Array<any>} [overrides]
 */
export function buildGroupIndex(groups, overrides = []) {
  /** @type {Map<string, Group>} */
  const groupById = new Map();
  for (const gr of Array.isArray(groups) ? groups : []) {
    if (gr && gr.id) groupById.set(gr.id, gr);
  }
  /** @type {Map<number, Array<any>>} */
  const byHash = new Map();
  for (const o of Array.isArray(overrides) ? overrides : []) {
    if (!o || typeof o.hash !== 'number') continue;
    const list = byHash.get(o.hash);
    if (list) list.push(o);
    else byHash.set(o.hash, [o]);
  }
  return { groupById, byHash };
}


/**
 * Sort key for VIP draw calls: higher `world` (back) first, lower (front) last.
 * When either draw lacks `world` in 0..31, preserve core order (`ia`/`ib`).
 *
 * @param {import('./vip-state.js').DrawCall} a
 * @param {import('./vip-state.js').DrawCall} b
 * @param {number} ia - original drawList index of `a`
 * @param {number} ib - original drawList index of `b`
 * @returns {number}
 */
export function compareDrawCallOrderByWorld(a, b, ia, ib) {
  const aw = a.world;
  const bw = b.world;
  const aHas = aw != null && aw >= 0 && aw <= 31;
  const bHas = bw != null && bw >= 0 && bw <= 31;
  if (aHas && bHas) {
    const d = (bw | 0) - (aw | 0);
    if (d !== 0) return d;
  } else if (!aHas || !bHas) {
    return ia - ib;
  }
  const as = a.strip ?? (a.y >> 3);
  const bs = b.strip ?? (b.y >> 3);
  if (as !== bs) return as - bs;
  const al = a.layer ?? 0;
  const bl = b.layer ?? 0;
  if (al !== bl) return al - bl;
  return ia - ib;
}

/**
 * Decode base64 RGBA bytes into a 256-byte tile (8×8×4).
 * Supports browser atob and Node Buffer fallback for tests.
 *
 * @param {string} b64
 * @returns {Uint8Array|null}
 */
function decodeTileRgbaBase64(b64) {
  if (!b64) return null;
  try {
    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    } else if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    } else {
      return null;
    }
    if (bytes.length < 256) return null;
    if (bytes.length === 256) return bytes;
    return bytes.subarray(0, 256);
  } catch (_) {
    return null;
  }
}

/**
 * Resolve optional v2 tile8 RGBA for (variant, hash), with __default__ fallback.
 * Shape intentionally permissive for early authoring:
 *   painterV2Rules.tile8ByVariant[variantId][hashKey] = "base64" | { rgbaBase64: "..." }
 *
 * @param {unknown} painterV2Rules
 * @param {string|null|undefined} variantId
 * @param {number} hash
 * @param {Map<string, Uint8Array>} decodeCache
 * @returns {Uint8Array|null}
 */
function resolvePainterV2TileRgba(painterV2Rules, variantId, hash, decodeCache) {
  if (!painterV2Rules || typeof painterV2Rules !== 'object' || Array.isArray(painterV2Rules)) return null;
  const tile8ByVariant = painterV2Rules.tile8ByVariant;
  if (!tile8ByVariant || typeof tile8ByVariant !== 'object' || Array.isArray(tile8ByVariant)) return null;
  const vId = typeof variantId === 'string' && variantId.trim() ? variantId.trim() : '__default__';
  const variantCandidates = [vId, '__default__'];
  const hashDec = String(hash >>> 0);
  const hashHexLower = `0x${(hash >>> 0).toString(16)}`;
  const hashHexUpper = hashHexLower.toUpperCase();
  const hashCandidates = [hashDec, hashHexLower, hashHexUpper];

  for (const vk of variantCandidates) {
    const bucket = tile8ByVariant[vk];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    for (const hk of hashCandidates) {
      const row = bucket[hk];
      if (!row) continue;
      let rgba = null;
      if (typeof row === 'string') {
        if (decodeCache.has(row)) return decodeCache.get(row) ?? null;
        rgba = decodeTileRgbaBase64(row);
        if (rgba) decodeCache.set(row, rgba);
      } else if (typeof row === 'object' && !Array.isArray(row) && typeof row.rgbaBase64 === 'string') {
        const key = row.rgbaBase64;
        if (decodeCache.has(key)) return decodeCache.get(key) ?? null;
        rgba = decodeTileRgbaBase64(key);
        if (rgba) decodeCache.set(key, rgba);
      }
      if (rgba) return rgba;
    }
  }
  return null;
}

/**
 * Composite one eye's frame into ImageData using pack lookup and optional position overrides.
 *
 * @param {import('./vip-state.js').VIPState} state
 * @param {Map<number, Uint8Array>} packEntries - hash -> 256-byte RGBA
 * @param {ImageData} imageData - 384×224, data is RGBA
 * @param {object} [options] - everything else, by name (all optional):
 * @param {number} [options.eye] - 0 = left, 1 = right. Only draws with matching eye are composited. Default 0 (left).
 * @param {PositionOverride[]} [options.overrides] - position-based overrides (first match wins)
 * @param {Group[]} [options.groups] - optional groups; required to honor overrides with groupId
 * @param {number} [options.brightnessScale] - scale applied to state.masterBrightness (1 = use core value; <1 = lighter, >1 = darker, capped at 1)
 * @param {boolean} [options.stripClip] - when true, only draw pixels whose screen Y falls in this draw's strip (debug for per-strip ghost)
 * @param {number} [options.objXOffset] - pixel offset applied to OBJ (layer 2) draws only; e.g. -8 to test ghost
 * @param {number} [options.bgXOffset] - pixel offset applied to BG (layer 0) draws only; e.g. -8 for animated/scrolling BG ghost test
 * @param {boolean} [options.applyOffsetToAllDraws] - when true and objXOffset set, apply offset to every draw (debug when core doesn't set layer)
 * @param {boolean} [options.deduplicateDraws] - when true, only draw first occurrence of each (tileIndex, x, y, eye) to avoid double-draw ghost from core duplicates
 * @param {unknown} [options.gameStatePools] - optional schema v2 pools from groups.json
 * @param {Uint8Array|null} [options.wram] - live 64 KiB CPU WRAM for `ramConditions`; when null, gated overrides are skipped
 * @param {'transparent'|'occlude_black'} [options.unpackedMode] - See docs/reference/color-layer-z-order-and-performance.md. Briefly: no-pack pixels paint a VIP 2bpp fallback when ≥2 draws geometrically cover the pixel (cheap prepass); palette 0 can punch holes.
 * @param {{ data: Uint8ClampedArray, shade: Uint8Array, world: Int8Array, art?: Uint8Array, touched?: Set<number> } | null} [options.stereoSource] - right eye only: the left
 *   eye's composite and its getCompositePixelInfo(). A right-only world twinned with a left-only one (src/stereo-twin.js)
 *   then takes colour for its unpainted pixels from the left copy: the nearest pixel across of the same shade. Where the
 *   left world had a touch-up, every pixel of the twin is taken from the left that way (touch-up included), instead of
 *   placing the touch-up on the right copy, whose art is drawn shifted for depth and would show twice.
 * @param {boolean} [options.sortDrawsByWorld] - when true (default), composite draws for this eye in VIP world order (31→0) with strip/layer/original-index ties; when either draw lacks world, core order is kept for that pair. See vip-state DrawCall `world`.
 * @param {unknown} [options.painterV2Rules] - optional parsed `painter-v2-rules.json` object
 * @param {string|null} [options.painterV2VariantId] - variant id for v2 tile8 lookup; null uses "__default__"
 * @param {number} [options.unpackedMinCoverage] - for `unpackedMode === 'transparent'`, minimum geometric draw-stack depth (from prepass) before painting VIP 2bpp fallback when no pack RGBA; default **2** matches hardware-ish stacking. Use **1** for tools that subset draws (e.g. single VIP world) so single-cover pixels still show fallback.
 * @param {boolean} [options.diagnosticMonoFallback] - when true and there is no pack/override color for a pixel, paint VIP 2bpp using the **red diagnostic ramp** (same 4-level idea as the v1 tile editor) instead of grayscale 0/96/192. Intended for **Painter v2 preview** only; main app / emulation stay default false.
 * @param {boolean} [options.renderUnpackedFallback] - when false, pixels with no pack/override color remain transparent (so emulator mono underlay shows through unchanged).
 * @param {number} [options.monoFallbackGain] - multiplier for no-pack fallback pixels only (clamped per channel at 255); painted pack/override colors are unaffected. Painter preview brightness; main app keeps 1.
 * @param {boolean} [options.drawTransparentPaint] - draw paint on pixels the game leaves transparent (value 0), where it is opaque; see src/transparent-paint.js. The tools always do; the emulator only for packs flagged `paintOnTransparent`.
 */
export function compositeColorFrame(state, packEntries, imageData, options = {}) {
  let {
    eye = 0,
    overrides = [],
    groups = [],
    brightnessScale = 1,
    stripClip = false,
    objXOffset = 0,
    applyOffsetToAllDraws = false,
    bgXOffset = 0,
    deduplicateDraws = false,
    gameStatePools = null,
    wram = null,
    unpackedMode = 'transparent',
    sortDrawsByWorld = true,
    painterV2Rules = null,
    painterV2VariantId = null,
    unpackedMinCoverage = 2,
    diagnosticMonoFallback = false,
    renderUnpackedFallback = true,
    monoFallbackGain = 1,
    drawTransparentPaint = false,
    stereoSource = null,
  } = options;
  const fallbackGain = Number.isFinite(monoFallbackGain) && monoFallbackGain > 0 ? monoFallbackGain : 1;
  // The brightness the player sees for an unpainted pixel: background pixels go through the
  // game's palette (GPLT, one per palette selector, 2 bits per pixel value). Some games remap it —
  // Mario's Tennis inverts palette 0, so its white court lines are pixel value 1. Sprites use
  // their own palettes (JPLT), which frames do not carry, so they keep the raw value.
  const gplt = Array.isArray(state.gplt) && state.gplt.length >= 4 ? state.gplt : null;
  const shadeOf = (px, palette, layer) => (gplt && layer !== 2 ? (Number(gplt[palette & 3]) >> (px * 2)) & 3 : px);
  const minCov =
    typeof unpackedMinCoverage === 'number' && Number.isFinite(unpackedMinCoverage)
      ? Math.max(1, Math.min(0xffff, unpackedMinCoverage | 0))
      : 2;
  const data = imageData.data;
  data.fill(0);
  if (!state.drawList || !state.patternTable) return;
  // The core leaves BG tiles cut by the top (or left) of their window out of the draw list,
  // though the mono frame shows them; put them back so colour does not vanish a tile early.
  // Appended after the core's draws so indices below `state.drawList.length` (draw owners,
  // group membership) still mean the same draw.
  const recoveredDraws = recoverClippedBgDraws(state, eye);
  const drawList = recoveredDraws.length ? state.drawList.concat(recoveredDraws) : state.drawList;
  // Groups by id and overrides bucketed by pattern, built once here rather than per draw.
  const _frameGroupIndex = overrides.length ? buildGroupIndex(groups, overrides) : null;
  // Overrides keep their own game-state gate (ramConditions, above); paint and overpaint show
  // only for groups whose screens setting allows this frame (src/screen-gate.js).
  const overrideGroups = groups;
  groups = groupsForScreen(groups, gameStatePools, wram);
  const _frameGroupTileColors = buildGroupTileColorIndex(groups);
  const _frameAnimatedGroups = animatedGroupsOf(groups);
  // Groups that follow the game's palette brighten and dim with it (paletteFollowFactors).
  const _paletteFollow = gplt && groups.some((g) => g?.followPalette === true)
    ? paletteFollowFactors(state, drawList, eye, gplt)
    : null;
  // A blank tile (every pixel see-through) is skipped as it paints nothing — unless someone
  // painted it and transparent paint is wanted: then it is drawn like any painted tile (the empty
  // cells of Mario's Tennis's court, coloured grass green).
  const drawPaintedBlank =
    drawTransparentPaint && (packEntries.has(BLANK_TILE_HASH) || !!_frameGroupTileColors?.has(BLANK_TILE_HASH));

  const eyeIdx = [];
  for (let i = 0; i < drawList.length; i++) {
    if ((drawList[i].eye ?? 0) === eye) eyeIdx.push(i);
  }
  if (sortDrawsByWorld) {
    eyeIdx.sort((ia, ib) => compareDrawCallOrderByWorld(drawList[ia], drawList[ib], ia, ib));
  }

  const pixN = W * H;
  if (!_drawCoverageScratch || _drawCoverageScratch.length < pixN) {
    _drawCoverageScratch = new Uint16Array(pixN);
  }
  const drawCoverage = _drawCoverageScratch;
  drawCoverage.fill(0, 0, pixN);
  if (!_drawOwnerScratch || _drawOwnerScratch.length < pixN) {
    _drawOwnerScratch = new Int32Array(pixN);
  }
  const drawOwner = _drawOwnerScratch;
  drawOwner.fill(-1, 0, pixN);
  if (!_pixShadeScratch || _pixShadeScratch.length < pixN) {
    _pixShadeScratch = new Uint8Array(pixN);
    _pixWorldScratch = new Int8Array(pixN);
    _pixArtScratch = new Uint8Array(pixN);
    _pixBareScratch = new Uint8Array(pixN);
    _pixCharScratch = new Int16Array(pixN);
  }
  const pixShade = _pixShadeScratch;
  const pixWorld = /** @type {Int8Array} */ (_pixWorldScratch);
  const pixArt = /** @type {Uint8Array} */ (_pixArtScratch);
  pixShade.fill(0xff, 0, pixN);
  pixWorld.fill(-1, 0, pixN);
  pixArt.fill(0, 0, pixN);
  const pixBare = /** @type {Uint8Array} */ (_pixBareScratch);
  const pixChar = /** @type {Int16Array} */ (_pixCharScratch);
  pixBare.fill(0, 0, pixN);
  pixChar.fill(-1, 0, pixN);
  _touchedWorlds = new Set();

  if (!_tileBlankValid || _tileBlankValid.length < 2048) {
    _tileBlankValid = new Uint8Array(2048);
    _tileBlankVal = new Uint8Array(2048);
  }
  _tileBlankValid.fill(0);
  if (!_tileHashValid || _tileHashValid.length < 2048) {
    _tileHashValid = new Uint8Array(2048);
    _tileHashVal = new Uint32Array(2048);
  }
  _tileHashValid.fill(0);

  /** @type {Set<string>} */
  const drawnKeys = deduplicateDraws ? new Set() : null;
  /** @type {Set<string>} */
  const prepassKeys = deduplicateDraws ? new Set() : null;
  // One slot per VIP world. `eye` is fixed for the whole call, so the world index is the
  // whole key — building a `"world,eye"` string per draw cost more than the lookup saved.
  /** @type {Array<ReturnType<typeof getBgAffineWorldClipRect> | undefined>} */
  const worldClipCache = new Array(32);
  const windowsTable = getWindowsTableBytesFromState(state);
  /** @type {Map<string, Uint8Array>} */
  const v2DecodeCache = new Map();
  // Right eye: worlds that draw the right eye's copy of a left-only layer (src/stereo-twin.js).
  // Their draws match groups as the left world, and unpainted pixels borrow the left's colour.
  const twins = eye === 1 && windowsTable ? stereoTwins(windowsTable) : null;
  const twinOf = twins && twins.size ? twins : null;
  const borrow = twinOf && stereoSource ? stereoSource : null;
  /**
   * Each right-eye pixel of a twin world: its shade, 4 where see-through, 0xff where no twin draws.
   * What borrowFrom compares with the left eye's shades; built on first use.
   */
  let rightCodes = null;
  const buildRightCodes = () => {
    rightCodes = new Uint8Array(W * H).fill(0xff);
    for (const i of eyeIdx) {
      const call = drawList[i];
      if (call.world == null || !twinOf.has(call.world) || call.layer === 1 || call.layer === 2) continue;
      const tb = getTileBytes(state.patternTable, call.tileIndex);
      const pal = call.paletteSelector ?? 0;
      for (let py = 0; py < 8; py++) {
        const sy = call.flipV ? 7 - py : py;
        const word = tb[sy * 2] | (tb[sy * 2 + 1] << 8);
        for (let px = 0; px < 8; px++) {
          const ix = call.x + px;
          const iy = call.y + py;
          if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
          const v = (word >> ((call.flipH ? 7 - px : px) * 2)) & 3;
          rightCodes[iy * W + ix] = v ? shadeOf(v, pal, 0) : 4;
        }
      }
    }
    for (const world of twinOf.keys()) {
      if (!affineSet.has(world)) continue;
      sampleAffineWorld(state, world, eye, (x, y, _ch, _tx, _ty, px, pal) => {
        rightCodes[y * W + x] = px ? shadeOf(px, pal, 1) : 4;
      });
    }
  };
  /** The left eye's pixel as the same code: its shade on the left twin, 4 see-through, 5 another world. */
  const leftCode = (q, left) => {
    if (borrow.world[q] !== left) return borrow.world[q] < 0 ? 4 : 5;
    const s0 = borrow.shade[q];
    return s0 === 0xff ? 4 : s0 & 3;
  };
  /** Pixels compared either side when matching a right-eye pixel to the left eye. */
  const MATCH_REACH = 3;
  /**
   * The left composite's pixel showing what this right-eye pixel shows, or −1. Candidates lie
   * within STEREO_SEARCH px across of where the twins line up, are drawn by the left world and
   * coloured (painted, or covered by layer art or a touch-up) with the same shade; the one whose
   * neighbours along the row best match this pixel's wins (block matching), so a run of pixels
   * takes one consistent offset and edges don't smear.
   */
  const borrowFrom = (ix, iy, shade, twin) => {
    if (!rightCodes) buildRightCodes();
    const row = iy * W;
    const x0 = ix - twin.shift;
    let best = -1;
    let bestCost = Infinity;
    for (let k = 0; k <= STEREO_SEARCH; k++) {
      for (let s = k ? -1 : 1; s <= 1; s += 2) {
        const x = x0 + s * k;
        if (x < 0 || x >= W) continue;
        const q = row + x;
        if (borrow.world[q] !== twin.left) continue;
        const s0 = borrow.shade[q];
        if (!(s0 === shade || (borrow.art && borrow.art[q] && (s0 & ~STEREO_UNPAINTED) === shade))) continue;
        let cost = 0;
        for (let d = -MATCH_REACH; d <= MATCH_REACH && cost < bestCost; d++) {
          const rx = ix + d;
          const lx = x + d;
          if (rx < 0 || rx >= W || lx < 0 || lx >= W) cost++;
          else if (rightCodes[row + rx] !== leftCode(row + lx, twin.left)) cost++;
        }
        if (cost < bestCost) {
          best = q;
          bestCost = cost;
          if (!cost) return best;
        }
      }
    }
    return best;
  };
  /** A twin whose left world had a touch-up: all of it is taken from the left eye. */
  const borrowsAll = (world) => {
    const twin = borrow && world != null ? twinOf.get(world) : undefined;
    return !!twin && !!borrow.touched && borrow.touched.has(twin.left);
  };
  /** Colour a pixel from the left eye; false when nothing there matches. */
  const borrowInto = (dst, pidx, ix, iy, shade, world) => {
    const twin = twinOf.get(world);
    if (!twin) return false;
    const q = borrowFrom(ix, iy, shade, twin);
    if (q < 0) return false;
    const sd = borrow.data;
    data[dst] = sd[q * 4];
    data[dst + 1] = sd[q * 4 + 1];
    data[dst + 2] = sd[q * 4 + 2];
    data[dst + 3] = 255;
    pixShade[pidx] = shade;
    pixArt[pidx] = 2; // coloured from the left eye, not by its own tile's paint
    return true;
  };

  // The prepass below counts how many draws cover each pixel, but only the unpainted-tile
  // fallback ever reads that count. On a layered frame it walks all 64 cells of every draw,
  // so skip it outright when no draw can reach that path.
  const needsCoveragePrepass =
    renderUnpackedFallback
    && minCov > 1
    && !everyDrawHasColor(drawList, eyeIdx, state.patternTable, packEntries, _frameGroupTileColors);

  // Overpaint (src/overpaint.js, read by src/layer-art.js): a group's picture in its layer's map,
  // drawn over the world's tiles when the back-to-front walk has drawn them. With `hideTiles`
  // (old layer art) the picture replaces the tiles: those draws are skipped below.
  const artState = { patternTable: state.patternTable, windows: windowsTable, drawList };
  const layerArts = activeLayerArts(artState, groups, eye, overrideGroups);
  const hiding = layerArts.filter((a) => a.art.hideTiles);
  const replacedWorlds = hiding.length ? new Set(hiding.map((a) => a.world)) : null;
  const isReplaced = (call) => !!replacedWorlds && (call.layer ?? 0) === 0 && replacedWorlds.has(call.world);
  // How much the game's fade dims colour on this frame (src/fade.js): paint, art and fallback alike.
  const artBrightness = fadeFactor(state, brightnessScale);
  // Affine worlds (src/affine-world.js): the draw list holds rigid 8×8 stand-ins for a scaled or
  // rotated layer (one per screen pixel that reads a tile's top-left texel), so those records are
  // skipped and the world is sampled pixel by pixel, the way the VIP draws it, at its depth.
  const affineSet = new Set(affineWorlds(state, eye));
  const isAffineRecord = (call) => affineSet.size > 0 && call.layer === 1 && affineSet.has(call.world);
  const paintAffine = (world) => {
    /** @type {Map<number, Uint8Array | null>} colours per character, resolved once per world */
    const byChar = new Map();
    const pt = state.patternTable;
    const colourOf = (ch) => {
      if (byChar.has(ch)) return byChar.get(ch);
      const tileBytes = getTileBytes(pt, ch);
      const hash = ch < 2048 && _tileHashValid[ch] ? _tileHashVal[ch] : hashTile(tileBytes);
      // A background group covers its worlds' affine mode too (drawMatchesGroup), so tiles
      // painted while the world was a plain background keep their colours when it zooms.
      const asAffine = { world: twinOf?.get(world)?.left ?? world, layer: 1, tileIndex: ch };
      const rgba =
        resolveGroupTileRgba(_frameGroupTileColors, asAffine, hash)
        ||(_frameAnimatedGroups ? resolveShadeRampRgba(_frameAnimatedGroups, asAffine, hash, tileBytes) : null)
        || resolvePainterV2TileRgba(painterV2Rules, painterV2VariantId, hash, v2DecodeCache)
        || packEntries.get(hash)
        || null;
      byChar.set(ch, rgba);
      return rgba;
    };
    const owner = drawList.findIndex((d) => d.layer === 1 && d.world === world && (d.eye ?? 0) === eye);
    const k = artBrightness;
    const allFromLeft = borrowsAll(world);
    sampleAffineWorld(state, world, eye, (x, y, ch, tx, ty, px, pal) => {
      const rgba = colourOf(ch);
      // Transparent texels stay see-through unless painted and transparent paint is wanted.
      if (px === 0 && !(drawTransparentPaint && rgba && rgba[(ty * 8 + tx) * 4 + 3])) return;
      const pidx = y * W + x;
      drawOwner[pidx] = owner;
      pixWorld[pidx] = world;
      pixChar[pidx] = ch;
      pixBare[pidx] = px === 0 ? 0 : !rgba ? 2 : rgba[(ty * 8 + tx) * 4 + 3] === 0 ? 1 : 0;
      pixArt[pidx] = 0; // a tile in front of a picture: the pixel is the tile's now
      const dst = pidx * 4;
      if (allFromLeft && px !== 0 && borrowInto(dst, pidx, x, y, shadeOf(px, pal, 1), world)) return;
      if (!rgba) {
        pixShade[pidx] = STEREO_UNPAINTED | shadeOf(px, pal, 1);
        if (borrow && borrowInto(dst, pidx, x, y, shadeOf(px, pal, 1), world)) return;
        // Unpainted: clear (the emulator's mono picture shows) or the preview's fallback shade.
        if (!renderUnpackedFallback) {
          data[dst + 3] = 0;
          return;
        }
        if (minCov > 1) return;
        const shade = shadeOf(px, pal, 1);
        const base = diagnosticMonoFallback ? [0, 80, 160, 255][shade] : FALLBACK_GREYS[shade];
        const v = Math.min(255, ((base * k) | 0) * fallbackGain) | 0;
        data[dst] = v;
        data[dst + 1] = diagnosticMonoFallback ? 0 : v;
        data[dst + 2] = diagnosticMonoFallback ? 0 : v;
        data[dst + 3] = 255;
        return;
      }
      const src = (ty * 8 + tx) * 4;
      const a = rgba[src + 3];
      if (a === 0) return;
      pixShade[pidx] = shadeOf(px, pal, 1);
      data[dst] = (rgba[src] * k) | 0;
      data[dst + 1] = (rgba[src + 1] * k) | 0;
      data[dst + 2] = (rgba[src + 2] * k) | 0;
      data[dst + 3] = a;
    });
  };
  // Pictures drawn at a world's depth: affine worlds, layer art (instead of the world's tiles)
  // and touch-ups (src/touch-up.js, over the world's tiles). Back to front; within a world the
  // affine sampling or layer art first, touch-ups over them.
  const passes = [
    ...[...affineSet].map((world) => ({ world, paint: () => paintAffine(world) })),
    ...layerArts.map((a) => ({ world: a.world, paint: () => paintLayerArt(data, drawOwner, windowsTable, eye, a, artBrightness, pixArt) })),
    ...activeTouchUps(artState, groups, eye).filter((t) => !borrowsAll(t.world)).map((t) => ({ world: t.world, touchUp: true, paint: () => paintTouchUp(data, drawOwner, windowsTable, eye, t, artBrightness, pixArt) })),
    // Touch-ups painted on a scaled world's base tiles, drawn through its sampling.
    ...(affineSet.size ? affineTouchUps(state, groups, eye) : []).filter((t) => !borrowsAll(t.world)).map((t) => ({ world: t.world, touchUp: true, paint: () => paintAffineTouchUp(data, drawOwner, state, eye, t, artBrightness, pixArt) })),
    // Overpaint on a scaled world, drawn through its sampling over the tiles. Like a touch-up, a
    // right-eye twin takes it from the left eye with everything else.
    ...(affineSet.size ? affineOverpaints(state, groups, eye, overrideGroups) : []).filter((o) => !borrowsAll(o.world)).map((o) => ({ world: o.world, touchUp: true, paint: () => paintAffineOverpaint(data, drawOwner, state, eye, o, artBrightness, pixArt) })),
  ].sort((a, b) => b.world - a.world);
  for (const p of passes) if (p.touchUp) _touchedWorlds.add(p.world);
  let nextArt = 0;
  const paintArtsBehind = (world) => {
    // Everything drawn so far is behind `world` (or is `world` itself): passes for worlds
    // further back go in now, so a touch-up lands over its own world's tiles.
    while (nextArt < passes.length && (world == null || passes[nextArt].world > world)) passes[nextArt++].paint();
  };

  if (needsCoveragePrepass) for (const i of eyeIdx) {
    const call = drawList[i];
    if (isReplaced(call) || isAffineRecord(call)) continue;
    const layer = call.layer;
    let pixelOffset = 0;
    if (applyOffsetToAllDraws && objXOffset) pixelOffset = objXOffset;
    else if (layer === 0 && bgXOffset) pixelOffset = bgXOffset;
    else if (layer === 2 && objXOffset) pixelOffset = objXOffset;
    const x0 = call.x + pixelOffset;
    const y0 = call.y;
    if (prepassKeys) {
      const key = `${call.tileIndex},${x0},${y0},${eye}`;
      if (prepassKeys.has(key)) continue;
      prepassKeys.add(key);
    }
    let worldClip = null;
    if (windowsTable && call.world !== undefined && call.world !== null) {
      const wid = call.world | 0;
      if (wid >= 0 && wid <= 31) {
        let wc = worldClipCache[wid];
        if (wc === undefined) {
          wc = getBgAffineWorldClipRect(windowsTable, wid, eye);
          worldClipCache[wid] = wc;
        }
        worldClip = wc;
      }
    }
    if (worldClip && worldClip.x0 > worldClip.x1) continue;

    const strip = call.strip ?? (call.y >> 3);
    const stripTop = (strip & 0x1F) * 8;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const ix = x0 + px;
        const iy = y0 + py;
        if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
        if (stripClip && (iy < stripTop || iy >= stripTop + 8)) continue;
        if (worldClip && (ix < worldClip.x0 || ix > worldClip.x1 || iy < worldClip.y0 || iy > worldClip.y1)) continue;
        const pidx = iy * W + ix;
        if (drawCoverage[pidx] < 0xffff) drawCoverage[pidx]++;
      }
    }
  }

  if (prepassKeys) prepassKeys.clear();

  for (const i of eyeIdx) {
    const call = drawList[i];
    if (nextArt < passes.length && call.world != null) paintArtsBehind(call.world);
    if (isReplaced(call) || isAffineRecord(call)) continue;
    const layer = call.layer;
    let pixelOffset = 0;
    if (applyOffsetToAllDraws && objXOffset) pixelOffset = objXOffset;
    else if (layer === 0 && bgXOffset) pixelOffset = bgXOffset;
    else if (layer === 2 && objXOffset) pixelOffset = objXOffset;
    const x0 = call.x + pixelOffset;
    const y0 = call.y;
    if (drawnKeys) {
      const key = `${call.tileIndex},${x0},${y0},${eye}`;
      if (drawnKeys.has(key)) continue;
      drawnKeys.add(key);
    }
    const tIdx = call.tileIndex | 0;
    const pt = state.patternTable;
    const byteStart = tIdx * BYTES_PER_TILE;
    const tileBytes =
      byteStart >= 0 && byteStart + BYTES_PER_TILE <= pt.length
        ? pt.subarray(byteStart, byteStart + BYTES_PER_TILE)
        : getTileBytes(pt, call.tileIndex);
    // Blank cells (all pixels palette 0) paint nothing but are most of a frame's BG draws, so
    // drop them before the 8×8 loop. Coverage from the prepass above is unchanged.
    if (tIdx >= 0 && tIdx < 2048) {
      if (!_tileBlankValid[tIdx]) {
        _tileBlankVal[tIdx] = isBlankTile(tileBytes) ? 1 : 0;
        _tileBlankValid[tIdx] = 1;
      }
      if (_tileBlankVal[tIdx] && !drawPaintedBlank) continue;
    } else if (isBlankTile(tileBytes) && !drawPaintedBlank) {
      continue;
    }
    let hash;
    if (tIdx >= 0 && tIdx < 2048) {
      if (!_tileHashValid[tIdx]) {
        _tileHashVal[tIdx] = hashTile(tileBytes);
        _tileHashValid[tIdx] = 1;
      }
      hash = _tileHashVal[tIdx];
    } else {
      hash = hashTile(tileBytes);
    }
    const drawLayer = call.layer !== undefined && call.layer !== null ? call.layer : undefined;
    // The right eye's copy of a left-only layer matches groups as that left world.
    const twin = twinOf && call.world != null ? twinOf.get(call.world) : undefined;
    const matchCall = twin ? { ...call, world: twin.left } : call;
    const allFromLeft = !!twin && borrowsAll(call.world);
    let rgba = resolveOverrideRgba(overrides, hash, x0, y0, packEntries, drawLayer, matchCall, overrideGroups, gameStatePools, wram, _frameGroupIndex);
    // A group's own colour for this pattern beats the pack, so the same tile can be a
    // different colour in each layer that draws it. Position overrides still win: they are
    // scoped tighter than a whole group.
    /** @type {Float64Array | null} brightness by palette and pixel value, for a palette-following group */
    let followT = null;
    if (!rgba) {
      const match = resolveGroupTileMatch(_frameGroupTileColors, matchCall, hash);
      if (match) {
        rgba = match.rgba;
        if (_paletteFollow && match.group.followPalette === true && (call.layer ?? 0) === 0) followT = _paletteFollow.get(call.world) || null;
      }
    }
    if (!rgba && _frameAnimatedGroups) rgba = resolveShadeRampRgba(_frameAnimatedGroups, matchCall, hash, tileBytes);
    if (!rgba) rgba = resolvePainterV2TileRgba(painterV2Rules, painterV2VariantId, hash, v2DecodeCache);
    if (!rgba) rgba = packEntries.get(hash);
    let worldClip = null;
    if (windowsTable && call.world !== undefined && call.world !== null) {
      const wid = call.world | 0;
      if (wid >= 0 && wid <= 31) {
        let wc = worldClipCache[wid];
        if (wc === undefined) {
          wc = getBgAffineWorldClipRect(windowsTable, wid, eye);
          worldClipCache[wid] = wc;
        }
        worldClip = wc;
      }
    }
    if (worldClip && worldClip.x0 > worldClip.x1) continue;

    const flipH = call.flipH ?? false;
    const flipV = call.flipV ?? false;
    const strip = call.strip ?? (call.y >> 3);
    const stripTop = (strip & 0x1F) * 8;
    const hasPackRgba = !!rgba;
    for (let py = 0; py < 8; py++) {
      const sy = flipV ? 7 - py : py;
      const tileRowWord = tileBytes[sy * 2] | (tileBytes[sy * 2 + 1] << 8);
      for (let px = 0; px < 8; px++) {
        const sx = flipH ? 7 - px : px;
        const ix = x0 + px;
        const iy = y0 + py;
        if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
        if (stripClip && (iy < stripTop || iy >= stripTop + 8)) continue;
        if (worldClip && (ix < worldClip.x0 || ix > worldClip.x1 || iy < worldClip.y0 || iy > worldClip.y1)) continue;
        const monoPx = (tileRowWord >> (sx * 2)) & 0x3;
        // A transparent pixel stays see-through, unless it is painted and paint there is wanted
        // (src/transparent-paint.js): then it is drawn like any painted pixel, covering what is behind.
        if (monoPx === 0 && !(drawTransparentPaint && hasPackRgba && rgba[(sy * 8 + sx) * 4 + 3])) continue;
        const pidx = iy * W + ix;
        // A lit pixel occludes whatever is behind it, painted or not.
        drawOwner[pidx] = i;
        pixWorld[pidx] = call.world ?? -1;
        pixChar[pidx] = call.tileIndex;
        pixBare[pidx] = monoPx === 0 ? 0 : !hasPackRgba ? 2 : rgba[(sy * 8 + sx) * 4 + 3] === 0 ? 1 : 0;
        // A tile drawn in front of a picture (layer art, overpaint behind it): the pixel is the
        // tile's now, so its paint, not the picture, decides whether it is coloured.
        pixArt[pidx] = 0;
        const dst = pidx * 4;
        if (allFromLeft && monoPx !== 0 && borrowInto(dst, pidx, ix, iy, shadeOf(monoPx, call.paletteSelector ?? 0, layer), call.world)) continue;
        if (!hasPackRgba) {
          const shade = shadeOf(monoPx, call.paletteSelector ?? 0, layer);
          pixShade[pidx] = STEREO_UNPAINTED | shade;
          if (twin && borrow && borrowInto(dst, pidx, ix, iy, shade, call.world)) continue;
          if (!renderUnpackedFallback) {
            // The emulator draws the mono picture under this layer. An unpainted tile in front
            // must hide colour from a world behind it, so clear to transparent and let the mono
            // pixel show at the right depth — just leaving the pixel kept the colour on top.
            data[dst + 3] = 0;
            continue;
          }
          if (unpackedMode === 'occlude_black' && (call.paletteSelector ?? 0) === 0) {
            data[dst] = 0;
            data[dst + 1] = 0;
            data[dst + 2] = 0;
            data[dst + 3] = 0;
            continue;
          }
          // Only meaningful when the prepass actually counted; skipping it means every
          // drawn pixel would have passed this test anyway.
          if (needsCoveragePrepass && drawCoverage[pidx] < minCov) continue;
          let r;
          let g;
          let b;
          if (diagnosticMonoFallback) {
            const ramp = [
              [0, 0, 0],
              [80, 0, 0],
              [160, 0, 0],
              [255, 0, 0],
            ];
            const c = ramp[shadeOf(monoPx, call.paletteSelector ?? 0, layer)] ?? [0, 0, 0];
            r = c[0];
            g = c[1];
            b = c[2];
          } else {
            const base = FALLBACK_GREYS[shadeOf(monoPx, call.paletteSelector ?? 0, layer)];
            r = base;
            g = base;
            b = base;
          }
          if (artBrightness !== 1) {
            r = (r * artBrightness) | 0;
            g = (g * artBrightness) | 0;
            b = (b * artBrightness) | 0;
          }
          if (fallbackGain !== 1) {
            r = Math.min(255, (r * fallbackGain) | 0);
            g = Math.min(255, (g * fallbackGain) | 0);
            b = Math.min(255, (b * fallbackGain) | 0);
          }
          data[dst] = r;
          data[dst + 1] = g;
          data[dst + 2] = b;
          data[dst + 3] = 255;
          continue;
        }
        const src = (sy * 8 + sx) * 4;
        let r = rgba[src];
        let g = rgba[src + 1];
        let b = rgba[src + 2];
        const a = rgba[src + 3];
        if (a === 0) continue;
        pixShade[pidx] = shadeOf(monoPx, call.paletteSelector ?? 0, layer);
        const k = followT && monoPx ? followT[((call.paletteSelector ?? 0) & 3) * 4 + monoPx] * artBrightness : artBrightness;
        if (k !== 1) {
          r = (r * k) | 0;
          g = (g * k) | 0;
          b = (b * k) | 0;
        }
        data[dst] = r;
        data[dst + 1] = g;
        data[dst + 2] = b;
        data[dst + 3] = a;
      }
    }
  }
  // Arts whose worlds had nothing in front of them.
  paintArtsBehind(null);
}

/**
 * compositeColorFrame for one eye, as a tool shows it (Eye: Right): the right eye of a layer the
 * game draws twice takes colour from the left eye (src/stereo-twin.js), so the left eye is
 * composited first when the frame has such a layer. Same parameters as compositeColorFrame;
 * `options.stereoSource` is filled in here.
 * @param {import('./vip-state.js').VIPState} state
 * @param {Map<number, Uint8Array>} packEntries
 * @param {ImageData} imageData
 * @param {Parameters<typeof compositeColorFrame>[3]} [options]
 */
export function compositeColorFrameForEye(state, packEntries, imageData, options = {}) {
  const eye = options.eye ?? 0;
  const windows = eye === 1 ? getWindowsTableBytesFromState(state) : null;
  if (!windows || !stereoTwins(windows).size) return compositeColorFrame(state, packEntries, imageData, options);
  const left = { data: new Uint8ClampedArray(W * H * 4) };
  compositeColorFrame(state, packEntries, left, { ...options, eye: 0, stereoSource: null });
  const info = getCompositePixelInfo();
  const stereoSource = {
    data: left.data,
    shade: info.shade.slice(0, W * H),
    world: info.world.slice(0, W * H),
    art: info.art ? info.art.slice(0, W * H) : undefined,
    touched: new Set(info.touched),
  };
  return compositeColorFrame(state, packEntries, imageData, { ...options, eye: 1, stereoSource });
}

/**
 * Create a canvas and 2D context for color output (384×224).
 *
 * @returns {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, imageData: ImageData }}
 */
export function createColorCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context not available');
  const imageData = ctx.createImageData(W, H);
  return { canvas, ctx, imageData };
}

/**
 * Wire color layer: returns an onState handler. Supports stereo (left/right by state.eye) and view mode.
 *
 * @param {HTMLCanvasElement} colorCanvas - display canvas (may be resized for side-by-side)
 * @param {() => {'mono'|'color'}} getDisplayMode
 * @param {() => '2d'|'sidebyside'|'anaglyph'} getViewMode
 * @param {() => number} [getBrightnessScale] - optional; return scale for masterBrightness (1 = use core value)
 * @param {() => boolean} [getStripClip] - optional; when true, only draw pixels in each draw's strip (debug)
 * @param {() => number} [getObjXOffset] - optional; pixel offset for OBJ (layer 2) draws only; e.g. -8 for ghost test
 * @param {() => boolean} [getApplyOffsetToAllDraws] - optional; when true, apply objXOffset to all draws (debug when core doesn't set layer)
 * @param {() => number} [getBgXOffset] - optional; pixel offset for BG (layer 0) draws only; e.g. -8 for animated BG ghost test
 * @param {() => boolean} [getDeduplicateDraws] - optional; when true, only first draw per (tileIndex,x,y,eye) to fix core duplicate ghost
 * @param {() => 'transparent'|'occlude_black'} [getUnpackedMode] - unpacked tiles without pack entry
 * @param {(info: { durationMs: number, drawListLength: number }) => void} [onCompositeTiming] - after composite + putImageData
 * @param {() => boolean} [getSortDrawsByWorld] - when true (default if omitted), sort each eye's draws by VIP world id before compositing
 */
export function wireColorLayer(colorCanvas, getDisplayMode, getViewMode, getBrightnessScale, getStripClip, getObjXOffset, getApplyOffsetToAllDraws, getBgXOffset, getDeduplicateDraws, getUnpackedMode, onCompositeTiming, getSortDrawsByWorld) {
  let pack = null;
  /** @type {PositionOverride[]} */
  let overrides = [];
  /** @type {Group[]} */
  let groups = [];
  /** @type {unknown[]} - gameStatePools from groups.json (schema v2) */
  let gameStatePools = [];
  /** @type {Record<string, unknown>|null} */
  let painterV2Rules = null;
  /** @type {Map<string, Map<number, Uint8Array>>} */
  let vipOverlayByGroupAndEye = new Map();
  /** Draw paint on transparent pixels — only for packs flagged `paintOnTransparent`. */
  let drawTransparentPaint = false;
  const leftData = new ImageData(W, H);
  const rightData = new ImageData(W, H);
  /** Reused for final blit to avoid allocating every VIP frame. */
  let stereoOutImageData = /** @type {ImageData | null} */ (null);
  let stereoOutW = 0;
  let stereoOutH = 0;

  const onState = (state) => {
    if (getDisplayMode() !== 'color' || !pack) return;
    const t0 = typeof onCompositeTiming === 'function' ? performance.now() : 0;
    const brightnessScale = typeof getBrightnessScale === 'function' ? getBrightnessScale() : 1;
    const stripClip = typeof getStripClip === 'function' && getStripClip();
    const objXOffset = typeof getObjXOffset === 'function' ? getObjXOffset() : 0;
    const applyOffsetToAllDraws = typeof getApplyOffsetToAllDraws === 'function' && getApplyOffsetToAllDraws();
    const bgXOffset = typeof getBgXOffset === 'function' ? getBgXOffset() : 0;
    const deduplicateDraws = typeof getDeduplicateDraws === 'function' && getDeduplicateDraws();
    const unpackedMode = typeof getUnpackedMode === 'function' ? getUnpackedMode() : 'transparent';
    const wram = tryCopyVBSystemRamFromEmulator();
    const sortDrawsByWorld = typeof getSortDrawsByWorld === 'function' ? getSortDrawsByWorld() : true;
    const mode = getViewMode();
    /** Side-by-side and anaglyph need both eyes; 2D uses left only (~2× less compositing work). */
    const needRightEyeComposite = mode === 'sidebyside' || mode === 'anaglyph';

    const v2Variant = suggestedPainterV2VariantId(gameStatePools);
    // How the emulator and the player draw (src/project.js, view `play`), with their live settings.
    const project = { overrides, groups, gameStatePools, painterV2Rules, paintsTransparent: drawTransparentPaint };
    const live = { brightnessScale, stripClip, objXOffset, applyOffsetToAllDraws, bgXOffset, deduplicateDraws, wram, unpackedMode, sortDrawsByWorld, painterV2VariantId: v2Variant };
    compositeColorFrame(state, pack.entries, leftData, colourOptions(project, 'play', { ...live, eye: 0 }));
    // Same brightnessScale the composite used, so anchored paint fades with the scene, and the
    // owner buffer it just filled, so an overlay stops at whatever is drawn in front of it.
    blendPainterV2VipOverlaysIntoImageData(
      state, leftData, 0, groupsForScreen(groups, gameStatePools, wram), vipOverlayByGroupAndEye, brightnessScale, getCompositeDrawOwners(),
    );
    if (needRightEyeComposite) {
      // The right eye borrows the left's colour for its copies of left-only layers.
      const info = getCompositePixelInfo();
      const stereoSource = info.shade && info.world
        ? {
          data: leftData.data,
          shade: info.shade.slice(0, W * H),
          world: info.world.slice(0, W * H),
          art: info.art ? info.art.slice(0, W * H) : undefined,
          touched: new Set(info.touched),
        }
        : null;
      compositeColorFrame(state, pack.entries, rightData, colourOptions(project, 'play', { ...live, eye: 1, stereoSource }));
      blendPainterV2VipOverlaysIntoImageData(
        state, rightData, 1, groupsForScreen(groups, gameStatePools, wram), vipOverlayByGroupAndEye, brightnessScale, getCompositeDrawOwners(),
      );
    }

    const ctx = colorCanvas.getContext('2d');
    if (!ctx) {
      if (typeof onCompositeTiming === 'function') {
        onCompositeTiming({
          durationMs: performance.now() - t0,
          drawListLength: Array.isArray(state.drawList) ? state.drawList.length : 0,
        });
      }
      return;
    }
    const { width: outW, height: outH } = getStereoOutputSize(mode);
    if (colorCanvas.width !== outW || colorCanvas.height !== outH) {
      colorCanvas.width = outW;
      colorCanvas.height = outH;
    }
    if (!stereoOutImageData || stereoOutW !== outW || stereoOutH !== outH) {
      stereoOutImageData = ctx.createImageData(outW, outH);
      stereoOutW = outW;
      stereoOutH = outH;
    }
    compositeStereo(mode, leftData, rightData, stereoOutImageData);
    ctx.putImageData(stereoOutImageData, 0, 0);
    if (typeof onCompositeTiming === 'function') {
      onCompositeTiming({
        durationMs: performance.now() - t0,
        drawListLength: Array.isArray(state.drawList) ? state.drawList.length : 0,
      });
    }
  };

  return {
    onState,
    /** @param {boolean} on the pack's transparent-pixel paint is intentional (src/transparent-paint.js) */
    setDrawTransparentPaint(on) {
      drawTransparentPaint = !!on;
    },
    setPackFromBuffer(buf) {
      pack = buf ? parseVBColorPack(buf) : null;
      painterV2Rules = null;
      vipOverlayByGroupAndEye = new Map();
    },
    /**
     * Painter v2 payloads from a loaded .vbpack. Call after {@link setPackFromBuffer} in the same tick
     * so rules/overlays are not wiped (standalone .vbcolor load clears v2 via setPackFromBuffer only).
     * @param {unknown} rules - parsed painter-v2-rules.json or null
     * @param {string|undefined} vipOverlaysJson - raw painter-v2-vip-overlays.json string
     */
    setPainterV2FromVbpack(rules, vipOverlaysJson) {
      painterV2Rules =
        rules != null && typeof rules === 'object' && !Array.isArray(rules) ? /** @type {Record<string, unknown>} */ (rules) : null;
      if (typeof vipOverlaysJson === 'string' && vipOverlaysJson.length > 0) {
        vipOverlayByGroupAndEye = parsePainterV2VipOverlaysJson(vipOverlaysJson);
      } else {
        vipOverlayByGroupAndEye = new Map();
      }
    },
    /** @param {unknown} json - JSON array of override entries (see parsePositionOverrides).
     *  @returns {number} Count of overrides after parsing. */
    setOverrides(json) {
      overrides = parsePositionOverrides(json);
      return overrides.length;
    },
    /**
     * @param {unknown} json - array of group objects from vbpack (groups.json).
     * @param {unknown} [pools] - gameStatePools array; when undefined, pools are cleared.
     * @param {unknown} [gameStates] - the project's game states (src/game-states.js); left as they
     *   are when undefined
     */
    setGroups(json, pools, gameStates) {
      groups = Array.isArray(json) ? json : [];
      if (pools !== undefined) {
        gameStatePools = Array.isArray(pools) ? pools : [];
      }
      if (gameStates !== undefined) setProjectGameStates(gameStates);
      return groups.length;
    },
  };
}

export { W as COLOR_FB_WIDTH, H as COLOR_FB_HEIGHT };
