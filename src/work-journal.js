/**
 * The unsaved-work journal (recovery): a tool keeps a copy of its unsaved changes in browser
 * storage while you work, and clears it when a save succeeds. If the tab crashes, is closed or
 * reloads first, opening the same pack again offers to restore them.
 *
 * Stored as UTF-8 JSON bytes (src/handoff-store.js keeps binary values as Blobs, outside
 * IndexedDB's value size limit). One per tool and pack name.
 */

import { putHandoff, getHandoff, deleteHandoff } from './handoff-store.js';

export const JOURNAL_VERSION = 1;

const keyOf = (tool, label) => `journal:${tool}:${label}`;

/**
 * @param {string} tool @param {string} label the pack's file name
 * @param {Record<string, unknown>} snapshot what the tool needs to restore
 */
export async function writeJournal(tool, label, snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...snapshot, version: JOURNAL_VERSION }));
  await putHandoff(keyOf(tool, label), bytes.buffer);
}

/**
 * The journal for this pack, or null when there is none (or not one this build reads).
 * @param {string} tool @param {string} label
 */
export async function readJournal(tool, label) {
  const stored = await getHandoff(keyOf(tool, label));
  if (!stored) return null;
  try {
    const journal = JSON.parse(new TextDecoder().decode(stored));
    return journal && journal.version === JOURNAL_VERSION ? journal : null;
  } catch {
    return null;
  }
}

/** @param {string} tool @param {string} label */
export async function clearJournal(tool, label) {
  await deleteHandoff(keyOf(tool, label));
}

/** @param {ArrayBuffer | Uint8Array} buf */
export function bytesToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** @param {string} b64 */
export function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
