/**
 * Take colours out of a reference image and into tile patterns
 * (docs/design/reference-images.md §5.1–5.2).
 *
 * A reference sits on the frame at `transform` — `scale` plus a top-left in frame pixels —
 * set once in the Project tool. The two are rarely 1:1, so a frame pixel takes the **median
 * of the reference block it covers**. Paint is stored per tile *pattern*, so every copy of a
 * pattern is sampled and the copies' per-pixel median wins; how far the copies disagreed is
 * reported, because that is what marks a tile needing its own position-scoped group.
 *
 * Pure functions on typed arrays: no DOM, no pack.
 */

/** VB pixels whose shade is 0 paint nothing — the mono frame's black shows through. */
const TRANSPARENT_SHADE = 0;

/**
 * @typedef {{ data: ArrayLike<number>, width: number, height: number,
 *             transform: { scale: number, dx: number, dy: number } }} Reference
 */

function median(values) {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/**
 * The reference colour under one frame pixel, or `null` where the reference does not reach.
 * @param {Reference} ref
 * @returns {[number, number, number]|null}
 */
export function referenceColorAt(ref, fx, fy) {
  const { scale, dx, dy } = ref.transform;
  if (!(scale > 0)) return null;
  const x0 = (fx - dx) / scale;
  const y0 = (fy - dy) / scale;
  const x1 = (fx + 1 - dx) / scale;
  const y1 = (fy + 1 - dy) / scale;
  if (x1 <= 0 || y1 <= 0 || x0 >= ref.width || y0 >= ref.height) return null;
  const ix0 = Math.max(0, Math.floor(x0));
  const iy0 = Math.max(0, Math.floor(y0));
  const ix1 = Math.min(ref.width, Math.max(ix0 + 1, Math.ceil(x1)));
  const iy1 = Math.min(ref.height, Math.max(iy0 + 1, Math.ceil(y1)));
  const rs = [];
  const gs = [];
  const bs = [];
  for (let iy = iy0; iy < iy1; iy++) {
    for (let ix = ix0; ix < ix1; ix++) {
      const o = (iy * ref.width + ix) * 4;
      if (ref.data[o + 3] === 0) continue; // a letterboxed import has clear edges
      rs.push(ref.data[o]);
      gs.push(ref.data[o + 1]);
      bs.push(ref.data[o + 2]);
    }
  }
  if (!rs.length) return null;
  return [median(rs), median(gs), median(bs)];
}

/**
 * Where a tile pattern's pixel (px, py) lands on screen for one placement. A flipped draw
 * shows the pattern mirrored, so sampling has to undo the flip — otherwise a mirrored sprite
 * takes its colours from the wrong side.
 */
export function screenPixelForPatternPixel(placement, px, py) {
  const sx = placement.flipH ? 7 - px : px;
  const sy = placement.flipV ? 7 - py : py;
  return { fx: placement.x + sx, fy: placement.y + sy };
}

/**
 * Sample every placement of every pattern and reduce the copies to one 8×8 RGBA tile each.
 *
 * @param {Reference} ref
 * @param {Array<{ hash: number, x: number, y: number, flipH?: boolean, flipV?: boolean }>} placements
 * @param {(hash: number) => { shades: ArrayLike<number> }|null} patternOf
 *   the pattern's 64 shades (0..3) in pattern order — `shades[py * 8 + px]`
 * @param {{ conflictThreshold?: number }} [opts] mean RGB distance between a copy and the
 *   agreed colours above which the pattern counts as a conflict
 * @returns {{ tiles: Map<number, Uint8ClampedArray>, patterns: number, placements: number,
 *             conflicts: number[], skipped: number }}
 */
export function fillTilesFromReference(ref, placements, patternOf, opts = {}) {
  const threshold = opts.conflictThreshold ?? 40;
  /** @type {Map<number, Array<{ hash: number, x: number, y: number, flipH?: boolean, flipV?: boolean }>>} */
  const byHash = new Map();
  for (const p of placements) {
    const hash = p.hash >>> 0;
    const list = byHash.get(hash);
    if (list) list.push(p);
    else byHash.set(hash, [p]);
  }

  const tiles = new Map();
  const conflicts = [];
  let skipped = 0;

  for (const [hash, copies] of byHash) {
    const pattern = patternOf(hash);
    if (!pattern?.shades) {
      skipped++;
      continue;
    }
    const rgba = new Uint8ClampedArray(256);
    /** Per copy, the summed distance from the agreed colours — the disagreement measure. */
    const drift = new Array(copies.length).fill(0);
    let sampledPixels = 0;

    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const i = py * 8 + px;
        if ((pattern.shades[i] & 3) === TRANSPARENT_SHADE) continue; // stays clear
        const rs = [];
        const gs = [];
        const bs = [];
        const perCopy = [];
        for (const copy of copies) {
          const { fx, fy } = screenPixelForPatternPixel(copy, px, py);
          const c = referenceColorAt(ref, fx, fy);
          perCopy.push(c);
          if (!c) continue;
          rs.push(c[0]);
          gs.push(c[1]);
          bs.push(c[2]);
        }
        if (!rs.length) continue; // the reference does not cover this pixel
        const agreed = [median(rs), median(gs), median(bs)];
        rgba[i * 4] = agreed[0];
        rgba[i * 4 + 1] = agreed[1];
        rgba[i * 4 + 2] = agreed[2];
        rgba[i * 4 + 3] = 255;
        sampledPixels++;
        perCopy.forEach((c, ci) => {
          if (!c) return;
          drift[ci] += Math.hypot(c[0] - agreed[0], c[1] - agreed[1], c[2] - agreed[2]);
        });
      }
    }

    if (!sampledPixels) {
      skipped++;
      continue;
    }
    tiles.set(hash, rgba);
    if (copies.length > 1 && Math.max(...drift) / sampledPixels > threshold) conflicts.push(hash);
  }

  return { tiles, patterns: tiles.size, placements: placements.length, conflicts, skipped };
}

