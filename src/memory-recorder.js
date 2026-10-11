/**
 * Recording memory in the emulator, for a question's side (docs/design/memory-states.md §3.5, §5.1).
 *
 * A recording is a few seconds of memory samples (default 5 s, 2 a second; a sample identical to
 * the one before is skipped), or samples until stopped, labelled with one side of a question.
 * Switching side while recording ends that recording and starts the next. The recorder keeps the
 * pack's questions and recordings it was loaded with, adds its own, and hands them all back for
 * the next export (Colorize!, Save and Play, Export .vbpack), so a round trip through the emulator
 * keeps them.
 */

import { ReadOnGetMap } from './lazy-entries.js';
import { encodeRecording, questionsOf, recordingsOf, newQuestion, WRAM_SIZE } from './memory-questions.js';

export const SAMPLE_MS = 500;
export const DEFAULT_SECONDS = 5;
export const MAX_SECONDS = 600;

/**
 * @param {{
 *   getWram: () => Uint8Array | null,
 *   onChange?: () => void,
 *   now?: () => Date,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 * }} deps
 */
export function createMemoryRecorder({ getWram, onChange = () => {}, now = () => new Date(), setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (t) => clearInterval(t) }) {
  const session = `p-${now().getTime().toString(36)}`;
  /** @type {any[]} */
  let questions = [];
  /** @type {any[]} */
  let recordings = [];
  /** @type {Map<string, ArrayBuffer>} file name → bytes */
  let files = new Map();
  /** @type {null | { question: string, side: string, seconds: number | null, startedAt: Date, samples: Uint8Array[], timer: any, ticks: number }} */
  let active = null;

  /** End the recording in progress, keeping it if it got any samples. */
  function finish() {
    if (!active) return null;
    const a = active;
    active = null;
    clearTimer(a.timer);
    if (!a.samples.length) {
      onChange();
      return null;
    }
    const id = `r-${a.startedAt.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    files.set(`${id}.bin`, encodeRecording(a.samples).buffer);
    const rec = {
      id,
      question: a.question,
      side: a.side,
      startedAt: a.startedAt.toISOString(),
      seconds: Math.round((a.ticks * SAMPLE_MS) / 100) / 10,
      samples: a.samples.length,
      session,
      source: 'record',
    };
    recordings = [...recordings, rec];
    onChange();
    return rec;
  }

  function sampleNow() {
    if (!active) return;
    const w = getWram();
    active.ticks++;
    if (w && w.byteLength >= WRAM_SIZE) {
      const prev = active.samples[active.samples.length - 1];
      const s = w.slice(0, WRAM_SIZE);
      if (!prev || !prev.every((v, i) => v === s[i])) active.samples.push(s);
    }
    if (active.seconds != null && active.ticks * SAMPLE_MS >= active.seconds * 1000) finish();
    else onChange();
  }

  function start(question, side, seconds = DEFAULT_SECONDS) {
    if (active) finish();
    if (!questions.some((q) => q.id === question && q.sides.some((s) => s.id === side))) return false;
    const secs = seconds == null ? null : Math.max(1, Math.min(MAX_SECONDS, Number(seconds) || DEFAULT_SECONDS));
    active = { question, side, seconds: secs, startedAt: now(), samples: [], timer: null, ticks: 0 };
    active.timer = setTimer(sampleNow, SAMPLE_MS);
    sampleNow();
    return true;
  }

  return {
    session,
    /** The pack's questions and recordings, as loaded (replaces what was there). */
    load(manifest, folder) {
      if (active) finish();
      questions = questionsOf(manifest);
      recordings = recordingsOf(manifest);
      // Read when used (re-checking a question, export), not when the pack opens (src/lazy-entries.js).
      files = new ReadOnGetMap((f) => (f && typeof f === 'object' && 'buffer' in f ? f.buffer : f));
      for (const f of Array.isArray(folder) ? folder : []) files.set(f.name, f);
      onChange();
    },
    questions: () => questions,
    recordings: () => recordings,
    /** A new question; null when it needs two different sides. */
    addQuestion(name, sideNames) {
      const q = newQuestion(questions, name, sideNames, now);
      if (q) {
        questions = [...questions, q];
        onChange();
      }
      return q;
    },
    /**
     * Start recording a side: for `seconds` (clamped to 1–600), or until stopped when null. A
     * recording already going ends first.
     */
    start,
    stop: () => finish(),
    /** Switch the side being recorded: the current recording ends, the next starts the same way. */
    switchSide(side) {
      if (!active) return false;
      const { question, seconds } = active;
      finish();
      return start(question, side, seconds);
    },
    recording: () => (active ? { question: active.question, side: active.side, samples: active.samples.length, seconds: active.seconds, elapsed: (active.ticks * SAMPLE_MS) / 1000 } : null),
    /** Recordings per side of a question: all of them, and this session's. */
    counts(questionId) {
      /** @type {Record<string, { recordings: number, thisSession: number }>} */
      const out = {};
      for (const r of recordings.filter((x) => x.question === questionId)) {
        const c = (out[r.side] ||= { recordings: 0, thisSession: 0 });
        c.recordings++;
        if (r.session === session) c.thisSession++;
      }
      return out;
    },
    /** For the next export: manifest fields (none when empty). */
    manifestFields() {
      return {
        ...(questions.length && { memoryQuestions: questions }),
        ...(recordings.length && { memoryRecordings: recordings }),
      };
    },
    /** For the next export: the recordings' files. */
    folder() {
      const wanted = new Set(recordings.map((r) => `${r.id}.bin`));
      // A recording read unchanged from the pack goes as its item, so the pack built from it copies
      // the stored bytes (src/zip-write.js) instead of reading the recording.
      return [...files.keys()].filter((name) => wanted.has(name)).map((name) => {
        const item = Map.prototype.get.call(files, name);
        return item?.zipEntry ? item : { name, buffer: files.get(name) };
      });
    },
  };
}
