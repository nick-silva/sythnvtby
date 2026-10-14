/**
 * Art pack (.vbpack): generic ZIP containing rom, color.vbcolor, overrides.json, manifest.json.
 * See docs/reference/art-pack-file-format.md.
 */

import { convertInterimSubStates } from './game-states.js';
import JSZip from 'jszip';
import { openZip, canReadZipNatively, ZipUnsupported } from './zip-read.js';
import { lazyJsonItem, lazyBufferItem, withZipEntry } from './lazy-entries.js';
import { ZipWriter } from './zip-write.js';

/**
 * A folder's files as items. From the native reader they stay compressed until read
 * (src/lazy-entries.js); from JSZip (the fallback) they are read now.
 * @param {any[]} matches zip entries @param {RegExp} prefix @param {'json' | 'buffer'} kind
 */
async function folderItems(matches, prefix, kind) {
  return Promise.all(
    (matches || []).map(async (file) => {
      const name = (file.name || '').replace(prefix, '');
      if (typeof file.bytesSync === 'function') return kind === 'json' ? lazyJsonItem(name, file) : lazyBufferItem(name, file);
      return kind === 'json' ? { name, json: (await file.async('string')) || '' } : { name, buffer: await file.async('arraybuffer') };
    }),
  );
}
import { romIdentity } from './rom-identity.js';

/**
 * Copy ArrayBuffer / TypedArray into a standalone ArrayBuffer (safe for zip + IndexedDB).
 * @param {unknown} data
 * @returns {ArrayBuffer|null}
 */
export function copyBinaryToArrayBuffer(data) {
  if (data == null) return null;
  if (data instanceof ArrayBuffer) {
    return data.byteLength > 0 ? data.slice(0) : null;
  }
  if (ArrayBuffer.isView(data)) {
    const v = /** @type {ArrayBufferView} */ (data);
    if (v.byteLength <= 0) return null;
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  }
  return null;
}

/**
 * Case-insensitive JSZip member lookup (path separators normalized).
 * Some zip tools use different casing; memory-analysis merges manifest by resolved name.
 * @param {JSZip} zip
 * @param {string} preferredPath
 * @returns {import('jszip').JSZipObject | null}
 */
function findZipFile(zip, preferredPath) {
  const n = preferredPath.replace(/\\/g, '/');
  const direct = zip.file(n);
  if (direct) return direct;
  const low = n.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    if (name.replace(/\\/g, '/').toLowerCase() === low) return zip.file(name);
  }
  return null;
}

/** Canonical entry names in the zip. */
export const PACK_ENTRIES = {
  ROM: 'rom',
  ROM_BIN: 'rom.bin',
  COLOR: 'color.vbcolor',
  PACK: 'pack.vbcolor',
  OVERRIDES: 'overrides.json',
  MANIFEST: 'manifest.json',
  /** Single current VIP state (frame snapshot); painter and emulator can use it. */
  VIPSTATE_CURRENT: 'vipstate-current.json',
  /** Single current core save state; used to restore exact frame after Save and Play. */
  SAVESTATE_CURRENT: 'save-state.state',
  /** Groups for paint tool: window/hash/layer criteria and optional RAM stub. */
  GROUPS: 'groups.json',
  /**
   * Painter v2 authoring rules (additive). Old tools ignore this file.
   * @see docs/reference/art-pack-file-format.md
   */
  PAINTER_V2_RULES: 'painter-v2-rules.json',
  /**
   * Painter v2: full-frame VIP RGBA authoring per group + eye (anchor BG overlay paint).
   * JSON: `{ schemaVersion: 1, width, height, entries: [{ groupId, eye, rgbaBase64 }] }`.
   */
  PAINTER_V2_VIP_OVERLAYS: 'painter-v2-vip-overlays.json',
  /**
   * What each captured frame shows, in brief (src/frame-summary.js), so opening a project does not
   * decode every frame. Optional and rebuilt for any frame it does not match; old tools ignore it.
   */
  FRAME_SUMMARIES: 'framesummaries.json',
};

/** Current document shape for {@link PACK_ENTRIES.PAINTER_V2_RULES}; forward-compatible fields allowed. */
export const PAINTER_V2_RULES_SCHEMA_VERSION = 1;

