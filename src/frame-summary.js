/**
 * Frame summaries saved in the pack (`framesummaries.json`): what each captured frame shows, in
 * brief, so opening a project does not have to decode every frame to know it. Each tool used to
 * build its own after every open — SpriteStudio's "could this frame show these patterns?" filter
 * (tools/shared/pack-session.js) and the Project tool's screen index (src/group-screens.js) —
 * which grew with the frame count (about 5 s of background work at 1,000 frames, plus a blocking
 * pass over every frame for the brightness reference). One summary serves both:
 *
 *   { n: frame text length (the fingerprint), b: master brightness or null,
 *     h: every pattern any draw uses (either eye, any layer),
 *     w: { "world|layer": [[patterns], [tile slots]] } — the left eye's non-blank draws, with "*"
 *        for a draw with no world or layer,
 *     a: 1 when a layer is scaled (affine), x: the patterns its scaled layers show without a draw
 *        record (null when not worked out) }
 *
 * A summary whose `n` no longer matches its frame is ignored and the frame is read again.
 */
import { getTileBytes, hashTile, isBlankTile } from './vip-state.js';
import { affineWorlds, affineStandInDraws } from './affine-world.js';

export const FRAME_SUMMARIES_VERSION = 1;
const ANY = '*';

/**
 * Summarise a decoded frame.
 * @param {any} state a deserialized VIP state
 * @param {number} textLength the frame's text length (its row's `jsonSize`)
 * @param {{ standIns?: boolean }} [opts] work out the scaled layers' unrecorded patterns (a few ms)
 */
export function summarizeFrameForPack(state, textLength, { standIns = true } = {}) {
  const pt = state?.patternTable;
  const draws = Array.isArray(state?.drawList) ? state.drawList : [];
  /** @type {Map<number, number>} */
  const hashBySlot = new Map();
  const hashOf = (slot) => {
    let h = hashBySlot.get(slot);
    if (h === undefined) {
      h = pt ? hashTile(getTileBytes(pt, slot)) >>> 0 : 0;
      hashBySlot.set(slot, h);
    }
    return h;
  };
  /** @type {Map<number, boolean>} */
  const blank = new Map();
  const isBlank = (slot) => {
    let b = blank.get(slot);
    if (b === undefined) blank.set(slot, (b = !pt || isBlankTile(getTileBytes(pt, slot))));
    return b;
  };
  const all = new Set();
  /** @type {Map<string, { h: Set<number>, s: Set<number> }>} */
  const byKey = new Map();
  for (const d of draws) {
    const h = hashOf(d.tileIndex);
    all.add(h);
    if ((Number(d.eye) === 1 ? 1 : 0) !== 0 || isBlank(d.tileIndex)) continue;
    const key = `${d.world ?? ANY}|${d.layer ?? ANY}`;
    let e = byKey.get(key);
    if (!e) byKey.set(key, (e = { h: new Set(), s: new Set() }));
    e.h.add(h);
    e.s.add(Number(d.tileIndex));
  }
  let affine = false;
  let x = null;
  try {
    affine = affineWorlds(state, 0).length > 0 || affineWorlds(state, 1).length > 0;
    if (affine && standIns) x = [...new Set(affineStandInDraws(state).map((d) => hashOf(d.tileIndex)))];
  } catch {
    affine = true;
    x = null;
  }
  const w = {};
  for (const [key, e] of byKey) w[key] = [[...e.h], [...e.s]];
  const b = state?.masterBrightness != null && Number.isFinite(Number(state.masterBrightness)) ? Number(state.masterBrightness) : null;
  return { n: textLength, b, h: [...all], w, a: affine ? 1 : 0, x: affine ? x : [] };
}

/**
 * The saved summary for a frame, when it still matches it.
 * @param {Record<string, any> | null | undefined} saved file name → summary
 * @param {string} vipFile @param {number} textLength
 */
export function savedSummaryFor(saved, vipFile, textLength) {
  const s = saved?.[vipFile];
  return s && typeof s === 'object' && s.n === textLength && Array.isArray(s.h) && s.w && typeof s.w === 'object' ? s : null;
}

/**
 * SpriteStudio's in-memory form: the patterns a frame can show, for skipping frames.
 * @returns {{ hashes: Set<number>, affine: boolean, standIns: Set<number> | null }}
 */
export function toPatternSummary(s) {
  const affine = !!s.a;
  return { hashes: new Set(s.h), affine, standIns: affine ? (Array.isArray(s.x) ? new Set(s.x) : null) : new Set() };
}

/**
 * The Project tool's screen-index form (src/group-screens.js frameGroupIndex): per world and layer,
 * and "any" of either, the patterns and tile slots the left eye draws there.
 * @returns {{ byWorldLayer: Map<string, { hashes: Set<number>, slots: Set<number> }> }}
 */
export function toGroupIndex(s) {
  const byWorldLayer = new Map();
  const entry = (key) => {
    let e = byWorldLayer.get(key);
    if (!e) byWorldLayer.set(key, (e = { hashes: new Set(), slots: new Set() }));
    return e;
  };
  for (const [key, [hashes, slots]] of Object.entries(s.w)) {
    const [w, l] = key.split('|');
    for (const wk of w === ANY ? [ANY] : [w, ANY]) {
      for (const lk of l === ANY ? [ANY] : [l, ANY]) {
        const e = entry(`${wk}|${lk}`);
        for (const h of hashes) e.hashes.add(h);
        for (const t of slots) e.slots.add(t);
      }
    }
  }
  return { byWorldLayer };
}

/**
 * The brightness reference's inputs: each frame's master brightness, saved or (for frames with no
 * summary) read from the frame text — only those are read.
 * @param {Array<{ vipFile: string, jsonSize?: number, json: string }>} frames
 * @param {Record<string, any> | null | undefined} saved
 * @param {(texts: string[]) => number[]} readLevels src/fade.js masterBrightnessLevels
 */
export function brightnessLevelsFor(frames, saved, readLevels) {
  const levels = [];
  const unread = [];
  for (const f of frames) {
    const s = savedSummaryFor(saved, f.vipFile, f.jsonSize ?? f.json?.length);
    if (s) {
      if (s.b != null) levels.push(s.b);
    } else unread.push(f);
  }
  return unread.length ? levels.concat(readLevels(unread.map((f) => f.json))) : levels;
}

/**
 * The file to save: one summary per frame still in the project — one worked out this session, else
 * the saved one if it still matches.
 * @param {Array<{ vipFile: string, jsonSize?: number, json?: string }>} frames
 * @param {Record<string, any> | null | undefined} saved
 * @param {Map<string, any>} fresh file name → summary worked out this session
 * @returns {string | null} JSON, or null when there is nothing to save
 */
export function frameSummariesJson(frames, saved, fresh) {
  const out = {};
  for (const f of frames) {
    const n = f.jsonSize ?? f.json?.length;
    const s = fresh.get(f.vipFile);
    const keep = s && s.n === n ? s : savedSummaryFor(saved, f.vipFile, n);
    if (keep) out[f.vipFile] = keep;
  }
  return Object.keys(out).length ? JSON.stringify({ version: FRAME_SUMMARIES_VERSION, frames: out }) : null;
}

/**
 * The saved summaries in a pack's `framesummaries.json`, or null when there are none (or they are
 * from another version, or unreadable).
 * @param {unknown} text
 * @returns {Record<string, any> | null}
 */
export function parseFrameSummaries(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const doc = JSON.parse(text);
    return doc?.version === FRAME_SUMMARIES_VERSION && doc.frames && typeof doc.frames === 'object' ? doc.frames : null;
  } catch {
    return null;
  }
}
