/**
 * The Project tool's older paint kinds, read from the pack and written back at Save: VIP overlays,
 * touch-ups, position overrides and the painterV2 rules (variant picker, paint top tile to rule). Split out of tools/painter.js, which passes in the state and functions it shares
 * (initPackRules).
 */
import { deserializeVIPState } from '../../src/vip-dump.js';
import { defaultPainterV2Rules } from '../../src/art-pack.js';
import { setLayerArtPixels, clearLayerArtPixels, artPixelsFor } from '../../src/layer-art.js';
import { encodePngBase64 } from '../../src/layer-art-png.js';
import { touchUpOf, touchUpKey, convertOverlaysToTouchUps } from '../../src/touch-up.js';
import { withoutStrayTransparentPaint } from '../../src/project.js';
import { overlaysJsonWithoutGroup } from '../shared/pack-session.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initPackRules(context) {
  ctx = context;
}

function suggestedVariantId() {
  for (const p of ctx.gameStatePools) {
    const variants = p?.variants;
    if (!Array.isArray(variants) || variants.length === 0) continue;
    const v = variants[0];
    const id = typeof v?.id === 'string' ? v.id.trim() : '';
    if (id) return id;
  }
  return '__default__';
}

export function ensurePainterV2Rules() {
  if (ctx.painterV2Rules && typeof ctx.painterV2Rules === 'object' && !Array.isArray(ctx.painterV2Rules)) {
    return ctx.painterV2Rules;
  }
  ctx.painterV2Rules = defaultPainterV2Rules();
  return ctx.painterV2Rules;
}

function uint8ToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/** @param {string} b64 */
function base64ToUint8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} buf */
function vipOverlayBufferHasPaint(buf) {
  for (let i = 3; i < buf.length; i += 4) {
    if (buf[i] !== 0) return true;
  }
  return false;
}

/** @returns {{ json: string | null; layers: number }} */
export function serializePainterVipOverlaysForSave() {
  /** @type {Array<{ groupId: string; eye: number; rgbaBase64: string }>} */
  const entries = [];
  for (const [groupId, byEye] of ctx.vipAuthoringByGroupAndEye) {
    for (const [eyeKey, buf] of byEye) {
      const eye = Number(eyeKey) & 1;
      if (!buf || buf.length !== ctx.W * ctx.H * 4) continue;
      if (!vipOverlayBufferHasPaint(buf)) continue;
      entries.push({ groupId, eye, rgbaBase64: uint8ToBase64(buf) });
    }
  }
  if (entries.length === 0) return { json: null, layers: 0 };
  return {
    json: JSON.stringify({ schemaVersion: 1, width: ctx.W, height: ctx.H, entries }),
    layers: entries.length,
  };
}

/**
 * @param {string | undefined} jsonStr
 * @returns {number} number of group+eye layers applied
 */
export function restorePainterVipOverlaysFromPack(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') return 0;
  let doc;
  try {
    doc = JSON.parse(jsonStr);
  } catch {
    return 0;
  }
  if (!doc || typeof doc !== 'object' || doc.schemaVersion !== 1) return 0;
  if (doc.width !== ctx.W || doc.height !== ctx.H) return 0;
  const entries = doc.entries;
  if (!Array.isArray(entries)) return 0;
  let n = 0;
  for (const e of entries) {
    const groupId = typeof e?.groupId === 'string' ? e.groupId.trim() : '';
    const eye = e?.eye === 1 ? 1 : 0;
    const b64 = typeof e?.rgbaBase64 === 'string' ? e.rgbaBase64 : '';
    if (!groupId || !b64) continue;
    let rgba;
    try {
      rgba = base64ToUint8(b64);
    } catch {
      continue;
    }
    const expected = ctx.W * ctx.H * 4;
    if (rgba.length !== expected) continue;
    const buf = ctx.ensureVipOverlayBufferForGroupEye(groupId, eye);
    buf.set(rgba);
    n++;
  }
  return n;
}

/** Touch-ups converted or edited since the last save; their pixels are PNG-encoded on save. */
const touchUpsToEncode = new Set();

/**
 * Turn old screen-pinned overlays into touch-ups (src/touch-up.js), anchored where each was
 * painted. Groups whose anchor no captured frame shows keep their overlay. Returns the counts.
 */