/** Default empty rules document for new packs or tooling. */
export function defaultPainterV2Rules() {
  return {
    schemaVersion: PAINTER_V2_RULES_SCHEMA_VERSION,
    /** variantId -> hash -> { rgbaBase64 } (or raw base64 string) */
    tile8ByVariant: {},
    /** reserved for upcoming macro path */
    macroByVariant: {},
  };
}

/**
 * Resolve ROM entry: prefer 'rom', then 'rom.bin'.
 * @param {JSZip} zip
 * @returns {Promise<ArrayBuffer | null>}
 */
async function getRomFromZip(zip) {
  const entry = zip.file(PACK_ENTRIES.ROM) ?? zip.file(PACK_ENTRIES.ROM_BIN);
  if (!entry) return null;
  return entry.async('arraybuffer');
}

/**
 * Resolve color pack entry: prefer 'color.vbcolor', then 'pack.vbcolor'.
 * @param {JSZip} zip
 * @returns {Promise<ArrayBuffer | null>}
 */
async function getVbcolorFromZip(zip) {
  const entry = zip.file(PACK_ENTRIES.COLOR) ?? zip.file(PACK_ENTRIES.PACK);
  if (!entry) return null;
  return entry.async('arraybuffer');
}

/**
 * Parse a .vbpack (ZIP) from buffer. Returns extracted parts; caller applies them (ROM, pack, overrides).
 *
 * @param {ArrayBuffer} buffer - Raw bytes of the .vbpack file.
 * @returns {Promise<{ rom?: ArrayBuffer, vbcolor?: ArrayBuffer, overrides?: unknown, manifest?: Record<string, unknown>, vipState?: string, saveState?: ArrayBuffer, vipStatesFolder?: Array<{ name: string, json: string }>, saveStatesFolder?: Array<{ name: string, buffer: ArrayBuffer }>, ramdumpsFolder?: Array<{ name: string, buffer: ArrayBuffer }>, screenshotsFolder?: Array<{ name: string, buffer: ArrayBuffer }>, groups?: unknown[], overridePresets?: unknown[], gameStatePools: unknown[], groupsSchemaVersion?: number, painterV2Rules?: Record<string, unknown>, painterV2VipOverlays?: string, groupsJsonInPack: boolean }>}
 */
export async function parseArtPack(buffer) {
  // The native reader (src/zip-read.js) is several times faster; JSZip reads anything it can't.
  if (canReadZipNatively()) {
    try {
      return await parseArtPackFrom(openZip(buffer));
    } catch (e) {
      if (!(e instanceof ZipUnsupported)) throw e;
    }
  }
  return parseArtPackFrom(await JSZip.loadAsync(buffer));
}

