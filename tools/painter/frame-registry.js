/**
 * Frame labels from manifest.frameRegistry (shared logic with v1 paint).
 */

import { frameTag } from '../../src/frame-numbers.js';

/** @param {string} s */
export function vipMatchKey(s) {
  return String(s || '')
    .replace(/^vipstates\//i, '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\.json$/i, '');
}

/**
 * @param {Array<Record<string, unknown>>|null|undefined} registry
 * @param {string} vipLeafName
 */
export function findFrameRegistryEntry(registry, vipLeafName) {
  if (!registry?.length) return null;
  const key = vipMatchKey(vipLeafName);
  if (!key) return null;
  for (const ent of registry) {
    const ref = vipMatchKey(/** @type {string} */ (ent.vipStateFile || ''));
    if (ref && ref === key) return ent;
    const fid = String(ent.frameId || '').trim().toLowerCase();
    if (fid && fid === key) return ent;
  }
  return null;
}

/**
 * @param {Record<string, unknown>|null} ent
 * @param {string} vipLeafFallback
 */
export function formatPaintToolFrameLabelFromRegistry(ent, vipLeafFallback) {
  const stem =
    vipMatchKey(vipLeafFallback) ||
    (String(vipLeafFallback || '').split(/[/\\]/).pop() || '').replace(/\.json$/i, '') ||
    'frame';
  if (!ent) return stem;
  const state = (ent.stateName != null && String(ent.stateName).trim()) || '(unnamed)';
  const sub = ent.subStateName != null && String(ent.subStateName).trim();
  const fid = (ent.frameId != null && String(ent.frameId).trim()) || stem;
  // The frame's short number first (src/frame-numbers.js): what people say and type.
  const tag = frameTag(ent);
  // A name given in Frame ▸ Rename stands for the state names.
  const named = typeof ent.name === 'string' && ent.name.trim();
  const rest = named ? `${named} – ${fid}` : sub ? `${state} – ${sub} – ${fid}` : `${state} – ${fid}`;
  return tag ? `${tag} · ${rest}` : rest;
}

/** @param {unknown} raw */
/**
 * A frame row (`{ label, vipFile, …, json }`) for a pack's `vipStatesFolder` item. When the item
 * reads lazily (src/lazy-entries.js) the row's `json` reads through to it, so the frame stays
 * compressed until something looks at it; `jsonSize` is its length either way, known without
 * reading it. Null when an eager item has no usable JSON.
 * @param {Record<string, unknown>} fields @param {{ json: unknown, size?: number }} item
 */
export function frameRowFrom(fields, item) {
  const lazy = !!Object.getOwnPropertyDescriptor(item, 'json')?.get;
  if (!lazy) {
    const json = normalizeVipJsonForFrameField(item.json);
    return json ? { ...fields, json, jsonSize: json.length } : null;
  }
  const row = { ...fields, jsonSize: Number(item.size) || 0 };
  let own = null;
  Object.defineProperty(row, 'json', {
    enumerable: true,
    get: () => own ?? normalizeVipJsonForFrameField(item.json) ?? '',
    set: (v) => {
      own = v;
    },
  });
  return row;
}

export function normalizeVipJsonForFrameField(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}
