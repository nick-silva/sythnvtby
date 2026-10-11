/**
 * Questions asked of the game's memory, answered from recordings (docs/design/memory-states.md §3–4).
 *
 *   manifest.memoryQuestions  [{ id, name, sides: [{ id, name }], createdAt, status }]
 *   manifest.memoryRecordings [{ id, question, side, startedAt, seconds, samples, session, source, frameId? }]
 *   memoryrecordings/<id>.bin  the recording's memory samples (encodeRecording)
 *
 * A recording is a few seconds of memory samples labelled with one side of a question ("Luigi is
 * the player"), or a captured frame's memory dump added to a side (`source: 'frame'`, no file: it
 * is read from the frame). The analysis looks for bytes that hold one value on every sample of a
 * side and a different value for each side; with samples from many moments of play, everything
 * that moves (positions, scores, the ball) drops out and only bytes that follow the state remain.
 */

import { newGameStateId, withGameState } from './game-states.js';

export const WRAM_SIZE = 0x10000;
const MAGIC = [0x56, 0x42, 0x4d, 0x52]; // "VBMR"
const VERSION = 1;
const HEADER = 12;
/** "Enough": per side, at least this many recordings from at least this many sessions. */
export const ENOUGH_RECORDINGS = 5;
export const ENOUGH_SESSIONS = 2;
/** At most this many near misses are listed. */
const MAX_NEAR_MISSES = 50;

// --- The recording file ---

/**
 * Samples → file: a header, the first sample whole, and each later one as its difference (XOR)
 * from the one before — mostly zeros, which the pack's compression shrinks to almost nothing.
 * @param {Uint8Array[]} samples 64 KiB each
 * @returns {Uint8Array}
 */
export function encodeRecording(samples) {
  const list = samples.filter((s) => s && s.byteLength >= WRAM_SIZE);
  const out = new Uint8Array(HEADER + list.length * WRAM_SIZE);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  new DataView(out.buffer).setUint32(8, list.length, true);
  for (let i = 0; i < list.length; i++) {
    const at = HEADER + i * WRAM_SIZE;
    const cur = list[i];
    if (i === 0) out.set(cur.subarray(0, WRAM_SIZE), at);
    else {
      const prev = list[i - 1];
      for (let k = 0; k < WRAM_SIZE; k++) out[at + k] = cur[k] ^ prev[k];
    }
  }
  return out;
}

/**
 * File → samples; null when it is not a recording (or is cut short).
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {Uint8Array[] | null}
 */
export function decodeRecording(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < HEADER || MAGIC.some((b, i) => u8[i] !== b) || u8[4] !== VERSION) return null;
  const count = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(8, true);
  if (u8.byteLength < HEADER + count * WRAM_SIZE) return null;
  const out = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER + i * WRAM_SIZE;
    const s = u8.slice(at, at + WRAM_SIZE);
    if (i > 0) {
      const prev = out[i - 1];
      for (let k = 0; k < WRAM_SIZE; k++) s[k] ^= prev[k];
    }
    out.push(s);
  }
  return out;
}

/** The pack path of a recording's file. */
export const recordingFile = (id) => `memoryrecordings/${id}.bin`;

/** Samples worth keeping: each different from the one before it (identical ones add nothing). */
export function distinctSamples(samples) {
  const out = [];
  for (const s of samples) {
    const prev = out[out.length - 1];
    if (prev && prev.every((v, i) => v === s[i])) continue;
    out.push(s);
  }
  return out;
}

// --- Questions and recordings in the manifest ---

/** @param {unknown} manifest */
export function questionsOf(manifest) {
  const list = /** @type {any} */ (manifest)?.memoryQuestions;
  return (Array.isArray(list) ? list : []).filter((q) => typeof q?.id === 'string' && Array.isArray(q.sides) && q.sides.length >= 2);
}