/**
 * The reference colour for every lit pixel of every placement, in **screen** coordinates.
 *
 * {@link fillTilesFromReference} reduces a pattern's copies to one tile, because paint stored
 * per pattern has to agree across them. Positional paint has no such constraint: an anchored
 * group's overlay holds a colour per screen pixel, so each copy can take the colours actually
 * over it and two copies of one pattern may legitimately differ.
 *
 * @param {Reference} ref
 * @param {Array<{ hash: number, x: number, y: number, flipH?: boolean, flipV?: boolean }>} placements
 * @param {(hash: number) => { shades: ArrayLike<number> }|null} patternOf
 * @returns {{ pixels: Array<{ x: number, y: number, color: [number, number, number] }>, tiles: number, skipped: number }}
 */
export function referencePixelsForPlacements(ref, placements, patternOf) {
  /** @type {Array<{ x: number, y: number, color: [number, number, number] }>} */
  const pixels = [];
  let tiles = 0;
  let skipped = 0;
  for (const placement of placements) {
    const pattern = patternOf(placement.hash >>> 0);
    if (!pattern?.shades) {
      skipped++;
      continue;
    }
    let any = false;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        if ((pattern.shades[py * 8 + px] & 3) === TRANSPARENT_SHADE) continue;
        const { fx, fy } = screenPixelForPatternPixel(placement, px, py);
        const c = referenceColorAt(ref, fx, fy);
        if (!c) continue;
        pixels.push({ x: fx, y: fy, color: c });
        any = true;
      }
    }
    if (any) tiles++;
    else skipped++;
  }
  return { pixels, tiles, skipped };
}

/**
 * A placement for one paste: the transform that puts the part of the reference inside
 * `refRect` onto `stageRect` (both in frame pixels).
 *
 * This is the ghost box. The stage box says where paint lands; the reference box says where
 * the colours come from, so an area the global placement misses can be aimed by hand without
 * moving the placement the whole pack shares. Scale stays uniform — the width ratio wins, and
 * the caller keeps the boxes the same shape.
 *
 * @param {{ scale: number, dx: number, dy: number }} base the reference's stored placement
 * @param {{ x: number, y: number, w: number, h: number }} refRect
 * @param {{ x: number, y: number, w: number, h: number }} stageRect
 */
export function transformForGhostBoxes(base, refRect, stageRect) {
  if (!(base?.scale > 0) || !(refRect?.w > 0) || !(stageRect?.w > 0)) return { ...base };
  const scale = base.scale * (stageRect.w / refRect.w);
  return {
    scale,
    dx: stageRect.x - (scale * (refRect.x - base.dx)) / base.scale,
    dy: stageRect.y - (scale * (refRect.y - base.dy)) / base.scale,
  };
}

/** The placements that fall inside a rectangle, for a paste limited to the ghost box. */
export function placementsInRect(placements, rect) {
  if (!rect) return placements;
  return placements.filter((p) => p.x + 8 > rect.x && p.x < rect.x + rect.w && p.y + 8 > rect.y && p.y < rect.y + rect.h);
}

/**
 * The colours a fill would use, most common first — for the palette strip.
 * @param {Map<number, Uint8ClampedArray>} tiles
 * @param {number} [limit]
 * @returns {string[]} `#rrggbb`
 */
export function paletteFromTiles(tiles, limit = 24) {
  const counts = new Map();
  for (const rgba of tiles.values()) {
    for (let i = 0; i < 64; i++) {
      if (rgba[i * 4 + 3] === 0) continue;
      const key = `#${[rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([hex]) => hex);
}