export function convertLoadedOverlaysToTouchUps() {
  // A new pack: forget touch-up pixels edited for the last one, so saved PNGs show.
  touchUpsToEncode.clear();
  for (const g of ctx.groups) clearLayerArtPixels(touchUpKey(g.id));
  if (!ctx.vipAuthoringByGroupAndEye.size || !ctx.availableFrames.length) return { converted: 0, kept: 0 };
  const result = convertOverlaysToTouchUps({
    groups: ctx.groups,
    overlays: ctx.vipAuthoringByGroupAndEye,
    frameCount: ctx.availableFrames.length,
    frameAt: (i) => {
      try {
        return deserializeVIPState(JSON.parse(ctx.availableFrames[i].json));
      } catch {
        return null;
      }
    },
  });
  if (!result.converted.length) return { converted: 0, kept: result.kept.length };
  ctx.groups = result.groups;
  for (const id of result.converted) {
    setLayerArtPixels(touchUpKey(id), result.pixels.get(id));
    touchUpsToEncode.add(id);
    ctx.vipAuthoringByGroupAndEye.delete(id);
    if (ctx.loadedPackParts && typeof ctx.loadedPackParts.painterV2VipOverlays === 'string') {
      ctx.loadedPackParts.painterV2VipOverlays = overlaysJsonWithoutGroup(ctx.loadedPackParts.painterV2VipOverlays, id);
    }
  }
  ctx.groupsDirty = true;
  return { converted: result.converted.length, kept: result.kept.length };
}

/**
 * A pack saved before paint on transparent pixels was drawn (src/transparent-paint.js) may hold
 * stray strokes there that never showed. Clear them once, so nothing changes on screen, and flag
 * the pack so paint on transparent pixels from now on is kept and drawn.
 * @returns {null | { pixels: number, tiles: number, unknown: number }} null when already flagged
 */
export function clearStrayTransparentPaint() {
  if (!ctx.loadedPackParts) return null;
  const frameAt = (i) => {
    try {
      return deserializeVIPState(JSON.parse(ctx.availableFrames[i].json));
    } catch {
      return null;
    }
  };
  const r = withoutStrayTransparentPaint({ pack: ctx.pack, groups: ctx.groups, manifest: ctx.loadedPackParts.manifest }, ctx.availableFrames.length, frameAt);
  if (!r.cleared) return null;
  ctx.pack = r.pack;
  ctx.groups = r.groups;
  ctx.loadedPackParts.manifest = r.manifest;
  if (r.cleared.pixels) {
    ctx.markGroupsDirty();
    ctx.paintEditsSinceSave++;
    ctx.invalidateGroupColorIndex();
  }
  return r.cleared;
}

/** Store the pixels of converted or edited touch-ups as PNGs on their groups, before Save. */
export async function encodeTouchUpsForSave() {
  for (const id of [...touchUpsToEncode]) {
    const i = ctx.groups.findIndex((g) => g.id === id);
    const tu = i >= 0 ? touchUpOf(ctx.groups[i]) : null;
    const px = tu ? artPixelsFor(touchUpKey(id), '') : null;
    if (!tu || !px) {
      touchUpsToEncode.delete(id);
      continue;
    }
    const png = await encodePngBase64(px);
    ctx.groups = ctx.groups.map((g, j) => (j === i ? { ...g, touchUp: { ...tu, png } } : g));
    touchUpsToEncode.delete(id);
  }
}

/** Re-apply `painter-v2-vip-overlays.json` from the in-memory pack (e.g. after Reload frame clears authoring). */
export function reapplyPackVipAuthoringOverlaysFromLoadedPack() {
  const raw =
    ctx.loadedPackParts && typeof ctx.loadedPackParts.painterV2VipOverlays === 'string' ? ctx.loadedPackParts.painterV2VipOverlays : '';
  const n = restorePainterVipOverlaysFromPack(raw);
  if (n > 0) ctx.render();
  return n;
}

/** JSON shape for overrides.json (matches paint tool export). */
export function serializeOverridesForSave() {
  return ctx.overrides.map((o) => ({
    hash: o.hash >>> 0,
    xMin: o.xMin,
    yMin: o.yMin,
    xMax: o.xMax,
    yMax: o.yMax,
    ...(o.layer !== undefined && o.layer !== null && { layer: o.layer }),
    ...(o.groupId && typeof o.groupId === 'string' && { groupId: o.groupId }),
    ...(Array.isArray(o.ramConditions) && o.ramConditions.length && { ramConditions: o.ramConditions }),
    ...(o.rgba && o.rgba.length >= 256 ? { rgbaBase64: uint8ToBase64(o.rgba.subarray(0, 256)) } : {}),
    ...(typeof o.alternateHash === 'number' && Number.isFinite(o.alternateHash)
      ? { alternateHash: o.alternateHash >>> 0 }
      : {}),
  }));
}

