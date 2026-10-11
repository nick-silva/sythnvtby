/**
 * Stereo twins: a layer a game draws twice, once per eye, in two neighbouring worlds.
 *
 * The VIP shows a world on the left eye (LON), the right (RON) or both. Many games give a flat
 * layer depth inside it by drawing it twice — a left-only world and, next to it, a right-only
 * world reading a stereo-shifted copy of the art from another part of the BG map (Mario's
 * Tennis's crowd: worlds 30/31, map rows 352 and 432). Everything an author paints is seen on
 * the left eye, so without this rule the right eye's copy matches no group: no layer art, no
 * touch-up, and tile paint only where the copy happens to reuse the left's patterns.
 *
 * `stereoTwins(windows)` pairs each right-only world with a left-only neighbour (world index − 1,
 * else + 1: Mario's Tennis's title puts the left eye in world 28 and the right in 27) when both
 * have the same mode, map size and rows. Their window or source
 * may differ across (some games crop each eye differently), so the pairing carries `shift`: the
 * right-eye screen x of what the left eye shows at x − shift, the same map columns seen through
 * each world's own placement and parallax.
 *
 * See docs/design/vb-color-player.md §2.
 */

const WORLD_BYTES = 32;
const HDR_LON = 0x8000;
const HDR_RON = 0x4000;
const HDR_END = 0x40;
/** Mode (bits 12–13) plus OVER, SCY and SCX (bits 7–11): must match between twins. */
const TWIN_HEADER_MASK = 0x3f80;
const BGM_AFFINE = 2;
/** Twins further apart than this across are taken as two unrelated layers. */
export const MAX_TWIN_SHIFT = 64;

/** @param {number} v @param {number} bits */
function signExtend(v, bits) {
  const m = 1 << (bits - 1);
  const x = v & ((1 << bits) - 1);
  return x & m ? x - (1 << bits) : x;
}

/**
 * @param {Uint8Array} windows 1024-byte world table
 * @returns {Map<number, { left: number, shift: number }>} right-only world → its left twin
 */
export function stereoTwins(windows) {
  /** @type {Map<number, { left: number, shift: number }>} */
  const out = new Map();
  if (!windows || windows.length < 32 * WORLD_BYTES) return out;
  const rd = (w, off) => windows[w * WORLD_BYTES + off] | (windows[w * WORLD_BYTES + off + 1] << 8);
  // Worlds are drawn from 31 down to the first one marked END.
  let end = -1;
  for (let w = 31; w >= 0; w--) {
    if (rd(w, 0) & HDR_END) {
      end = w;
      break;
    }
  }
  for (let r = 31; r > end; r--) {
    const hr = rd(r, 0);
    if ((hr & (HDR_LON | HDR_RON)) !== HDR_RON) continue;
    for (const l of [r - 1, r + 1]) {
      if (l <= end || l > 31) continue;
      const hl = rd(l, 0);
      if ((hl & (HDR_LON | HDR_RON)) !== HDR_LON) continue;
      if ((hl & TWIN_HEADER_MASK) !== (hr & TWIN_HEADER_MASK)) continue;
      if (rd(l, 6) !== rd(r, 6) || (rd(l, 16) & 0x3ff) !== (rd(r, 16) & 0x3ff)) continue;
      const shift = twinShift(rd, l, r, ((hr >> 12) & 3) === BGM_AFFINE);
      if (Math.abs(shift) > MAX_TWIN_SHIFT) continue;
      out.set(r, { left: l, shift });
      break;
    }
  }
  return out;
}

/**
 * Right-eye screen x minus left-eye screen x of the same map column (each world's destination
 * minus its source, with parallax). Affine worlds have no MX/MP; only their placement counts.
 */
function twinShift(rd, l, r, affine) {
  const gx = (w) => signExtend(rd(w, 2), 11);
  const gp = (w) => signExtend(rd(w, 4), 9);
  const destR = gx(r) + gp(r);
  const destL = gx(l) - gp(l);
  if (affine) return destR - destL;
  const mp = (w) => signExtend(rd(w, 10), 9);
  // MX is a 13-bit map position; take the short way round between the two.
  const dmx = signExtend(rd(r, 8) - rd(l, 8), 13);
  return destR - destL - dmx - mp(r) - mp(l);
}
