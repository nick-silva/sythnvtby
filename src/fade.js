/**
 * Fades: how much to dim colour so it follows the game's brightness.
 *
 * The core reports `masterBrightness`, the mean level of the VB's three lit shades (0..1). Games
 * run at different levels all the time: Mario Clash sits near 0.75, Mario's Tennis at 0.39. Dimming
 * paint by the raw value made a painted white show as 53% grey in Mario's Tennis. So the level is
 * measured against the game's *normal* brightness — `state.brightnessReference`, the level most of
 * its captured frames show — and only drops below it (a fade) dim the paint.
 */

/** Default scale for masterBrightness when a game's normal level is unknown (Mario Clash's). */
export const FADE_RESPONSE_DEFAULT = 1.34;

/** Below this a "normal" level is a black screen, not a reference. */
const MIN_REFERENCE = 0.05;

/**
 * A game's normal brightness: the level most of these frames show (fades are short, so they
 * rarely win). Ties go to the brighter level. Null when there is nothing to go by.
 * @param {Iterable<unknown>} levels masterBrightness values
 * @returns {number|null}
 */
export function brightnessReference(levels) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const v of levels) {
    const n = Number(v);
    if (v == null || !Number.isFinite(n) || n < MIN_REFERENCE) continue;
    const key = Math.round(Math.min(1, n) * 1000) / 1000;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [level, count] of counts) {
    if (count > bestCount || (count === bestCount && level > best)) {
      best = level;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The `masterBrightness` values in serialized VIP states, without parsing whole frames.
 * @param {Iterable<unknown>} jsonTexts
 * @returns {number[]}
 */
export function masterBrightnessLevels(jsonTexts) {
  const out = [];
  for (const text of jsonTexts) {
    const m = typeof text === 'string' ? /"masterBrightness"\s*:\s*([0-9.eE+-]+)/.exec(text) : null;
    if (m) out.push(Number(m[1]));
  }
  return out;
}

/**
 * How much to dim colour on this frame, 0..1 (exactly 1 when nothing is fading).
 * With a `brightnessReference` the frame's level is measured against it, and `scale` works
 * relative to the default response, so the emulator's Fade response control still applies.
 * Without one, the old rule: `masterBrightness × scale`, clamped.
 * @param {{ masterBrightness?: number|null, brightnessReference?: number|null } | null | undefined} state
 * @param {number} [scale]
 */
export function fadeFactor(state, scale = 1) {
  const mb = state?.masterBrightness;
  if (mb == null) return 1;
  const s = typeof scale === 'number' ? scale : 1;
  const ref = Number(state?.brightnessReference);
  if (state?.brightnessReference != null && Number.isFinite(ref) && ref >= MIN_REFERENCE) {
    return Math.max(0, Math.min(1, (Number(mb) / ref) * (s / FADE_RESPONSE_DEFAULT)));
  }
  if (mb >= 1 && s === 1) return 1;
  return Math.max(0, Math.min(1, Number(mb) * s));
}
