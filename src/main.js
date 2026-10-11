/**
 * sythnvtby — main entry.
 * Embeds EmulatorJS (Beetle VB core, GPL-2.0) and wires ROM/pack loading and display toggle.
 */

import { coreStereoOptions, leftEyeRect } from './stereo-view.js';
import { pushVIPState, setVIPStateConsumer, getTileBytes, hashTile } from './vip-state.js';
import {
  createColorCanvas,
  wireColorLayer,
  DEFAULT_FADE_RESPONSE,
  parsePositionOverrides,
  resolveOverrideRgba,
  COLOR_FB_WIDTH,
  COLOR_FB_HEIGHT,
  suggestedPainterV2VariantId,
} from './color-layer.js';
import { parseVBColorPack } from './vbcolor-pack.js';
import { projectFromParsed } from './project.js';
import { parseArtPack, buildArtPack, downloadBlob, copyBinaryToArrayBuffer } from './art-pack.js';
import { serializeVIPState, deserializeVIPState } from './vip-dump.js';
import { tryCopyVBSystemRamFromEmulator } from './vb-emulator-ram.js';
import { tryExtractWramFromMednafenSavestate } from './mednafen-savestate-wram.js';
import { generateFrameId, QUICK_CAPTURE_KEY, isQuickCaptureHotkey } from './frame-capture.js';
import { displayHotkeyAction, nextDisplayState, describeDisplay, SWAP_DISPLAY_KEY, TOGGLE_MONO_KEY } from './display-hotkeys.js';
import { PAINT_ON_TRANSPARENT_VERSION } from './transparent-paint.js';
import { addArchivedCoverage } from './frame-cleanup.js';
import {
  buildCoverage,
  addStateToCoverage,
  findUncoveredTiles,
  coverageSize,
  normalizeCaptureKinds,
  describeCaptureKinds,
  describeUncovered,
  CAPTURE_KINDS,
  AUTO_CAPTURE_EYE,
} from './auto-capture.js';
import { findPaintGaps, paintGapKey, describePaintGaps } from './paint-gaps.js';
import { brightnessReference, masterBrightnessLevels } from './fade.js';
import { frameStepAction, StateHistory, HISTORY_FRAMES, BIG_STEP } from './frame-step.js';
import { bestPoolVariantByRam } from './pool-match-by-ram.js';
import { saveLastVbpack, loadLastVbpack } from './vbpack-storage.js';
import { onLayerArtDecoded } from './layer-art.js';
import { installLayerArtDecoder } from './layer-art-png.js';
import { getHandoff, putHandoff, deleteHandoff } from './handoff-store.js';
import {
  isOpenFilePickerSupported,
  pickAndStoreHomeDirectory,
  clearHomeDirectoryHandle,
  getHomeStatus,
  requestHomeAccess,
  formatHomeStatusLabel,
  pickOpenVbpackFile,
  pickOpenFile,
  pickSaveVbpackFile,
  writeBlobToFileHandle,
  normalizeVbpackFileName,
} from './project-home.js';
// Palette-based color (optional; rollback: set ENABLE_PALETTE false, remove Palette UI)
import * as paletteLayerModule from './palette-layer.js';
import { runPaletteDiagnostics, runPaletteFrameChecksumTest } from './palette-diagnostics.js';
import { getWindowsTableBytesFromState, getBgAffineWorldClipRect } from './vip-world-clip.js';
import { discardCapturesPrompt, unsavedCapturesNote, captureGapsNote } from './unsaved-work.js';
import { createMemoryRecorder } from './memory-recorder.js';
import { createMemoryPanel } from './memory-panel.js';
import { matchedScreens, screenLabel } from './screen-gate.js';
import { gameStatesOf } from './game-states.js';

const CDN = 'https://cdn.emulatorjs.org/stable/data/';
/** Use local built core (Phase 0+) from public/data/ when true; set false to use CDN. */
const USE_LOCAL_CORE = true;

// --- PALETTE FEATURE (rollback: set false + remove Palette button/preset from HTML) ---
const ENABLE_PALETTE = true;
/** Verbose palette logs (one-time diagnostic, switch-to-palette messages). Enable: ?palette-debug=1 or localStorage vb-palette-debug=1 */
function isPaletteDebug() {
  try {
    if (localStorage.getItem('vb-palette-debug') === '1') return true;
    if (new URLSearchParams(location.search).get('palette-debug') === '1') return true;
  } catch (_) {}
  return false;
}
// --- END PALETTE FEATURE ---

// Expose for a patched core to push VIP state each frame (window + globalThis for any execution context)
if (typeof window !== 'undefined') {
  window.__VB_PUSH_VIP_STATE__ = pushVIPState;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__VB_PUSH_VIP_STATE__ = pushVIPState;
}
// If the core runs in a Worker context, it cannot call window functions directly.
// In that case the core will postMessage({ __vb: 'vip', frameNumber, eye }) and we forward it here.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (ev) => {
    const d = ev?.data;
    if (!d || !d.__vb) return;
    if (d.__vb === 'frame') {
      // Firefox may run the core in a Worker; mirror Phase 1 counter via messages.
      window.__vbFrameCount = (window.__vbFrameCount || 0) + 1;
      return;
    }
    if (d.__vb !== 'vip') return;
    const state = { frameNumber: d.frameNumber ?? 0, eye: d.eye ?? 0 };
    try {
      globalThis.__VB_VIP_STATE_AVAILABLE__ = true;
      globalThis.__VB_LAST_VIP_FRAME__ = state.frameNumber;
    } catch (_) {}
    pushVIPState(state);
  });
}

const romInput = document.getElementById('rom-input');
const packInput = document.getElementById('pack-input');
const packFileInput = document.getElementById('pack-file-input');
const lastVbpackBtn = document.getElementById('last-vbpack-btn');

const RELOAD_TO_LOAD_LAST_VBPACK = 'vb-load-last-vbpack-on-start';
let currentRomBlobUrl = null;
/** Copy of current ROM buffer (for Export .vbpack); blob URL can become invalid. */
let currentRomBuffer = null;
/** Set true when startEmulator has ever run; used to decide we must reload before loading another ROM. */
let emulatorStarted = false;

function setLastVbpackButton(displayName) {
  if (!lastVbpackBtn) return;
  lastVbpackBtn.textContent = displayName ? `Last pack: ${displayName}` : '';
  lastVbpackBtn.style.display = displayName ? 'inline-flex' : 'none';
  lastVbpackBtn.title = displayName ? `Load last vbpack: ${displayName}` : '';
}

function startWithRomData(name, arrayBuffer) {
  if (currentRomBlobUrl) URL.revokeObjectURL(currentRomBlobUrl);
  currentRomBlobUrl = URL.createObjectURL(new Blob([arrayBuffer]));
  currentRomBuffer = arrayBuffer.slice(0);
  currentRomFileName = name || null;
  startEmulator(currentRomBlobUrl, name);
}

/** Apply a parsed vbpack result to the app (ROM, vbcolor, overrides, VIP). Optionally switch to Color if vbcolor present. */
function applyVbpackResult(result, options = {}) {
  const manifest = result.manifest || {};
  // The colour project, read the way every app reads it (src/project.js): groups through the
  // group schema, screens, game states, the older rules, and the transparent-paint flag.
  const project = projectFromParsed(result, { label: manifest.romFileName || 'pack.vbpack' });
  const romName = manifest.romFileName || 'rom.vb';
  if (result.rom && result.rom.byteLength > 0) {
    startWithRomData(romName, result.rom);
  }
  if (result.vbcolor && result.vbcolor.byteLength > 0) {
    colorPackData = result.vbcolor;
    colorLayer.setPackFromBuffer(colorPackData);
    const parsed = parseVBColorPack(colorPackData);
    lastPackSummary = parsed ? { gameId: parsed.gameId, entryCount: parsed.entries.size } : null;
    if (options.switchToColor !== false) {
      paletteEnabled = false;
      colorEnabled = true;
      syncDisplayState();
    }
  }
  if (result.overrides != null) {
    lastOverridesJson = Array.isArray(result.overrides) ? result.overrides : null;
    lastOverridesCount = colorLayer.setOverrides(result.overrides);
  } else {
    lastOverridesCount = 0;
    lastOverridesJson = null;
    colorLayer.setOverrides([]);
  }
  refreshPerfMetricsOverlay();
  if (result.vipState != null && result.vipState.length > 0) {
    try {
      lastVIPState = deserializeVIPState(JSON.parse(result.vipState));
    } catch (_) {}
  } else if (result.vipStatesFolder && result.vipStatesFolder.length > 0) {
    const first = result.vipStatesFolder[0];
    if (first?.json) {
      try {
        lastVIPState = deserializeVIPState(JSON.parse(first.json));
      } catch (_) {}
    }
  }
  if (lastVIPState?.patternTable?.length) {
    referencePatternTable = lastVIPState.patternTable.slice(0);
  } else {
    referencePatternTable = null;
  }
  if (result.vipStatesFolder && Array.isArray(result.vipStatesFolder)) {
    // The pack's own items: lazily read ones stay compressed until used (src/lazy-entries.js).
    loadedVbpackFrames = result.vipStatesFolder.slice();
  } else {
    loadedVbpackFrames = [];
  }
  ingestLoadedPackBinaryMaps(result);
  buildVbpackFramesList(result);
  updateColorPackStatus();
  lastVbpackGroups = project.groups;
  lastVbpackOverridePresets = (result.overridePresets != null && Array.isArray(result.overridePresets))
    ? result.overridePresets
    : [];
  lastVbpackGameStatePools = project.gameStatePools;
  lastVbpackGameStates = project.gameStates;
  // Paint on transparent pixels shows only when the pack says it is intentional; kept on the way
  // back to the Project tool so its deliberate paint is not cleared as stray.
  lastPackPaintsTransparent = project.paintsTransparent;
  colorLayer.setDrawTransparentPaint?.(lastPackPaintsTransparent);
  lastVbpackGroupsSchemaVersion = typeof result.groupsSchemaVersion === 'number' ? result.groupsSchemaVersion : undefined;
  // Ensure groupId overrides can be evaluated at runtime.
  if (typeof colorLayer.setGroups === 'function') {
    colorLayer.setGroups(lastVbpackGroups, lastVbpackGameStatePools, lastVbpackGameStates);
  }
  lastPainterV2Rules = project.painterV2Rules;
  lastPainterV2VipOverlays =
    typeof result.painterV2VipOverlays === 'string' && result.painterV2VipOverlays.length > 0
      ? result.painterV2VipOverlays
      : null;
  if (typeof colorLayer.setPainterV2FromVbpack === 'function') {
    colorLayer.setPainterV2FromVbpack(lastPainterV2Rules, lastPainterV2VipOverlays);
  }
  if (result.vbcolor || result.overrides != null) {
    window.dispatchEvent(new CustomEvent('vb-color-pack', { detail: { data: colorPackData } }));
  }
  updateColorDebugPanelVisibility();
}

// When user returns via back button (or page is shown after being hidden), the emulator may be gone (bfcache or iframe torn down). Reset state and clear file inputs so Load ROM works again and re-selecting the same file fires change.
window.addEventListener('pageshow', () => {
  const gameEl = document.getElementById('game');
  const hasEmulator = typeof window !== 'undefined' && window.EJS_emulator;
  if (!emulatorStarted || hasEmulator) return;
  emulatorStarted = false;
  if (currentRomBlobUrl) {
    try { URL.revokeObjectURL(currentRomBlobUrl); } catch (_) {}
    currentRomBlobUrl = null;
  }
  currentRomBuffer = null;
  currentRomFileName = null;
  const splashEl = document.getElementById('splash');
  if (splashEl) {
    splashEl.classList.remove('hidden');
    splashEl.style.display = '';
  }
  if (gameEl) gameEl.innerHTML = '';
  const romInput = document.getElementById('rom-input');
  const packFileInput = document.getElementById('pack-file-input');
  const packInput = document.getElementById('pack-input');
  if (romInput) romInput.value = '';
  if (packFileInput) packFileInput.value = '';
  if (packInput) packInput.value = '';
  updateColorPackStatus();
});

// Show "Last pack" if we have a stored vbpack
loadLastVbpack().then((stored) => {
  if (stored?.name) setLastVbpackButton(stored.name);
}).catch(() => {});
const gameContainer = document.getElementById('game-container');
const gameEl = document.getElementById('game');
const splash = document.getElementById('splash');
const btnMono = document.getElementById('btn-mono');
const btnPalette = document.getElementById('btn-palette');
const btnColor = document.getElementById('btn-color');

/** Underlay (mono) toggle. When off, we hide the emulator's base render (keeps it rendered for reads). */
let monoEnabled = true;
/** Palette overlay is exclusive: when on, mono+color are both off. */
let paletteEnabled = false;
/** Color overlay toggle (pack overlay). */
let colorEnabled = false;

/** Display mode for color layer: only 'color' or 'mono'. */
let displayMode = 'mono';
/** @type {'2d'|'sidebyside'|'anaglyph'} */
let viewMode = '2d';
/** The core options last sent for the View menu, and to which emulator (a new ROM starts a new one). */
let appliedCoreView = { emulator: /** @type {unknown} */ (null), key: '' };
/** @type {ArrayBuffer|null} */
let colorPackData = null;
/** @type {{ gameId: string, entryCount: number }|null} */
let lastPackSummary = null;
/** Number of position overrides loaded (for status line) */
let lastOverridesCount = 0;
/** Raw overrides array (for Export pack); set when loading overrides or pack file. */
let lastOverridesJson = null;
/** ROM filename used when loading (for Export pack manifest). */
let currentRomFileName = null;
/** True when the current pack is an in-memory vbpack created by capturing (not loaded from file). */
let hasTemporaryVbpack = false;
/** VIP state captures added via Capture Frame; written into vipstates/ when building a vbpack. */
let temporaryVipStates = [];
/** The loaded pack's manifest says its paint on transparent pixels is intentional. */
let lastPackPaintsTransparent = false;
/**
 * How many of `temporaryVipStates` are safe: handed to the Project tool by Colorize! or
 * written out by Export .vbpack. The rest live only in this page's memory.
 */
let capturesSavedCount = 0;
/** Set just before this page navigates away on purpose (Colorize!, Last pack reload). */
let leavingOnPurpose = false;

function unsavedCaptureCount() {
  return Math.max(0, temporaryVipStates.length - capturesSavedCount);
}

/** True when there is nothing to lose, or the user agreed to lose it. */
function confirmDropCaptures(action) {
  const n = unsavedCaptureCount();
  return n === 0 || window.confirm(discardCapturesPrompt(n, action));
}
/** Frames that came from the last loaded vbpack (vipstates folder); merged with temporaryVipStates when building Colorize handoff. */
let loadedVbpackFrames = [];
/** Display name of the vbpack currently loaded (file or Last pack), so Colorize can show "editing" and Save and Play updates the same pack. */
let currentVbpackDisplayName = null;
/**
 * On-disk file the current pack came from (File System Access handle), when known. Passed to the
 * painter through the Colorize! handoff so Save / Save and Play overwrite that file rather than
 * creating a new .vbpack. Null for Last pack, file-input loads, and non-Chromium browsers.
 * @type {FileSystemFileHandle|null}
 */
let currentPackFileHandle = null;
/** Frames from loaded vbpack for Frame / Save state dropdown: { label, vipJson, saveState (ArrayBuffer|null) }[] */
let vbpackFramesList = [];
/** Groups from the last applied vbpack (paint tool only); included in Colorize handoff so the painter restores them. */
let lastVbpackGroups = [];
/** gameStatePools from groups.json (schema v2); used by color layer for variant WRAM gates. */
let lastVbpackGameStatePools = [];
/** Game states (src/game-states.js) from groups.json; groups' conditions name them. */
let lastVbpackGameStates = [];

/**
 * Memory recordings for questions (src/memory-recorder.js): the pack's, and this session's; they go
 * back with Colorize! and Export .vbpack. The Memory panel records them and shows live which screen
 * and game states hold (src/memory-panel.js).
 */
const memoryRecorder = createMemoryRecorder({
  getWram: () => tryCopyVBSystemRamFromEmulator(),
  onChange: () => memoryPanel?.render(),
});
/** @type {ReturnType<typeof createMemoryPanel> | null} */
let memoryPanel = null;
function initMemoryPanel() {
  const root = document.getElementById('memory-panel');
  if (!root) return;
  memoryPanel = createMemoryPanel({
    root,
    recorder: memoryRecorder,
    live: () => {
      const wram = tryCopyVBSystemRamFromEmulator();
      const matched = wram ? matchedScreens(lastVbpackGameStatePools, wram) : null;
      return {
        wram,
        screens: matched ? [...matched].map((id) => screenLabel(lastVbpackGameStatePools, id)) : [],
        states: gameStatesOf(lastVbpackGameStates),
      };
    },
    onMarkChecked: (id) => {
      // "Looks right" in play: stamped on the game state, and taken back to the Project tool.
      const at = new Date().toISOString();
      lastVbpackGameStates = lastVbpackGameStates.map((s) => (s?.id === id ? { ...s, checkedLive: at } : s));
      colorLayer.setGroups(lastVbpackGroups, lastVbpackGameStatePools, lastVbpackGameStates);
      memoryPanel?.render();
    },
  });
  document.getElementById('btn-memory')?.addEventListener('click', () => {
    memoryPanel?.toggle();
    document.getElementById('btn-memory')?.setAttribute('aria-pressed', document.getElementById('memory-panel')?.hidden ? 'false' : 'true');
  });
}
/** groupsSchemaVersion from groups.json when present (e.g. 2 when pools are authored). */
let lastVbpackGroupsSchemaVersion;

/** Maps stem (e.g. frame id) → buffer; filled when parsing a vbpack. */
let loadedPackRamdumpByStem = new Map();
let loadedPackScreenshotByStem = new Map();
let loadedPackSaveStateByStem = new Map();
/** frameRegistry from last loaded pack manifest (array or null). */
let loadedManifestFrameRegistry = null;
/** memoryAnalysis from last loaded pack manifest (object or null); needed for Colorize / Export so the painter keeps WRAM candidates. */
let loadedManifestMemoryAnalysis = null;
/** archivedCoverage from the last loaded manifest: patterns of frames cleaned out of the pack (src/frame-cleanup.js). */
let loadedManifestArchivedCoverage = null;
/** Override presets from last loaded groups.json (array); included in handoff / export. */
let lastVbpackOverridePresets = [];
/** Painter v2 rules from last loaded/returned vbpack; included in Colorize! / Export so sidecars survive. */
let lastPainterV2Rules = null;
/** Painter v2 VIP overlays JSON string from last pack (or null). */
let lastPainterV2VipOverlays = null;
/** Counter for default "State 001" labels when capture dialog uses auto names. */
let captureAutoStateCounter = 0;
/** Short-lived message shown at the start of the status line (e.g. after F8 quick capture). */
let colorPackStatusFlash = /** @type {{ message: string, until: number } | null} */ (null);

