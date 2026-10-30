/**
 * How much of a group is painted: of the tile patterns it lists (`criteria.hashes`), how many have
 * colours — its own (`tileColors`, src/group-tile-colors.js) or the shared pack's. The blank
 * pattern is left out (it lights no pixel, so there is nothing to paint). Pictures (overpaint,
 * pose pictures) are not counted: they cover a place on screen, not a pattern.
 */
import { hashTile } from './vip-state.js';

const BLANK = hashTile(new Uint8Array(16)) >>> 0;

/**
 * @param {any} group
 * @param {{ has: (hash: number) => boolean } | null} [pack] the shared pack's colours, by pattern
 * @returns {{ painted: number, total: number }}
 */
export function groupPaintProgress(group, pack = null) {
  const hashes = Array.isArray(group?.criteria?.hashes) ? group.criteria.hashes : [];
  const own = group?.tileColors && typeof group.tileColors === 'object' ? group.tileColors : {};
  const seen = new Set();
  let painted = 0;
  for (const raw of hashes) {
    const h = Number(raw) >>> 0;
    if (h === BLANK || seen.has(h)) continue;
    seen.add(h);
    if (own[String(h)] || pack?.has(h)) painted++;
  }
  return { painted, total: seen.size };
}

/** "271 of 326 tiles painted (83%)", or "all 326 tiles painted"; '' for a group listing no tiles. */
export function describePaintProgress({ painted, total }) {
  if (!total) return '';
  if (painted >= total) return `all ${total} tile${total === 1 ? '' : 's'} painted`;
  return `${painted} of ${total} tiles painted (${Math.floor((painted / total) * 100)}%)`;
}
