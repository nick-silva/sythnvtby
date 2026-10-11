/**
 * The Project tool's per-frame data from the pack: screenshots, RAM dumps (WRAM for a frame) and
 * Analyze memory run on the loaded pack. Split out of tools/painter.js, which passes in the state and functions it shares (initFrameData).
 */
import { seedGameStatePoolsFromMemoryAnalysis } from '../../src/seed-game-state-pools-from-memory-analysis.js';
import { ReadOnGetMap } from '../../src/lazy-entries.js';
import { bestPoolVariantByRam } from '../../src/pool-match-by-ram.js';
import { PROMOTED_FRAME_STATE_NAME } from '../../src/pose-source-frames.js';
import { findFrameWram, frameStem } from '../../src/frame-wram.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initFrameData(context) {
  ctx = context;
}

function clearScreenshotStore() {
  for (const url of ctx.screenshotObjectUrls) URL.revokeObjectURL(url);
  ctx.screenshotObjectUrls = [];
  ctx.screenshotUrlByName = new Map();
  ctx.screenshotUrlByStem = new Map();
  ctx.activeFrameScreenshotImage = null;
  ctx.activeFrameScreenshotUrl = null;
}

export function primeScreenshotStore(screenshotsFolder) {
  clearScreenshotStore();
  if (!Array.isArray(screenshotsFolder) || screenshotsFolder.length === 0) return;
  // A screenshot's image is made the first time its frame is shown, not for every frame up front
  // (the pack's bytes stay compressed until then, src/lazy-entries.js).
  const urlOf = (rec) => {
    if (rec.url === undefined) {
      const buffer = rec.shot.buffer;
      rec.url = buffer instanceof ArrayBuffer && buffer.byteLength ? URL.createObjectURL(new Blob([buffer], { type: rec.mime })) : null;
      if (rec.url) ctx.screenshotObjectUrls.push(rec.url);
    }
    return rec.url;
  };
  ctx.screenshotUrlByName = new ReadOnGetMap(urlOf);
  ctx.screenshotUrlByStem = new ReadOnGetMap(urlOf);
  for (const shot of screenshotsFolder) {
    const rawName = typeof shot?.name === 'string' ? shot.name.trim() : '';
    if (!rawName || !(shot.size ?? shot.buffer?.byteLength)) continue;
    const leaf = rawName.replace(/^screenshots\//i, '').toLowerCase();
    if (!leaf) continue;
    const ext = (leaf.split('.').pop() || '').toLowerCase();
    const rec = { shot, mime: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png', url: undefined };
    ctx.screenshotUrlByName.set(leaf, rec);
    const stem = leaf.replace(/\.[^.]+$/, '');
    if (stem && !ctx.screenshotUrlByStem.has(stem)) ctx.screenshotUrlByStem.set(stem, rec);
  }
}

/**
 * Index the WRAM dump captured with each frame (`ramdumps/<stem>.wram.bin`).
 * These are what let us ask "which memory pool is this frame?" by fingerprint
 * instead of by frame name.
 * @param {Array<{ name: string, buffer: ArrayBuffer }>|undefined} ramdumpsFolder
 */
export function primeRamDumpStore(ramdumpsFolder) {
  ctx.ramDumpsByStem = new Map();
  frameWramCache = new Map();
  saveStatesByStemCache = null;
  for (const row of Array.isArray(ramdumpsFolder) ? ramdumpsFolder : []) {
    const rawName = typeof row?.name === 'string' ? row.name.trim() : '';
    if (!rawName || !(row?.buffer instanceof ArrayBuffer)) continue;
    const stem = rawName
      .replace(/^ramdumps\//i, '')
      .replace(/\.wram\.bin$/i, '')
      .replace(/\.bin$/i, '')
      .toLowerCase();
    if (stem) ctx.ramDumpsByStem.set(stem, new Uint8Array(row.buffer));
  }
}

/** @returns {Uint8Array|null} WRAM captured with this frame, if the pack has it. */
export function wramForFrameIndex(i) {
  return frameWramForIndex(i)?.wram ?? null;
}

/** Memory found per frame file (reading a save state is not free); cleared when a pack loads. */
let frameWramCache = /** @type {Map<string, ReturnType<typeof findFrameWram>>} */ (new Map());
/** Save states by frame stem, built on first use from the pack that is open. */
let saveStatesByStemCache = /** @type {Map<string, Uint8Array> | null} */ (null);

/** The live Current (Colorize!) frame: first in the list, labelled "Current — …", not a capture. */
export function isCurrentFrameRow(row) {
  return !!row && /^current\b/i.test(String(row.label || '').trim()) && !row.frameRegistryEntry?.frameId;
}

/**
 * The game memory captured with a frame and where it came from: its RAM dump, else read out of
 * its save state — which is how the Current (Colorize!) frame, which has only the pack's own save
 * state, can be matched to a screen too.
 */
function frameWramForIndex(i) {
  if (!Number.isFinite(i) || i < 0 || i >= ctx.availableFrames.length) return null;
  const row = ctx.availableFrames[i];
  const key = String(row?.vipFile || i);
  if (frameWramCache.has(key)) return frameWramCache.get(key);
  if (!saveStatesByStemCache) {
    // Save states are read only for the frames asked about (src/lazy-entries.js).
    saveStatesByStemCache = new ReadOnGetMap((f) => (f?.buffer ? new Uint8Array(f.buffer) : null));
    for (const f of ctx.loadedPackParts?.saveStatesFolder || []) {
      if (f?.name && (f.size ?? f.buffer?.byteLength)) saveStatesByStemCache.set(frameStem(f.name), f);
    }
  }
  const ent = row?.frameRegistryEntry;
  const root = ctx.loadedPackParts?.saveState;
  const found = findFrameWram({
    names: [ent?.ramdumpFile, ent?.saveStateFile, row?.vipFile, ent?.frameId].filter((n) => n != null && String(n).trim()).map(String),
    isCurrent: isCurrentFrameRow(row),
    ramDumpsByStem: ctx.ramDumpsByStem,
    saveStatesByStem: saveStatesByStemCache,
    rootSaveState: root && root.byteLength ? new Uint8Array(root) : null,
  });
  frameWramCache.set(key, found);
  return found;
}

/**
 * Read pack entries by their in-zip path straight from what is already loaded,
 * so the memory analyzer can run here without a zip handle or a re-export.
 * @returns {(path: string) => Promise<Uint8Array|null>}
 */
function loadedPackEntryReader() {
  // Entries are read when the analyzer asks for them, not all up front (src/lazy-entries.js).
  /** @type {Map<string, { buffer: ArrayBuffer }>} */
  const index = new Map();
  const add = (folder, rows) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const leaf = String(row?.name || '').replace(new RegExp(`^${folder}/`, 'i'), '');
      if (!leaf || !row) continue;
      index.set(`${folder}/${leaf}`.toLowerCase(), row);
    }
  };
  add('ramdumps', ctx.loadedPackParts?.ramdumpsFolder);
  add('savestates', ctx.loadedPackParts?.saveStatesFolder);
  return async (path) => {
    const buffer = index.get(String(path || '').replace(/\\/g, '/').toLowerCase())?.buffer;
    return buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : null;
  };
}

/**
 * Run the WRAM analysis on the pack that is open, write `manifest.memoryAnalysis`
 * into it and seed `gameStatePools` from the result. Nothing is exported and no
 * second "annotated" pack is produced — the normal Save writes it back.
 */
export async function runMemoryAnalysisOnLoadedPack() {
  if (!ctx.loadedPackParts) {
    ctx.setStatus('Open a .vbpack first.');
    return;
  }
  // Colorize! frames saved only because a pose was drawn on them share one label but come from
  // any screen: analyzed as one "screen" they would teach the analysis a fingerprint that is not
  // there, and push the real screens' fingerprints apart. Named captures only.
  const registry = (Array.isArray(ctx.lastFrameRegistry) ? ctx.lastFrameRegistry : []).filter(
    (e) => String(e?.stateName || '').trim() !== PROMOTED_FRAME_STATE_NAME,
  );
  if (registry.length === 0) {
    ctx.setStatus('This pack has no named captures to analyze — capture frames in the emulator first.');
    return;
  }
  if (ctx.ramDumpsByStem.size === 0 && !(ctx.loadedPackParts.saveStatesFolder || []).length) {
    ctx.setStatus('This pack has no WRAM dumps or save states to analyze.');
    return;
  }
  const states = new Set(registry.map((e) => String(e?.stateName || '').trim() || '(unnamed)'));
  ctx.setStatus(`Analyzing WRAM across ${registry.length} frame(s) in ${states.size} state(s)…`);
  try {
    const { runInBrowserWramAnalysis, buildMemoryAnalysisManifest } = await import('../memory-analysis-inbrowser.js');
    const analysis = await runInBrowserWramAnalysis({ readEntry: loadedPackEntryReader(), frameRegistry: registry });
    const manifestBlock = buildMemoryAnalysisManifest(analysis);
    if (!ctx.loadedPackParts.manifest || typeof ctx.loadedPackParts.manifest !== 'object') ctx.loadedPackParts.manifest = {};
    ctx.loadedPackParts.manifest.memoryAnalysis = manifestBlock;

    const seeded = seedGameStatePoolsFromMemoryAnalysis(manifestBlock);
    let poolNote = '';
    if (seeded.length === 0) {
      poolNote = ' No state produced a usable fingerprint — capture 2+ frames per state and try again.';
    } else if (ctx.gameStatePools.length === 0) {
      ctx.gameStatePools = seeded;
      ctx.memoryAnalysisSeededPools = true;
      poolNote = ` Seeded ${seeded.length} memory pool(s).`;
    } else {
      const known = new Set(ctx.gameStatePools.map((p) => String(p?.id || '')));
      const added = seeded.filter((p) => !known.has(String(p.id)));
      if (added.length) ctx.gameStatePools = [...ctx.gameStatePools, ...added];
      poolNote = added.length
        ? ` Added ${added.length} new memory pool(s) (kept your existing ${ctx.gameStatePools.length - added.length}).`
        : ` Existing ${ctx.gameStatePools.length} memory pool(s) already cover these states.`;
    }
    ctx.markGroupsDirty();
    ctx.updatePoolSummary();
    ctx.fillNewGroupPoolVariantSelect();
    // New fingerprints may now say which screen the Colorize! frame is on.
    ctx.populateFrames();
    const single =Array.isArray(manifestBlock?.lowConfidenceStateNames) ? manifestBlock.lowConfidenceStateNames : [];
    const thin = single.length ? ` ${single.length} state(s) had only one frame and were skipped: ${single.slice(0, 3).join(', ')}.` : '';
    ctx.setStatus(`Memory analysis complete.${poolNote}${thin} Save the pack to keep it.`);
  } catch (e) {
    ctx.setStatus(`Memory analysis failed: ${e?.message || e}`);
  }
}

/**
 * Pool/variant whose memory fingerprint actually holds for this frame's WRAM.
 * @returns {{ match: any, all: any[], ambiguous: boolean, wram: boolean }}
 */
export function findPoolVariantForFrameByRam(i) {
  const wram = wramForFrameIndex(i);
  if (!wram) return { match: null, all: [], ambiguous: false, wram: false };
  return { ...bestPoolVariantByRam(ctx.gameStatePools, wram), wram: true };
}