/**
 * Stem → a pack folder item, answering `get` with the item's bytes: lazily read items
 * (src/lazy-entries.js) stay compressed until a frame's RAM, screenshot or save state is used.
 */
class ItemBufferMap extends Map {
  get(key) {
    return super.get(key)?.buffer;
  }

  /** The item itself (it may carry its zip entry, so a rebuilt pack copies it as stored). */
  item(key) {
    return super.get(key);
  }
}

function ingestLoadedPackBinaryMaps(result) {
  loadedPackRamdumpByStem = new ItemBufferMap();
  loadedPackScreenshotByStem = new ItemBufferMap();
  loadedPackSaveStateByStem = new ItemBufferMap();
  for (const row of result.ramdumpsFolder || []) {
    const leaf = (row.name || '').replace(/^ramdumps\//i, '');
    const stem = leaf.replace(/\.wram\.bin$/i, '').replace(/\.bin$/i, '');
    if (stem) loadedPackRamdumpByStem.set(stem, row);
  }
  for (const row of result.screenshotsFolder || []) {
    const leaf = (row.name || '').replace(/^screenshots\//i, '');
    const stem = leaf.replace(/\.png$/i, '').replace(/\.jpe?g$/i, '');
    if (stem) loadedPackScreenshotByStem.set(stem, row);
  }
  for (const row of result.saveStatesFolder || []) {
    const leaf = (row.name || '').replace(/^savestates\//i, '');
    const stem = leaf.replace(/\.state$/i, '');
    if (stem) loadedPackSaveStateByStem.set(stem, row);
  }
  loadedManifestFrameRegistry = Array.isArray(result.manifest?.frameRegistry) ? result.manifest.frameRegistry : null;
  loadedManifestMemoryAnalysis =
    result.manifest != null && result.manifest.memoryAnalysis != null ? result.manifest.memoryAnalysis : null;
  loadedManifestArchivedCoverage =
    result.manifest?.archivedCoverage && typeof result.manifest.archivedCoverage === 'object' ? result.manifest.archivedCoverage : null;
  memoryRecorder.load(result.manifest, result.memoryRecordingsFolder);
}

function mergeTemporaryCapturesIntoFrameList() {
  for (const t of temporaryVipStates) {
    const label = `${t.stateName}${t.subStateName ? ' / ' + t.subStateName : ''} · ${t.frameId}`;
    vbpackFramesList.push({
      label,
      vipJson: t.json,
      saveState: t.saveStateBuffer ?? null,
    });
  }
}

/** Rebuild Frame / Save state dropdown from loaded pack rows + in-memory captures (after Capture Frame). */
function rebuildVbpackFramesListAfterCapture() {
  vbpackFramesList = [];
  for (const item of loadedVbpackFrames) {
    const name = item.name;
    const stem = name.replace(/\.json$/i, '');
    const saveState = loadedPackSaveStateByStem.get(stem) ?? null;
    vbpackFramesList.push({
      label: name,
      get vipJson() {
        return item.json;
      },
      saveState,
    });
  }
  mergeTemporaryCapturesIntoFrameList();
  updateFrameSavestateSelect();
}

function buildVbpackFramesList(result) {
  vbpackFramesList = [];
  const saveStatesFolder = result.saveStatesFolder && Array.isArray(result.saveStatesFolder) ? result.saveStatesFolder : [];
  const byBase = (name) => (name || '').replace(/\.(json|state)$/i, '');
  if (result.vipState != null && result.vipState.length > 0) {
    vbpackFramesList.push({
      label: 'Current',
      vipJson: result.vipState,
      saveState: result.saveState ?? null,
    });
  }
  if (result.vipStatesFolder && result.vipStatesFolder.length > 0) {
    for (const item of result.vipStatesFolder) {
      const name = item.name;
      const stateItem = saveStatesFolder.find((s) => byBase(s.name) === byBase(name)) ?? null;
      // Read the frame and its save state only when this row is used.
      vbpackFramesList.push({
        label: name,
        get vipJson() {
          return item.json;
        },
        get saveState() {
          return stateItem?.buffer ?? null;
        },
      });
    }
  }
  mergeTemporaryCapturesIntoFrameList();
  updateFrameSavestateSelect();
}

function allocDefaultStateName() {
  captureAutoStateCounter += 1;
  return `State ${String(captureAutoStateCounter).padStart(3, '0')}`;
}

/**
 * Merge loaded vbpack frames + temporary captures into folder payloads for zip export / Colorize.
 * @returns {{
 *   vipStatesFolder: Array<{ name: string, json: string }>,
 *   ramdumpsFolder: Array<{ name: string, buffer: ArrayBuffer }>,
 *   screenshotsFolder: Array<{ name: string, blob: Blob }>,
 *   saveStatesFolder: Array<{ name: string, buffer: ArrayBuffer }>,
 *   frameRegistry: object[],
 * }}
 */
function mergeAllCapturePartsForExport() {
  const vipStatesFolder = [];
  const ramdumpsFolder = [];
  const screenshotsFolder = [];
  const saveStatesFolder = [];
  const frameRegistry = Array.isArray(loadedManifestFrameRegistry) ? loadedManifestFrameRegistry.slice() : [];

  // Items read unchanged from the opened pack go in as they are: the pack built from them copies
  // their compressed bytes instead of reading and recompressing every frame (src/zip-write.js).
  const stored = (map, stem) => {
    const item = typeof map.item === 'function' ? map.item(stem) : null;
    return item?.zipEntry ? item : null;
  };
  for (const frame of loadedVbpackFrames) {
    const name = frame.name;
    const stem = name.replace(/\.json$/i, '');
    vipStatesFolder.push(frame.zipEntry ? frame : { name, json: frame.json });
    const ramItem = stored(loadedPackRamdumpByStem, stem);
    if (ramItem && ramItem.size >= 0x10000) {
      ramdumpsFolder.push(ramItem);
    } else {
      const ram = loadedPackRamdumpByStem.get(stem);
      if (ram && ram.byteLength >= 0x10000) ramdumpsFolder.push({ name: `${stem}.wram.bin`, buffer: ram.slice(0) });
    }
    const shotItem = stored(loadedPackScreenshotByStem, stem);
    if (shotItem && shotItem.size) {
      screenshotsFolder.push(shotItem);
    } else {
      const shot = loadedPackScreenshotByStem.get(stem);
      if (shot && shot.byteLength) screenshotsFolder.push({ name: `${stem}.png`, blob: new Blob([shot], { type: 'image/png' }) });
    }
    const stItem = stored(loadedPackSaveStateByStem, stem);
    if (stItem && stItem.size) {
      saveStatesFolder.push(stItem);
    } else {
      const st = loadedPackSaveStateByStem.get(stem);
      if (st && st.byteLength) saveStatesFolder.push({ name: `${stem}.state`, buffer: st.slice(0) });
    }
  }

  for (const t of temporaryVipStates) {
    const stem = t.frameId;
    vipStatesFolder.push({ name: `${stem}.json`, json: t.json });
    let wram64 = null;
    let wramSrc = t.wramSource;
    if (t.wramBuffer && t.wramBuffer.byteLength >= 0x10000) {
      const buf = new ArrayBuffer(0x10000);
      new Uint8Array(buf).set(new Uint8Array(t.wramBuffer, 0, 0x10000));
      wram64 = buf;
    } else if (t.saveStateBuffer && t.saveStateBuffer.byteLength) {
      const extracted = tryExtractWramFromMednafenSavestate(new Uint8Array(t.saveStateBuffer));
      if (extracted && extracted.byteLength >= 0x10000) {
        const buf = new ArrayBuffer(0x10000);
        new Uint8Array(buf).set(extracted.subarray(0, 0x10000));
        wram64 = buf;
        wramSrc = wramSrc || 'savestate';
      }
    }
    if (wram64) {
      ramdumpsFolder.push({ name: `${stem}.wram.bin`, buffer: wram64 });
    }
    if (t.screenshotBlob) {
      screenshotsFolder.push({ name: `${stem}.png`, blob: t.screenshotBlob });
    }
    if (t.saveStateBuffer && t.saveStateBuffer.byteLength) {
      const st = t.saveStateBuffer;
      const u8 = st instanceof Uint8Array ? st : new Uint8Array(st);
      const copy = new ArrayBuffer(u8.byteLength);
      new Uint8Array(copy).set(u8);
      saveStatesFolder.push({ name: `${stem}.state`, buffer: copy });
    }
    frameRegistry.push({
      frameId: t.frameId,
      stateName: t.stateName,
      subStateName: t.subStateName || '',
      note: t.note || '',
      vipStateFile: `vipstates/${stem}.json`,
      screenshotFile: `screenshots/${stem}.png`,
      ramdumpFile: wram64 ? `ramdumps/${stem}.wram.bin` : null,
      saveStateFile: t.saveStateBuffer && t.saveStateBuffer.byteLength ? `savestates/${stem}.state` : null,
      wramBytes: wram64 ? 0x10000 : 0,
      wramCaptureOk: !!wram64,
      ...(wramSrc && { wramSource: wramSrc }),
    });
  }

  return { vipStatesFolder, ramdumpsFolder, screenshotsFolder, saveStatesFolder, frameRegistry };
}

/**
 * Pause/resume EmulatorJS while the Capture Frame dialog is open.
 * Note: EJS `pause()` only enters pause (no-op if already paused); `play()` resumes.
 * Do not call `pause(false)` — it does not unpause.
 */
function setEmulatorPaused(paused) {
  try {
    const emu = typeof window !== 'undefined' && window.EJS_emulator;
    if (!emu) return;
    if (paused) {
      if (typeof emu.pause === 'function') emu.pause();
    } else if (userPaused) {
      // The user paused to step through frames: a dialog closing must not set the game running.
      renderStepStatus();
    } else if (typeof emu.play === 'function') {
      emu.play();
    }
  } catch (_) {
    /* ignore */
  }
}

/** Remember Capture Frame labels between captures (localStorage). */
const CAPTURE_LAST_STATE_KEY = 'vb-capture-last-state-name';
const CAPTURE_LAST_SUBSTATE_KEY = 'vb-capture-last-substate-name';
const CAPTURE_RECENT_STATES_KEY = 'vb-capture-recent-state-names';
const CAPTURE_RECENT_SUBSTATE_KEY = 'vb-capture-recent-substate-names';
const CAPTURE_RECENT_MAX = 14;

function readCaptureRecentList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((s) => typeof s === 'string' && s.trim()).slice(0, CAPTURE_RECENT_MAX);
  } catch (_) {
    return [];
  }
}

function pushCaptureRecent(key, value) {
  const v = (value || '').trim();
  if (!v) return;
  const lower = v.toLowerCase();
  const deduped = readCaptureRecentList(key).filter((x) => x.toLowerCase() !== lower);
  const next = [v, ...deduped].slice(0, CAPTURE_RECENT_MAX);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch (_) {}
}

function loadCaptureFieldDefaults() {
  try {
    return {
      lastState: (localStorage.getItem(CAPTURE_LAST_STATE_KEY) || '').trim(),
      lastSub: (localStorage.getItem(CAPTURE_LAST_SUBSTATE_KEY) || '').trim(),
      recentStates: readCaptureRecentList(CAPTURE_RECENT_STATES_KEY),
      recentSubs: readCaptureRecentList(CAPTURE_RECENT_SUBSTATE_KEY),
    };
  } catch (_) {
    return { lastState: '', lastSub: '', recentStates: [], recentSubs: [] };
  }
}

function persistCaptureFieldChoice(stateName, subStateName) {
  const sn = (stateName || '').trim();
  const sub = (subStateName || '').trim();
  try {
    if (sn) localStorage.setItem(CAPTURE_LAST_STATE_KEY, sn);
    localStorage.setItem(CAPTURE_LAST_SUBSTATE_KEY, sub);
  } catch (_) {}
  if (sn) pushCaptureRecent(CAPTURE_RECENT_STATES_KEY, sn);
  if (sub) pushCaptureRecent(CAPTURE_RECENT_SUBSTATE_KEY, sub);
}

function fillCaptureDatalist(id, values) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = '';
  for (const t of values) {
    const o = document.createElement('option');
    o.value = t;
    dl.appendChild(o);
  }
}

/**
 * The emulator's picture for a capture: one eye, as the tools expect. In Side-by-side the left
 * eye is cut out; Anaglyph mixes both eyes into one picture, so there is no screenshot then (the
 * capture notes it).
 */
function captureEmulatorScreenshotPngBlob() {
  return new Promise((resolve) => {
    const canvas = typeof paletteLayerModule?.getEmulatorCanvas === 'function' ? paletteLayerModule.getEmulatorCanvas() : null;
    const core = coreStereoOptions(viewMode, { palette: paletteEnabled });
    if (!canvas || core.vb_anaglyph_preset !== 'disabled') {
      resolve(null);
      return;
    }
    try {
      if (core.vb_3dmode !== 'side-by-side') {
        canvas.toBlob((b) => resolve(b), 'image/png');
        return;
      }
      const r = leftEyeRect(canvas.width, canvas.height);
      const eye = document.createElement('canvas');
      eye.width = r.w;
      eye.height = r.h;
      eye.getContext('2d')?.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      eye.toBlob((b) => resolve(b), 'image/png');
    } catch (err) {
      console.warn('[Capture] Could not take the screenshot:', err);
      resolve(null);
    }
  });
}

/**
 * @param {{ auto?: { found: string, stateName?: string, screenLabel?: string } }} [opts]
 *   `found`: what made it stop, e.g. "2 new sprite tile(s) no captured frame shows yet".
 *   `auto`: opened by auto-capture. The dialog then gets a real way out — Stop
 *   auto-capture (or Escape) resolves `{ cancelled: true }` instead of capturing
 *   with default names, and the backdrop stays light so the highlighted tiles show.
 */
function showCaptureFrameDialog(opts = {}) {
  const auto = opts.auto || null;
  setEmulatorPaused(true);
  return new Promise((resolve) => {
    const dlg = document.getElementById('capture-frame-dialog');
    const stateIn = document.getElementById('capture-state-name');
    const subIn = document.getElementById('capture-substate-name');
    const noteIn = document.getElementById('capture-note');
    const btnOk = document.getElementById('capture-dialog-ok');
    const btnSkip = document.getElementById('capture-dialog-skip');
    const btnStop = document.getElementById('capture-dialog-stop');
    const hintEl = document.getElementById('capture-frame-hint');
    const hintDefault = hintEl ? hintEl.innerHTML : '';
    if (!dlg || !stateIn || !subIn || !noteIn || !btnOk || !btnSkip) {
      setEmulatorPaused(false);
      resolve({
        stateName: allocDefaultStateName(),
        subStateName: '',
        note: '',
        skippedDefaults: true,
      });
      return;
    }
    const nextDefault = `State ${String(captureAutoStateCounter + 1).padStart(3, '0')}`;
    const mem = loadCaptureFieldDefaults();
    fillCaptureDatalist('capture-state-datalist', mem.recentStates);
    fillCaptureDatalist('capture-substate-datalist', mem.recentSubs);
    stateIn.value = mem.lastState;
    stateIn.placeholder = nextDefault;
    subIn.value = mem.lastSub;
    noteIn.value = '';

    dlg.classList.toggle('auto', !!auto);
    if (btnStop) btnStop.hidden = !auto;
    if (auto) {
      // The screen the RAM fingerprint matched is the best guess for the state name.
      if (auto.stateName) stateIn.value = auto.stateName;
      noteIn.value = `Auto-capture: ${auto.found}`;
      if (hintEl) {
        hintEl.textContent =
          `Auto-capture stopped here: ${auto.found} — outlined on the game. ` +
          `Screen: ${auto.screenLabel || 'unknown'}. Capture this frame, or stop auto-capture.`;
      }
    }

    const cleanup = () => {
      btnOk.removeEventListener('click', onOk);
      btnSkip.removeEventListener('click', onSkip);
      btnStop?.removeEventListener('click', onStop);
      dlg.removeEventListener('close', onClose);
      dlg.classList.remove('auto');
      if (btnStop) btnStop.hidden = true;
      if (hintEl) hintEl.innerHTML = hintDefault;
    };
    let settled = false;
    const settle = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      setEmulatorPaused(false);
      resolve(payload);
    };
    const onClose = () => {
      if (settled) return;
      // In auto mode, Escape means "no" — stop, don't capture under a default name.
      if (auto) {
        settle({ cancelled: true });
        return;
      }
      settle({
        stateName: allocDefaultStateName(),
        subStateName: '',
        note: '',
        skippedDefaults: true,
      });
    };
    const onStop = () => {
      settle({ cancelled: true });
      dlg.close();
    };
    const onSkip = () => {
      settle({
        stateName: allocDefaultStateName(),
        subStateName: '',
        note: '',
        skippedDefaults: true,
      });
      dlg.close();
    };
    const onOk = () => {
      let sn = (stateIn.value || '').trim();
      if (!sn) sn = allocDefaultStateName();
      const subTrim = (subIn.value || '').trim();
      persistCaptureFieldChoice(sn, subTrim);
      settle({
        stateName: sn,
        subStateName: subTrim,
        note: (noteIn.value || '').trim(),
        skippedDefaults: false,
      });
      dlg.close();
    };
    dlg.addEventListener('close', onClose);
    btnOk.addEventListener('click', onOk);
    btnSkip.addEventListener('click', onSkip);
    btnStop?.addEventListener('click', onStop);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else {
      setEmulatorPaused(false);
      resolve({ stateName: allocDefaultStateName(), subStateName: '', note: '', skippedDefaults: true });
    }
  });
}