/** @param {unknown} manifest */
export function recordingsOf(manifest) {
  const list = /** @type {any} */ (manifest)?.memoryRecordings;
  return (Array.isArray(list) ? list : []).filter((r) => typeof r?.id === 'string' && typeof r.question === 'string' && typeof r.side === 'string');
}

const slug = (s, fallback) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || fallback;

/**
 * A new question with these sides (at least two different names); null with fewer.
 * @param {any[]} questions @param {string} name @param {string[]} sideNames @param {() => Date} [now]
 */
export function newQuestion(questions, name, sideNames, now = () => new Date()) {
  const names = [...new Set(sideNames.map((s) => String(s).trim()).filter(Boolean))];
  if (names.length < 2) return null;
  const taken = new Set(questions.map((q) => q.id));
  let id = `q-${slug(name, 'question')}`;
  for (let n = 2; taken.has(id); n++) id = `q-${slug(name, 'question')}-${n}`;
  const sides = [];
  for (const s of names) {
    let sid = slug(s, 'side');
    for (let n = 2; sides.some((x) => x.id === sid); n++) sid = `${slug(s, 'side')}-${n}`;
    sides.push({ id: sid, name: s });
  }
  return { id, name: String(name).trim() || 'Question', sides, createdAt: now().toISOString(), status: 'collecting' };
}

// --- The analysis ---

/**
 * For one recording, per byte: whether every sample has the same value, and that value.
 * @param {Uint8Array[]} samples
 */
export function recordingProfile(samples) {
  const steady = new Uint8Array(WRAM_SIZE).fill(samples.length ? 1 : 0);
  const value = samples.length ? samples[0].slice(0, WRAM_SIZE) : new Uint8Array(WRAM_SIZE);
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    for (let k = 0; k < WRAM_SIZE; k++) if (s[k] !== value[k]) steady[k] = 0;
  }
  return { steady, value, samples: samples.length };
}

/**
 * @typedef {{ id: string, side: string, session?: string, samples: Uint8Array[] }} LoadedRecording
 * @typedef {{
 *   sides: Array<{ id: string, name: string, recordings: number, samples: number, sessions: number }>,
 *   candidates: Array<{ offset: number, values: Record<string, number> }>,
 *   nearMisses: Array<{ offset: number, side: string, recording: string, values: Record<string, number> }>,
 *   enough: boolean,
 *   advice: string[],
 * }} QuestionAnalysis
 */

/** The value every recording of a side holds at `k`, or -1; `skip` leaves one recording out. */
function sideValue(profiles, k, skip = -1) {
  let v = -1;
  for (let i = 0; i < profiles.length; i++) {
    if (i === skip) continue;
    const p = profiles[i];
    if (!p.steady[k]) return -1;
    if (v === -1) v = p.value[k];
    else if (p.value[k] !== v) return -1;
  }
  return v;
}

const allDifferent = (list) => new Set(list).size === list.length;

/**
 * Which bytes tell the sides apart: steady on every sample of each side, a different value for
 * each side. Also the near misses — bytes that would fit but for one recording of one side (most
 * often a recording made with the wrong side picked) — and whether there is enough to trust it.
 * @param {{ sides: Array<{ id: string, name: string }> }} question
 * @param {LoadedRecording[]} recordings
 * @returns {QuestionAnalysis}
 */
