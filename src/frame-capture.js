/**
 * Stable id and default labeling for Capture Frame workflow.
 */

export function generateFrameId() {
  const r = () => Math.random().toString(36).slice(2, 8);
  return `f-${Date.now().toString(36)}-${r()}`;
}

export const QUICK_CAPTURE_KEY = 'F8';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * @param {{ key: string, repeat?: boolean, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean,
 *   shiftKey?: boolean, target?: { tagName?: string, isContentEditable?: boolean } | null }} e
 * @returns {boolean}
 */
export function isQuickCaptureHotkey(e) {
  if (e.key !== QUICK_CAPTURE_KEY || e.repeat) return false;
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  const t = e.target;
  return !(t && (EDITABLE_TAGS.has(String(t.tagName).toUpperCase()) || t.isContentEditable === true));
}

export function nextDefaultStateName(counterRef) {
  counterRef.n = (counterRef.n || 0) + 1;
  const n = counterRef.n;
  return `State ${String(n).padStart(3, '0')}`;
}