function updateFrameSavestateSelect() {
  const wrap = document.getElementById('frame-savestate-wrap');
  const select = document.getElementById('frame-savestate-select');
  if (!wrap || !select) return;
  if (vbpackFramesList.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  select.innerHTML = '';
  vbpackFramesList.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = f.saveState ? `${f.label} (has save state)` : f.label;
    select.appendChild(opt);
  });
  select.selectedIndex = 0;
}

function applyFrameSavestate(index) {
  const entry = vbpackFramesList[index];
  if (!entry) return;
  const saveStateBytes = entry.saveState ? new Uint8Array(entry.saveState) : null;
  const hasSaveState = saveStateBytes && saveStateBytes.length > 0;

  if (hasSaveState) {
    // Restore game state only; do not apply the stored VIP snapshot. The core will
    // push the real VIP state on the next frame, so the color layer shows the
    // actual game at that point instead of a static snapshot.
    const startedAt = Date.now();
    const tryRestore = () => {
      const emu = typeof window !== 'undefined' && window.EJS_emulator;
      if (!emu?.gameManager?.loadState) {
        if (Date.now() - startedAt > 8000) return;
        setTimeout(tryRestore, 50);
        return;
      }
      try {
        if (emu.pause) emu.pause(true);
      } catch (_) {}
      try {
        emu.gameManager.loadState(saveStateBytes);
        try { if (emu.pause) emu.pause(true); } catch (_) {}
        // Opened paused on a captured frame: step from here. Earlier history is from elsewhere.
        stateHistory.clear();
        userPaused = true;
        renderStepStatus();
      } catch (err) {
        reportProblem('Could not restore that frame’s save state — showing its picture only.', err);
      }
    };
    tryRestore();
  } else {
    // No save state for this frame: apply the stored VIP snapshot so at least
    // the color layer shows that frame's tiles (we cannot restore game state).
    try {
      const state = deserializeVIPState(JSON.parse(entry.vipJson));
      lastVIPState = state;
      colorLayer.onState(state);
      updateColorPackStatus();
    } catch (err) {
      reportProblem('Could not show that captured frame.', err);
    }
  }
}

const { canvas: colorCanvas } = createColorCanvas();
colorCanvas.id = 'color-canvas';
colorCanvas.className = 'color-output';
colorCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;display:none;';
if (gameContainer) {
  gameContainer.appendChild(colorCanvas);
}

let paletteCanvas = null;
const PALETTE_PRESET_KEY = 'vb-palette-preset';
const VALID_PRESETS = ['original', 'green', 'blue', 'gameboy', 'warm'];
let palettePreset = (() => {
  try {
    const s = localStorage.getItem(PALETTE_PRESET_KEY);
    if (s && VALID_PRESETS.includes(s)) return s;
  } catch (_) {}
  return 'original';
})();
if (ENABLE_PALETTE && paletteLayerModule.createPaletteCanvas) {
  paletteCanvas = paletteLayerModule.createPaletteCanvas();
  if (gameContainer) gameContainer.appendChild(paletteCanvas);
}

let lastVIPState = null;

/** Reference (unmodified) pattern table: set when we first get VIP state or when we load a vbpack. Kept separate so the paint tool (or color layer) can use stable tile content. HBias/VBias do not modify this — they are display scroll offsets. */
let referencePatternTable = null;

/** Scale for core masterBrightness (1 = use as-is; <1 = lighter; >1 = darker). Default matches mono fade. */
let colorBrightnessScale = DEFAULT_FADE_RESPONSE;

let stripClipColorLayer = false;
let objXOffsetColorLayer = 0;
let applyOffsetToAllDrawsColorLayer = false;
/** BG X offset in pixels (from number input, default 0). Getter reads DOM so value is always current. */
function getBgXOffsetColorLayer() {
  const el = document.getElementById('color-bg-x-offset');
  if (!el) return 0;
  const n = parseInt(el.value, 10);
  return Number.isFinite(n) ? Math.max(-24, Math.min(24, n)) : 0;
}
let deduplicateDrawsColorLayer = false;
/** When true, composite in VIP world order (31 back → 0 front) instead of core list order. */
let sortDrawsByWorldColorLayer = true;
/** How to treat tiles missing from the pack in color mode. */
let unpackedTileModeColorLayer = 'transparent';

let perfFrameIntervalEmaMs = 0;
let perfLastCompositeWallMs = 0;
let perfLastVipToPresentMs = 0;
let perfLastDrawListLength = 0;
let perfHasCompositeSample = false;

function onColorCompositeTiming(info) {
  perfHasCompositeSample = true;
  perfLastVipToPresentMs = info.durationMs;
  perfLastDrawListLength = info.drawListLength;
  const now = performance.now();
  if (perfLastCompositeWallMs > 0) {
    const dt = now - perfLastCompositeWallMs;
    perfFrameIntervalEmaMs = perfFrameIntervalEmaMs > 0 ? perfFrameIntervalEmaMs * 0.92 + dt * 0.08 : dt;
  }
  perfLastCompositeWallMs = now;
  refreshPerfMetricsOverlay();
}

function refreshPerfMetricsOverlay() {
  const el = document.getElementById('perf-metrics-overlay');
  if (!el) return;
  const colorOn = colorEnabled && !paletteEnabled;
  const showFrame = document.getElementById('perf-overlay-frame-interval')?.checked === true;
  const showPresent = document.getElementById('perf-overlay-vip-present')?.checked === true;
  const showDraws = document.getElementById('perf-overlay-draw-count')?.checked === true;
  const showOv = document.getElementById('perf-overlay-override-count')?.checked === true;
  if (!colorOn || (!showFrame && !showPresent && !showDraws && !showOv)) {
    el.hidden = true;
    return;
  }
  const lines = [];
  if (showFrame) {
    if (perfFrameIntervalEmaMs > 0) {
      const fps = 1000 / perfFrameIntervalEmaMs;
      lines.push(`frame Δ ${perfFrameIntervalEmaMs.toFixed(2)} ms (~${fps.toFixed(1)} fps)`);
    } else {
      lines.push('frame Δ … (2nd composite needed)');
    }
  }
  if (showPresent) {
    lines.push(
      perfHasCompositeSample ? `VIP→present ${perfLastVipToPresentMs.toFixed(3)} ms` : 'VIP→present —',
    );
  }
  if (showDraws) {
    lines.push(`draws ${perfLastDrawListLength}`);
  }
  if (showOv) {
    lines.push(`overrides ${lastOverridesCount}`);
  }
  el.textContent = lines.join('\n');
  el.hidden = false;
}

const colorLayer = wireColorLayer(
  colorCanvas,
  () => displayMode,
  () => viewMode,
  () => colorBrightnessScale,
  () => stripClipColorLayer,
  () => objXOffsetColorLayer,
  () => applyOffsetToAllDrawsColorLayer,
  getBgXOffsetColorLayer,
  () => deduplicateDrawsColorLayer,
  () => unpackedTileModeColorLayer,
  onColorCompositeTiming,
  () => sortDrawsByWorldColorLayer,
);

// Layer art (a picture replacing a BG group's layer) is saved as PNG; decode it here, and
// redraw once it is ready so a paused game shows it too.
installLayerArtDecoder();
onLayerArtDecoded(() => {
  if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
});

/**
 * Send the View menu to the core, so the monochrome picture is in 3D too (src/stereo-view.js).
 * Only when something changed: setting a core option makes the core re-read its options.
 */
function applyCoreViewMode() {
  const emulator = window.EJS_emulator;
  const gm = emulator?.gameManager;
  if (!gm || typeof gm.setVariable !== 'function') return;
  const opts = coreStereoOptions(viewMode, { palette: paletteEnabled });
  const key = JSON.stringify(opts);
  if (appliedCoreView.emulator === emulator && appliedCoreView.key === key) return;
  try {
    for (const [name, value] of Object.entries(opts)) gm.setVariable(name, value);
    appliedCoreView = { emulator, key };
  } catch (err) {
    console.warn('[View] Could not set the core’s 3D mode:', err);
  }
}

document.getElementById('view-select')?.addEventListener('change', (e) => {
  viewMode = /** @type {'2d'|'sidebyside'|'anaglyph'} */ (e.target.value);
  applyCoreViewMode();
  if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
});

const colorFadeSlider = document.getElementById('color-fade-slider');
const colorFadeValueEl = document.getElementById('color-fade-value');
if (colorFadeSlider && colorFadeValueEl) {
  const updateFadeValue = () => {
    const v = parseFloat(colorFadeSlider.value);
    colorBrightnessScale = Number.isFinite(v) ? v : 1;
    colorFadeValueEl.textContent = colorBrightnessScale.toFixed(2);
    if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
  };
  colorFadeSlider.addEventListener('input', updateFadeValue);
  colorFadeSlider.addEventListener('change', updateFadeValue);
  updateFadeValue();
}
const colorStripClipCheckbox = document.getElementById('color-strip-clip');
if (colorStripClipCheckbox) {
  colorStripClipCheckbox.addEventListener('change', () => {
    stripClipColorLayer = colorStripClipCheckbox.checked;
    if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
  });
}
const colorObjXOffsetCheckbox = document.getElementById('color-obj-x-offset');
if (colorObjXOffsetCheckbox) {
  colorObjXOffsetCheckbox.addEventListener('change', () => {
    objXOffsetColorLayer = colorObjXOffsetCheckbox.checked ? -8 : 0;
    if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
  });
}
const colorApplyOffsetAllCheckbox = document.getElementById('color-apply-offset-all');
if (colorApplyOffsetAllCheckbox) {
  colorApplyOffsetAllCheckbox.addEventListener('change', () => {
    applyOffsetToAllDrawsColorLayer = colorApplyOffsetAllCheckbox.checked;
    if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
  });
}
const colorBgXOffsetInput = document.getElementById('color-bg-x-offset');
if (colorBgXOffsetInput) {
  const applyBgXOffset = () => { if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState); };
  colorBgXOffsetInput.addEventListener('input', applyBgXOffset);
  colorBgXOffsetInput.addEventListener('change', applyBgXOffset);
}
const colorDeduplicateDrawsCheckbox = document.getElementById('color-deduplicate-draws');
if (colorDeduplicateDrawsCheckbox) {
  colorDeduplicateDrawsCheckbox.addEventListener('change', () => {
    deduplicateDrawsColorLayer = colorDeduplicateDrawsCheckbox.checked;
    if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
  });
}
const colorSortWorldCheckbox = document.getElementById('color-sort-world');
if (colorSortWorldCheckbox) {
  colorSortWorldCheckbox.checked = sortDrawsByWorldColorLayer;
  colorSortWorldCheckbox.addEventListener('change', () => {
    sortDrawsByWorldColorLayer = colorSortWorldCheckbox.checked;
    if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
  });
}
const colorUnpackedModeSelect = document.getElementById('color-unpacked-mode');
if (colorUnpackedModeSelect) {
  colorUnpackedModeSelect.value = unpackedTileModeColorLayer;
  colorUnpackedModeSelect.addEventListener('change', () => {
    const v = String(colorUnpackedModeSelect.value || 'transparent');
    unpackedTileModeColorLayer = v === 'occlude_black' ? 'occlude_black' : 'transparent';
    if (displayMode === 'color' && lastVIPState) colorLayer.onState(lastVIPState);
  });
}
for (const id of ['perf-overlay-frame-interval', 'perf-overlay-vip-present', 'perf-overlay-draw-count', 'perf-overlay-override-count']) {
  document.getElementById(id)?.addEventListener('change', () => refreshPerfMetricsOverlay());
}

function updateColorPackStatus() {
  const el = document.getElementById('color-pack-status');
  if (el) {
    const romStr = currentRomFileName ? `ROM: ${currentRomFileName} · ` : '';
    let packStr = 'Pack: not loaded';
    if (hasTemporaryVbpack && !lastPackSummary) {
      packStr = temporaryVipStates.length > 0
        ? `Pack: unsaved vbpack (${temporaryVipStates.length} frame${temporaryVipStates.length === 1 ? '' : 's'})`
        : 'Pack: unsaved vbpack';
    } else if (lastPackSummary) {
      packStr = `Pack: ${lastPackSummary.gameId} (${lastPackSummary.entryCount} tiles)`;
    } else if (currentVbpackDisplayName) {
      packStr = `Pack: ${currentVbpackDisplayName} (no color tiles yet)`;
    }
    let vipStr = 'VIP: no state';
    if (lastVIPState) {
      const dl = lastVIPState.drawList;
      const frameNum = lastVIPState.frameNumber;
      const frameStr = frameNum !== undefined && frameNum !== null ? ` · frame ${frameNum}` : '';
      vipStr = dl && dl.length ? `VIP: ${dl.length} draws${frameStr}` : `VIP: state but no draw list${frameStr}`;
    }
    const modeStr = displayMode === 'color' ? ' · Color mode on' : '';
    const overridesStr = lastOverridesCount > 0 ? ` · Overrides: ${lastOverridesCount}` : '';
    const flashStr = colorPackStatusFlash && Date.now() < colorPackStatusFlash.until ? `${colorPackStatusFlash.message} ` : '';
    const unsaved = unsavedCapturesNote(unsavedCaptureCount());
    el.textContent = `${flashStr}${romStr}${packStr}. ${vipStr}${modeStr}${overridesStr}${unsaved ? ` · ${unsaved}` : ''}`;
  }
  // Update visible "loaded" labels so after Save and Play it's clear what is loaded
  const setLoaded = (id, text) => {
    const span = document.getElementById(id);
    if (span) {
      span.textContent = text || '';
    }
  };
  const noFile = 'No file chosen';
  setLoaded('loaded-rom-name', currentRomFileName ? `Loaded: ${currentRomFileName}` : noFile);
  if (lastPackSummary || hasTemporaryVbpack || currentVbpackDisplayName) {
    const name = currentVbpackDisplayName || lastPackSummary?.gameId || (hasTemporaryVbpack ? 'Unsaved vbpack' : '');
    const frames = loadedVbpackFrames.length + temporaryVipStates.length;
    const frameInfo = frames > 0 ? ` (${frames} frame${frames === 1 ? '' : 's'})` : '';
    setLoaded('loaded-pack-name', name ? `Loaded: ${name}${frameInfo}` : noFile);
  } else {
    setLoaded('loaded-pack-name', noFile);
  }
  setLoaded('loaded-color-pack-name', colorPackData ? 'Loaded' : noFile);
  setLoaded('loaded-overrides-name', lastOverridesCount > 0 ? `${lastOverridesCount} overrides` : noFile);
}

/**
 * Compare current frame's tile hashes to the loaded pack. Logs to console and optionally updates status.
 * Call when you want to see why Color mode isn't showing (hash mismatch / frame difference).
 */
function reportPackCoverage() {
  if (!lastVIPState?.drawList?.length || !colorPackData) {
    console.warn('[Pack coverage] Need VIP state with draw list and a loaded pack.');
    if (lastVIPState && !lastVIPState.drawList?.length) console.warn('[Pack coverage] This frame has no draw list.');
    if (!colorPackData) console.warn('[Pack coverage] No pack loaded.');
    return;
  }
  const pack = parseVBColorPack(colorPackData);
  if (!pack) {
    console.warn('[Pack coverage] Failed to parse pack.');
    return;
  }
  const packHashes = new Set(pack.entries.keys());
  const drawList = lastVIPState.drawList;
  const patternTable = lastVIPState.patternTable;
  if (!patternTable || patternTable.length < 16) {
    console.warn('[Pack coverage] No pattern table in state.');
    return;
  }
  let drawsWithPack = 0;
  const frameHashes = new Set();
  for (const call of drawList) {
    const tileBytes = getTileBytes(patternTable, call.tileIndex);
    const hash = hashTile(tileBytes);
    frameHashes.add(hash);
    if (packHashes.has(hash)) drawsWithPack++;
  }
  const overlap = [...frameHashes].filter((h) => packHashes.has(h));
  const packArr = [...packHashes].sort((a, b) => (a >>> 0) - (b >>> 0));
  const frameArr = [...frameHashes].sort((a, b) => (a >>> 0) - (b >>> 0));
  const msg = `This frame: ${drawList.length} draws, ${frameHashes.size} unique tile hashes. Pack: ${packHashes.size} entries. Draws using a pack tile: ${drawsWithPack}. Overlap (hashes in both): ${overlap.length}`;
  console.log('[Pack coverage]', msg);
  console.log('[Pack coverage] Pack hashes (hex):', packArr.slice(0, 20).map((h) => '0x' + (h >>> 0).toString(16)).join(', '), packArr.length > 20 ? '...' : '');
  console.log('[Pack coverage] Frame hashes (hex, first 25):', frameArr.slice(0, 25).map((h) => '0x' + (h >>> 0).toString(16)).join(', '));
  if (overlap.length > 0) {
    console.log('[Pack coverage] Matching hashes (in both):', overlap.slice(0, 15).map((h) => '0x' + (h >>> 0).toString(16)).join(', '), overlap.length > 15 ? '...' : '');
  } else {
    console.log('[Pack coverage] No hashes in common — frame tiles do not match the pack (different frame or different tile data).');
  }
  const statusEl = document.getElementById('color-pack-status');
  if (statusEl) {
    updateColorPackStatus();
    const base = statusEl.textContent.replace(/\s*\((no hash match)\)|\s*•\s*\d+\s+draws in pack\.?$/i, '').trim();
    const extra = overlap.length === 0 ? ' (no hash match)' : ` • ${drawsWithPack} draws in pack`;
    statusEl.textContent = base + extra;
  }
}

/**
 * Log draw list layer counts and whether OBJ X offset applies. Use when "OBJ X offset -8" has no visible effect.
 * If no draws have layer === 2, the core may not set layer and the offset is never applied.
 */
