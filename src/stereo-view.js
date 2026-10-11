/**
 * The emulator's View menu for the monochrome picture: Beetle VB draws both eyes itself when
 * asked (core option `vb_3dmode`), so 3D in monochrome is exactly what the VIP drew. The colour
 * layer composites both eyes on its own (src/color-layer.js) and lays them out the same way.
 *
 * See docs/design/vb-color-player.md §2 (0b).
 */

/** One eye's frame, and the core's side-by-side frame (both eyes, left first, no gap). */
export const EYE_W = 384;
export const EYE_H = 224;

/**
 * Core options for a View mode.
 * - 2D: the core's default, anaglyph with no colours, which shows the left eye.
 * - Side-by-side: both eyes, left then right, in a 768×224 frame.
 * - Anaglyph: red/cyan — except under Palette, which remaps the picture by brightness and would
 *   scramble the two colours, so it gets the left eye.
 * @param {'2d'|'sidebyside'|'anaglyph'} viewMode
 * @param {{ palette?: boolean }} [opts]
 * @returns {{ vb_3dmode: string, vb_anaglyph_preset: string }}
 */
export function coreStereoOptions(viewMode, { palette = false } = {}) {
  if (viewMode === 'sidebyside') return { vb_3dmode: 'side-by-side', vb_anaglyph_preset: 'disabled' };
  if (viewMode === 'anaglyph' && !palette) return { vb_3dmode: 'anaglyph', vb_anaglyph_preset: 'red & cyan' };
  return { vb_3dmode: 'anaglyph', vb_anaglyph_preset: 'disabled' };
}

/**
 * Where the left eye sits on an emulator canvas showing the core's side-by-side frame (fitted
 * inside the canvas, centred), in canvas pixels.
 * @param {number} canvasW @param {number} canvasH
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function leftEyeRect(canvasW, canvasH) {
  const scale = Math.min(canvasW / (EYE_W * 2), canvasH / EYE_H);
  const w = Math.round(EYE_W * 2 * scale);
  const h = Math.round(EYE_H * scale);
  return { x: Math.round((canvasW - w) / 2), y: Math.round((canvasH - h) / 2), w: Math.round(w / 2), h };
}
