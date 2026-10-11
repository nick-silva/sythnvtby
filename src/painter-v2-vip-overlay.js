/**
 * Parse and composite Painter v2 full-frame VIP RGBA overlays (`painter-v2-vip-overlays.json`)
 * for the main emulator color layer (same semantics as the Project tool's anchor BG overlay, tools/painter/vip-overlay-paint.js).
 */

import { getTileBytes, hashTile } from './vip-state.js';
import { fadeFactor } from './fade.js';

const W = 384;
const H = 224;

/**
 * How much to dim overlay paint, from the scene's own fade level. Same clamp and the same
 * `masterBrightness × scale` product `compositeColorFrame` uses on painted tiles.
 *
 * @param {{ masterBrightness?: number|null }} state
 * @param {number} brightnessScale
 * @returns {number} 0..1, exactly 1 when nothing is fading
 */
export function overlayBrightness(state, brightnessScale = 1) {
  return fadeFactor(state, brightnessScale);
}

/** @param {import('./vip-dump.js').DrawCall} d */
function drawEye(d) {
  const e = d.eye;
  if (e === 0 || e === 1) return e;
  const n = Number(e);
  return n === 0 || n === 1 ? n : 0;
}

/**
 * @param {import('./vip-dump.js').DrawCall} draw
 * @param {{ criteria?: { windowIds?: unknown[], worldIds?: unknown[], hashes?: unknown[], layers?: unknown[] } }} group
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
    if (L === undefined || L === null || !c.layers.has(Number(L))) return false;
  }
  return true;
}

/**
 * A group's criteria as Sets, cached on the group object.
 *
 * This runs once per draw per group — tens of thousands of times a frame once overlays check
 * what is in front of them — so it must not scan or allocate. A world-sized group holds
 * hundreds of hashes, and `Array.includes` on that is what made this quadratic.
 */