function reportColorLayerDebug() {
  if (!lastVIPState?.drawList?.length) {
    console.warn('[Color layer debug] No draw list (load a ROM and let a frame run in Color mode).');
    return;
  }
  const drawList = lastVIPState.drawList;
  const counts = { layer0: 0, layer1: 0, layer2: 0, layerUndef: 0 };
  let drawsWithWorldField = 0;
  for (const d of drawList) {
    if (d.layer === 0) counts.layer0++;
    else if (d.layer === 1) counts.layer1++;
    else if (d.layer === 2) counts.layer2++;
    else counts.layerUndef++;
    if (d.world !== undefined && d.world !== null) drawsWithWorldField++;
  }
  const wt = getWindowsTableBytesFromState(lastVIPState);
  const windowsTableBytes = wt?.byteLength ?? 0;
  const objXOffset = objXOffsetColorLayer;
  const bgXOffset = getBgXOffsetColorLayer();
  console.log('[Color layer debug]', {
    drawListLength: drawList.length,
    drawsWithWorldField,
    windowsTableBytes,
    'BG (layer 0)': counts.layer0,
    'Affine (layer 1)': counts.layer1,
    'OBJ (layer 2)': counts.layer2,
    'layer undefined': counts.layerUndef,
    objXOffset,
    bgXOffset,
    'Offset applied to (layer===2)': objXOffset ? counts.layer2 : 0,
    'Offset applied to (layer===0)': bgXOffset ? counts.layer0 : 0,
    applyOffsetToAllDraws: applyOffsetToAllDrawsColorLayer,
  });
  if (!wt || windowsTableBytes < 1024) {
    console.warn('[Color layer debug] VIP window table missing or short — BG/Affine pillarbox clip is off. Core should send `windows` (1024 bytes) or `windowsBase64`.');
  }
  if (drawsWithWorldField === 0) {
    console.warn('[Color layer debug] No draws have `world` — world clip has no effect.');
  }
  if (objXOffset && counts.layer2 === 0 && !applyOffsetToAllDrawsColorLayer) {
    console.log('[Color layer debug] No draws have layer 2 — OBJ X offset has no effect. Enable "Apply offset to all draws (debug)" to confirm the offset path works.');
  }
}

let pixelInspectorEnabled = false;
/** @type {{ draws: unknown[], eye: number, x: number, y: number } | null} */
let lastPixelInspectorReport = null;
/** Mono-mode inspector: listen on the real EmulatorJS canvas (iframe/shadow), not #game directly. */
/** @type {HTMLCanvasElement | null} */
let inspectorEmuCanvasAttached = null;
/** @type {((e: MouseEvent) => void) | null} */
let inspectorEmuClickListener = null;

/**
 * Attach pixel-inspector clicks to the emulator video canvas when Color overlay is off.
 * Clicks do not bubble from inside an iframe to `game-container`, and `querySelector('canvas')` on `#game` misses iframe/shadow canvases — use palette-layer's resolver.
 */
function syncEmulatorInspectorClickAttachment() {
  const cc = document.getElementById('color-canvas');
  const colorOverlayActive = colorEnabled && cc && cc.style.display !== 'none';
  const wantMonoInspect = pixelInspectorEnabled && !paletteEnabled && !colorOverlayActive;
  const emu =
    wantMonoInspect && typeof paletteLayerModule?.getEmulatorCanvas === 'function'
      ? paletteLayerModule.getEmulatorCanvas()
      : null;

  if (inspectorEmuCanvasAttached && (inspectorEmuCanvasAttached !== emu || !wantMonoInspect)) {
    if (inspectorEmuClickListener) {
      inspectorEmuCanvasAttached.removeEventListener('click', inspectorEmuClickListener);
    }
    inspectorEmuCanvasAttached = null;
    inspectorEmuClickListener = null;
  }
  if (!wantMonoInspect || !emu) return;
  if (inspectorEmuCanvasAttached === emu) return;
  inspectorEmuClickListener = (e) => {
    const p = eventToCanvasPixel(e, emu);
    if (!p) return;
    applyPixelInspectorFromFramebufferCoords(p.xCanvas, p.yCanvas, p.canvas);
  };
  emu.addEventListener('click', inspectorEmuClickListener);
  inspectorEmuCanvasAttached = emu;
}

function drawMatchesGroupForInspector(draw, group, hash) {
  const c = group?.criteria || {};
  const windowIds = Array.isArray(c.windowIds)
    ? c.windowIds
    : (Array.isArray(c.worldIds) ? c.worldIds : []);
  const hashes = Array.isArray(c.hashes) ? c.hashes : [];
  const layers = Array.isArray(c.layers) ? c.layers : [];
  if (windowIds.length > 0) {
    const w = draw.world;
    if (w === undefined || w === null) return false;
    if (!windowIds.includes(Number(w))) return false;
  }
  const slots = Array.isArray(c.tileSlots) ? c.tileSlots : [];
  if (hashes.length > 0 && !hashes.includes(hash) && !slots.includes(Number(draw.tileIndex))) return false;
  if (layers.length > 0) {
    const L = draw.layer;
    if (L === undefined || L === null) return false;
    if (!layers.includes(Number(L))) return false;
  }
  return true;
}

/**
 * @param {number} x - framebuffer x 0..383
 * @param {number} y - framebuffer y 0..223
 * @param {{ eye?: number }} [opts]
 */
function reportPixelStack(x, y, opts = {}) {
  const report = { x, y, eye: opts.eye ?? 0, draws: /** @type {unknown[]} */ ([]) };
  if (!lastVIPState?.drawList?.length || !lastVIPState?.patternTable?.length) {
    return report;
  }
  const eye = opts.eye ?? 0;
  const pack = colorPackData ? parseVBColorPack(colorPackData) : null;
  const packEntries = pack?.entries ?? new Map();
  const overridesParsed = parsePositionOverrides(Array.isArray(lastOverridesJson) ? lastOverridesJson : []);
  const groupsForInspect = Array.isArray(lastVbpackGroups) ? lastVbpackGroups : [];
  const wramInspect = tryCopyVBSystemRamFromEmulator();
  const windowsTable = getWindowsTableBytesFromState(lastVIPState);
  const dl = lastVIPState.drawList;
  const pt = lastVIPState.patternTable;
  const stack = [];
  for (let i = 0; i < dl.length; i++) {
    const d = dl[i];
    if ((d.eye ?? 0) !== eye) continue;
    if (x < d.x || x >= d.x + 8 || y < d.y || y >= d.y + 8) continue;
    const tileBytes = getTileBytes(pt, d.tileIndex);
    const hash = hashTile(tileBytes);
    const lx = x - d.x;
    const ly = y - d.y;
    const flipH = d.flipH ?? false;
    const flipV = d.flipV ?? false;
    const sx = flipH ? 7 - lx : lx;
    const sy = flipV ? 7 - ly : ly;
    const row = tileBytes[sy * 2] | (tileBytes[sy * 2 + 1] << 8);
    const monoPx = (row >> (sx * 2)) & 0x3;
    let inWorldClip = true;
    let worldClip = null;
    if (windowsTable && d.world !== undefined && d.world !== null) {
      const wid = d.world | 0;
      if (wid >= 0 && wid <= 31) {
        worldClip = getBgAffineWorldClipRect(windowsTable, wid, eye);
        if (worldClip && (x < worldClip.x0 || x > worldClip.x1 || y < worldClip.y0 || y > worldClip.y1)) {
          inWorldClip = false;
        }
      }
    }
    const mapHit = !!packEntries.get(hash);
    const drawLayer = d.layer !== undefined && d.layer !== null ? Number(d.layer) : undefined;
    const rgbaFromOverride = resolveOverrideRgba(
      overridesParsed,
      hash,
      d.x,
      d.y,
      packEntries,
      drawLayer,
      d,
      groupsForInspect,
      lastVbpackGameStatePools,
      wramInspect,
    );
    let colorSrc = 'none';
    if (rgbaFromOverride) colorSrc = 'override';
    else if (mapHit) colorSrc = 'vbcolor';
    stack.push({
      drawIndex: i,
      tileIndex: d.tileIndex,
      hash: hash >>> 0,
      world: d.world,
      layer: d.layer,
      pack: mapHit ? 'Y' : 'N',
      colorSrc,
      monoPx,
      inWorldClip,
      groups: (lastVbpackGroups || []).filter((g) => drawMatchesGroupForInspector(d, g, hash)).map((g) => g.id),
    });
  }
  report.draws = stack;
  return report;
}

function formatPixelInspectorReport(rep) {
  if (!rep?.draws?.length) return 'No draws at this pixel for this eye.';
  const lines = [
    `x=${rep.x} y=${rep.y} eye=${rep.eye}`,
    'Bottom → top (last listed is top-most). pack=hash in .vbcolor map; src=compositor tile rgba (override beats map, alternateHash counts as override).',
    'Click: color overlay when Color is on; game area (mono framebuffer) when Color is off and this panel is visible.',
  ];
  for (let i = 0; i < rep.draws.length; i++) {
    const e = rep.draws[i];
    const src = e.colorSrc ?? 'none';
    lines.push(
      `  #${i} draw ${e.drawIndex} tile ${e.tileIndex} hash 0x${(e.hash >>> 0).toString(16)} W${e.world} L${e.layer} pack=${e.pack} src=${src} mono=${e.monoPx} clip=${e.inWorldClip ? 'Y' : 'N'}`,
    );
  }
  return lines.join('\n');
}

function setPixelInspectorReport(rep) {
  lastPixelInspectorReport = rep;
  const out = document.getElementById('color-pixel-inspector-output');
  const st = document.getElementById('color-pixel-inspector-status');
  if (out) out.textContent = formatPixelInspectorReport(rep);
  if (st) st.textContent = rep?.draws?.length ? `${rep.draws.length} draw(s) at stack` : 'No hits.';
}

function updatePixelInspectorUi() {
  const btn = document.getElementById('btn-pixel-inspector-toggle');
  if (btn) {
    btn.textContent = pixelInspectorEnabled ? 'Pixel inspector: On' : 'Pixel inspector: Off';
    btn.classList.toggle('active', pixelInspectorEnabled);
  }
  const canvas = document.getElementById('color-canvas');
  if (canvas) canvas.style.pointerEvents = pixelInspectorEnabled ? 'auto' : 'none';
  syncEmulatorInspectorClickAttachment();
}

/** @returns {{ xCanvas: number, yCanvas: number, canvas: HTMLCanvasElement } | null} */
function eventToCanvasPixel(ev, canvas) {
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  const xCanvas = Math.min(
    canvas.width - 1,
    Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * canvas.width)),
  );
  const yCanvas = Math.min(
    canvas.height - 1,
    Math.max(0, Math.floor(((ev.clientY - r.top) / r.height) * canvas.height)),
  );
  return { xCanvas, yCanvas, canvas };
}

/** @returns {{ xCanvas: number, yCanvas: number, canvas: HTMLCanvasElement } | null} */
function eventToColorCanvasPixel(ev) {
  return eventToCanvasPixel(ev, document.getElementById('color-canvas'));
}

/**
 * VIP drawList / compositor use 384×224 per eye. Emulator canvas buffer is often scaled (e.g. 768×224 SBS) — map click to VIP (x,y) and eye.
 *
 * @param {number} xBuf
 * @param {number} yBuf
 * @param {HTMLCanvasElement} sourceCanvas
 * @returns {{ fx: number, fy: number, eye: number }}
 */
function mapCanvasBufferToVipPixel(xBuf, yBuf, sourceCanvas) {
  const cw = sourceCanvas.width;
  const ch = sourceCanvas.height;
  const x = Math.max(0, Math.min(cw - 1, xBuf));
  const y = Math.max(0, Math.min(ch - 1, yBuf));
  let eye = 0;
  let localX = x;
  const halfW = cw / 2;
  /** Each half is ~384:224 when the core stacks L|R in one buffer (e.g. 768×224). */
  const looksLikeSideBySide =
    cw >= COLOR_FB_WIDTH * 2 - 4 && Math.abs(halfW / ch - COLOR_FB_WIDTH / COLOR_FB_HEIGHT) < 0.12;
  if (looksLikeSideBySide) {
    if (x >= halfW) {
      eye = 1;
      localX = x - halfW;
    }
    const fx = Math.floor((localX * COLOR_FB_WIDTH) / halfW);
    const fy = Math.floor((y * COLOR_FB_HEIGHT) / ch);
    return {
      fx: Math.max(0, Math.min(COLOR_FB_WIDTH - 1, fx)),
      fy: Math.max(0, Math.min(COLOR_FB_HEIGHT - 1, fy)),
      eye,
    };
  }
  const fx = Math.floor((x * COLOR_FB_WIDTH) / cw);
  const fy = Math.floor((y * COLOR_FB_HEIGHT) / ch);
  return {
    fx: Math.max(0, Math.min(COLOR_FB_WIDTH - 1, fx)),
    fy: Math.max(0, Math.min(COLOR_FB_HEIGHT - 1, fy)),
    eye: 0,
  };
}

function applyPixelInspectorFromFramebufferCoords(xCanvas, yCanvas, sourceCanvas) {
  const { fx, fy, eye } = mapCanvasBufferToVipPixel(xCanvas, yCanvas, sourceCanvas);
  setPixelInspectorReport(reportPixelStack(fx, fy, { eye }));
}

/**
 * Log duplicate or near-duplicate draws (same tile at same or nearby x,y). Use when double-draw/ghost persists after -4.
 * If the same tileIndex appears at (x,y) and (x±1,y) or (x,y±1), that could explain a 1px ghost.
 */
