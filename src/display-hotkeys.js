/**
 * Emulator display hotkeys, for flipping between the original and the colorized picture
 * mid-play (a before/after video, or just checking your paint):
 *   F9   Monochrome ⇄ Color — show only one of them, swapping each press
 *   F10  Monochrome on/off — the original picture under the colour layer, Color left as it is
 * Like F8 (quick capture), they are ignored while typing in a field and with modifiers held.
 */

export const SWAP_DISPLAY_KEY = 'F9';
export const TOGGLE_MONO_KEY = 'F10';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * @param {{ key: string, repeat?: boolean, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean,
 *   shiftKey?: boolean, target?: { tagName?: string, isContentEditable?: boolean } | null }} e
 * @returns {'swap' | 'toggle-mono' | null}
 */
export function displayHotkeyAction(e) {
  const action = e.key === SWAP_DISPLAY_KEY ? 'swap' : e.key === TOGGLE_MONO_KEY ? 'toggle-mono' : null;
  if (!action || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  const t = e.target;
  if (t && (EDITABLE_TAGS.has(String(t.tagName).toUpperCase()) || t.isContentEditable === true)) return null;
  return action;
}

/**
 * The display after a hotkey. Palette is its own mode; either key leaves it.
 * @param {{ mono: boolean, color: boolean, palette: boolean }} s
 * @param {'swap' | 'toggle-mono'} action
 * @returns {{ mono: boolean, color: boolean, palette: boolean }}
 */
export function nextDisplayState(s, action) {
  if (action === 'toggle-mono') return { mono: s.palette ? true : !s.mono, color: s.palette ? false : s.color, palette: false };
  // Swap: colour alone ⇄ monochrome alone. From anything else (both on, palette, nothing), go
  // to colour — the point of pressing it is usually to see the colorized picture.
  const colourOnly = s.color && !s.mono && !s.palette;
  return colourOnly ? { mono: true, color: false, palette: false } : { mono: false, color: true, palette: false };
}

/** Status-line words for a display state. */
export function describeDisplay(s) {
  if (s.palette) return 'Palette';
  if (s.color && s.mono) return 'Color over Monochrome';
  if (s.color) return 'Color';
  if (s.mono) return 'Monochrome';
  return 'Monochrome and Color both off';
}
