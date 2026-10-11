/**
 * Stereo output: composite left and right 384×224 buffers into one display based on view mode.
 * Modes: '2d' (left only), 'sidebyside' (left | right), 'anaglyph' (red/cyan).
 */

const W = 384;
const H = 224;

/**
 * Composite left and right ImageData into a single ImageData for display.
 *
 * @param {'2d'|'sidebyside'|'anaglyph'} mode
 * @param {ImageData} left
 * @param {ImageData} right
 * @param {ImageData} out - output (width/height depend on mode: 2d/sidebyside/anaglyph)
 */
export function compositeStereo(mode, left, right, out) {
  const outW = out.width;
  const outH = out.height;
  const d = out.data;
  d.fill(0);

  if (mode === '2d') {
    for (let y = 0; y < H && y < outH; y++) {
      for (let x = 0; x < W && x < outW; x++) {
        const src = (y * W + x) * 4;
        const dst = (y * outW + x) * 4;
        d[dst] = left.data[src];
        d[dst + 1] = left.data[src + 1];
        d[dst + 2] = left.data[src + 2];
        d[dst + 3] = left.data[src + 3];
      }
    }
    return;
  }

  if (mode === 'sidebyside') {
    for (let y = 0; y < H && y < outH; y++) {
      for (let x = 0; x < W; x++) {
        const src = (y * W + x) * 4;
        let dst = (y * outW + x) * 4;
        if (dst + 3 < d.length) {
          d[dst] = left.data[src];
          d[dst + 1] = left.data[src + 1];
          d[dst + 2] = left.data[src + 2];
          d[dst + 3] = left.data[src + 3];
        }
      }
      for (let x = 0; x < W; x++) {
        const src = (y * W + x) * 4;
        const dst = (y * outW + W + x) * 4;
        if (dst + 3 < d.length) {
          d[dst] = right.data[src];
          d[dst + 1] = right.data[src + 1];
          d[dst + 2] = right.data[src + 2];
          d[dst + 3] = right.data[src + 3];
        }
      }
    }
    return;
  }

  if (mode === 'anaglyph') {
    for (let y = 0; y < H && y < outH; y++) {
      for (let x = 0; x < W && x < outW; x++) {
        const i = (y * W + x) * 4;
        const l = left.data;
        const r = right.data;
        const dst = (y * outW + x) * 4;
        d[dst] = l[i];
        d[dst + 1] = r[i + 1];
        d[dst + 2] = r[i + 2];
        d[dst + 3] = Math.max(l[i + 3], r[i + 3]);
      }
    }
    return;
  }
}

/**
 * Get output dimensions for view mode.
 *
 * @param {'2d'|'sidebyside'|'anaglyph'} mode
 * @returns {{ width: number, height: number }}
 */
export function getStereoOutputSize(mode) {
  if (mode === 'sidebyside') return { width: W * 2, height: H };
  return { width: W, height: H };
}