function reportDuplicateDraws() {
  if (!lastVIPState?.drawList?.length) {
    console.warn('[Duplicate draws] No draw list (load a ROM with a VIP-exporting core and let a frame run).');
    return;
  }
  const drawList = lastVIPState.drawList;
  const byKey = new Map();
  for (let i = 0; i < drawList.length; i++) {
    const d = drawList[i];
    const key = `${d.tileIndex},${d.x},${d.y},${d.eye ?? 0}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(i);
  }
  let exactDuplicates = 0;
  const exactExamples = [];
  for (const indices of byKey.values()) {
    if (indices.length > 1) {
      exactDuplicates += indices.length;
      if (exactExamples.length < 5) {
        const d = drawList[indices[0]];
        exactExamples.push({ tileIndex: d.tileIndex, x: d.x, y: d.y, eye: d.eye ?? 0, count: indices.length });
      }
    }
  }
  // Near-duplicates: same tileIndex and eye, (x,y) within 2 px (group by tileIndex+eye first to avoid O(n^2) over full list)
  const byTileAndEye = new Map();
  for (let i = 0; i < drawList.length; i++) {
    const d = drawList[i];
    const key = `${d.tileIndex},${d.eye ?? 0}`;
    if (!byTileAndEye.has(key)) byTileAndEye.set(key, []);
    byTileAndEye.get(key).push(i);
  }
  let nearPairs = 0;
  const nearExamples = [];
  for (const indices of byTileAndEye.values()) {
    for (let i = 0; i < indices.length; i++) {
      const a = drawList[indices[i]];
      for (let j = i + 1; j < indices.length; j++) {
        const b = drawList[indices[j]];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        if (dx <= 2 && dy <= 2 && (dx > 0 || dy > 0)) {
          nearPairs++;
          if (nearExamples.length < 5) nearExamples.push({ tileIndex: a.tileIndex, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, eye: a.eye ?? 0 });
        }
      }
    }
  }
  console.log('[Duplicate draws]', {
    drawListLength: drawList.length,
    uniqueKeys: byKey.size,
    exactDuplicateDraws: exactDuplicates,
    exactExamples: exactExamples.length ? exactExamples : '(none)',
    nearDuplicatePairs: nearPairs,
    nearExamples: nearExamples.length ? nearExamples : '(none)',
  });
  if (exactDuplicates > 0 || nearPairs > 0) {
    console.log('[Duplicate draws] If exact or near duplicates are high, the core may be emitting the same tile at multiple positions → could explain double-draw/ghost.');
  }
}

/**
 * Full VIP snapshots include pattern table + draw list. Partial pings (frame/eye only) must not
 * clobber lastVIPState or wipe the color layer.
 */
function isRenderableVIPState(state) {
  return !!(state && state.patternTable && state.patternTable.length && Array.isArray(state.drawList));
}

function enableVipToolbarButtons() {
  requestAnimationFrame(() => {
    const dumpBtn = document.getElementById('btn-dump-vip');
    if (dumpBtn) dumpBtn.disabled = false;
    const colorizeBtn = document.getElementById('btn-colorize');
    if (colorizeBtn) colorizeBtn.disabled = false;
    const autoBtn = document.getElementById('btn-auto-capture');
    if (autoBtn) autoBtn.disabled = false;
    for (const id of ['btn-pause', 'btn-step-back', 'btn-step-forward']) {
      const b = document.getElementById(id);
      if (b) b.disabled = false;
    }
    // A new emulator starts in 2D; give it the View menu's mode.
    applyCoreViewMode();
  });
}

/** The loaded pack's normal brightness, worked out once per frame list. */
let brightnessRefFor = /** @type {{ frames: any[], ref: number|null } | null} */ (null);
function packBrightnessReference() {
  if (brightnessRefFor?.frames !== loadedVbpackFrames) {
    const texts = loadedVbpackFrames.map((f) => (typeof f.json === 'string' ? f.json : new TextDecoder().decode(f.json)));
    brightnessRefFor = { frames: loadedVbpackFrames, ref: brightnessReference(masterBrightnessLevels(texts)) };
  }
  return brightnessRefFor.ref;
}

setVIPStateConsumer((state) => {
  if (!state) return;
  if (!isRenderableVIPState(state)) {
    if (lastVIPState) {
      lastVIPState = {
        ...lastVIPState,
        frameNumber: state.frameNumber ?? lastVIPState.frameNumber,
        eye: state.eye ?? lastVIPState.eye,
      };
    }
    updateColorPackStatus();
    enableVipToolbarButtons();
    return;
  }
  // Fades are measured against the game's normal brightness (src/fade.js): the level most of the
  // pack's frames show. Without it a game that always runs dim showed painted white as grey.
  state.brightnessReference = packBrightnessReference();
  lastVIPState = state;
  if (referencePatternTable == null && state.patternTable?.length) {
    referencePatternTable = state.patternTable.slice(0);
  }
  colorLayer.onState(state);
  if (autoCaptureOn) autoCaptureCheck(state);
  updateColorPackStatus();
  updateColorDebugPanelVisibility();
  syncEmulatorInspectorClickAttachment();
  enableVipToolbarButtons();
});
const dumpVipBtn = document.getElementById('btn-dump-vip');
if (dumpVipBtn) dumpVipBtn.disabled = true;
const colorizeBtn = document.getElementById('btn-colorize');
if (colorizeBtn) colorizeBtn.disabled = true;

function hideSplash() {
  if (splash) splash.classList.add('hidden');
}

/** VIP / color debug panel: show when Color is on, or Monochrome while we have a draw list (pixel inspector uses the game canvas). */
function updateColorDebugPanelVisibility() {
  const colorDebugPanel = document.getElementById('color-debug-panel');
  if (!colorDebugPanel) return;
  const show =
    !paletteEnabled &&
    (colorEnabled || (Array.isArray(lastVIPState?.drawList) && lastVIPState.drawList.length > 0));
  colorDebugPanel.style.display = show ? 'block' : 'none';
}

function syncDisplayState() {
  // Color layer cares about displayMode === 'color'
  const wasColour = displayMode === 'color';
  displayMode = (colorEnabled && !paletteEnabled) ? 'color' : 'mono';
  // While hidden the colour layer stops compositing, so its canvas still holds the frame from when
  // it was switched off. Draw the latest frame the moment it comes back (F9 flips mid-play), and
  // clear it on the way out, so a stale picture is never shown.
  if (displayMode === 'color' && !wasColour && lastVIPState) colorLayer.onState(lastVIPState);
  else if (displayMode !== 'color' && wasColour) colorCanvas?.getContext('2d')?.clearRect(0, 0, colorCanvas.width, colorCanvas.height);

  // UI active states
  btnMono?.classList.toggle('active', monoEnabled && !paletteEnabled);
  btnPalette?.classList.toggle('active', paletteEnabled);
  btnColor?.classList.toggle('active', colorEnabled && !paletteEnabled);

  // Palette-only UI visibility
  const palettePresetElNow = document.getElementById('palette-preset-wrap');
  if (palettePresetElNow) palettePresetElNow.style.display = paletteEnabled ? 'inline' : 'none';
  const paletteDebugEl = document.getElementById('palette-debug');
  if (paletteDebugEl) paletteDebugEl.style.display = paletteEnabled ? 'inline-flex' : 'none';

  // Hide/show mono underlay without stopping emulator rendering (keeps palette reads aligned).
  // Only the emulator's picture goes: #game also holds EmulatorJS's controls (pause, restart…),
  // and hiding the whole element left them clickable but invisible.
  if (gameEl) gameEl.classList.toggle('mono-hidden', paletteEnabled || !monoEnabled);

  if (colorCanvas) colorCanvas.style.display = (!paletteEnabled && colorEnabled) ? 'block' : 'none';
  if (paletteCanvas) paletteCanvas.style.display = paletteEnabled ? 'block' : 'none';
  updateColorDebugPanelVisibility();
  updatePixelInspectorUi();
  // Palette changes what Anaglyph can show (src/stereo-view.js).
  applyCoreViewMode();
  // Palette loop
  if (ENABLE_PALETTE && paletteLayerModule) {
    if (paletteEnabled) {
      paletteLayerModule.startPaletteLoop(
        paletteCanvas,
        () => paletteLayerModule.getEmulatorCanvas(),
        () => paletteLayerModule.PALETTE_PRESETS[palettePreset] || paletteLayerModule.PALETTE_PRESETS.original
      );
      startPaletteDebug();
    } else {
      paletteLayerModule.stopPaletteLoop();
      stopPaletteDebug();
    }
  }

  updateColorPackStatus();
  refreshPerfMetricsOverlay();
  window.dispatchEvent(new CustomEvent('vb-display-mode', { detail: { mode: paletteEnabled ? 'palette' : (colorEnabled ? 'color' : 'mono') } }));
}

let paletteDebugInterval = null;
function startPaletteDebug() {
  stopPaletteDebug();
  const statusEl = document.getElementById('palette-debug-status');
  if (!statusEl) return;
  const run = () => {
    const canvas = paletteLayerModule?.getEmulatorCanvas?.() ?? null;
    if (!canvas) {
      statusEl.textContent = 'Canvas: not found';
      return;
    }
    const ctx2d = canvas.getContext('2d');
    let read = '—';
    try {
      if (ctx2d) {
        ctx2d.getImageData(0, 0, 1, 1);
        read = 'ok (2d)';
      } else {
        const readback = document.createElement('canvas');
        readback.width = canvas.width;
        readback.height = canvas.height;
        readback.getContext('2d').drawImage(canvas, 0, 0);
        readback.getContext('2d').getImageData(0, 0, 1, 1);
        read = 'ok (WebGL→2d)';
      }
    } catch (e) {
      read = e?.message?.includes('tainted') ? 'tainted (cross-origin)' : (e?.message || 'error');
    }
    let status = `Canvas: ${canvas.width}×${canvas.height} | Read: ${read}`;
    if (USE_LOCAL_CORE && typeof window.__vbFrameCount === 'number') {
      status += ` | VIP: ${window.__vbFrameCount}`;
    }
    const vipExported = (typeof globalThis !== 'undefined' && globalThis.__VB_VIP_STATE_AVAILABLE__ === true)
      || (typeof window !== 'undefined' && window.__VB_VIP_STATE_AVAILABLE__ === true);
    const patchLevel = (typeof globalThis !== 'undefined' && globalThis.__VB_CORE_PATCH_LEVEL__)
      || (typeof window !== 'undefined' && window.__VB_CORE_PATCH_LEVEL__)
      || 0;
    const segCount = lastVIPState?.segments?.length ?? 0;
    const dlCount = lastVIPState?.drawList?.length ?? 0;
    status += ` | Core patch: ${patchLevel} | VIP push: ${vipExported ? 'yes' : 'no'} | Seg: ${segCount} | DL: ${dlCount}`;
    statusEl.textContent = status;
  };
  run();
  paletteDebugInterval = setInterval(run, 1500);
  if (isPaletteDebug()) {
    console.log('[Palette debug] Switched to Palette. Run again in 1.5s. Click "Log #game" to see DOM structure.');
    setTimeout(() => {
      const c = paletteLayerModule?.getEmulatorCanvas?.();
      console.log('[Palette debug] getEmulatorCanvas() =', c ? `${c.width}×${c.height} canvas` : null);
      if (c) {
        try {
          c.getContext('2d')?.getImageData(0, 0, 1, 1);
          console.log('[Palette debug] getImageData(1,1): OK');
        } catch (e) {
          console.warn('[Palette debug] getImageData failed:', e?.message);
        }
      }
    }, 500);
  }
}
function stopPaletteDebug() {
  if (paletteDebugInterval) {
    clearInterval(paletteDebugInterval);
    paletteDebugInterval = null;
  }
}

function logGameStructure() {
  const statusEl = document.getElementById('palette-debug-status');
  const game = document.getElementById('game');
  if (!game) {
    if (statusEl) statusEl.textContent = 'Logged: #game not found';
    console.log('[Palette debug] #game not found');
    return;
  }
  const lines = [];
  const tree = (el, depth = 0) => {
    const pad = '  '.repeat(depth);
    const tag = el.tagName?.toLowerCase() || '?';
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string') ? `.${el.className.split(/\s+/).join('.')}` : '';
    const size = el.tagName === 'CANVAS' ? ` ${el.width}×${el.height}` : '';
    const line = `${pad}<${tag}${id}${cls}${size}>`;
    lines.push(line);
    if (el.shadowRoot) {
      lines.push(`${pad}  #shadowRoot`);
      Array.from(el.shadowRoot.children).forEach((c) => tree(c, depth + 2));
    }
    Array.from(el.children).forEach((c) => tree(c, depth + 1));
  };
  tree(game);
  if (statusEl) statusEl.textContent = 'Logged! Open Console (F12)';
  console.log('[Palette debug] #game structure:');
  lines.forEach((l) => console.log(l));
  console.log('[Palette debug] All canvases:', document.querySelectorAll('canvas'));
}

const palettePresetEl = document.getElementById('palette-preset-wrap');
if (!ENABLE_PALETTE) {
  btnPalette?.remove();
  palettePresetEl?.remove();
}

btnMono?.addEventListener('click', () => {
  if (paletteEnabled) {
    paletteEnabled = false;
  }
  monoEnabled = !monoEnabled;
  syncDisplayState();
});

// F9 swaps Monochrome ⇄ Color, F10 turns Monochrome on/off (src/display-hotkeys.js): for
// before/after videos. Capture phase, like F8, so the emulator's own key handling never eats it.
document.addEventListener(
  'keydown',
  (e) => {
    const action = displayHotkeyAction(e);
    if (!action) return;
    e.preventDefault();
    const next = nextDisplayState({ mono: monoEnabled, color: colorEnabled, palette: paletteEnabled }, action);
    monoEnabled = next.mono;
    colorEnabled = next.color;
    paletteEnabled = next.palette;
    syncDisplayState();
    const noColour = next.color && !colorPackData && !(lastVbpackGroups?.length);
    flashColorPackStatus(
      noColour
        ? `${describeDisplay(next)} — no colour pack loaded, so Color has nothing to show yet.`
        : `${describeDisplay(next)} (${action === 'swap' ? `${SWAP_DISPLAY_KEY} swaps Monochrome ⇄ Color` : `${TOGGLE_MONO_KEY} turns Monochrome on/off`}).`,
    );
  },
  true,
);
btnPalette?.addEventListener('click', () => {
  // Palette is exclusive: it replaces both mono+color visuals
  paletteEnabled = !paletteEnabled;
  if (paletteEnabled) {
    monoEnabled = false;
    colorEnabled = false;
  } else {
    // Return to a sensible default after leaving palette
    monoEnabled = true;
    colorEnabled = false;
  }
  syncDisplayState();
});
btnColor?.addEventListener('click', () => {
  if (paletteEnabled) {
    paletteEnabled = false;
  }
  const wasColor = colorEnabled;
  colorEnabled = !colorEnabled;
  if (colorEnabled && !wasColor) monoEnabled = false;
  syncDisplayState();
});
const palettePresetSelect = document.getElementById('palette-preset');
if (palettePresetSelect) {
  palettePresetSelect.value = palettePreset;
  palettePresetSelect.addEventListener('change', (e) => {
    palettePreset = e.target.value;
    try {
      localStorage.setItem(PALETTE_PRESET_KEY, palettePreset);
    } catch (_) {}
  });
}
document.getElementById('palette-debug-diagnostics')?.addEventListener('click', () => {
  const statusEl = document.getElementById('palette-debug-status');
  if (statusEl) statusEl.textContent = 'Running diagnostics… (see console)';
  runPaletteDiagnostics({
    container: document.getElementById('game-container') || null,
    overlayCanvas: paletteCanvas || null,
  }).then((result) => {
    if (statusEl) {
      const failed = ['step0', 'step1a', 'step1b', 'step3'].filter((k) => result[k] === 'fail');
      statusEl.textContent = failed.length ? `Diagnostics: ${failed.join(', ')} FAIL` : 'Diagnostics: all pass (see console)';
    }
  });
});
document.getElementById('palette-debug-checksums')?.addEventListener('click', () => runPaletteFrameChecksumTest());
document.getElementById('palette-debug-log')?.addEventListener('click', logGameStructure);
if (typeof window !== 'undefined') window.runPaletteFrameChecksumTest = runPaletteFrameChecksumTest;

packInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    colorPackData = r.result;
    colorLayer.setPackFromBuffer(colorPackData);
    const parsed = colorPackData ? parseVBColorPack(colorPackData) : null;
    lastPackSummary = parsed ? { gameId: parsed.gameId, entryCount: parsed.entries.size } : null;
    updateColorPackStatus();
    window.dispatchEvent(new CustomEvent('vb-color-pack', { detail: { data: colorPackData } }));
  };
  r.readAsArrayBuffer(file);
});

const overridesInput = document.getElementById('overrides-input');
overridesInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      lastOverridesJson = Array.isArray(json) ? json : null;
      lastOverridesCount = colorLayer.setOverrides(json);
      updateColorPackStatus();
      refreshPerfMetricsOverlay();
    } catch (err) {
      reportProblem(`Could not read that overrides file: ${err?.message || err}`, err);
      lastOverridesCount = 0;
      lastOverridesJson = null;
      colorLayer.setOverrides([]);
      updateColorPackStatus();
      refreshPerfMetricsOverlay();
    }
  };
  reader.readAsText(file);
});

packFileInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    await loadVbpackFromUserFile(buffer, file.name || 'pack.vbpack');
  } catch (err) {
    reportProblem(`Could not open ${file.name || 'that pack'}: ${err?.message || err}`, err);
  }
  e.target.value = '';
});

/**
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 */
async function loadVbpackFromUserFile(buffer, fileName) {
  const result = await parseArtPack(buffer);
  hasTemporaryVbpack = false;
  temporaryVipStates = [];
  capturesSavedCount = 0;
  // File-input loads have no handle; the picker path sets one right after this returns.
  currentPackFileHandle = null;
  const fromFile = String(fileName || '')
    .replace(/\.vbpack$/i, '')
    .replace(/\.zip$/i, '')
    .trim();
  const fromRom =
    typeof result.manifest?.romFileName === 'string'
      ? result.manifest.romFileName.replace(/\.(vb|bin)$/i, '').trim()
      : '';
  const fromGameId =
    typeof result.manifest?.gameId === 'string' && result.manifest.gameId.trim() && result.manifest.gameId !== 'vb-pack'
      ? result.manifest.gameId.trim()
      : '';
  const displayName = fromFile || fromRom || fromGameId || 'pack';
  currentVbpackDisplayName = displayName;
  await saveLastVbpack(buffer, displayName).catch(() => {});
  setLastVbpackButton(displayName);
  applyVbpackResult(result);
}

/** Prefer File System Access open (starts in project home when set); fall back to hidden file input. */
async function openVbpackWithHomePreference() {
  if (isOpenFilePickerSupported()) {
    const picked = await pickOpenVbpackFile();
    if (picked.status === 'aborted') return;
    if (picked.status === 'ok') {
      try {
        await loadVbpackFromUserFile(picked.buffer, picked.name);
      } catch (err) {
        reportProblem(`Could not open ${picked.name || 'that pack'}: ${err?.message || err}`, err);
      }
      return;
    }
    if (picked.status === 'error') {
      console.warn('[Pack file] Open picker failed, using file input:', picked.error);
    }
  }
  packFileInput?.click();
}

const packPickerLabel = document.getElementById('pack-picker-label');
packPickerLabel?.addEventListener('click', (e) => {
  if (!confirmDropCaptures('Load pack')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // Intercept label → file-input; use FSA when available so startIn = project home works.
  if (!isOpenFilePickerSupported()) return;
  e.preventDefault();
  e.stopPropagation();
  void openVbpackWithHomePreference();
});

async function refreshProjectHomeUi() {
  const labelEl = document.getElementById('project-home-label');
  const clearBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-project-home-clear'));
  const chooseBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-project-home-choose'));
  const grantBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-project-home-grant'));
  const status = await getHomeStatus().catch(() => /** @type {const} */ ({ state: 'unset', name: '' }));
  if (chooseBtn) {
    chooseBtn.disabled = status.state === 'unsupported';
    chooseBtn.title =
      status.state === 'unsupported'
        ? 'Folder picker requires Chromium (File System Access API).'
        : 'Choose a folder for .vbpack open/save (persisted in this browser).';
  }
  if (labelEl) labelEl.textContent = formatHomeStatusLabel(status);
  // Chrome forgets folder permission when the tab closes; one click restores it.
  if (grantBtn) {
    grantBtn.hidden = status.state !== 'needs-permission';
    grantBtn.title = `Let this page use “${status.name}” again (browsers ask once per session).`;
  }
  if (clearBtn) clearBtn.disabled = status.state === 'unsupported' || status.state === 'unset';
}

document.getElementById('btn-project-home-grant')?.addEventListener('click', async () => {
  const ok = await requestHomeAccess();
  if (!ok) window.alert('Folder access was not granted. Load pack / Export will use the browser dialog instead.');
  await refreshProjectHomeUi();
});

document.getElementById('btn-project-home-choose')?.addEventListener('click', async () => {
  const result = await pickAndStoreHomeDirectory();
  if (result.status === 'ok') {
    await refreshProjectHomeUi();
    const name = result.handle.name || 'folder';
    console.info(`[Project home] Set to “${name}”. Load pack / Export will prefer this folder.`);
  } else if (result.status === 'unsupported') {
    window.alert('Choosing a project home folder needs a Chromium-based browser (File System Access API).');
  } else if (result.status === 'error') {
    console.warn('[Project home] Choose failed:', result.error);
  }
  await refreshProjectHomeUi();
});

document.getElementById('btn-project-home-clear')?.addEventListener('click', async () => {
  await clearHomeDirectoryHandle();
  await refreshProjectHomeUi();
});

void refreshProjectHomeUi();

/**
 * Reset pack/capture state for a fresh ROM, then boot it.
 * @param {string} name
 * @param {ArrayBuffer} buffer
 */
function startFreshRom(name, buffer) {
  currentVbpackDisplayName = null;
  lastPackPaintsTransparent = false;
  colorLayer.setDrawTransparentPaint?.(false);
  currentPackFileHandle = null;
  loadedVbpackFrames = [];
  temporaryVipStates = [];
  capturesSavedCount = 0;
  hasTemporaryVbpack = false;
  loadedPackRamdumpByStem = new Map();
  loadedPackScreenshotByStem = new Map();
  loadedPackSaveStateByStem = new Map();
  loadedManifestFrameRegistry = null;
  memoryRecorder.load(null, []);
  captureAutoStateCounter = 0;
  vbpackFramesList = [];
  updateFrameSavestateSelect();
  try {
    if (window.__vbSaveAndPlayStateUrl) {
      URL.revokeObjectURL(window.__vbSaveAndPlayStateUrl);
      window.__vbSaveAndPlayStateUrl = null;
    }
    window.EJS_loadStateURL = undefined;
  } catch (_) {}
  startWithRomData(name, buffer);
}

romInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => startFreshRom(file.name, /** @type {ArrayBuffer} */ (reader.result));
  reader.readAsArrayBuffer(file);
});

/** Prefer File System Access open (starts in project home); fall back to the hidden file input. */
async function openRomWithHomePreference() {
  const picked = await pickOpenFile({
    types: [{ description: 'Virtual Boy ROM', accept: { 'application/octet-stream': ['.vb', '.bin'] } }],
  });
  if (picked.status === 'aborted') return;
  if (picked.status === 'ok') {
    startFreshRom(picked.name, picked.buffer);
    return;
  }
  if (picked.status === 'error') console.warn('[ROM] Open picker failed, using file input:', picked.error);
  romInput?.click();
}

document.getElementById('rom-picker-label')?.addEventListener('click', (e) => {
  if (!confirmDropCaptures('Load ROM')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!isOpenFilePickerSupported()) return;
  e.preventDefault();
  e.stopPropagation();
  void openRomWithHomePreference();
});

lastVbpackBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!confirmDropCaptures('Last pack')) return;
  loadLastVbpack().then(async (stored) => {
    if (!stored?.buffer) {
      packFileInput?.click();
      return;
    }
    if (emulatorStarted) {
      sessionStorage.setItem(RELOAD_TO_LOAD_LAST_VBPACK, '1');
      leavingOnPurpose = true;
      location.reload();
      return;
    }
    try {
      const result = await parseArtPack(stored.buffer);
      hasTemporaryVbpack = false;
      temporaryVipStates = [];
      capturesSavedCount = 0;
      // Last pack comes from IndexedDB, so we don't know which file it came from.
      currentPackFileHandle = null;
      currentVbpackDisplayName = stored.name || (result.manifest?.gameId || result.manifest?.romFileName || 'pack');
      applyVbpackResult(result);
    } catch (err) {
      reportProblem(`Could not reopen the last pack: ${err?.message || err}`, err);
    }
  }).catch(() => packFileInput?.click());
});

document.getElementById('frame-savestate-select')?.addEventListener('change', (e) => {
  const i = parseInt(e.target.value, 10);
  if (!Number.isNaN(i)) applyFrameSavestate(i);
});

document.getElementById('btn-pack-coverage')?.addEventListener('click', () => reportPackCoverage());
document.getElementById('btn-color-layer-debug')?.addEventListener('click', () => reportColorLayerDebug());
document.getElementById('btn-duplicate-draws')?.addEventListener('click', () => reportDuplicateDraws());
document.getElementById('btn-pixel-inspector-toggle')?.addEventListener('click', () => {
  pixelInspectorEnabled = !pixelInspectorEnabled;
  updatePixelInspectorUi();
});
document.getElementById('btn-pixel-inspector-clear')?.addEventListener('click', () => {
  setPixelInspectorReport({ x: 0, y: 0, eye: 0, draws: [] });
});
document.getElementById('color-canvas')?.addEventListener('click', (e) => {
  if (!pixelInspectorEnabled) return;
  const p = eventToColorCanvasPixel(e);
  if (!p) return;
  applyPixelInspectorFromFramebufferCoords(p.xCanvas, p.yCanvas, p.canvas);
});
if (typeof window !== 'undefined') {
  window.reportColorLayerDebug = reportColorLayerDebug;
  window.reportPackCoverage = reportPackCoverage;
  window.reportDuplicateDraws = reportDuplicateDraws;
  window.reportPixelStack = reportPixelStack;
  window.getLastPixelInspectorReport = () => lastPixelInspectorReport;
  /** Full vbstate JSON (base64 binaries) for copy/paste or diff between pauses. Null if no frame yet. */
  window.vbSerializeLastVIPState = () => (lastVIPState ? JSON.stringify(serializeVIPState(lastVIPState)) : null);
  /** Compact draw rows for diffing: index, tileIndex, x, y, world, layer, eye. */
  window.vbGetDrawListSnapshot = () => {
    const dl = lastVIPState?.drawList;
    if (!Array.isArray(dl)) return [];
    return dl.map((d, i) => ({
      i,
      tileIndex: d.tileIndex,
      x: d.x,
      y: d.y,
      world: d.world,
      layer: d.layer,
      eye: d.eye ?? 0,
    }));
  };
}

function suggestExportVbpackBaseName() {
  if (currentRomFileName) {
    const stem = currentRomFileName.replace(/^.*[/\\]/, '').replace(/\.vbpack$/i, '').replace(/\.(vb|zip)$/i, '');
    if (stem) {
      const safe = stem.replace(/[^a-z0-9-_]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (safe) return safe;
    }
  }
  return (lastPackSummary?.gameId || 'vb-pack').replace(/[^a-z0-9-_]/gi, '-') || 'vb-pack';
}

document.getElementById('btn-export-pack')?.addEventListener('click', async () => {
  const romBuffer = currentRomBuffer ?? undefined;
  const merged = mergeAllCapturePartsForExport();
  const manifest = {
    version: 1,
    gameId: lastPackSummary?.gameId ?? 'vb-pack',
    name: lastPackSummary?.gameId ?? 'VB color pack',
    romFileName: currentRomFileName ?? undefined,
    updatedAt: new Date().toISOString(),
    ...(merged.frameRegistry.length > 0 && { frameRegistry: merged.frameRegistry }),
    ...(loadedManifestMemoryAnalysis != null && { memoryAnalysis: loadedManifestMemoryAnalysis }),
    ...(loadedManifestArchivedCoverage && { archivedCoverage: loadedManifestArchivedCoverage }),
    ...(lastPackPaintsTransparent && { paintOnTransparent: PAINT_ON_TRANSPARENT_VERSION }),
    ...memoryRecorder.manifestFields(),
  };
  const vipStateJson = lastVIPState
    ? JSON.stringify(serializeVIPState(lastVIPState))
    : undefined;
  let saveStateBlob = undefined;
  try {
    const emu = typeof window !== 'undefined' && window.EJS_emulator;
    if (emu?.gameManager?.getState) saveStateBlob = emu.gameManager.getState();
  } catch (_) {}
  const vipStatesFolder = merged.vipStatesFolder.length > 0 ? merged.vipStatesFolder : undefined;
  const blob = await buildArtPack({
    rom: romBuffer,
    vbcolor: colorPackData || undefined,
    overrides: lastOverridesJson ?? undefined,
    groups: lastVbpackGroups?.length ? lastVbpackGroups : undefined,
    overridePresets: lastVbpackOverridePresets?.length ? lastVbpackOverridePresets : undefined,
    ...(lastVbpackGameStates?.length ? { gameStates: lastVbpackGameStates } : {}),
    ...(memoryRecorder.folder().length ? { memoryRecordingsFolder: memoryRecorder.folder() } : {}),
    ...(lastVbpackGameStatePools?.length
      ? {
          gameStatePools: lastVbpackGameStatePools,
          groupsSchemaVersion: typeof lastVbpackGroupsSchemaVersion === 'number' ? lastVbpackGroupsSchemaVersion : 2,
        }
      : {}),
    manifest,
    vipState: vipStateJson,
    vipStatesFolder,
    saveState: saveStateBlob,
    ramdumpsFolder: merged.ramdumpsFolder.length > 0 ? merged.ramdumpsFolder : undefined,
    screenshotsFolder: merged.screenshotsFolder.length > 0 ? merged.screenshotsFolder : undefined,
    saveStatesFolder: merged.saveStatesFolder.length > 0 ? merged.saveStatesFolder : undefined,
    ...(lastPainterV2Rules != null && { painterV2Rules: lastPainterV2Rules }),
    ...(lastPainterV2VipOverlays != null && { painterV2VipOverlays: lastPainterV2VipOverlays }),
  });
  const defaultBase = suggestExportVbpackBaseName();
  const defaultName = normalizeVbpackFileName(`${defaultBase}.vbpack`);
  // One save dialog (starting in project home) — you name the file there, so no separate prompt.
  const picked = await pickSaveVbpackFile(defaultName);
  if (picked.status === 'ok') {
    try {
      await writeBlobToFileHandle(picked.handle, blob);
      currentPackFileHandle = picked.handle;
      currentVbpackDisplayName = (picked.handle.name || defaultName).replace(/\.vbpack$/i, '');
      capturesSavedCount = temporaryVipStates.length;
      updateColorPackStatus();
      flashColorPackStatus(`Exported ${picked.handle.name || defaultName}.`);
      return;
    } catch (err) {
      console.warn('[Export .vbpack] Write to picked file failed, falling back to download:', err);
    }
  } else if (picked.status === 'aborted') {
    return;
  } else if (picked.status === 'error') {
    console.warn('[Export .vbpack] Save picker failed, falling back to download:', picked.error);
  }
  // No File System Access (or it failed): ask for a name, then download.
  const entered =
    typeof window !== 'undefined' && window.prompt
      ? window.prompt('Save .vbpack as (name without .vbpack extension):', defaultBase)
      : defaultBase;
  if (entered === null) return;
  const trimmed = String(entered).trim().replace(/\.vbpack$/i, '');
  const baseName = (trimmed || defaultBase).replace(/[^a-z0-9-_]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'vb-pack';
  downloadBlob(blob, normalizeVbpackFileName(`${baseName}.vbpack`));
  capturesSavedCount = temporaryVipStates.length;
  updateColorPackStatus();
});

const HANDOFF_KEY_COLORIZE = 'colorize-current';
/** File System Access handle for the pack's file on disk, so the painter can save back to it. */
const HANDOFF_KEY_COLORIZE_FILE_HANDLE = 'colorize-pack-file-handle';
document.getElementById('btn-colorize')?.addEventListener('click', async () => {
  const hasCurrentFrame = lastVIPState?.drawList?.length;
  const hasCapturedFrames = temporaryVipStates.length > 0;
  if (!hasCurrentFrame && !hasCapturedFrames) {
    alert('No frame to send. Use a patched core that exports VIP state (calls __VB_PUSH_VIP_STATE__), let a frame run, then click Colorize!. Or use Capture Frame first.');
    return;
  }
  try {
    // Capture save state while the core is still running (same as Capture Frame).
    // Pausing first can yield an empty/invalid state from EmulatorJSGetState.
    let saveStateBlob = undefined;
    try {
      const emu = typeof window !== 'undefined' && window.EJS_emulator;
      if (emu?.gameManager?.getState) {
        saveStateBlob = copyBinaryToArrayBuffer(emu.gameManager.getState()) ?? undefined;
      }
    } catch (e) {
      console.warn('[Colorize] getState() failed before pause:', e);
    }
    if (saveStateBlob) {
      const stInfo = describeSaveStateBuffer(saveStateBlob);
      console.info('[Colorize] Captured save state:', stInfo);
      if (!stInfo.ok) {
        const cont = confirm(
          `Captured save state looks invalid (${stInfo.reason || 'bad format'}, ${stInfo.bytes || 0}B). ` +
            'Save and Play may not resume this frame (often needs the RetroArch GetState heap-copy patch). Continue to Painter anyway?',
        );
        if (!cont) return;
      }
    }

    // Pause if supported (best-effort). Use setEmulatorPaused — pause(false) does NOT unpause.
    setEmulatorPaused(true);

    const romBuffer = copyBinaryToArrayBuffer(currentRomBuffer) ?? undefined;
    if (!romBuffer) {
      alert('Colorize! needs the current ROM in memory. Load a ROM or .vbpack first, then try again.');
      return;
    }
    if (!saveStateBlob) {
      const cont = confirm(
        'Could not capture an emulator save state. Painter will open, but Save and Play may not resume at this frame. Continue anyway?',
      );
      if (!cont) return;
    }

    const packNameForHandoff = pickPackDisplayName(
      currentVbpackDisplayName,
      currentRomFileName,
      lastPackSummary?.gameId,
      lastPackSummary?.name,
    );
    const gameIdForManifest = pickPackDisplayName(
      lastPackSummary?.gameId,
      lastPackSummary?.name,
      packNameForHandoff,
    );

    const merged = mergeAllCapturePartsForExport();
    const manifest = {
      version: 1,
      gameId: gameIdForManifest,
      name: gameIdForManifest,
      romFileName: currentRomFileName ?? undefined,
      updatedAt: new Date().toISOString(),
      ...(merged.frameRegistry.length > 0 && { frameRegistry: merged.frameRegistry }),
      ...(loadedManifestMemoryAnalysis != null && { memoryAnalysis: loadedManifestMemoryAnalysis }),
      ...(loadedManifestArchivedCoverage && { archivedCoverage: loadedManifestArchivedCoverage }),
      ...(lastPackPaintsTransparent && { paintOnTransparent: PAINT_ON_TRANSPARENT_VERSION }),
      ...memoryRecorder.manifestFields(),
    };
    let vipStateJson = undefined;
    if (lastVIPState?.drawList?.length) {
      vipStateJson = JSON.stringify(serializeVIPState(lastVIPState));
    } else if (temporaryVipStates.length > 0) {
      vipStateJson = temporaryVipStates[temporaryVipStates.length - 1].json;
    }

    const vipStatesFolder = merged.vipStatesFolder.length > 0 ? merged.vipStatesFolder : undefined;
    const blob = await buildArtPack({
      rom: romBuffer,
      vbcolor: colorPackData || undefined,
      overrides: lastOverridesJson ?? undefined,
      groups: lastVbpackGroups?.length ? lastVbpackGroups : undefined,
      overridePresets: lastVbpackOverridePresets?.length ? lastVbpackOverridePresets : undefined,
      ...(lastVbpackGameStates?.length ? { gameStates: lastVbpackGameStates } : {}),
      ...(memoryRecorder.folder().length ? { memoryRecordingsFolder: memoryRecorder.folder() } : {}),
      ...(lastVbpackGameStatePools?.length
        ? {
            gameStatePools: lastVbpackGameStatePools,
            groupsSchemaVersion: typeof lastVbpackGroupsSchemaVersion === 'number' ? lastVbpackGroupsSchemaVersion : 2,
          }
        : {}),
      manifest,
      vipState: vipStateJson,
      vipStatesFolder,
      saveState: saveStateBlob,
      ramdumpsFolder: merged.ramdumpsFolder.length > 0 ? merged.ramdumpsFolder : undefined,
      screenshotsFolder: merged.screenshotsFolder.length > 0 ? merged.screenshotsFolder : undefined,
      saveStatesFolder: merged.saveStatesFolder.length > 0 ? merged.saveStatesFolder : undefined,
      ...(lastPainterV2Rules != null && { painterV2Rules: lastPainterV2Rules }),
      ...(lastPainterV2VipOverlays != null && { painterV2VipOverlays: lastPainterV2VipOverlays }),
    });
    const buffer = await blob.arrayBuffer();
    await putHandoff(HANDOFF_KEY_COLORIZE, buffer);
    const HANDOFF_KEY_COLORIZE_PACK_NAME = 'colorize-pack-name';
    await putHandoff(HANDOFF_KEY_COLORIZE_PACK_NAME, packNameForHandoff);
    if (currentPackFileHandle) await putHandoff(HANDOFF_KEY_COLORIZE_FILE_HANDLE, currentPackFileHandle).catch(() => {});
    else await deleteHandoff(HANDOFF_KEY_COLORIZE_FILE_HANDLE).catch(() => {});
    // Delay so IndexedDB commit is visible to the painter when it loads.
    await new Promise((r) => setTimeout(r, 400));
    // Verify the write is readable before navigating (same origin).
    const verify = await getHandoff(HANDOFF_KEY_COLORIZE);
    if (!verify || verify.byteLength === 0) {
      console.warn('[Colorize] Handoff verify read failed; painter may not see the pack.');
      alert('Failed to store the Colorize! handoff pack. Try again.');
      return;
    }
    // The captures are in the handoff now: the Project tool has them.
    capturesSavedCount = temporaryVipStates.length;
    leavingOnPurpose = true;
    location.href = '/tools/project.html?from=emulator';
  } catch (err) {
    console.warn('[Colorize] Failed to open painter:', err);
    alert(`Failed to open painter: ${err?.message || String(err)}`);
  }
});

const HANDOFF_KEY_SAVE_AND_PLAY = 'save-and-play';
const HANDOFF_KEY_SAVE_AND_PLAY_NAME = 'save-and-play-pack-name';
/** Painter hands the pack's file back so a second Colorize! still knows where the pack lives. */
const HANDOFF_KEY_SAVE_AND_PLAY_FILE_HANDLE = 'save-and-play-pack-file-handle';

/** Prefer human pack/ROM names; skip placeholder ids like "vb-pack". */
function pickPackDisplayName(...candidates) {
  const cleaned = candidates
    .map((c) => {
      if (c == null) return '';
      return String(c)
        .trim()
        .replace(/ \(editing\)$/i, '')
        .replace(/\.vbpack$/i, '')
        .replace(/\.zip$/i, '')
        .replace(/\.(vb|bin)$/i, '')
        .trim();
    })
    .filter(Boolean);
  for (const name of cleaned) {
    if (/^(vb-pack|pack|none|untitled|from colorize)$/i.test(name)) continue;
    return name;
  }
  return cleaned[0] || 'untitled-pack';
}

/**
 * EmulatorJS getState() should return RASTATE1 (or raw MDFNSVST). Garbage from the
 * unpatched GetState free-before-copy bug will fail this check.
 * @param {ArrayBuffer|Uint8Array|null|undefined} data
 */
function describeSaveStateBuffer(data) {
  if (data == null) return { ok: false, reason: 'missing' };
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.byteLength < 16) return { ok: false, reason: 'too short', bytes: u8.byteLength };
  const head7 = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5], u8[6]);
  const head8 = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5], u8[6], u8[7]);
  if (head7 === 'RASTATE') {
    const wram = tryExtractWramFromMednafenSavestate(u8);
    return { ok: true, kind: 'RASTATE', bytes: u8.byteLength, hasWram: !!wram };
  }
  if (head8 === 'MDFNSVST') {
    return { ok: true, kind: 'MDFNSVST', bytes: u8.byteLength, hasWram: !!tryExtractWramFromMednafenSavestate(u8) };
  }
  return {
    ok: false,
    reason: `unexpected magic "${head8.replace(/[^\x20-\x7e]/g, '.')}"`,
    bytes: u8.byteLength,
  };
}

function finishSaveAndPlayUi(ok, opts) {
  try {
    // Keep mono underlay visible under the color layer (unlike the Color button).
    monoEnabled = true;
    if (opts?.hadVbcolor) colorEnabled = true;
    syncDisplayState();
  } catch (_) {}
  if (lastVIPState && isRenderableVIPState(lastVIPState)) {
    try {
      colorLayer.onState(lastVIPState);
    } catch (_) {}
  }
  enableVipToolbarButtons();
  flashColorPackStatus(
    ok ? 'Restored from Save and Play.' : 'Save and Play pack loaded, but the save state could not be restored.',
  );
}

/**
 * Restore Colorize! save state after Save and Play.
 * Loads via gameManager.loadState AFTER emu.started (main loop running).
 * Do not use pause(false) — only play() unpauses (see setEmulatorPaused).
 * @param {Uint8Array} saveStateBytes
 * @param {{ hadVbcolor: boolean }} opts
 */
