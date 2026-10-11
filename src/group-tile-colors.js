/**
 * Group-scoped tile colour: the colours a group paints onto its own tile patterns.
 *
 * Colour in a `.vbcolor` pack is keyed by pattern hash alone, so painting a pattern colours
 * every copy of it on every frame. That cannot express "this black-out tile, but only in the
 * cloud layer" — a scene like the intro cinematic draws one solid pattern across a dozen
 * worlds and each needs its own colour. A group holds its own colours here instead, applied
 * only to draws that match the group's criteria (world + layer + hashes), falling back to the
 * pack when the group has nothing to say.
 *
 * Stored in `groups.json` as `tileColors: { "<unsigned hash, decimal>": "<base64 RGBA>" }`.
 * This module is pure data — no draw matching, so the tools and the compositor can share it.
 *
 * While authoring, a tool may instead put a live `Map<hash, Uint8Array>` in that field and
 * paint into its buffers directly; the compositor reads it as-is, and
 * {@link groupWithEncodedTileColors} converts it back to the stored form on save. That keeps
 * a brush stroke from re-encoding base64 on every pixel.
 */

/** 8×8 pixels, RGBA. */
export const TILE_RGBA_BYTES = 256;

/**
 * Decoded colours per stored `tileColors` object. Keyed on the stored colours rather than the
 * group, so a copy of a group (`{ ...group, overpaint: … }`, made per composite in places) reuses
 * the decoding; replacing the colours (a new object) decodes again.
 */
const decodeCache = new WeakMap();

/** @param {string} b64 */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** A hash as it is written in JSON: unsigned 32-bit, decimal, no sign. */
function hashKey(hash) {
  return String(hash >>> 0);
}

/**
 * The group's painted patterns as `hash → RGBA`. Cached on the group object, so callers may
 * treat the result as read-only; use {@link withGroupTileColor} to change it.
 *
 * @param {{ tileColors?: Record<string, string> } | null | undefined} group
 * @returns {Map<number, Uint8Array>}
 */
export function decodeGroupTileColors(group) {
  if (!group || typeof group !== 'object') return new Map();
  const raw = group.tileColors;
  // A tool is painting into this group right now — its buffers are already the live truth.
  if (raw instanceof Map) return raw;
  const keyed = raw && typeof raw === 'object';
  const cached = keyed ? decodeCache.get(raw) : null;
  if (cached) return cached;
  /** @type {Map<number, Uint8Array>} */
  const value = new Map();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of Object.keys(raw)) {
      const hash = Number(key);
      if (!Number.isFinite(hash)) continue;
      const b64 = raw[key];
      if (typeof b64 !== 'string' || !b64) continue;
      let bytes;
      try {
        bytes = base64ToBytes(b64);
      } catch {
        continue;
      }
      if (bytes.length !== TILE_RGBA_BYTES) continue;
      value.set(hash >>> 0, bytes);
    }
  }
  if (keyed) decodeCache.set(raw, value);
  return value;
}

/**
 * @param {Map<number, Uint8Array>} map
 * @returns {Record<string, string>}
 */
export function encodeGroupTileColors(map) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!map) return out;
  for (const [hash, rgba] of map) {
    if (!(rgba instanceof Uint8Array) || rgba.length !== TILE_RGBA_BYTES) continue;
    out[hashKey(hash)] = bytesToBase64(rgba);
  }
  return out;
}

/**
 * A copy of the group with one pattern painted. The group is not modified.
 *
 * @template {{ tileColors?: Record<string, string> }} G
 * @param {G} group
 * @param {number} hash
 * @param {Uint8Array} rgba 256 bytes
 * @returns {G}
 */
export function withGroupTileColor(group, hash, rgba) {
  if (!(rgba instanceof Uint8Array) || rgba.length !== TILE_RGBA_BYTES) return group;
  const merged = new Map(decodeGroupTileColors(group));
  merged.set(hash >>> 0, Uint8Array.from(rgba));
  return { ...group, tileColors: encodeGroupTileColors(merged) };
}

/**
 * A copy of the group with one pattern unpainted, dropping `tileColors` when it empties.
 *
 * @template {{ tileColors?: Record<string, string> }} G
 * @param {G} group
 * @param {number} hash
 * @returns {G}
 */
export function withoutGroupTileColor(group, hash) {
  const merged = new Map(decodeGroupTileColors(group));
  if (!merged.delete(hash >>> 0)) return group;
  const next = { ...group };
  if (merged.size === 0) delete next.tileColors;
  else next.tileColors = encodeGroupTileColors(merged);
  return next;
}

/**
 * A copy of the group with no painted patterns at all.
 *
 * @template {{ tileColors?: Record<string, string> }} G
 * @param {G} group
 * @returns {G}
 */
export function withoutAnyGroupTileColor(group) {
  if (!group || group.tileColors === undefined) return group;
  const next = { ...group };
  delete next.tileColors;
  return next;
}

/**
 * The group as it should be written to `groups.json`: a live authoring Map becomes the stored
 * base64 form, and a group that paints nothing loses the field entirely.
 *
 * @template {{ tileColors?: Record<string, string> | Map<number, Uint8Array> }} G
 * @param {G} group
 * @returns {G}
 */
export function groupWithEncodedTileColors(group) {
  if (!group || typeof group !== 'object') return group;
  const raw = group.tileColors;
  if (raw === undefined) return group;
  const encoded = raw instanceof Map ? encodeGroupTileColors(raw) : raw;
  const next = { ...group };
  if (!encoded || Object.keys(encoded).length === 0) delete next.tileColors;
  else next.tileColors = encoded;
  return next;
}

/**
 * @param {{ tileColors?: Record<string, string> } | null | undefined} group
 * @returns {number[]}
 */
export function groupTileColorHashes(group) {
  return [...decodeGroupTileColors(group).keys()];
}

/**
 * @param {{ tileColors?: Record<string, string> } | null | undefined} group
 * @returns {number}
 */
export function groupTileColorCount(group) {
  return decodeGroupTileColors(group).size;
}