/** @param {{ file: Function, files: Record<string, unknown>, filter: Function }} zip a JSZip, or src/zip-read.js's reader */
async function parseArtPackFrom(zip) {
  const [rom, vbcolor, overridesRaw, manifestRaw, vipStateRaw, saveStateBuf, groupsRaw, painterV2RulesRaw, painterV2VipOverlaysRaw, frameSummariesRaw] =
    await Promise.all([
      getRomFromZip(zip),
      getVbcolorFromZip(zip),
      findZipFile(zip, PACK_ENTRIES.OVERRIDES)?.async('string') ?? null,
      findZipFile(zip, PACK_ENTRIES.MANIFEST)?.async('string') ?? null,
      findZipFile(zip, PACK_ENTRIES.VIPSTATE_CURRENT)?.async('string') ?? null,
      findZipFile(zip, PACK_ENTRIES.SAVESTATE_CURRENT)?.async('arraybuffer') ?? null,
      findZipFile(zip, PACK_ENTRIES.GROUPS)?.async('string') ?? null,
      findZipFile(zip, PACK_ENTRIES.PAINTER_V2_RULES)?.async('string') ?? null,
      findZipFile(zip, PACK_ENTRIES.PAINTER_V2_VIP_OVERLAYS)?.async('string') ?? null,
      findZipFile(zip, PACK_ENTRIES.FRAME_SUMMARIES)?.async('string') ?? null,
    ]);

  let overrides;
  if (overridesRaw != null) {
    try {
      overrides = JSON.parse(overridesRaw);
    } catch (_) {
      overrides = undefined;
    }
  }

  let manifest;
  if (manifestRaw != null) {
    try {
      manifest = JSON.parse(manifestRaw);
    } catch (_) {
      manifest = undefined;
    }
  }

  let vipStatesFolder = [];
  const vipstateMatches = zip.filter((relativePath) => /^vipstates\/[^/]+\.json$/i.test(relativePath));
  if (vipstateMatches && vipstateMatches.length > 0) {
    vipStatesFolder = await folderItems(vipstateMatches, /^vipstates\//i, 'json');
  }

  let saveStatesFolder = [];
  const savestateMatches = zip.filter((relativePath) => /^savestates\/[^/]+\.state$/i.test(relativePath));
  if (savestateMatches && savestateMatches.length > 0) {
    saveStatesFolder = await folderItems(savestateMatches, /^savestates\//i, 'buffer');
  }

  let ramdumpsFolder = [];
  const ramMatches = zip.filter((relativePath) => /^ramdumps\/[^/]+\.(wram\.bin|bin)$/i.test(relativePath));
  if (ramMatches && ramMatches.length > 0) {
    ramdumpsFolder = await folderItems(ramMatches, /^ramdumps\//i, 'buffer');
  }

  let screenshotsFolder = [];
  const shotMatches = zip.filter((relativePath) => /^screenshots\/[^/]+\.(png|jpg|jpeg)$/i.test(relativePath));
  if (shotMatches && shotMatches.length > 0) {
    screenshotsFolder = await folderItems(shotMatches, /^screenshots\//i, 'buffer');
  }

  // Colour reference images imported by hand (docs/design/reference-images.md); the manifest's
  // `references` block says which frame or game state each one belongs to.
  let referencesFolder = [];
  const refMatches = zip.filter((relativePath) => /^references\/[^/]+\.png$/i.test(relativePath));
  if (refMatches && refMatches.length > 0) {
    referencesFolder = await Promise.all(
      refMatches.map(async (file) => {
        const name = (file.name || '').replace(/^references\//i, '');
        const buffer = await file.async('arraybuffer');
        return { name, buffer };
      })
    );
  }

  // Memory recordings for questions (src/memory-questions.js): one file each, delta-coded samples.
  let memoryRecordingsFolder = [];
  const recordingMatches = zip.filter((relativePath) => /^memoryrecordings\/[^/]+\.bin$/i.test(relativePath));
  if (recordingMatches && recordingMatches.length > 0) {
    memoryRecordingsFolder = await folderItems(recordingMatches, /^memoryrecordings\//i, 'buffer');
  }

  // Pictures a tool set aside instead of saving them wrong (src/recovery.js): one JSON file each.
  let recoveryFolder = [];
  const recoveryMatches = zip.filter((relativePath) => /^recovery\/[^/]+\.json$/i.test(relativePath));
  if (recoveryMatches && recoveryMatches.length > 0) {
    recoveryFolder = await Promise.all(
      recoveryMatches.map(async (file) => ({ name: (file.name || '').replace(/^recovery\//i, ''), json: await file.async('string') })),
    );
  }

  /** @type {unknown[]|undefined} */
  let groups;
  /** @type {unknown[]|undefined} */
  let overridePresets;
  /** @type {unknown[]} */
  let gameStatePools = [];
  /** @type {unknown[]} game states (src/game-states.js) */
  let gameStates = [];
  /** @type {number|undefined} */
  let groupsSchemaVersion;
  if (groupsRaw != null && groupsRaw.length > 0) {
    try {
      const parsed = JSON.parse(groupsRaw);
      groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
      overridePresets = Array.isArray(parsed?.overridePresets) ? parsed.overridePresets : [];
      if (Array.isArray(parsed?.gameStatePools)) gameStatePools = parsed.gameStatePools;
      if (Array.isArray(parsed?.gameStates)) gameStates = parsed.gameStates;
      if (typeof parsed?.groupsSchemaVersion === 'number') groupsSchemaVersion = parsed.groupsSchemaVersion;
      // Oct 8's interim sub-states become game states and group conditions (src/game-states.js).
      const converted = convertInterimSubStates({ gameStatePools, groups, gameStates });
      if (converted.changed) ({ gameStatePools, groups, gameStates } = converted);
    } catch (_) {
      groups = [];
      overridePresets = [];
      gameStatePools = [];
    }
  }

  /** @type {Record<string, unknown>|undefined} */
  let painterV2Rules;
  if (painterV2RulesRaw != null && painterV2RulesRaw.length > 0) {
    try {
      const o = JSON.parse(painterV2RulesRaw);
      if (o != null && typeof o === 'object' && !Array.isArray(o)) painterV2Rules = o;
    } catch (_) {
      painterV2Rules = undefined;
    }
  }

  const groupsJsonInPack = groupsRaw != null;

  return {
    ...(rom != null && { rom }),
    ...(vbcolor != null && { vbcolor }),
    ...(overrides !== undefined && { overrides }),
    ...(manifest !== undefined && { manifest }),
    ...(vipStateRaw != null && vipStateRaw.length > 0 && { vipState: vipStateRaw }),
    ...(saveStateBuf != null && saveStateBuf.byteLength > 0 && { saveState: saveStateBuf }),
    ...(vipStatesFolder.length > 0 && { vipStatesFolder }),
    ...(saveStatesFolder.length > 0 && { saveStatesFolder }),
    ...(ramdumpsFolder.length > 0 && { ramdumpsFolder }),
    ...(screenshotsFolder.length > 0 && { screenshotsFolder }),
    ...(referencesFolder.length > 0 && { referencesFolder }),
    ...(recoveryFolder.length > 0 && { recoveryFolder }),
    ...(memoryRecordingsFolder.length > 0 && { memoryRecordingsFolder }),
    ...(groups !== undefined && { groups }),
    ...(overridePresets !== undefined && { overridePresets }),
    gameStatePools,
    ...(gameStates.length > 0 && { gameStates }),
    ...(typeof groupsSchemaVersion === 'number' && { groupsSchemaVersion }),
    ...(painterV2Rules !== undefined && { painterV2Rules }),
    ...(painterV2VipOverlaysRaw != null &&
      painterV2VipOverlaysRaw.length > 0 && { painterV2VipOverlays: painterV2VipOverlaysRaw }),
    ...(frameSummariesRaw != null && frameSummariesRaw.length > 0 && { frameSummaries: frameSummariesRaw }),
    groupsJsonInPack,
  };
}

/**
 * Map {@link parseArtPack} output into {@link buildArtPack} options so you can round-trip
 * or merge fields (e.g. `painterV2Rules`) without hand-copying every path.
 *
 * @param {Awaited<ReturnType<typeof parseArtPack>>} parsed
 */
export function artPackPartsFromParsed(parsed) {
  /** @type {Record<string, unknown>} */
  const parts = {};
  if (parsed.rom) parts.rom = parsed.rom;
  if (parsed.vbcolor) parts.vbcolor = parsed.vbcolor;
  if (parsed.overrides !== undefined) parts.overrides = parsed.overrides;
  if (parsed.manifest != null && typeof parsed.manifest === 'object') {
    parts.manifest = { ...parsed.manifest };
  }
  if (parsed.vipState) parts.vipState = parsed.vipState;
  if (parsed.saveState) parts.saveState = parsed.saveState;
  if (parsed.vipStatesFolder?.length) parts.vipStatesFolder = parsed.vipStatesFolder;
  if (parsed.saveStatesFolder?.length) parts.saveStatesFolder = parsed.saveStatesFolder;
  if (parsed.ramdumpsFolder?.length) parts.ramdumpsFolder = parsed.ramdumpsFolder;
  if (parsed.screenshotsFolder?.length) {
    // A lazily read screenshot keeps its zip entry, and becomes a Blob only if something asks.
    parts.screenshotsFolder = parsed.screenshotsFolder.map((item) =>
      item.zipEntry
        ? withZipEntry({ name: item.name, get blob() { return new Blob([item.buffer], { type: 'image/png' }); } }, item.zipEntry)
        : { name: item.name, blob: new Blob([item.buffer], { type: 'image/png' }) },
    );
  }
  if (parsed.referencesFolder?.length) {
    parts.referencesFolder = parsed.referencesFolder.map(({ name, buffer }) => ({
      name,
      blob: new Blob([buffer], { type: 'image/png' }),
    }));
  }
  if (parsed.recoveryFolder?.length) parts.recoveryFolder = parsed.recoveryFolder.map(({ name, json }) => ({ name, json }));
  if (parsed.memoryRecordingsFolder?.length) parts.memoryRecordingsFolder = parsed.memoryRecordingsFolder.map((item) => (item.zipEntry ? item : { name: item.name, buffer: item.buffer }));
  if (parsed.groups !== undefined) parts.groups = parsed.groups;
  if (parsed.overridePresets !== undefined) parts.overridePresets = parsed.overridePresets;
  if (Array.isArray(parsed.gameStatePools) && parsed.gameStatePools.length > 0) {
    parts.gameStatePools = parsed.gameStatePools;
  }
  if (Array.isArray(parsed.gameStates) && parsed.gameStates.length > 0) parts.gameStates = parsed.gameStates;
  if (typeof parsed.groupsSchemaVersion === 'number') parts.groupsSchemaVersion = parsed.groupsSchemaVersion;
  if (parsed.painterV2Rules != null && typeof parsed.painterV2Rules === 'object') {
    parts.painterV2Rules = parsed.painterV2Rules;
  }
  if (typeof parsed.painterV2VipOverlays === 'string' && parsed.painterV2VipOverlays.length > 0) {
    parts.painterV2VipOverlays = parsed.painterV2VipOverlays;
  }
  if (typeof parsed.frameSummaries === 'string' && parsed.frameSummaries.length > 0) parts.frameSummaries = parsed.frameSummaries;
  return parts;
}

/**
 * Build a .vbpack (ZIP) from the given parts. Returns a Blob (type application/zip).
 * Use canonical names: rom, color.vbcolor, overrides.json, manifest.json, vipstate-current.json.
 *
 * @param {{
 *   rom?: ArrayBuffer,
 *   vbcolor?: ArrayBuffer,
 *   overrides?: unknown,
 *   manifest?: Record<string, unknown>,
 *   vipState?: string | object,
 *   vipStatesFolder?: Array<{ name: string, json: string }>,
 *   saveState?: ArrayBuffer | Uint8Array,
 *   saveStatesFolder?: Array<{ name: string, buffer: ArrayBuffer | Uint8Array }>,
 *   groups?: Array<unknown>,
 *   overridePresets?: Array<unknown>,
 *   gameStatePools?: Array<unknown>,
 *   gameStates?: Array<unknown>,
 *   groupsSchemaVersion?: number,
 *   artExportsFolder?: Array<{ name: string, blob: Blob }>,
 *   painterV2Rules?: Record<string, unknown>,
 *   painterV2VipOverlays?: string
 * }} parts
 * @returns {Promise<Blob>}
 */
/**
 * Image entries arrive as a Blob from the browser and as bytes from tests and node scripts.
 * JSZip only takes a Blob where the platform supports one, so unwrap it either way.
 */
async function zipBytes(data) {
  return typeof data?.arrayBuffer === 'function' ? data.arrayBuffer() : data;
}

/**
 * How packs are compressed. Frame snapshots (JSON) and save states are most of a project and
 * shrink about 10×: measured on a 132-frame Mario Clash project, 192 MB stored → 18.6 MB at
 * level 1 (1.9 s to save in node) → 16.0 MB at level 6 (3.8 s). Level 1 is most of the win for
 * half the time. Every reader (JSZip) opens stored and deflated packs alike.
 */
export const PACK_ZIP_COMPRESSION = Object.freeze({ compression: 'DEFLATE', compressionOptions: Object.freeze({ level: 1 }) });
/** PNGs are compressed already: deflating them again costs time and saves nothing. */
const ALREADY_COMPRESSED = Object.freeze({ compression: 'STORE' });

/**
 * @param {object} parts
 * @param {{ onUpdate?: (p: { percent: number, currentFile: string|null }) => void }} [opts]
 *   `onUpdate` is JSZip's own progress: a project with a hundred captured frames carries their
 *   RAM dumps and screenshots, so this step is most of a save and needs to say where it is.
 */
/**
 * What buildArtPack writes into: JSZip's `file(name, data, { compression })`, plus `item()` for a
 * pack folder item, which copies an unchanged item's zip entry as stored instead of reading it.
 */
class PackZipWriter {
  constructor() {
    this.writer = new ZipWriter();
  }

  /** @param {string} name @param {unknown} data @param {{ compression?: string }} [opts] */
  file(name, data, opts = {}) {
    this.writer.add(name, data, { store: opts.compression === 'STORE' });
  }

  /** @param {string} name @param {any} item @param {() => unknown} [content] the item's data, when it was not read from a zip */
  item(name, item, content) {
    if (item?.zipEntry) this.writer.addStored(name, item.zipEntry.stored());
    else this.writer.add(name, content ? content() : item?.buffer ?? item?.json ?? '');
  }

  /** @param {(p: { percent: number, currentFile: string | null }) => void} [onUpdate] */
  toBlob(onUpdate) {
    return this.writer.toBlob(onUpdate);
  }
}

export async function buildArtPack(parts, opts = {}) {
  // Entries read unchanged from the opened pack are copied as stored (src/zip-write.js): a save
  // recompresses only what it built here — groups, paint, manifest — not every frame.
  const zip = new PackZipWriter();
  let manifest = parts.manifest && typeof parts.manifest === 'object' ? { ...parts.manifest } : {};

  if (parts.artExportsFolder && parts.artExportsFolder.length > 0) {
    for (const { name, blob } of parts.artExportsFolder) {
      const safeName = name.replace(/[^a-z0-9_.-]/gi, '-');
      zip.file(`art_exports/${safeName}`, blob);
    }
  }
  if (parts.rom && parts.rom.byteLength > 0) {
    const romBuf = copyBinaryToArrayBuffer(parts.rom);
    if (romBuf) {
      zip.file(PACK_ENTRIES.ROM, romBuf);
      // Which ROM this is, so a play pack (src/play-pack.js) can name it without carrying it.
      const id = await romIdentity(romBuf);
      manifest = { ...manifest, romSha1: id.sha1, romCrc32: id.crc32, romSize: id.size };
    }
  }
  if (parts.vbcolor && parts.vbcolor.byteLength > 0) {
    zip.file(PACK_ENTRIES.COLOR, parts.vbcolor);
  }
  if (parts.overrides != null) {
    const json = Array.isArray(parts.overrides)
      ? JSON.stringify(parts.overrides, null, 0)
      : JSON.stringify(parts.overrides);
    zip.file(PACK_ENTRIES.OVERRIDES, json);
  }
  if (parts.vipState != null) {
    const vipJson = typeof parts.vipState === 'string'
      ? parts.vipState
      : JSON.stringify(parts.vipState);
    zip.file(PACK_ENTRIES.VIPSTATE_CURRENT, vipJson);
    manifest.currentVipStateRef = PACK_ENTRIES.VIPSTATE_CURRENT;
  }
  if (parts.vipStatesFolder && parts.vipStatesFolder.length > 0) {
    for (const item of parts.vipStatesFolder) {
      const safeName = item.name.replace(/[^a-z0-9_.-]/gi, '-');
      zip.item(`vipstates/${safeName}`, item, () => item.json);
    }
  }
  {
    const saveBuf = copyBinaryToArrayBuffer(parts.saveState);
    if (saveBuf) {
      zip.file(PACK_ENTRIES.SAVESTATE_CURRENT, saveBuf);
      manifest.currentSaveStateRef = PACK_ENTRIES.SAVESTATE_CURRENT;
    }
  }
  if (parts.saveStatesFolder && parts.saveStatesFolder.length > 0) {
    for (const item of parts.saveStatesFolder) {
      const safeName = item.name.replace(/[^a-z0-9_.-]/gi, '-');
      if (item.zipEntry) {
        zip.item(`savestates/${safeName}`, item);
        continue;
      }
      const buf = copyBinaryToArrayBuffer(item.buffer);
      if (buf) zip.file(`savestates/${safeName}`, buf);
    }
  }
  if (parts.ramdumpsFolder && parts.ramdumpsFolder.length > 0) {
    for (const item of parts.ramdumpsFolder) {
      const safeName = item.name.replace(/[^a-z0-9_.-]/gi, '-');
      const withExt = /\.wram\.bin$/i.test(safeName) || /\.bin$/i.test(safeName) ? safeName : `${safeName}.wram.bin`;
      if (item.zipEntry) {
        zip.item(`ramdumps/${withExt}`, item);
        continue;
      }
      const buffer = item.buffer;
      if (!buffer || (buffer.byteLength ?? 0) === 0) continue;
      zip.file(`ramdumps/${withExt}`, buffer);
    }
  }
  if (parts.screenshotsFolder && parts.screenshotsFolder.length > 0) {
    for (const item of parts.screenshotsFolder) {
      const safeName = item.name.replace(/[^a-z0-9_.-]/gi, '-');
      const withExt = /\.png$/i.test(safeName) ? safeName : `${safeName}.png`;
      if (item.zipEntry) {
        zip.item(`screenshots/${withExt}`, item);
        continue;
      }
      if (!item.blob) continue;
      zip.file(`screenshots/${withExt}`, await zipBytes(item.blob), ALREADY_COMPRESSED);
    }
  }
  if (parts.referencesFolder && parts.referencesFolder.length > 0) {
    for (const { name, blob } of parts.referencesFolder) {
      if (!blob) continue;
      const safeName = name.replace(/[^a-z0-9_.-]/gi, '-');
      const withExt = /\.png$/i.test(safeName) ? safeName : `${safeName}.png`;
      zip.file(`references/${withExt}`, await zipBytes(blob), ALREADY_COMPRESSED);
    }
  }
  if (Array.isArray(parts.memoryRecordingsFolder)) {
    for (const item of parts.memoryRecordingsFolder) {
      const safeName = String(item.name || '').split(/[\\/]/).pop() || 'recording.bin';
      const path = `memoryrecordings/${/\.bin$/i.test(safeName) ? safeName : `${safeName}.bin`}`;
      if (item.zipEntry) {
        zip.item(path, item);
        continue;
      }
      const buffer = item.buffer;
      if (buffer && buffer.byteLength) zip.file(path, buffer);
    }
  }
  if (Array.isArray(parts.recoveryFolder)) {
    for (const { name, json } of parts.recoveryFolder) {
      if (typeof json !== 'string') continue;
      const safeName = String(name).replace(/[^a-z0-9_.-]/gi, '-');
      zip.file(`recovery/${/\.json$/i.test(safeName) ? safeName : `${safeName}.json`}`, json);
    }
  }
  if (Object.keys(manifest).length > 0) {
    zip.file(PACK_ENTRIES.MANIFEST, JSON.stringify(manifest, null, 2));
  }
  const hasGroupsJson =
    (parts.groups != null && Array.isArray(parts.groups) && parts.groups.length > 0) ||
    (parts.overridePresets != null && Array.isArray(parts.overridePresets) && parts.overridePresets.length > 0) ||
    (parts.gameStatePools != null && Array.isArray(parts.gameStatePools) && parts.gameStatePools.length > 0) ||
    (Array.isArray(parts.gameStates) && parts.gameStates.length > 0) ||
    typeof parts.groupsSchemaVersion === 'number';
  if (hasGroupsJson) {
    zip.file(
      PACK_ENTRIES.GROUPS,
      JSON.stringify(
        {
          ...(typeof parts.groupsSchemaVersion === 'number' && { groupsSchemaVersion: parts.groupsSchemaVersion }),
          ...(Array.isArray(parts.gameStatePools) && parts.gameStatePools.length > 0 && { gameStatePools: parts.gameStatePools }),
          ...(Array.isArray(parts.gameStates) && parts.gameStates.length > 0 && { gameStates: parts.gameStates }),
          ...(Array.isArray(parts.groups) && parts.groups.length > 0 && { groups: parts.groups }),
          ...(Array.isArray(parts.overridePresets) && parts.overridePresets.length > 0 && { overridePresets: parts.overridePresets }),
        },
        null,
        2,
      ),
    );
  }

  if (parts.painterV2Rules != null && typeof parts.painterV2Rules === 'object' && !Array.isArray(parts.painterV2Rules)) {
    zip.file(PACK_ENTRIES.PAINTER_V2_RULES, JSON.stringify(parts.painterV2Rules, null, 2));
  }
  if (typeof parts.painterV2VipOverlays === 'string' && parts.painterV2VipOverlays.length > 0) {
    zip.file(PACK_ENTRIES.PAINTER_V2_VIP_OVERLAYS, parts.painterV2VipOverlays);
  }
  if (typeof parts.frameSummaries === 'string' && parts.frameSummaries.length > 0) {
    zip.file(PACK_ENTRIES.FRAME_SUMMARIES, parts.frameSummaries);
  }

  const onUpdate = typeof opts?.onUpdate === 'function' ? opts.onUpdate : null;
  return zip.toBlob(onUpdate || undefined);
}

/**
 * Trigger download of a Blob as a file.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
