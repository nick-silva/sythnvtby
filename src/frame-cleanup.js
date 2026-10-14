/**
 * Project ▸ Clean up frames: which captured frames a project can do without, and taking them out —
 * deleted, or moved into a separate archive .vbpack that File ▸ Import from another pack brings
 * back.
 *
 * A frame is kept when a pose was captured from it (SpriteStudio shows the pose there) or a
 * reference picture is set on it. Of the rest, a frame is suggested when everything it shows is
 * also shown by another kept frame of the same screen (state name), so no tile pattern and no
 * screen a group appears on is lost. What removed frames showed is remembered in the manifest
 * (`archivedCoverage`) so auto-capture still counts those patterns as captured.
 */
import { emptyCoverage, addStateToCoverage, CAPTURE_KINDS } from './auto-capture.js';

/** Pack parts that hold one file per frame. */
export const FRAME_FOLDERS = Object.freeze(['vipStatesFolder', 'saveStatesFolder', 'ramdumpsFolder', 'screenshotsFolder']);

/** Registry fields naming each frame file, by folder. */
const REGISTRY_FILE_FIELD = {
  vipStatesFolder: 'vipStateFile',
  saveStatesFolder: 'saveStateFile',
  ramdumpsFolder: 'ramdumpFile',
  screenshotsFolder: 'screenshotFile',
};

const leaf = (name) => String(name || '').replace(/^.*[\\/]/, '').toLowerCase();
const stem = (name) => leaf(name).split('.')[0];

/** A frame file's size in bytes, whatever form it is held in. */
export function fileBytes(f) {
  if (typeof f?.json === 'string') return f.json.length;
  if (f?.buffer?.byteLength != null) return f.buffer.byteLength;
  if (typeof f?.blob?.size === 'number') return f.blob.size;
  return 0;
}

/** The registry entry for a frame id (or null). */
function registryEntry(registry, frameId) {
  const want = String(frameId || '').toLowerCase();
  return (registry || []).find((e) => String(e?.frameId || '').toLowerCase() === want || stem(e?.vipStateFile) === want) || null;
}

/**
 * Does `file` (in `folder`) belong to the frame? By the registry's file names when it lists them,
 * else by the file name's stem (`f-abc.wram.bin` → `f-abc`).
 */
function belongsTo(folder, file, frameId, ent) {
  const named = ent?.[REGISTRY_FILE_FIELD[folder]];
  if (typeof named === 'string' && named.trim()) return leaf(named) === leaf(file.name);
  return stem(file.name) === String(frameId).toLowerCase();
}

/** The captured frames in pack parts: one per vipstates file, with its id and registry entry. */
export function framesInParts(parts) {
  const registry = parts?.manifest?.frameRegistry || [];
  return (parts?.vipStatesFolder || []).map((f) => {
    const id = stem(f.name);
    const ent = registryEntry(registry, id);
    return { frameId: ent?.frameId || id, name: f.name, entry: ent, json: f.json };
  });
}

/** Bytes a frame takes across its files (uncompressed). */
export function frameBytes(parts, frameId) {
  const ent = registryEntry(parts?.manifest?.frameRegistry, frameId);
  let n = 0;
  for (const folder of FRAME_FOLDERS) {
    for (const f of parts?.[folder] || []) if (belongsTo(folder, f, frameId, ent)) n += fileBytes(f);
  }
  return n;
}

/**
 * Coverage keys for one frame: every non-blank pattern it shows, by kind, tagged with its screen.
 * @param {any} state deserialized VIP state @param {string} screen
 */
export function frameContentKeys(state, screen) {
  const cov = emptyCoverage();
  if (state) addStateToCoverage(cov, state);
  const keys = new Set();
  for (const kind of CAPTURE_KINDS) for (const h of cov[kind]) keys.add(`${screen}|${kind}:${h}`);
  return keys;
}

/**
 * What each frame is for, and which frames can go.
 * @param {{
 *   frames: Array<{ frameId: string, json?: string, keys: Set<string> }>,
 *   groups: any[],
 *   references?: { active?: Record<string, string> } | null,
 * }} args
 * @returns {{ rows: Array<{ frameId: string, poses: string[], hasReference: boolean,
 *   duplicateOf: string|null, protected: boolean, unique: number }>, suggested: Set<string> }}
 *   `unique` patterns no other frame of its screen shows (0 = nothing lost by removing it alone).
 */
