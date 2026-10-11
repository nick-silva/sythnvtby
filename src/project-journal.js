/**
 * The Project tool's unsaved-work journal (recovery; stored by src/work-journal.js, as
 * SpriteStudio's is): a copy of what Save would write that changes while you work — groups and
 * their paint, painted tiles, position overrides, memory pools and game states, rules, frame
 * overlays and frame names/tags — kept in browser storage a moment after you stop editing, and
 * cleared when a save succeeds. Frames, reference images and memory recordings are not copied:
 * they are large, and come from the pack file or the emulator, not from painting.
 *
 * Restoring puts that work over the pack as it opens, through the normal load path: the parts are
 * merged into the opened pack's (artPackPartsFromParsed) and the result is opened again, unsaved.
 */

/** The journal's tool name in src/work-journal.js. */
export const PROJECT_JOURNAL_TOOL = 'project';

/** Frame-registry fields the Project tool edits (Frame ▸ Rename / Tags); the rest is the pack's. */
const FRAME_DETAIL_FIELDS = Object.freeze(['name', 'tags']);

/**
 * Names and tags per frame id, from the registry.
 * @param {any[] | null} registry
 * @returns {Record<string, Record<string, unknown>>}
 */
export function frameDetailsOf(registry) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const e of Array.isArray(registry) ? registry : []) {
    if (!e?.frameId) continue;
    const d = {};
    for (const k of FRAME_DETAIL_FIELDS) if (e[k] !== undefined) d[k] = e[k];
    out[e.frameId] = d;
  }
  return out;
}

/**
 * The opened registry with the journal's names and tags put back on frames it still has. Frames
 * added since (captured in the emulator) keep theirs; a field the journal does not have is removed.
 * @param {any[] | null} registry @param {Record<string, Record<string, unknown>> | undefined} details
 */
export function withFrameDetails(registry, details) {
  if (!Array.isArray(registry) || !details) return registry;
  return registry.map((e) => {
    const d = e?.frameId ? details[e.frameId] : null;
    if (!d) return e;
    const next = { ...e };
    for (const k of FRAME_DETAIL_FIELDS) {
      if (d[k] === undefined) delete next[k];
      else next[k] = d[k];
    }
    return next;
  });
}

/**
 * The journal's work over the opened pack's parts, ready for buildArtPack. Parts the journal does
 * not have keep the pack's.
 * @param {Record<string, any>} base from artPackPartsFromParsed
 * @param {Record<string, any>} journal
 * @param {(b64: string) => Uint8Array} decode base64 → bytes (src/work-journal.js base64ToBytes)
 */
export function mergeJournalIntoParts(base, journal, decode) {
  const merged = { ...base };
  if (Array.isArray(journal.groups)) merged.groups = journal.groups;
  if (typeof journal.vbcolor === 'string') {
    const bytes = decode(journal.vbcolor);
    merged.vbcolor = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  if (journal.overrides !== undefined) merged.overrides = journal.overrides;
  for (const key of ['overridePresets', 'gameStatePools', 'gameStates']) {
    if (!Array.isArray(journal[key])) continue;
    if (journal[key].length) merged[key] = journal[key];
    else delete merged[key];
  }
  if (journal.painterV2Rules && typeof journal.painterV2Rules === 'object') merged.painterV2Rules = journal.painterV2Rules;
  if (typeof journal.painterV2VipOverlays === 'string') merged.painterV2VipOverlays = journal.painterV2VipOverlays;
  if (journal.frameDetails && base.manifest && Array.isArray(base.manifest.frameRegistry)) {
    merged.manifest = { ...base.manifest, frameRegistry: withFrameDetails(base.manifest.frameRegistry, journal.frameDetails) };
  }
  return merged;
}

/**
 * The question asked when a pack opens with a journal for it.
 * @param {string} name the pack's name @param {{ savedAt: string, frames?: number }} journal
 * @param {number} frames frames the opened pack has
 */
export function restoreJournalPrompt(name, journal, frames) {
  const when = new Date(journal.savedAt).toLocaleString();
  const changed = typeof journal.frames === 'number' && journal.frames !== frames;
  return (
    `The Project tool has unsaved work for ${name} from ${when} — the page closed before it was saved.\n\n`
    + (changed
      ? `The pack has ${frames} frame(s) now, ${journal.frames} then: restoring puts back the groups, paint and frame names as they were, and keeps the frames the pack has.\n\n`
      : '')
    + 'Restore it? (Cancel discards it.)'
  );
}
