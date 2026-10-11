/**
 * Colour by shade, for tiles the game animates by rewriting them.
 *
 * Some BG animation (the IntroCin starfield's twinkle) keeps drawing the same tile slots but
 * rewrites their pixels each step, so every step is a new pattern. Paint is stored per pattern,
 * so a step nobody painted would drop out. The ramp is the colour a group's painted tiles use
 * for each shade (1-3), and colours any unpainted step pixel by pixel from its shades.
 */

const TILE_RGBA_BYTES = 256;

/** @param {Uint8Array} bytes @param {number} x @param {number} y */
function shadeAt(bytes, x, y) {
  return ((bytes[y * 2] | (bytes[y * 2 + 1] << 8)) >> (x * 2)) & 3;
}

const toHex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * The colour most painted pixels of each shade carry, across a group's painted patterns.
 * @param {Map<number, Uint8Array>} tileColors hash → 256-byte RGBA
 * @param {(hash: number) => Uint8Array|null|undefined} bytesOf a pattern's 16 bytes, if known
 * @returns {Array<string|null>} index = shade; [0] is always null (transparent in the game)
 */
export function shadeRampFromPaint(tileColors, bytesOf) {
  /** @type {Array<Map<string, number>>} */
  const counts = [new Map(), new Map(), new Map(), new Map()];
  for (const [hash, rgba] of tileColors || []) {
    const bytes = bytesOf(hash);
    if (!bytes || !rgba || rgba.length < TILE_RGBA_BYTES) continue;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const s = shadeAt(bytes, x, y);
        const i = (y * 8 + x) * 4;
        if (s === 0 || rgba[i + 3] === 0) continue;
        const key = toHex(rgba[i], rgba[i + 1], rgba[i + 2]);
        counts[s].set(key, (counts[s].get(key) || 0) + 1);
      }
    }
  }
  return counts.map((m, s) => {
    if (s === 0 || m.size === 0) return null;
    return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  });
}

/** @param {string} hex '#rrggbb' */
function parseHex(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * A tile's RGBA from a ramp: each lit pixel takes its shade's colour; a shade the ramp has no
 * colour for stays transparent.
 * @param {Uint8Array} tileBytes @param {Array<string|null>|null|undefined} ramp
 * @returns {Uint8Array|null} null when the ramp colours nothing
 */
export function rgbaFromShadeRamp(tileBytes, ramp) {
  if (!Array.isArray(ramp)) return null;
  const colours = [null, parseHex(ramp[1]), parseHex(ramp[2]), parseHex(ramp[3])];
  if (!colours[1] && !colours[2] && !colours[3]) return null;
  const out = new Uint8Array(TILE_RGBA_BYTES);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const c = colours[shadeAt(tileBytes, x, y)];
      if (!c) continue;
      out.set([c[0], c[1], c[2], 255], (y * 8 + x) * 4);
    }
  }
  return out;
}