export function planFrameCleanup({ frames, groups, references }) {
  const posesByFrame = new Map();
  for (const g of groups || []) {
    for (const p of g?.poses || []) {
      const id = String(p?.sourceFrameId || '').toLowerCase();
      if (!id) continue;
      const list = posesByFrame.get(id) || [];
      list.push(`${g.name || g.id} › ${p.name || p.poseId}`);
      posesByFrame.set(id, list);
    }
  }
  const referenced = new Set(
    Object.keys(references?.active || {})
      .filter((k) => k.startsWith('frame:'))
      .map((k) => k.slice('frame:'.length).toLowerCase()),
  );

  const counts = new Map();
  for (const f of frames) for (const k of f.keys) counts.set(k, (counts.get(k) || 0) + 1);

  const firstByJson = new Map();
  const rows = frames.map((f) => {
    const id = f.frameId.toLowerCase();
    const poses = posesByFrame.get(id) || [];
    const hasReference = referenced.has(id);
    let duplicateOf = null;
    if (typeof f.json === 'string' && f.json) {
      if (firstByJson.has(f.json)) duplicateOf = firstByJson.get(f.json);
      else firstByJson.set(f.json, f.frameId);
    }
    let unique = 0;
    for (const k of f.keys) if (counts.get(k) === 1) unique++;
    return { frameId: f.frameId, poses, hasReference, duplicateOf, protected: poses.length > 0 || hasReference, unique };
  });

  // Greedy: smallest frames first (most likely to be contained in another), each removed only
  // while every pattern it shows is still on some other frame left in the project.
  const left = new Map(counts);
  const order = frames
    .map((f, i) => ({ f, i }))
    .filter(({ i }) => !rows[i].protected)
    .sort((a, b) => a.f.keys.size - b.f.keys.size || a.i - b.i);
  const suggested = new Set();
  for (const { f } of order) {
    if (![...f.keys].every((k) => (left.get(k) || 0) >= 2)) continue;
    for (const k of f.keys) left.set(k, left.get(k) - 1);
    suggested.add(f.frameId);
  }
  return { rows, suggested };
}

/**
 * Take frames out of pack parts. Neither input is changed.
 * @param {Record<string, any>} parts @param {Iterable<string>} frameIds
 * @returns {{ kept: Record<string, any>, removed: Record<string, any>, count: number }}
 *   `removed` holds just those frames' files and registry entries (see {@link archivePackParts}).
 */
export function splitFrames(parts, frameIds) {
  const want = new Set([...frameIds].map((id) => String(id).toLowerCase()));
  const registry = parts?.manifest?.frameRegistry || [];
  const entries = new Map([...want].map((id) => [id, registryEntry(registry, id)]));
  const isRemoved = (folder, file) => [...want].some((id) => belongsTo(folder, file, id, entries.get(id)));

  const kept = { ...parts };
  const removed = {};
  for (const folder of FRAME_FOLDERS) {
    const files = parts?.[folder] || [];
    if (!files.length) continue;
    kept[folder] = files.filter((f) => !isRemoved(folder, f));
    removed[folder] = files.filter((f) => isRemoved(folder, f));
    if (!kept[folder].length) delete kept[folder];
  }
  const goes = (e) => want.has(String(e?.frameId || '').toLowerCase()) || want.has(stem(e?.vipStateFile));
  const manifest = { ...(parts?.manifest || {}) };
  manifest.frameRegistry = registry.filter((e) => !goes(e));
  if (manifest.references?.active) {
    const active = Object.fromEntries(
      Object.entries(manifest.references.active).filter(([k]) => !(k.startsWith('frame:') && want.has(k.slice(6).toLowerCase()))),
    );
    manifest.references = { ...manifest.references, active };
  }
  if (manifest.painterV2LastVipFile && want.has(stem(manifest.painterV2LastVipFile))) delete manifest.painterV2LastVipFile;
  kept.manifest = manifest;
  removed.frameRegistry = registry.filter(goes);
  return { kept, removed, count: (removed.vipStatesFolder || []).length };
}

/**
 * A pack of just the removed frames, for File ▸ Import from another pack to bring back later:
 * the same game and ROM identity, no ROM, groups or paint.
 * @param {Record<string, any>} manifest the project's @param {Record<string, any>} removed from {@link splitFrames}
 * @param {{ from?: string, at?: string }} [meta]
 */
export function archivePackParts(manifest, removed, { from = '', at = new Date().toISOString() } = {}) {
  const m = manifest || {};
  const pick = (k) => (m[k] != null ? { [k]: m[k] } : {});
  const parts = {
    manifest: {
      version: 1,
      ...pick('gameId'),
      ...pick('name'),
      ...pick('romFileName'),
      ...pick('romSha1'),
      ...pick('romCrc32'),
      ...pick('romSize'),
      frameRegistry: removed.frameRegistry || [],
      archivedFrames: { from, at, count: (removed.vipStatesFolder || []).length },
    },
    groups: [],
  };
  for (const folder of FRAME_FOLDERS) if (removed[folder]?.length) parts[folder] = removed[folder];
  return parts;
}

/** Coverage (per-kind pattern sets) of deserialized VIP states. */
export function coverageOfStates(states) {
  const cov = emptyCoverage();
  for (const s of states || []) if (s) addStateToCoverage(cov, s);
  return cov;
}

/** The manifest with `coverage` added to what removed frames showed before. */
export function withArchivedCoverage(manifest, coverage) {
  const before = manifest?.archivedCoverage || {};
  const archivedCoverage = {};
  for (const kind of CAPTURE_KINDS) {
    const all = new Set([...(Array.isArray(before[kind]) ? before[kind] : []), ...(coverage?.[kind] || [])].map((h) => Number(h) >>> 0));
    archivedCoverage[kind] = [...all].sort((a, b) => a - b);
  }
  return { ...(manifest || {}), archivedCoverage };
}

/** Add a manifest's `archivedCoverage` into an auto-capture coverage (in place, like addStateToCoverage). */
export function addArchivedCoverage(coverage, archived) {
  if (!coverage || !archived || typeof archived !== 'object') return coverage;
  for (const kind of CAPTURE_KINDS) {
    for (const h of Array.isArray(archived[kind]) ? archived[kind] : []) coverage[kind]?.add(Number(h) >>> 0);
  }
  return coverage;
}
