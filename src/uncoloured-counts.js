/**
 * Uncoloured counts saved in the pack (`uncoloured.json`): how many tiles and pixels each captured
 * frame leaves uncoloured (src/uncoloured.js), so the Project tool's Show filter does not have to
 * draw every frame again when a project opens.
 *
 *   { version: 1, paint: stamp, variant: painter rules variant ('' for none),
 *     frames: { "<frame file>": [frame text length, tiles, pixels] } }
 *
 * `paint` is a fingerprint of the stored entries that decide colour — color.vbcolor,
 * overrides.json, groups.json (groups, their pictures, screens and game states) and
 * painter-v2-rules.json — taken when the pack is written. A pack whose colour entries no longer
 * match it (another tool saved new paint and copied this file along) has its counts ignored, as
 * does a frame whose text length changed.
 */

export const UNCOLOURED_COUNTS_VERSION = 1;

/** FNV-1a over a string's UTF-16 code units, or over bytes, continuing from `h`. */
function fnv(h, value) {
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  } else if (value) {
    const u8 = value instanceof Uint8Array ? value : new Uint8Array(value);
    for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 16777619);
  }
  return h >>> 0;
}

/**
 * The fingerprint of a pack's colour entries, as stored.
 * @param {{ vbcolor?: ArrayBuffer | Uint8Array | null, overrides?: string | null, groups?: string | null, rules?: string | null }} entries
 * @returns {string}
 */
export function paintStamp({ vbcolor = null, overrides = null, groups = null, rules = null }) {
  const parts = [vbcolor, overrides, groups, rules];
  // Each entry's length and its own hash, so moving text between entries changes the stamp.
  return parts
    .map((p) => {
      const len = p == null ? -1 : typeof p === 'string' ? p.length : p.byteLength;
      return `${len.toString(36)}.${fnv(2166136261, p).toString(36)}`;
    })
    .join('-');
}

/**
 * The file to save, or null when no frame has a count.
 * @param {string} stamp @param {string} variant
 * @param {Record<string, [number, number, number]>} frames frame file → [text length, tiles, pixels]
 */
export function uncolouredCountsJson(stamp, variant, frames) {
  if (!Object.keys(frames).length) return null;
  return JSON.stringify({ version: UNCOLOURED_COUNTS_VERSION, paint: stamp, variant, frames });
}

/**
 * The saved counts, when they were made against these colour entries; null otherwise (another
 * version, unreadable, or the paint changed since).
 * @param {unknown} text @param {string} stamp
 * @returns {{ variant: string, frames: Record<string, [number, number, number]> } | null}
 */
export function readUncolouredCounts(text, stamp) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const doc = JSON.parse(text);
    if (doc?.version !== UNCOLOURED_COUNTS_VERSION || doc.paint !== stamp || !doc.frames || typeof doc.frames !== 'object') return null;
    return { variant: typeof doc.variant === 'string' ? doc.variant : '', frames: doc.frames };
  } catch {
    return null;
  }
}

/**
 * A frame's saved count, when it still matches the frame.
 * @param {{ frames: Record<string, any> } | null | undefined} saved
 * @param {string} vipFile @param {number} textLength
 * @returns {{ tiles: number, pixels: number } | null}
 */
export function savedCountFor(saved, vipFile, textLength) {
  const e = saved?.frames?.[vipFile];
  if (!Array.isArray(e) || e.length !== 3 || e[0] !== textLength) return null;
  const [, tiles, pixels] = e;
  return Number.isInteger(tiles) && Number.isInteger(pixels) && tiles >= 0 && pixels >= 0 ? { tiles, pixels } : null;
}
