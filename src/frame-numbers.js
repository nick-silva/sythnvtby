/**
 * Short frame numbers ("#57") and finding a frame from what someone typed — a number, a name, or
 * a frame id with a typo in it. Random ids like `f-muytuaaa-eimjli` are easy to mistype and hard
 * to say; a number is neither.
 *
 * A number is stored on the frame's registry entry (`manifest.frameRegistry[].number`). Frames
 * without one get the next free number, in registry (capture) order, when a tool opens the pack;
 * a number is never reused or changed, so "#57" keeps meaning the same frame after others are
 * cleaned up.
 */

/** @param {any} entry @returns {number | null} */
export function frameNumberOf(entry) {
  const n = Number(entry?.number);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The registry with every entry numbered: entries that have a number keep it; the rest get the
 * next numbers after the highest, in order. The same array when nothing was missing.
 * @param {any[] | null} registry
 * @returns {{ registry: any[] | null, added: number }}
 */
export function withFrameNumbers(registry) {
  if (!Array.isArray(registry)) return { registry, added: 0 };
  const used = new Set(registry.map(frameNumberOf).filter(Boolean));
  let next = Math.max(0, ...used) + 1;
  let added = 0;
  const out = registry.map((e) => {
    if (!e || typeof e !== 'object') return e;
    const own = frameNumberOf(e);
    if (own && used.has(own)) {
      used.delete(own); // a repeated number (hand-edited file) goes to the first entry only
      return e;
    }
    added++;
    return { ...e, number: next++ };
  });
  return { registry: added ? out : registry, added };
}

/** "#57" or '' for a frame without a number. */
export const frameTag = (entry) => (frameNumberOf(entry) ? `#${frameNumberOf(entry)}` : '');

/** One line that names a frame unambiguously, for pasting into a note or a message. */
export function frameReference(entry, label = '') {
  const parts = [frameTag(entry), label || entry?.name || [entry?.stateName, entry?.subStateName].filter(Boolean).join(' / '), entry?.frameId];
  return [...new Set(parts.map((p) => String(p || '').trim()).filter(Boolean))].join(' · ');
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** How far off a typed id may be and still be taken as that frame (one closest, no tie). */
const MAX_ID_TYPOS = 2;

/**
 * The frame someone means: "#57" or "57" (its number), a name (exact, case ignored), its id, or an
 * id one or two characters off — when one frame is clearly closest.
 * @param {any[]} entries registry entries (null entries are skipped)
 * @param {string} text
 * @returns {null | { entry: any, how: 'number' | 'name' | 'id' | 'near', typed: string }}
 */
export function findFrame(entries, text) {
  const typed = String(text ?? '').trim();
  if (!typed) return null;
  const list = (entries || []).filter(Boolean);
  const num = /^#?\s*(\d+)$/.exec(typed);
  if (num) {
    const entry = list.find((e) => frameNumberOf(e) === Number(num[1]));
    return entry ? { entry, how: 'number', typed } : null;
  }
  const low = typed.toLowerCase();
  const byName = list.find((e) => String(e.name || '').trim().toLowerCase() === low);
  if (byName) return { entry: byName, how: 'name', typed };
  const byId = list.find((e) => String(e.frameId || '').toLowerCase() === low);
  if (byId) return { entry: byId, how: 'id', typed };
  const scored = list
    .filter((e) => e.frameId)
    .map((e) => ({ e, d: editDistance(low, String(e.frameId).toLowerCase()) }))
    .sort((a, b) => a.d - b.d);
  if (scored.length && scored[0].d <= MAX_ID_TYPOS && (scored.length === 1 || scored[1].d > scored[0].d)) {
    return { entry: scored[0].e, how: 'near', typed };
  }
  return null;
}