export function analyseQuestion(question, recordings) {
  const bySide = question.sides.map((s) => {
    const recs = recordings.filter((r) => r.side === s.id && r.samples.length);
    return { side: s, recs, profiles: recs.map((r) => recordingProfile(r.samples)) };
  });
  const sides = bySide.map(({ side, recs }) => ({
    id: side.id,
    name: side.name,
    recordings: recs.length,
    samples: recs.reduce((n, r) => n + r.samples.length, 0),
    sessions: new Set(recs.map((r) => r.session || r.id)).size,
  }));
  const ready = bySide.every((b) => b.recs.length > 0);
  /** @type {QuestionAnalysis['candidates']} */
  const candidates = [];
  /** @type {QuestionAnalysis['nearMisses']} */
  const nearMisses = [];
  const valuesOf = (vals) => Object.fromEntries(bySide.map((b, i) => [b.side.id, vals[i]]));
  for (let k = 0; ready && k < WRAM_SIZE; k++) {
    const vals = bySide.map((b) => sideValue(b.profiles, k));
    const failing = vals.map((v, i) => (v < 0 ? i : -1)).filter((i) => i >= 0);
    if (!failing.length) {
      if (allDifferent(vals)) candidates.push({ offset: k, values: valuesOf(vals) });
      continue;
    }
    // One side fails: would it fit without one of its recordings?
    if (failing.length !== 1 || nearMisses.length >= MAX_NEAR_MISSES) continue;
    const fi = failing[0];
    const b = bySide[fi];
    if (b.profiles.length < 2) continue;
    for (let r = 0; r < b.profiles.length; r++) {
      const v = sideValue(b.profiles, k, r);
      if (v < 0) continue;
      const all = vals.map((x, i) => (i === fi ? v : x));
      if (!allDifferent(all)) continue;
      nearMisses.push({ offset: k, side: b.side.id, recording: b.recs[r].id, values: valuesOf(all) });
      break;
    }
  }
  const advice = [];
  for (const s of sides) {
    if (s.recordings === 0) advice.push(`Record “${s.name}”.`);
    else if (s.recordings < ENOUGH_RECORDINGS) advice.push(`“${s.name}” has ${s.recordings} recording${s.recordings === 1 ? '' : 's'} — make at least ${ENOUGH_RECORDINGS}, at different moments of play.`);
    else if (s.sessions < ENOUGH_SESSIONS) advice.push(`All of “${s.name}”'s recordings come from one session — record it again in another one (another match, another level).`);
  }
  if (ready && !candidates.length) {
    advice.push(nearMisses.length
      ? 'No byte fits every recording, but some would without one recording: check the near misses — a recording made with the wrong side picked is the usual cause.'
      : 'No byte holds one value on every recording of each side and a different one for each side. The sides may not be a state the game keeps, or one byte is not enough.');
  }
  const enough = ready && candidates.length > 0 && sides.every((s) => s.recordings >= ENOUGH_RECORDINGS && s.sessions >= ENOUGH_SESSIONS);
  return { sides, candidates, nearMisses, enough, advice };
}

const sameConditions = (a, b) => a.length === b.length && a.every((c, i) => c.offset === b[i].offset && c.value === b[i].value);

/**
 * Each side of the question as a game state: the chosen bytes with that side's values. Saving the
 * question again updates its game states in place (same ids, so groups' conditions keep working);
 * one whose bytes changed loses its "checked live" mark.
 * @param {{ id: string, sides: Array<{ id: string, name: string }> }} question
 * @param {QuestionAnalysis} analysis @param {number[]} offsets candidate offsets to use (at least one)
 * @param {any[]} states the project's game states
 * @returns {{ states: any[], ids: string[] } | null}
 */
export function gameStatesFromQuestion(question, analysis, offsets, states) {
  const chosen = analysis.candidates.filter((c) => offsets.includes(c.offset));
  if (!chosen.length) return null;
  let next = Array.isArray(states) ? states : [];
  const ids = [];
  for (const side of question.sides) {
    const existing = next.find((s) => s.question === question.id && s.side === side.id);
    const conditions = chosen.map((c) => ({ offset: c.offset, value: c.values[side.id] }));
    const keepCheck = existing?.checkedLive && sameConditions(existing.conditions || [], conditions);
    const state = {
      id: existing?.id || newGameStateId(next, side.name),
      name: existing?.name || side.name,
      conditions,
      source: 'learned',
      question: question.id,
      side: side.id,
      ...(keepCheck && { checkedLive: existing.checkedLive }),
    };
    next = withGameState(next, state);
    ids.push(state.id);
  }
  return { states: next, ids };
}
