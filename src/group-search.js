/**
 * Finding groups in a long list: SpriteStudio's quick search and the Project tool's New pose
 * dialog. A query matches a group when every word of it appears in the group's name or folder
 * path (case ignored). Groups are listed most recently used first: an id list, newest first, kept by
 * each tool in browser storage ({@link withRecentUse}).
 */

import { folderOf } from './group-folders.js';

/** How many recently used groups are remembered. */
export const RECENT_GROUPS_MAX = 100;

/** @param {string} query @returns {string[]} */
const wordsOf = (query) => String(query || '').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * @param {any} group
 * @param {string} query
 * @returns {boolean}
 */
export function matchesGroupQuery(group, query) {
  const words = wordsOf(query);
  if (!words.length) return true;
  const text = `${group?.name || group?.id || ''} ${folderOf(group)}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * The groups matching a query, in their order; the list itself for an empty query.
 * @template T
 * @param {T[]} groups @param {string} query
 * @returns {T[]}
 */
export function filterGroups(groups, query) {
  return wordsOf(query).length ? groups.filter((g) => matchesGroupQuery(g, query)) : groups;
}

/**
 * Recently used groups first (newest use first), then the others by name.
 * @template {{ id: string, name?: string }} T
 * @param {T[]} groups @param {string[]} recentIds newest first
 * @returns {T[]}
 */
export function orderByRecent(groups, recentIds) {
  const rank = new Map((recentIds || []).map((id, i) => [id, i]));
  const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { sensitivity: 'base', numeric: true });
  return [...groups].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined || rb !== undefined) return (ra ?? Infinity) - (rb ?? Infinity);
    return byName(a, b);
  });
}

/**
 * The recent list with this group used now: moved (or added) to the front, trimmed to `max`.
 * @param {string[]} recentIds @param {string} id @param {number} [max]
 * @returns {string[]}
 */
export function withRecentUse(recentIds, id, max = RECENT_GROUPS_MAX) {
  const list = Array.isArray(recentIds) ? recentIds.filter((x) => typeof x === 'string') : [];
  if (!id) return list;
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