/** Variant id for v2 tile8: manual override if set, otherwise automatic. */
export function getActiveV2VariantId() {
  const o = ctx.v2Tile8VariantOverride != null ? String(ctx.v2Tile8VariantOverride).trim() : '';
  if (o) return o;
  return suggestedVariantId();
}

export function syncV2VariantSelect() {
  if (!ctx.v2VariantSelect) return;
  ctx.v2VariantSelect.innerHTML = '';
  const add = (id, label) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = label;
    ctx.v2VariantSelect.appendChild(o);
  };
  add('__default__', '__default__ (fallback)');
  for (const p of ctx.gameStatePools) {
    const poolLabel = typeof p?.label === 'string' && p.label.trim() ? p.label.trim() : (typeof p?.id === 'string' ? p.id : 'pool');
    const variants = p?.variants;
    if (!Array.isArray(variants)) continue;
    for (const v of variants) {
      const id = typeof v?.id === 'string' ? v.id.trim() : '';
      if (!id) continue;
      const vl = typeof v?.label === 'string' && v.label.trim() ? v.label.trim() : id;
      add(id, `${poolLabel} — ${vl}`);
    }
  }
  const ids = new Set(Array.from(ctx.v2VariantSelect.options).map((o) => o.value));
  const auto = suggestedVariantId();
  const want = ctx.v2Tile8VariantOverride != null && String(ctx.v2Tile8VariantOverride).trim() && ids.has(String(ctx.v2Tile8VariantOverride).trim())
    ? String(ctx.v2Tile8VariantOverride).trim()
    : ids.has(auto)
      ? auto
      : '__default__';
  ctx.v2VariantSelect.value = want;
}

export function setV2AuthoringVisible(on) {
  if (!ctx.v2Authoring) return;
  ctx.v2Authoring.hidden = !on;
  if (!on) ctx.v2Authoring.open = false;
}

export function updatePaintV2TopButton() {
  if (!ctx.btnPaintV2Top) return;
  const hasPack = ctx.loadedPackParts != null;
  const hasTile = ctx.lastTopTileHash != null;
  const hasRgba = hasTile && ctx.pack.has(ctx.lastTopTileHash >>> 0);
  ctx.btnPaintV2Top.disabled = !hasPack || !ctx.currentState || !hasTile || !hasRgba;
}

export function paintTopTileToV2Rule() {
  if (!ctx.loadedPackParts) {
    ctx.setStatus('Load a .vbpack first.');
    return;
  }
  if (!ctx.currentState?.patternTable) {
    ctx.setStatus('No frame loaded.');
    return;
  }
  if (ctx.lastTopTileHash == null) {
    ctx.setStatus('Click a tile on the canvas first (front tile is used).');
    return;
  }
  const h = ctx.lastTopTileHash >>> 0;
  const rgba = ctx.pack.get(h);
  if (!rgba || rgba.length < 256) {
    ctx.setStatus(
      `No vbcolor entry for hash #${h.toString(16).toUpperCase()} — add color in v1 / pack editor first.`,
    );
    return;
  }
  const rules = ensurePainterV2Rules();
  const variant = getActiveV2VariantId();
  const tile8ByVariant =
    rules.tile8ByVariant != null && typeof rules.tile8ByVariant === 'object' && !Array.isArray(rules.tile8ByVariant)
      ? { ...rules.tile8ByVariant }
      : {};
  const prevBucket = tile8ByVariant[variant];
  const bucket =
    prevBucket != null && typeof prevBucket === 'object' && !Array.isArray(prevBucket) ? { ...prevBucket } : {};
  const hKey = String(h);
  bucket[hKey] = { rgbaBase64: uint8ToBase64(rgba.subarray(0, 256)) };
  tile8ByVariant[variant] = bucket;
  rules.tile8ByVariant = tile8ByVariant;
  ctx.painterV2Rules = rules;
  ctx.setStatus(`v2 tile8: variant "${variant}" · hash #${h.toString(16).toUpperCase()}`);
  ctx.render();
  updatePaintV2TopButton();
}