function restoreSaveAndPlayState(saveStateBytes, opts) {
  const bytes = new Uint8Array(saveStateBytes);
  const info = describeSaveStateBuffer(bytes);
  console.info('[Save and Play] Save state check:', info);
  if (!info.ok) {
    console.warn(
      '[Save and Play] Save state does not look like RetroArch RASTATE/MDFNSVST. ' +
        'Colorize! may have captured a bad getState() (need GetState heap-copy patch).',
    );
  }
  if (bytes.byteLength === 0) {
    finishSaveAndPlayUi(false, opts);
    return;
  }

  // Prefer direct loadState with our bytes. EmulatorJS EJS_loadStateURL was passing an
  // EJS_CacheItem into `new Uint8Array(res.data)` → 0-byte game.state (patched in emulator.js,
  // but we still own the buffer here so restore does not depend on that download path).
  try {
    window.EJS_loadStateURL = undefined;
  } catch (_) {}

  const startedAt = Date.now();
  let finished = false;

  const doLoad = () => {
    if (finished) return;
    const emu = typeof window !== 'undefined' && window.EJS_emulator;
    if (!emu?.started || !emu?.gameManager?.loadState) {
      if (Date.now() - startedAt > 25000) {
        console.warn('[Save and Play] Timed out waiting for emulator start.');
        finishSaveAndPlayUi(false, opts);
        return;
      }
      setTimeout(doLoad, 50);
      return;
    }
    finished = true;
    // EmulatorJS built-in waits ~10ms after start; give the core a beat, keep loop running.
    setTimeout(() => {
      try {
        userPaused = false;
        setEmulatorPaused(false); // play()
        const ok = emu.gameManager.loadState(bytes) !== false;
        stateHistory.clear();
        console.info(
          `[Save and Play] loadState(${bytes.byteLength}B) returned`,
          ok,
          info.ok ? `(${info.kind})` : `(invalid magic)`,
        );
        finishSaveAndPlayUi(ok, opts);
        try {
          emu.elements?.parent?.focus({ preventScroll: true });
        } catch (_) {}
        console.info('[Save and Play] Restore finished (playing).');
      } catch (err) {
        reportProblem('Could not resume at your frame — the game starts from the beginning.', err);
        finishSaveAndPlayUi(false, opts);
      }
    }, 50);
  };
  doLoad();
}

async function maybeApplySaveAndPlayHandoff() {
  try {
    const params = new URLSearchParams(location.search);
    if (!params.has('from')) return;
    if (params.get('from') !== 'painter') return;

    const buffer = await getHandoff(HANDOFF_KEY_SAVE_AND_PLAY);
    if (!buffer) {
      console.warn('[Save and Play] No handoff buffer (key save-and-play).');
      alert('Save and Play: no pack was found in handoff storage. Try Colorize! → Save and Play again from the same browser tab.');
      history.replaceState({}, '', location.pathname);
      return;
    }
    await deleteHandoff(HANDOFF_KEY_SAVE_AND_PLAY).catch(() => {});

    const result = await parseArtPack(buffer);
    const handoffNameRaw = await getHandoff(HANDOFF_KEY_SAVE_AND_PLAY_NAME).catch(() => null);
    await deleteHandoff(HANDOFF_KEY_SAVE_AND_PLAY_NAME).catch(() => {});
    const manifest = result.manifest || {};
    const displayName = pickPackDisplayName(
      typeof handoffNameRaw === 'string' ? handoffNameRaw : '',
      manifest.romFileName,
      manifest.name,
      manifest.gameId,
    );
    const romBytes = result.rom?.byteLength ?? 0;
    const saveBytes = result.saveState?.byteLength ?? 0;
    console.info(`[Save and Play] Pack “${displayName}”: rom=${romBytes}B, saveState=${saveBytes}B`);

    if (romBytes <= 0) {
      alert(
        'Save and Play pack is missing the ROM, so the emulator cannot start. ' +
          'Use Colorize! again (with a ROM already loaded), then Save and Play.',
      );
      history.replaceState({}, '', location.pathname);
      return;
    }

    hasTemporaryVbpack = false;
    temporaryVipStates = [];
    capturesSavedCount = 0;
    currentVbpackDisplayName = displayName;
    const returnedHandle = await getHandoff(HANDOFF_KEY_SAVE_AND_PLAY_FILE_HANDLE).catch(() => null);
    await deleteHandoff(HANDOFF_KEY_SAVE_AND_PLAY_FILE_HANDLE).catch(() => {});
    currentPackFileHandle =
      returnedHandle && typeof (/** @type {any} */ (returnedHandle).createWritable) === 'function'
        ? /** @type {FileSystemFileHandle} */ (returnedHandle)
        : null;
    await saveLastVbpack(buffer, displayName).catch(() => {});
    setLastVbpackButton(displayName);

    const saveStateBytes = saveBytes > 0 ? new Uint8Array(result.saveState) : null;
    const hadVbcolor = !!(result.vbcolor && result.vbcolor.byteLength > 0);

    applyVbpackResult(result, { switchToColor: false });
    if (hadVbcolor) {
      colorEnabled = true;
      monoEnabled = true;
      syncDisplayState();
    }
    // Show pack VIP immediately (before / while save state restore runs).
    if (lastVIPState && isRenderableVIPState(lastVIPState)) {
      try {
        colorLayer.onState(lastVIPState);
      } catch (_) {}
      enableVipToolbarButtons();
    }
    hideSplash();

    if (!saveStateBytes) {
      reportProblem('This pack has no save state, so the game starts from the beginning instead of your frame.');
    } else {
      // After startEmulator (from applyVbpackResult): wait for started, then loadState.
      restoreSaveAndPlayState(saveStateBytes, { hadVbcolor });
    }

    history.replaceState({}, '', location.pathname);
  } catch (err) {
    console.warn('[Save and Play] Handoff failed:', err);
    alert(`Save and Play failed: ${err?.message || String(err)}`);
    try {
      window.EJS_loadStateURL = undefined;
    } catch (_) {}
  }
}

let quickCaptureInFlight = false;
const STATUS_FLASH_MS = 3000;

/** Problems stay up longer than confirmations, so they can be read. */
const STATUS_PROBLEM_MS = 9000;

function flashColorPackStatus(message, ms = STATUS_FLASH_MS) {
  colorPackStatusFlash = { message, until: Date.now() + ms };
  updateColorPackStatus();
  setTimeout(updateColorPackStatus, ms);
}

/** A failure the user needs to know about: on screen, and in the console with its detail. */
function reportProblem(message, detail) {
  console.warn(`[Problem] ${message}`, detail ?? '');
  flashColorPackStatus(message, STATUS_PROBLEM_MS);
}

document.addEventListener(
  'keydown',
  async (e) => {
    if (!isQuickCaptureHotkey(e)) return;
    e.preventDefault();
    if (quickCaptureInFlight || document.querySelector('dialog[open]')) return;
    if (!lastVIPState?.drawList?.length) {
      flashColorPackStatus(`${QUICK_CAPTURE_KEY}: no frame data to capture (needs the patched core).`);
      return;
    }
    quickCaptureInFlight = true;
    try {
      const captured = await captureFrameIntoPack({ promptForLabels: false });
      reportCapture(`Captured “${captured.stateName}” (${QUICK_CAPTURE_KEY}).`, captured.gaps);
    } finally {
      quickCaptureInFlight = false;
    }
  },
  true,
);

document.getElementById('btn-dump-vip')?.addEventListener('click', async () => {
  if (!lastVIPState?.drawList?.length) {
    alert('No frame captured. Use a patched core that exports VIP state (frame data), then try again.');
    return;
  }
  const captured = await captureFrameIntoPack({ promptForLabels: true });
  reportCapture(`Captured “${captured.stateName}”.`, captured.gaps);
});

/** Say a capture landed, and loudly what it is missing if anything. */
function reportCapture(message, gaps) {
  if (gaps) reportProblem(`${message} ${gaps}`);
  else flashColorPackStatus(message);
}

/**
 * Add the current frame (VIP state, save state, WRAM, screenshot) to the in-memory pack.
 * @param {{ promptForLabels: boolean }} options
 * @returns {Promise<{ frameId: string, stateName: string }>}
 */
/** Save state snapshot of the running core, or null. */
function snapshotSaveState() {
  try {
    const emu = typeof window !== 'undefined' && window.EJS_emulator;
    if (emu?.gameManager?.getState) {
      const raw = emu.gameManager.getState();
      if (raw instanceof ArrayBuffer) return raw.slice(0);
      if (ArrayBuffer.isView(raw)) {
        const v = /** @type {ArrayBufferView} */ (raw);
        return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
      }
    }
  } catch (e) {
    console.warn('[Capture Frame] getState() failed:', e);
  }
  return null;
}

/**
 * @param {{
 *   promptForLabels?: boolean,
 *   labels?: { stateName: string, subStateName: string, note: string },
 *   vipState?: any,
 *   saveStateBuffer?: ArrayBuffer | null,
 * }} opts `labels`, `vipState` and `saveStateBuffer` let auto-capture record the
 *   exact frame that stopped it, labelled by a dialog it has already shown.
 */
async function captureFrameIntoPack({ promptForLabels, labels: givenLabels, vipState, saveStateBuffer: givenSaveState }) {
  /** Snapshot save state while the main loop is running (before dialog pause). */
  const saveStateBuffer = givenSaveState !== undefined ? givenSaveState : snapshotSaveState();

  const labels = givenLabels
    ? givenLabels
    : promptForLabels
      ? await showCaptureFrameDialog()
      : { stateName: allocDefaultStateName(), subStateName: '', note: `Quick capture (${QUICK_CAPTURE_KEY})` };
  const frameId = generateFrameId();
  const capturedState = vipState || lastVIPState;
  const json = JSON.stringify(serializeVIPState(capturedState));

  let wramBuffer = tryCopyVBSystemRamFromEmulator();
  let wramSource = wramBuffer && wramBuffer.byteLength >= 0x10000 ? 'core' : null;
  if (!wramBuffer || wramBuffer.byteLength < 0x10000) {
    wramBuffer = null;
  }
  if (!wramBuffer && saveStateBuffer && saveStateBuffer.byteLength) {
    const stU8 = new Uint8Array(saveStateBuffer);
    const extracted = tryExtractWramFromMednafenSavestate(stU8);
    if (extracted && extracted.byteLength >= 0x10000) {
      wramBuffer = extracted;
      wramSource = 'savestate';
    }
  }
  const screenshotBlob = await captureEmulatorScreenshotPngBlob();
  const gaps = captureGapsNote({ wram: !!wramBuffer, screenshot: !!screenshotBlob });

  let wramAb = null;
  if (wramBuffer && wramBuffer.byteLength >= 0x10000) {
    wramAb = new ArrayBuffer(0x10000);
    new Uint8Array(wramAb).set(wramBuffer.subarray(0, 0x10000));
  }

  let saveStateForPack = saveStateBuffer;
  if (saveStateForPack && !(saveStateForPack instanceof ArrayBuffer)) {
    try {
      const u =
        saveStateForPack instanceof Uint8Array
          ? saveStateForPack
          : new Uint8Array(saveStateForPack);
      saveStateForPack = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
    } catch (_) {
      saveStateForPack = saveStateBuffer;
    }
  }

  temporaryVipStates.push({
    frameId,
    stateName: labels.stateName,
    subStateName: labels.subStateName,
    note: labels.note,
    name: `${frameId}.json`,
    json,
    wramBuffer: wramAb,
    wramSource: wramSource || undefined,
    screenshotBlob,
    saveStateBuffer: saveStateForPack,
  });
  hasTemporaryVbpack = true;
  rebuildVbpackFramesListAfterCapture();
  updateColorPackStatus();
  // Any capture — manual, F8 or auto — counts toward what auto-capture has seen.
  if (autoCaptureCoverage && capturedState) addStateToCoverage(autoCaptureCoverage, capturedState, AUTO_CAPTURE_EYE);
  return { frameId, stateName: labels.stateName, gaps };
}

/* ------------------------------------------------------------ screen size */

const SCREEN_SIZE_KEY = 'vb.screenSize';

/**
 * Screen: Fill (the default) makes the game as large as the window allows; 1:1 is the original
 * 640-pixel-wide box. The emulator and the colour layer both scale to fit the box, so they stay
 * lined up at either size.
 * @param {'fill'|'normal'} mode
 */
function applyScreenSize(mode) {
  const fill = mode !== 'normal';
  document.getElementById('game-container')?.classList.toggle('fill', fill);
  const btn = document.getElementById('btn-screen-size');
  if (btn) {
    btn.textContent = fill ? 'Screen: Fill' : 'Screen: 1:1';
    btn.setAttribute('aria-pressed', fill ? 'true' : 'false');
  }
  try {
    localStorage.setItem(SCREEN_SIZE_KEY, fill ? 'fill' : 'normal');
  } catch (_) {
    /* remembered for this page only */
  }
  // The emulator sizes its canvas on window resize.
  window.dispatchEvent(new Event('resize'));
}

(() => {
  let saved = 'fill';
  try {
    saved = localStorage.getItem(SCREEN_SIZE_KEY) || 'fill';
  } catch (_) {
    /* private mode: the default */
  }
  applyScreenSize(saved === 'normal' ? 'normal' : 'fill');
  document.getElementById('btn-screen-size')?.addEventListener('click', () => {
    applyScreenSize(document.getElementById('game-container')?.classList.contains('fill') ? 'normal' : 'fill');
  });
})();

/* ------------------------------------------------------------ pause & step */

/** A save state after each of the last few seconds of frames, for stepping back (src/frame-step.js). */
const stateHistory = new StateHistory(HISTORY_FRAMES);
// For the browser tests: how far back stepping can reach, and what it holds.
if (typeof window !== 'undefined') window.__vbStepHistory = stateHistory;
/** The user paused (P or Pause): a dialog closing must not set the game running again. */
let userPaused = false;
/** The frame count at which the core stops again: a step in progress. */
let stepStopAt = Infinity;
let stepBusy = false;
let historyRecordQueued = false;

function emulatorGameManager() {
  const emu = typeof window !== 'undefined' && window.EJS_emulator;
  return emu?.gameManager || null;
}

/**
 * Called by the core once per frame, mid-frame. Ends a step, and queues the frame's save state
 * for the history: taken once the frame has finished (a microtask runs after the core's frame
 * returns and before the next one), never from inside it.
 */
function onCoreFrame() {
  const gm = emulatorGameManager();
  if (window.__vbFrameCount >= stepStopAt) {
    stepStopAt = Infinity;
    gm?.toggleMainLoop(0);
  } else if (userPaused && stepStopAt === Infinity && !stepBusy) {
    // Something else set the game running (the emulator's own play button): not paused any more.
    userPaused = false;
    queueMicrotask(renderStepStatus);
  }
  if (historyRecordQueued || !gm?.getState) return;
  historyRecordQueued = true;
  queueMicrotask(() => {
    historyRecordQueued = false;
    try {
      const raw = gm.getState();
      if (raw) stateHistory.push(raw);
    } catch (_) {
      /* no state this frame: stepping back just reaches less far */
    }
  });
}

function renderStepStatus() {
  const btn = document.getElementById('btn-pause');
  const out = document.getElementById('step-status');
  if (btn) {
    btn.textContent = userPaused ? 'Resume' : 'Pause';
    btn.classList.toggle('active', userPaused);
    btn.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
  }
  if (!out) return;
  out.hidden = !userPaused;
  if (userPaused) {
    const back = stateHistory.canStepBack;
    out.textContent = `Paused · frame ${stateHistory.frame} · ${back} frame${back === 1 ? '' : 's'} back · F8 captures this frame`;
  }
}

function pauseGame() {
  if (userPaused) return;
  userPaused = true;
  setEmulatorPaused(true);
  renderStepStatus();
}

function resumeGame() {
  if (!userPaused) return;
  userPaused = false;
  stepStopAt = Infinity;
  setEmulatorPaused(false);
  renderStepStatus();
}

/** Run the core `frames` frames and stop. Pauses first if the game is running. */
async function stepForward(frames = 1) {
  const gm = emulatorGameManager();
  if (!gm?.toggleMainLoop || stepBusy) return;
  pauseGame();
  stepBusy = true;
  try {
    stepStopAt = (window.__vbFrameCount || 0) + Math.max(1, frames);
    gm.toggleMainLoop(1);
    const startedAt = performance.now();
    while (stepStopAt !== Infinity && performance.now() - startedAt < 3000) await new Promise((r) => setTimeout(r, 4));
    if (stepStopAt !== Infinity) {
      stepStopAt = Infinity;
      gm.toggleMainLoop(0);
    }
    // Let the last frame's history entry land before the readout counts it.
    await Promise.resolve();
  } finally {
    stepBusy = false;
    renderStepStatus();
  }
}

/** Show the frame `frames` frames back: restore the state before it and run one frame. */
async function stepBackward(frames = 1) {
  const gm = emulatorGameManager();
  if (!gm?.loadState || stepBusy) return;
  pauseGame();
  const back = stateHistory.stepBack(frames);
  if (!back) {
    flashColorPackStatus('No earlier frames kept to step back to — the emulator keeps the last 3 seconds while it runs.');
    return;
  }
  try {
    gm.loadState(back.state);
  } catch (err) {
    stateHistory.clear();
    reportProblem('Could not step back: restoring the earlier frame failed.', err);
    return;
  }
  // Run the replay frames: the last one puts the target frame on screen (see REPLAY_FRAMES).
  await stepForward(back.replay);
}

document.getElementById('btn-pause')?.addEventListener('click', () => (userPaused ? resumeGame() : pauseGame()));
document.getElementById('btn-step-forward')?.addEventListener('click', (e) => stepForward(e.shiftKey ? BIG_STEP : 1));
document.getElementById('btn-step-back')?.addEventListener('click', (e) => stepBackward(e.shiftKey ? BIG_STEP : 1));
document.addEventListener(
  'keydown',
  (e) => {
    if (!emulatorStarted) return;
    const hit = frameStepAction(e);
    if (!hit) return;
    // Capture phase, so the game does not also get the key.
    e.preventDefault();
    e.stopPropagation();
    if (hit.action === 'pause') {
      if (userPaused) resumeGame();
      else pauseGame();
    } else if (hit.action === 'forward') stepForward(hit.frames);
    else stepBackward(hit.frames);
  },
  true,
);

/* ------------------------------------------------------------ auto-capture */

