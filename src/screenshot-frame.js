/**
 * Read a captured emulator screenshot back to Virtual Boy frame pixels.
 *
 * A capture is the display canvas: the 384×224 frame scaled up by a whole ratio, with
 * transparent letterbox bars. It is what the player actually saw — including palette
 * remapping (the VIP's GPLT registers) and fades, neither of which `compositeColorFrame`
 * applies when it re-renders from a VIP state. So for "what was on screen", prefer this;
 * for "which tile pattern drew this pixel", use the VIP state.
 *
 * Captures are nearest-neighbour scaled, so the original pixels come back exactly.
 */

export const VB_W = 384;
export const VB_H = 224;

/**
 * The frame inside the canvas: the bounding box of pixels that are not fully transparent.
 * @param {{ width: number, height: number, data: ArrayLike<number> }} img RGBA
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function contentRect(img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, width: img.width, height: img.height };
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Per VB pixel, the most common red value of the source pixels it covers. The red channel
 * alone is enough: the Virtual Boy display is red.
 * @returns {Uint8Array} one level per VB pixel
 */
export function sampleLevels(img, rect = contentRect(img), w = VB_W, h = VB_H) {
  const out = new Uint8Array(w * h);
  const fx = rect.width / w, fy = rect.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = rect.y + Math.floor(y * fy), y1 = Math.max(y0 + 1, rect.y + Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = rect.x + Math.floor(x * fx), x1 = Math.max(x0 + 1, rect.x + Math.floor((x + 1) * fx));
      const counts = new Map();
      let best = 0, bestN = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const o = (yy * img.width + xx) * 4;
          const v = img.data[o + 3] === 0 ? 0 : img.data[o];
          const n = (counts.get(v) || 0) + 1;
          counts.set(v, n);
          if (n > bestN || (n === bestN && v > best)) { best = v; bestN = n; }
        }
      }
      out[y * w + x] = best;
    }
  }
  return out;
}

/**
 * Turn display levels into VB shades 0..3.
 *
 * The display's four levels depend on the game's brightness registers, so they are read from
 * the image rather than assumed. With all four present, darkest-to-brightest is shades 0..3.
 * With fewer (a screen that never uses one shade), which shade is missing is ambiguous, so
 * pass `reference` — shades for the same frame from the VIP state — and each level takes the
 * shade its pixels most often have there.
 *
 * @param {Uint8Array} levels
 * @param {{ reference?: Uint8Array }} [opts]
 * @returns {{ shades: Uint8Array, levels: number[] }}
 */
export function shadesFromLevels(levels, { reference } = {}) {
  const distinct = [...new Set(levels)].sort((a, b) => a - b);
  /** @type {Map<number, number>} */
  const toShade = new Map();
  if (distinct.length >= 4 || !reference) {
    distinct.forEach((v, i) => toShade.set(v, Math.min(3, i)));
  } else {
    for (const v of distinct) {
      const votes = [0, 0, 0, 0];
      for (let i = 0; i < levels.length; i++) if (levels[i] === v) votes[reference[i] & 3]++;
      toShade.set(v, votes.indexOf(Math.max(...votes)));
    }
    // Keep it monotonic: a brighter level must not end up on a darker shade.
    let last = -1;
    for (const v of distinct) {
      const s = Math.min(3, Math.max(toShade.get(v), last + 1));
      toShade.set(v, s);
      last = s;
    }
  }
  const shades = new Uint8Array(levels.length);
  for (let i = 0; i < levels.length; i++) shades[i] = toShade.get(levels[i]) ?? 0;
  return { shades, levels: distinct };
}

/**
 * Screenshot → VB shades.
 * @param {{ width: number, height: number, data: ArrayLike<number> }} img RGBA capture
 * @param {{ reference?: Uint8Array, width?: number, height?: number }} [opts]
 */
export function screenshotShades(img, { reference, width = VB_W, height = VB_H } = {}) {
  const rect = contentRect(img);
  const levels = sampleLevels(img, rect, width, height);
  return { ...shadesFromLevels(levels, { reference }), rect };
}

/**
 * How much a re-render disagrees with what was on screen: the share of pixels the render
 * lights up that the capture shows as black, and the reverse. Non-zero values mean the
 * renderer is missing palette remapping or a fade.
 */
export function compareShades(renderShades, shotShades) {
  let renderOnly = 0, shotOnly = 0, differing = 0, lit = 0;
  for (let i = 0; i < renderShades.length; i++) {
    const a = renderShades[i], b = shotShades[i];
    if (a || b) lit++;
    if (a && !b) renderOnly++;
    else if (!a && b) shotOnly++;
    else if (a !== b) differing++;
  }
  const n = renderShades.length || 1;
  return { renderOnly: renderOnly / n, shotOnly: shotOnly / n, differingShade: differing / n, litPixels: lit / n };
}
