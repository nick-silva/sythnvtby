/**
 * The groups used most recently, newest first, shared by the Project tool and SpriteStudio (same
 * origin, so the same browser storage): selecting a group or adding a pose to it counts as a use.
 * The New pose dialog lists groups in this order (src/group-search.js orderByRecent). A per-viewer
 * convenience: when storage is unavailable the lists just fall back to name order.
 */

import { withRecentUse } from '../../src/group-search.js';

const KEY = 'vbc.recentGroups';

/** @returns {string[]} group ids, most recently used first */
export function recentGroupIds() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** @param {string | null | undefined} id the group just used */
export function recordGroupUse(id) {
  if (!id) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(withRecentUse(recentGroupIds(), id)));
  } catch {
    // Storage blocked (private window, previews): the order just is not remembered.
  }
}