const criteriaCache = new WeakMap();
const EMPTY_CRITERIA_KEY = Object.freeze({});
function normalizedCriteria(group) {
  const raw = group?.criteria || null;
  const key = group || EMPTY_CRITERIA_KEY;
  const entry = criteriaCache.get(key);
  if (entry && entry.source === raw) return entry.value;
  const toNumSet = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const out = new Set();
    for (const v of arr) {
      const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
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
  criteriaCache.set(key, { source: raw, value });
  return value;
}

/**
 * Every draw for one eye paired with its pattern hash, hashing each distinct tile index once.
 * Checking groups one at a time used to re-hash the whole draw list per group, which on a
 * layered scene like the intro cinematic is tens of thousands of hashes per frame.
 *
 * @param {import('./vip-dump.js').VIPState} state
 * @param {number} eye 0 | 1
 * @returns {Array<{ d: import('./vip-dump.js').DrawCall, h: number, index: number }>}
 */
function hashDrawsForEye(state, eye) {
  const pt = state.patternTable;
  const dl = state.drawList;
  const out = [];
  const hashByTileIndex = new Map();
  for (let fi = 0; fi < dl.length; fi++) {
    const d = dl[fi];
    if (!d || drawEye(d) !== eye) continue;
    let h = hashByTileIndex.get(d.tileIndex);
    if (h === undefined) {
      h = hashTile(getTileBytes(pt, d.tileIndex)) >>> 0;
      hashByTileIndex.set(d.tileIndex, h);
    }
    out.push({ d, h, index: fi });
  }
  return out;
}

/**
 * Which draws belong to this group, as a flag per draw-list index. Built once per group per
 * frame so the per-pixel test is a single array read; a memoised per-draw variant was tried
 * and came out no faster, because an overlay ends up asking about most draws near it anyway.
 *
 * @param {Array<{ d: any, h: number, index: number }>} drawsWithHash
 * @param {{ criteria?: unknown }} group
 * @param {number} drawCount
 */
function groupMembershipByDrawIndex(drawsWithHash, group, drawCount) {
  const member = new Uint8Array(drawCount);
  for (let i = 0; i < drawsWithHash.length; i++) {
    const { d, h, index } = drawsWithHash[i];
    if (drawMatchesGroup(d, group, h)) member[index] = 1;
  }
  return member;
}

/**
 * Which draws belong to this group, as a flag per draw-list index — for a caller that has a
 * frame and one group, namely the authoring tools, which blend their own overlays and need the
 * same "is my group what you can see here" test.
 *
 * @param {import('./vip-dump.js').VIPState} state
 * @param {number} eye
 * @param {{ criteria?: unknown }} group
 */
export function groupDrawMembership(state, eye, group) {
  if (!state?.drawList || !state.patternTable) return new Uint8Array(0);
  const drawCount = state.drawList.length;
  const member = new Uint8Array(drawCount);
  const draws = hashDrawsForEye(state, eye & 1);
  for (let i = 0; i < draws.length; i++) {
    if (drawMatchesGroup(draws[i].d, group, draws[i].h)) member[draws[i].index] = 1;
  }
  return member;
}

/**
 * @param {Array<{ d: import('./vip-dump.js').DrawCall, h: number, index: number }>} drawsWithHash
 * @param {{ id?: string, anchorHash?: number, criteria?: unknown }} group
 */
/**
 * Groups whose overlay belongs on this frame: those whose anchor tile is drawn here, in the
 * group's own worlds and layers, on this eye. An overlay is paint for one screen; this is the
 * rule the emulator blends by, and every other view should follow it too.
 * @param {import('./vip-dump.js').VIPState} state
 * @param {number} eye 0 | 1
 * @param {Array<{ id: string, anchorHash?: number, criteria?: object }>} groups
 * @returns {Set<string>} group ids
 */
export function overlayGroupsOnScreen(state, eye, groups) {
  const out = new Set();
  if (!state?.patternTable || !Array.isArray(state.drawList) || !Array.isArray(groups)) return out;
  const drawsWithHash = hashDrawsForEye(state, eye & 1);
  for (const g of groups) if (g && anchorPresentIn(drawsWithHash, g)) out.add(g.id);
  return out;
}

function anchorPresentIn(drawsWithHash, group) {
  if (typeof group.anchorHash !== 'number' || !Number.isFinite(group.anchorHash)) return false;
  const ah = group.anchorHash >>> 0;
  for (let i = 0; i < drawsWithHash.length; i++) {
    const { d, h } = drawsWithHash[i];
    if (h !== ah) continue;
    if (drawMatchesGroup(d, group, h)) return true;
  }
  return false;
}

/**
 * The rectangle an overlay actually paints, so blending can skip the empty rest of the
 * frame. Cached per buffer — overlay buffers on this path come from
 * `parsePainterV2VipOverlaysJson` and are never mutated after parsing.
 *
 * @param {Uint8Array} buf
 * @returns {{ x0: number, y0: number, x1: number, y1: number } | null}
 */
const paintedBoundsCache = new WeakMap();
function paintedBounds(buf) {
  const cached = paintedBoundsCache.get(buf);
  if (cached !== undefined) return cached;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (buf[(row + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  const box = x1 < 0 ? null : { x0, y0, x1, y1 };
  paintedBoundsCache.set(buf, box);
  return box;
}

/**
 * @param {string | null | undefined} jsonStr
 * @returns {Map<string, Map<number, Uint8Array>>} groupId → eye → RGBA384×224
 */
export function parsePainterV2VipOverlaysJson(jsonStr) {
  const map = /** @type {Map<string, Map<number, Uint8Array>>} */ (new Map());
  if (!jsonStr || typeof jsonStr !== 'string') return map;
  let doc;
  try {
    doc = JSON.parse(jsonStr);
  } catch {
    return map;
  }
  if (!doc || typeof doc !== 'object' || doc.schemaVersion !== 1) return map;
  if (doc.width !== W || doc.height !== H) return map;
  const entries = doc.entries;
  if (!Array.isArray(entries)) return map;
  for (const e of entries) {
    const groupId = typeof e?.groupId === 'string' ? e.groupId.trim() : '';
    const eye = e?.eye === 1 ? 1 : 0;
    const b64 = typeof e?.rgbaBase64 === 'string' ? e.rgbaBase64 : '';
    if (!groupId || !b64) continue;
    let rgba;
    try {
      const bin = atob(b64);
      rgba = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) rgba[i] = bin.charCodeAt(i);
    } catch {
      continue;
    }
    if (rgba.length !== W * H * 4) continue;
    let byEye = map.get(groupId);
    if (!byEye) {
      byEye = new Map();
      map.set(groupId, byEye);
    }
    byEye.set(eye, rgba);
  }
  return map;
}

/**
 * Blend saved VIP authoring overlays for groups whose anchor tile appears on this frame/eye.
 *
 * @param {import('./vip-dump.js').VIPState} state
 * @param {ImageData} imageData
 * @param {number} eye
 * @param {Array<{ id?: string, anchorHash?: number, criteria?: unknown }>} groups
 * @param {Map<string, Map<number, Uint8Array>>} overlayByGroupAndEye
 * @param {number} [brightnessScale] same value `compositeColorFrame` was given, so overlay
 *   paint fades with the scene instead of staying lit while everything around it dims
 * @param {Int32Array|null} [drawOwners] front-most lit draw per pixel, from
 *   `getCompositeDrawOwners()`. With it, an overlay paints only where its own group is the
 *   thing you can actually see, so a sprite passing in front of an anchored background stays
 *   visible. Without it the overlay paints wherever it has pixels, as it always did.
 */
export function blendPainterV2VipOverlaysIntoImageData(state, imageData, eye, groups, overlayByGroupAndEye, brightnessScale = 1, drawOwners = null) {
  if (!overlayByGroupAndEye || overlayByGroupAndEye.size === 0) return;
  if (!state?.drawList || !state.patternTable) return;
  const e = eye & 1;
  const d = imageData.data;
  // Matches the per-pixel maths in compositeColorFrame, so a painted tile and the overlay
  // covering it dim together through a fade.
  const k = overlayBrightness(state, brightnessScale);
  const drawsWithHash = hashDrawsForEye(state, e);
  /** @type {Array<{ id: string, g: (typeof groups)[0] }>} */
  const layers = [];
  for (const gid of overlayByGroupAndEye.keys()) {
    const buf = overlayByGroupAndEye.get(gid)?.get(e);
    if (!buf || buf.length !== W * H * 4) continue;
    const g = groups.find((x) => x && typeof x.id === 'string' && x.id === gid);
    if (!g) continue;
    if (!anchorPresentIn(drawsWithHash, g)) continue;
    layers.push({ id: gid, g });
  }
  layers.sort((a, b) => a.id.localeCompare(b.id));
  const drawCount = state.drawList.length;
  for (const { g } of layers) {
    const gid = typeof g.id === 'string' ? g.id : '';
    const o = gid ? overlayByGroupAndEye.get(gid)?.get(e) : null;
    if (!o) continue;
    const member = drawOwners ? groupMembershipByDrawIndex(drawsWithHash, g, drawCount) : null;
    // Painted tiles usually cover a fraction of the screen, so walk that box rather than
    // all 86k pixels of an overlay that is mostly transparent.
    const box = paintedBounds(o);
    if (!box) continue;
    for (let y = box.y0; y <= box.y1; y++) {
      const rowStart = (y * W + box.x0) * 4;
      const rowEnd = (y * W + box.x1) * 4;
      for (let i = rowStart; i <= rowEnd; i += 4) {
        if (o[i + 3] === 0) continue;
        if (member) {
          const owner = drawOwners[i >> 2];
          if (owner < 0 || !member[owner]) continue; // something else is in front of it here
        }
        d[i] = k === 1 ? o[i] : (o[i] * k) | 0;
        d[i + 1] = k === 1 ? o[i + 1] : (o[i + 1] * k) | 0;
        d[i + 2] = k === 1 ? o[i + 2] : (o[i + 2] * k) | 0;
        d[i + 3] = o[i + 3];
      }
    }
  }
}
