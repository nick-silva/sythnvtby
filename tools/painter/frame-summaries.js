/**
 * The Project tool's frame summaries (src/frame-summary.js): the ones saved in the open pack, and
 * those worked out this session for frames without one. The screen index and the brightness
 * reference read them instead of decoding every frame; Save writes them back.
 */
import { deserializeVIPState } from '../../src/vip-dump.js';
import { brightnessReference, masterBrightnessLevels } from '../../src/fade.js';
import { summarizeFrameForPack, savedSummaryFor, brightnessLevelsFor, frameSummariesJson, parseFrameSummaries } from '../../src/frame-summary.js';

/** The open pack's saved summaries, parsed once per pack text. */
let saved = { text: /** @type {unknown} */ (undefined), frames: /** @type {Record<string, any> | null} */ (null) };
/** Summaries worked out this session, by frame file. */
const fresh = new Map();

function savedFrom(parts) {
  const text = parts?.frameSummaries;
  if (text !== saved.text) saved = { text, frames: parseFrameSummaries(text) };
  return saved.frames;
}

/** A frame row's text length, its summary's fingerprint, read without decompressing the frame. */
const textLength = (row) => row.jsonSize ?? (typeof row.json === 'string' ? row.json.length : 0);

/**
 * A frame's summary: saved, worked out earlier this session, or worked out now (decoding it).
 * @param {any} parts the open pack's parts @param {{ vipFile: string, json: string, jsonSize?: number }} row
 */
export function frameSummary(parts, row) {
  const n = textLength(row);
  const known = savedSummaryFor(savedFrom(parts), row.vipFile, n);
  if (known) return known;
  const had = fresh.get(row.vipFile);
  if (had && had.n === n) return had;
  const made = summarizeFrameForPack(deserializeVIPState(JSON.parse(row.json)), n);
  fresh.set(row.vipFile, made);
  return made;
}

/** The pack's normal brightness, from saved levels (only frames without a summary are read). */
export function brightnessReferenceFor(parts, rows) {
  return brightnessReference(brightnessLevelsFor(rows, savedFrom(parts), masterBrightnessLevels));
}

/** `{ frameSummaries }` to save with these frames, or `{}` when none is known. */
export function frameSummariesForSave(parts, rows) {
  const json = frameSummariesJson(
    rows.map((r) => ({ vipFile: r.vipFile, jsonSize: textLength(r) })),
    savedFrom(parts),
    fresh,
  );
  return json ? { frameSummaries: json } : {};
}
