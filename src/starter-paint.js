/**
 * Starter shades: the colours a tile's paint begins with the first time any pixel of it is
 * painted — each pixel value gets a plain shade (greys in SpriteStudio, reds in the Project tool,
 * see tools/shared/pack-session.js and tools/painter.js). Nobody chose them, so tools that match
 * pixels by colour treat them as unpainted: otherwise a tile painted once (only its transparent
 * pixels, say) stops matching "unpainted" everywhere else, and a group-wide colour swap skips it.
 */

/**
 * RGB per pixel value 1–3, one list per tool that seeds paint. Index 0 (transparent) is unused.
 * One step of blue off the plain shades (invisible), so a colour someone picks — pure red,
 * 255,0,0, is a common one — is never mistaken for a starter shade.
 */
export const STARTER_SHADES = Object.freeze([
  Object.freeze([null, [80, 80, 81], [160, 160, 161], [240, 240, 241]]), // SpriteStudio
  Object.freeze([null, [80, 0, 1], [160, 0, 1], [255, 0, 1]]), // Project tool
]);

/** The starter shades before Oct 9 2026 (plain greys and reds), as [old, new] RGB pairs. */
const OLD_STARTER_SHADES = STARTER_SHADES.flatMap((ramp, t) => {
  const old = [[null, [80, 80, 80], [160, 160, 160], [240, 240, 240]], [null, [80, 0, 0], [160, 0, 0], [255, 0, 0]]][t];
  return [1, 2, 3].map((v) => [old[v], ramp[v]]);
});

/**
 * Paint seeded with the old starter shades, moved to the new ones (they look the same). Run when a
 * tool opens a pack. A colour someone chose that happens to be an old starter shade exactly
 * (pure red painted before Oct 9 2026) cannot be told apart and moves too — it was already
 * treated as unpainted, so nothing changes for it; pure red painted from now on stays a colour.
 * @param {Map<number, Uint8Array>} pack shared paint, pattern hash → 256 RGBA bytes
 * @param {any[]} groups with `tileColors` as stored or as a Map
 * @param {(group: any) => Map<number, Uint8Array>} decode a group's paint (src/group-tile-colors.js)
 * @returns {{ pack: Map<number, Uint8Array>, groups: any[], pixels: number }} the same objects when nothing changed
 */
export function convertOldStarterShades(pack, groups, decode) {
  let pixels = 0;
  const convert = (map) => {
    let out = null;
    for (const [h, buf] of map) {
      let copy = null;
      for (let i = 0; i < buf.length; i += 4) {
        if (buf[i + 3] !== 255) continue;
        const hit = OLD_STARTER_SHADES.find(([o]) => o[0] === buf[i] && o[1] === buf[i + 1] && o[2] === buf[i + 2]);
        if (!hit) continue;
        copy ||= Uint8Array.from(buf);
        copy.set(hit[1], i);
        pixels++;
      }
      if (copy) (out ||= new Map(map)).set(h, copy);
    }
    return out;
  };
  const nextPack = convert(pack) || pack;
  const nextGroups = groups.map((g) => {
    const own = decode(g);
    if (!own.size) return g;
    const next = convert(own);
    return next ? { ...g, tileColors: next } : g;
  });
  return { pack: nextPack, groups: pixels ? nextGroups : groups, pixels };
}

/**
 * Is this colour one of the starter shades (any tool, any pixel value)? The palette leaves them
 * out: nobody chose them, and painting with one would look unpainted to Swap and Show unpainted.
 * @param {number} r @param {number} g @param {number} b
 */
export function isStarterColour(r, g, b) {
  // Asked per pixel (palettes, thumbnails): one set lookup rather than a walk of every ramp.
  return STARTER_RGB.has((r << 16) | (g << 8) | b);
}
const STARTER_RGB = new Set(STARTER_SHADES.flatMap((ramp) => ramp.filter(Boolean).map(([r, g, b]) => (r << 16) | (g << 8) | b)));

/**
 * Any of a tool's starter shades counts, not just the one for this pixel's value: SpriteStudio
 * starts a background tile from the shade the game's palette shows each value in, which need not
 * be the value itself (Mario's Tennis inverts palette 0).
 * @param {Uint8Array} rgba a tile's 256-byte paint
 * @param {number} i pixel index 0–63
 * @param {number} value the pattern's pixel value there (1–3)
 * @returns {boolean} the lit pixel still shows a starter shade
 */
export function isStarterShade(rgba, i, value) {
  if (!rgba || value < 1 || value > 3 || rgba[i * 4 + 3] !== 255) return false;
  const r = rgba[i * 4];
  const g = rgba[i * 4 + 1];
  const b = rgba[i * 4 + 2];
  return isStarterColour(r, g, b);
}

/**
 * A starter shade kept on purpose (SpriteStudio's Painting complete): one more step of blue — the
 * same grey to the eye, but a colour someone chose, so nothing counts it as unpainted any more. It is
 * neither a starter shade nor an old one ({@link convertOldStarterShades} moves those), so it stays
 * as it is. Any other colour comes back unchanged.
 * @param {number} r @param {number} g @param {number} b
 * @returns {[number, number, number]}
 */
export function keptStarterColour(r, g, b) {
  return isStarterColour(r, g, b) ? [r, g, b + 1] : [r, g, b];
}
