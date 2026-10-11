/**
 * Words for work that is not saved yet, shared by the emulator and the Project tool, so
 * every "you would lose this" prompt and note says the same thing the same way.
 *
 * Captured frames live only in the emulator's memory until Colorize! hands them to the
 * Project tool or Export .vbpack writes them out; loading a ROM or pack, or closing the tab,
 * drops them.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Confirm text before an action that would drop unsaved captures.
 * @param {number} count unsaved captures
 * @param {string} action what the user clicked, e.g. "Load ROM"
 */
export function discardCapturesPrompt(count, action) {
  return (
    `${plural(count, 'captured frame')} ${count === 1 ? 'is' : 'are'} not saved yet. ` +
    `${action} will throw ${count === 1 ? 'it' : 'them'} away.\n\n` +
    'To keep them, cancel and use Colorize! or Export .vbpack first.\n\n' +
    `${action} anyway?`
  );
}

/**
 * Status-line note while captures are unsaved; '' when there are none.
 * @param {number} count
 */
export function unsavedCapturesNote(count) {
  if (!count) return '';
  return `${plural(count, 'capture')} not saved — Colorize! or Export .vbpack to keep ${count === 1 ? 'it' : 'them'}`;
}

/**
 * What a capture is missing, in words; '' when it has everything. A frame without its
 * memory snapshot cannot be used by Analyze memory.
 * @param {{ wram: boolean, screenshot: boolean }} got
 */
export function captureGapsNote(got) {
  const missing = [];
  if (!got.wram) missing.push('its memory snapshot (Analyze memory will skip it)');
  if (!got.screenshot) missing.push('a screenshot');
  return missing.length ? `Saved without ${missing.join(' or ')}.` : '';
}

/**
 * Confirm text before the Project tool replaces an open pack with unsaved changes.
 * @param {string} action e.g. "Open pack"
 */
export function discardProjectChangesPrompt(action) {
  return `This project has unsaved changes. ${action} will throw them away.\n\nSave first to keep them. ${action} anyway?`;
}