let autoCaptureOn = false;
/** True while a stop is being handled, so later frames do not stack more dialogs. */
let autoCaptureBusy = false;
/** Tile patterns some captured frame already shows (left eye), per kind. */
let autoCaptureCoverage = /** @type {import('./auto-capture.js').Coverage|null} */ (null);
/**
 * Tiles on frames you stopped auto-capture at, as `kind:hash`. Kept for the session so turning
 * the mode back on does not immediately stop on the frame you just declined.
 */
const autoCaptureDismissed = /** @type {Set<string>} */ (new Set());
const AUTO_CAPTURE_KINDS_KEY = 'vb-auto-capture-kinds';
/** What auto-capture watches for: background, sprite and/or scaled (affine) tiles. */
let autoCaptureKinds = loadAutoCaptureKinds();
const AUTO_CAPTURE_GAPS_KEY = 'vb-auto-capture-gaps';
/** Also stop where paint doesn't cover the frame yet (src/paint-gaps.js). */
let autoCaptureGaps = loadAutoCaptureGaps();
/** Paint gaps already stopped on, as paintGapKey — each stops the game once a session. */
const autoCaptureGapsSeen = /** @type {Set<string>} */ (new Set());
/** Checking for gaps composites the frame again; every few frames is plenty. */
const AUTO_CAPTURE_GAPS_EVERY = 5;
/** The colour pack parsed once per load, for the gap check. */
let autoCaptureGapsPack = /** @type {{ data: unknown, entries: Map<number, Uint8Array> } | null} */ (null);

function loadAutoCaptureGaps() {
  try {
    return localStorage.getItem(AUTO_CAPTURE_GAPS_KEY) === '1';
  } catch (_) {
    return false;
  }
}

/** What colours the frame, as the gap check needs it; null when nothing is painted yet. */
function paintForGaps() {
  const groups = Array.isArray(lastVbpackGroups) ? lastVbpackGroups : [];
  if (!colorPackData && !groups.length) return null;
  if (autoCaptureGapsPack?.data !== colorPackData) {
    autoCaptureGapsPack = { data: colorPackData, entries: colorPackData ? parseVBColorPack(colorPackData)?.entries ?? new Map() : new Map() };
  }
  return {
    pack: autoCaptureGapsPack.entries,
    overrides: parsePositionOverrides(Array.isArray(lastOverridesJson) ? lastOverridesJson : []),
    groups,
    gameStatePools: lastVbpackGameStatePools,
    painterV2Rules: lastPainterV2Rules,
    variantId: suggestedPainterV2VariantId(lastVbpackGameStatePools),
    wram: tryCopyVBSystemRamFromEmulator(),
  };
}

/** "sprite", "sprite + paint gaps", "paint gaps" — what the readout says is watched. */
function describeAutoCaptureWatch() {
  return [describeCaptureKinds(autoCaptureKinds), autoCaptureGaps ? 'paint gaps' : ''].filter(Boolean).join(' + ');
}

function loadAutoCaptureKinds() {
  try {
    return normalizeCaptureKinds(JSON.parse(localStorage.getItem(AUTO_CAPTURE_KINDS_KEY) || '[]'));
  } catch (_) {
    return normalizeCaptureKinds([]);
  }
}

function saveAutoCaptureKinds(kinds, gaps) {
  try {
    if (kinds.length) localStorage.setItem(AUTO_CAPTURE_KINDS_KEY, JSON.stringify(kinds));
    localStorage.setItem(AUTO_CAPTURE_GAPS_KEY, gaps ? '1' : '0');
  } catch (_) {
    /* remembered for this page only */
  }
}

/**
 * Ask what to watch for, starting from the last choice. Resolves the chosen tile kinds and whether
 * to stop on paint gaps, or null when cancelled. Without the dialog (an old page), keeps the last
 * choice.
 * @returns {Promise<{ kinds: import('./auto-capture.js').CaptureKind[], gaps: boolean }|null>}
 */
function askAutoCaptureKinds() {
  const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById('auto-capture-kinds-dialog'));
  const form = document.getElementById('auto-capture-kinds-form');
  const all = /** @type {HTMLInputElement|null} */ (document.getElementById('auto-kind-all'));
  const gapsBox = /** @type {HTMLInputElement|null} */ (document.getElementById('auto-kind-gaps'));
  const cancel = document.getElementById('auto-kinds-cancel');
  const start = /** @type {HTMLButtonElement|null} */ (document.getElementById('auto-kinds-start'));
  const boxes = CAPTURE_KINDS.map((k) => /** @type {HTMLInputElement|null} */ (document.getElementById(`auto-kind-${k}`)));
  if (!dlg || !form || !all || !cancel || !start || boxes.some((b) => !b)) {
    return Promise.resolve({ kinds: autoCaptureKinds, gaps: autoCaptureGaps });
  }
  const chosen = () => CAPTURE_KINDS.filter((_, i) => boxes[i].checked);
  const sync = () => {
    const n = chosen().length;
    all.checked = n === CAPTURE_KINDS.length;
    all.indeterminate = n > 0 && n < CAPTURE_KINDS.length;
    start.disabled = n === 0 && !gapsBox?.checked;
  };
  boxes.forEach((b, i) => (b.checked = autoCaptureKinds.includes(CAPTURE_KINDS[i])));
  if (gapsBox) gapsBox.checked = autoCaptureGaps;
  sync();
  return new Promise((resolve) => {
    let done = false;
    const finish = (kinds) => {
      if (done) return;
      done = true;
      all.removeEventListener('change', onAll);
      gapsBox?.removeEventListener('change', sync);
      boxes.forEach((b) => b.removeEventListener('change', sync));
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onCancel);
      if (dlg.open) dlg.close();
      resolve(kinds);
    };
    const onAll = () => {
      for (const b of boxes) b.checked = all.checked;
      sync();
    };
    const onSubmit = (e) => {
      e.preventDefault();
      const gaps = !!gapsBox?.checked;
      if (chosen().length || gaps) finish({ kinds: chosen(), gaps });
    };
    const onCancel = () => finish(null);
    all.addEventListener('change', onAll);
    gapsBox?.addEventListener('change', sync);
    boxes.forEach((b) => b.addEventListener('change', sync));
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onCancel);
    dlg.showModal();
    start.focus();
  });
}
let autoCaptureFrameCount = 0;
/** Last RAM-fingerprint screen match, for the readout and to pre-fill the state name. */
let autoCaptureScreen = /** @type {{ label: string, stateName: string } | null} */ (null);
/** Refresh the screen readout every N frames — a 64 KiB WRAM copy, not worth doing 50×/s. */
const AUTO_CAPTURE_SCREEN_EVERY = 10;

const autoCaptureOverlay = document.createElement('canvas');
autoCaptureOverlay.id = 'auto-capture-overlay';
autoCaptureOverlay.width = 384;
autoCaptureOverlay.height = 224;
autoCaptureOverlay.style.cssText =
  'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;display:none;z-index:3;';

/** Frames already in the pack or captured this session, as VIP states. */
function capturedVipStatesForCoverage() {
  const out = [];
  for (const row of [...loadedVbpackFrames, ...temporaryVipStates]) {
    try {
      const raw = typeof row.json === 'string' ? row.json : new TextDecoder().decode(row.json);
      out.push(deserializeVIPState(JSON.parse(raw)));
    } catch (_) {
      /* skip unreadable frames */
    }
  }
  return out;
}

function updateAutoCaptureScreen() {
  const pools = Array.isArray(lastVbpackGameStatePools) ? lastVbpackGameStatePools : [];
  if (!pools.length) {
    autoCaptureScreen = null;
    return;
  }
  const { match } = bestPoolVariantByRam(pools, tryCopyVBSystemRamFromEmulator());
  if (!match) {
    autoCaptureScreen = null;
    return;
  }
  const pool = pools.find((p) => p?.id === match.poolId);
  autoCaptureScreen = {
    label: match.poolLabel,
    stateName: (typeof pool?.analysisStateKey === 'string' && pool.analysisStateKey.trim()) || match.poolLabel,
  };
}

function renderAutoCaptureStatus() {
  const btn = document.getElementById('btn-auto-capture');
  const out = document.getElementById('auto-capture-status');
  btn?.classList.toggle('active', autoCaptureOn);
  btn?.setAttribute('aria-pressed', autoCaptureOn ? 'true' : 'false');
  if (!out) return;
  if (!autoCaptureOn) {
    out.textContent = '';
    out.hidden = true;
    return;
  }
  const pools = Array.isArray(lastVbpackGameStatePools) ? lastVbpackGameStatePools.length : 0;
  const screen = autoCaptureScreen
    ? autoCaptureScreen.label
    : pools
      ? 'unknown screen'
      : 'no memory pools — run Analyze memory';
  out.hidden = false;
  out.textContent = `Auto-capture · ${describeAutoCaptureWatch()} · screen: ${screen} · ${coverageSize(autoCaptureCoverage, autoCaptureKinds)} tile(s) captured`;
}

function drawAutoCaptureHighlight(uncovered) {
  const ctx = autoCaptureOverlay.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, autoCaptureOverlay.width, autoCaptureOverlay.height);
  ctx.lineWidth = 1;
  for (const { draws } of uncovered) {
    for (const d of draws) {
      ctx.fillStyle = 'rgba(255, 0, 208, 0.28)';
      ctx.fillRect(d.x, d.y, 8, 8);
      ctx.strokeStyle = '#ff00d0';
      ctx.strokeRect(d.x + 0.5, d.y + 0.5, 7, 7);
    }
  }
  autoCaptureOverlay.style.display = 'block';
}

function clearAutoCaptureHighlight() {
  autoCaptureOverlay.getContext('2d')?.clearRect(0, 0, autoCaptureOverlay.width, autoCaptureOverlay.height);
  autoCaptureOverlay.style.display = 'none';
}

function setAutoCapture(on) {
  autoCaptureOn = on;
  autoCaptureBusy = false;
  if (!autoCaptureOverlay.isConnected) colorCanvas.parentElement?.appendChild(autoCaptureOverlay);
  if (on) {
    autoCaptureCoverage = buildCoverage(capturedVipStatesForCoverage(), AUTO_CAPTURE_EYE);
    // Frames cleaned out of the pack still count as captured.
    addArchivedCoverage(autoCaptureCoverage, loadedManifestArchivedCoverage);
    for (const key of autoCaptureDismissed) {
      const [kind, hash] = key.split(':');
      autoCaptureCoverage[kind]?.add(Number(hash));
    }
    autoCaptureFrameCount = 0;
    updateAutoCaptureScreen();
  } else {
    clearAutoCaptureHighlight();
  }
  renderAutoCaptureStatus();
}

initMemoryPanel();

document.getElementById('btn-auto-capture')?.addEventListener('click', async () => {
  if (autoCaptureOn) {
    setAutoCapture(false);
    return;
  }
  // Paused while you choose, so the game does not run past what you meant to catch.
  setEmulatorPaused(true);
  const choice = await askAutoCaptureKinds();
  setEmulatorPaused(false);
  if (!choice) return;
  autoCaptureKinds = choice.kinds;
  autoCaptureGaps = choice.gaps;
  saveAutoCaptureKinds(choice.kinds, choice.gaps);
  setAutoCapture(true);
  const watching = choice.kinds.length
    ? `watching ${describeCaptureKinds(choice.kinds)} tiles — ${coverageSize(autoCaptureCoverage, choice.kinds)} already captured. It stops on the next new one`
    : 'watching for paint gaps';
  const gapsNote = !choice.gaps
    ? ''
    : paintForGaps()
      ? ', and where paint doesn’t cover the frame yet'
      : ' — nothing is painted yet, so there are no paint gaps to find; load a pack first';
  flashColorPackStatus(`Auto-capture on, ${watching}${gapsNote}.`);
});

/** Called for every renderable VIP frame while auto-capture is on. */
async function autoCaptureCheck(state) {
  if (!autoCaptureOn || autoCaptureBusy || !autoCaptureCoverage) return;
  if (++autoCaptureFrameCount % AUTO_CAPTURE_SCREEN_EVERY === 0) {
    updateAutoCaptureScreen();
    renderAutoCaptureStatus();
  }
  const uncovered = autoCaptureKinds.length ? findUncoveredTiles(state, autoCaptureCoverage, autoCaptureKinds, AUTO_CAPTURE_EYE) : [];
  const paint = autoCaptureGaps && autoCaptureFrameCount % AUTO_CAPTURE_GAPS_EVERY === 0 ? paintForGaps() : null;
  const gaps = paint ? findPaintGaps(state, paint, autoCaptureGapsSeen) : [];
  if (!uncovered.length && !gaps.length) return;
  // Each gap stops the game once a session, captured or not: a backdrop past its picture stays so
  // until the picture is widened, and would otherwise stop every frame.
  for (const g of gaps) autoCaptureGapsSeen.add(paintGapKey(g));
  const found = [
    uncovered.length ? `${describeUncovered(uncovered)} no captured frame shows yet` : '',
    gaps.length ? `paint doesn’t cover ${describePaintGaps(gaps)}` : '',
  ].filter(Boolean).join('; ');

  autoCaptureBusy = true;
  const saveStateBuffer = snapshotSaveState();
  setEmulatorPaused(true);
  updateAutoCaptureScreen();
  renderAutoCaptureStatus();
  drawAutoCaptureHighlight([...uncovered, ...gaps]);
  try {
    const result = await showCaptureFrameDialog({
      auto: {
        found,
        stateName: autoCaptureScreen?.stateName,
        screenLabel:
          autoCaptureScreen?.label ??
          ((lastVbpackGameStatePools?.length ?? 0) > 0 ? 'unknown' : 'no memory pools — run Analyze memory'),
      },
    });
    clearAutoCaptureHighlight();
    if (result?.cancelled) {
      // Dismissing ends the mode. Remember the tiles for the session, so turning
      // it back on does not stop straight away on the same frame.
      for (const u of uncovered) autoCaptureDismissed.add(`${u.kind}:${u.hash}`);
      setAutoCapture(false);
      flashColorPackStatus('Auto-capture off.');
      return;
    }
    const captured = await captureFrameIntoPack({ labels: result, vipState: state, saveStateBuffer });
    reportCapture(`Auto-captured “${result.stateName}” (${found}).`, captured.gaps);
  } catch (e) {
    reportProblem(`Auto-capture could not save that frame: ${e?.message || e}`, e);
    clearAutoCaptureHighlight();
  } finally {
    autoCaptureBusy = false;
    renderAutoCaptureStatus();
  }
}

const EJS_LOADER_SCRIPT_ID = 'ejs-loader';

let getContextPreservePatched = false;
function patchGetContextForPreserveDrawingBuffer() {
  if (getContextPreservePatched) return;
  getContextPreservePatched = true;
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attribs) {
    if (type === 'webgl' || type === 'webgl2') {
      attribs = { ...(attribs || {}), preserveDrawingBuffer: true };
    }
    return orig.call(this, type, attribs);
  };
}

function startEmulator(gameUrl, gameName) {
  emulatorStarted = true;
  patchGetContextForPreserveDrawingBuffer();
  // For local core development, disable EmulatorJS IndexedDB cache so core updates take effect immediately.
  // Otherwise it can keep using an older decompressed core even if we replace beetle_vb-wasm.data on disk.
  if (USE_LOCAL_CORE) {
    window.EJS_disableDatabases = true;
    window.EJS_threads = false;
  }
  /** Phase 1: per-frame hook for local (patched) core; counter visible in Palette debug status when USE_LOCAL_CORE */
  if (USE_LOCAL_CORE) {
    window.__vbFrameCount = 0;
    window.__VB_FRAME__ = function () {
      window.__vbFrameCount = (window.__vbFrameCount || 0) + 1;
      onCoreFrame();
    };
    stateHistory.clear();
    userPaused = false;
    // Reset the Phase 2 marker each run; core sets it to true once it successfully pushes state.
    try { globalThis.__VB_VIP_STATE_AVAILABLE__ = false; } catch (_) {}
    try { globalThis.__VB_CORE_PATCH_LEVEL__ = 0; } catch (_) {}
  }
  const el = document.getElementById('game');
  const existingLoader = document.getElementById(EJS_LOADER_SCRIPT_ID);
  if (existingLoader) existingLoader.remove();
  if (el) el.innerHTML = '';
  if (colorCanvas) colorCanvas.style.display = displayMode === 'color' ? 'block' : 'none';
  if (paletteCanvas) paletteCanvas.style.display = displayMode === 'palette' ? 'block' : 'none';
  if (el) el.style.display = '';

  if (typeof paletteLayerModule?.stopPaletteLoop === 'function') paletteLayerModule.stopPaletteLoop();

  window.EJS_player = '#game';
  window.EJS_core = 'vb';
  window.EJS_gameUrl = gameUrl;
  // Prefer a stable human name (ROM / pack), not a blob UUID, for saves paths & UI.
  window.EJS_gameName = gameName || currentRomFileName || currentVbpackDisplayName || 'game';
  window.EJS_pathtodata = USE_LOCAL_CORE ? '/data/' : CDN;
  /** When using local core we only have unminified files (src/emulator.js, emulator.css); loader expects .min otherwise. */
  if (USE_LOCAL_CORE) window.EJS_DEBUG_XX = true;
  window.EJS_startOnLoaded = true;

  const script = document.createElement('script');
  script.id = EJS_LOADER_SCRIPT_ID;
  script.src = (USE_LOCAL_CORE ? '/data/' : CDN) + 'loader.js';
  script.onload = hideSplash;
  document.body.appendChild(script);
}

if (sessionStorage.getItem(RELOAD_TO_LOAD_LAST_VBPACK)) {
  sessionStorage.removeItem(RELOAD_TO_LOAD_LAST_VBPACK);
  loadLastVbpack().then(async (stored) => {
    if (stored?.buffer) {
      try {
        const result = await parseArtPack(stored.buffer);
        applyVbpackResult(result);
      } catch (err) {
        reportProblem(`Could not reopen the last pack: ${err?.message || err}`, err);
      }
    }
  });
}

// If returning from painter, apply updated pack + restore save state.
maybeApplySaveAndPlayHandoff();

// Captured frames live only in memory until Colorize! or Export .vbpack: ask before a tab
// close or reload throws them away.
window.addEventListener('beforeunload', (e) => {
  if (leavingOnPurpose || unsavedCaptureCount() === 0) return;
  e.preventDefault();
  e.returnValue = '';
});
