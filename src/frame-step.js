/**
 * Pause and step: stop the game, move one frame at a time, and step back to land on exactly the
 * frame you want to capture.
 *
 * Stepping forward runs the core for one frame and stops it from the core's own per-frame hook.
 * Stepping back restores a save state: the emulator keeps one for each of the last few seconds of
 * frames ({@link StateHistory}). Replaying from a state is exact (checked frame for frame), but only
 * with the same button presses, so the history holds every frame rather than every tenth and
 * replaying across presses is never needed.
 *
 * Keys (ignored while typing, and with Ctrl/Alt/Meta held; Shift steps 10 frames):
 *   P  pause / resume     .  step forward     ,  step back
 */

export const PAUSE_KEY = 'p';
export const STEP_FORWARD_KEY = '.';
export const STEP_BACK_KEY = ',';
/** Frames per step with Shift held. */
export const BIG_STEP = 10;
/** Frames of history kept for stepping back: 3 s at the VB's 50 frames a second. */
export const HISTORY_FRAMES = 150;
/**
 * Frames run after restoring a state to put the target on screen: one. Checked on Mario Clash: the
 * frame data after stepping back (draw list, patterns, palettes, worlds) matched going forward on
 * every frame. The monochrome canvas can flicker between two pictures from frame to frame whether
 * stepping or not, so a screenshot is no test of it.
 */
export const REPLAY_FRAMES = 1;

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** With Shift held the browser reports the shifted character for these keys. */
const SHIFTED = { '>': STEP_FORWARD_KEY, '<': STEP_BACK_KEY, P: PAUSE_KEY };

/**
 * @param {{ key: string, repeat?: boolean, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean,
 *   shiftKey?: boolean, target?: { tagName?: string, isContentEditable?: boolean } | null }} e
 * @returns {null | { action: 'pause' } | { action: 'forward' | 'back', frames: number }}
 */
export function frameStepAction(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const t = e.target;
  if (t && (EDITABLE_TAGS.has(String(t.tagName).toUpperCase()) || t.isContentEditable === true)) return null;
  const key = SHIFTED[e.key] ?? String(e.key || '').toLowerCase();
  const frames = e.shiftKey ? BIG_STEP : 1;
  if (key === PAUSE_KEY) return e.repeat ? null : { action: 'pause' };
  // Holding a step key keeps stepping, like a slow-motion scrub.
  if (key === STEP_FORWARD_KEY) return { action: 'forward', frames };
  if (key === STEP_BACK_KEY) return { action: 'back', frames };
  return null;
}

/**
 * The save state after each of the last `limit` frames, newest last, with a running frame number.
 * Buffers are reused once the history is full, so recording every frame does not churn memory.
 */
export class StateHistory {
  /** @param {number} [limit] @param {number} [replay] frames run after a restore ({@link REPLAY_FRAMES}) */
  constructor(limit = HISTORY_FRAMES, replay = REPLAY_FRAMES) {
    this.replay = Math.max(1, Math.floor(replay));
    this.limit = Math.max(this.replay + 1, Math.floor(limit));
    /** @type {Array<{ frame: number, bytes: Uint8Array, length: number }>} */
    this.entries = [];
    /** @type {Array<Uint8Array>} spare buffers from dropped entries */
    this.spare = [];
  }

  get size() {
    return this.entries.length;
  }

  /** Frame number of the newest entry (the frame on screen), or 0 when empty. */
  get frame() {
    return this.entries.length ? this.entries[this.entries.length - 1].frame : 0;
  }

  /** How many frames back can be shown: showing frame N−k needs the state after frame N−k−replay. */
  get canStepBack() {
    return Math.max(0, this.entries.length - 1 - this.replay);
  }

  /**
   * Record the state after the next frame.
   * @param {ArrayBuffer | ArrayBufferView} state
   */
  push(state) {
    const src = state instanceof Uint8Array
      ? state
      : ArrayBuffer.isView(state)
        ? new Uint8Array(state.buffer, state.byteOffset, state.byteLength)
        : new Uint8Array(state);
    if (!src.byteLength) return;
    const frame = this.frame + 1;
    if (this.entries.length >= this.limit) this.spare.push(this.entries.shift().bytes);
    let bytes = this.spare.pop();
    if (!bytes || bytes.byteLength < src.byteLength) bytes = new Uint8Array(src.byteLength);
    bytes.set(src);
    this.entries.push({ frame, bytes, length: src.byteLength });
  }

  /**
   * Go back `frames` frames (at most {@link canStepBack}). Drops the newer entries and hands back
   * the state to restore — the one `replay` frames before the target, which stays the newest
   * entry — so that running `replay` frames from it shows the target and records those frames
   * again. Null when nothing can be shown.
   * @param {number} frames
   * @returns {null | { state: Uint8Array, frames: number, replay: number }} the state to load, how far
   *   back that shows, and how many frames to run
   */
  stepBack(frames) {
    const k = Math.min(Math.max(1, Math.floor(frames)), this.canStepBack);
    if (k < 1) return null;
    // Entries hold the states after frames …, N−k−r, …, N. Keep up to N−k−r and load it: running r
    // frames from it shows N−k and pushes those states back.
    const drop = k + this.replay;
    for (const e of this.entries.splice(this.entries.length - drop, drop)) this.spare.push(e.bytes);
    const top = this.entries[this.entries.length - 1];
    return { state: top.bytes.subarray(0, top.length), frames: k, replay: this.replay };
  }

  /** Forget everything: a different game, or a state loaded from elsewhere. */
  clear() {
    for (const e of this.entries) this.spare.push(e.bytes);
    this.entries = [];
  }
}
