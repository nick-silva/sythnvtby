/**
 * Painter v2 (alpha) — load .vbpack, pick frame, color composite via compositeColorFrame (same implementation as main app color layer).
 * Zoomed brush/fill edits the in-memory vbcolor map; Save .vbpack rebuilds color.vbcolor.
 */


import { STARTER_SHADES, convertOldStarterShades } from '../src/starter-paint.js';




import { UNCOLOURED_FILTERS } from '../src/uncoloured.js';


import { validateVIPState } from '../src/vip-dump.js';


import { getTileBytes, hashTile } from '../src/vip-state.js';


import { buildVBColorPack } from '../src/vbcolor-pack.js';

import {
  parseArtPack,
  buildArtPack,
  artPackPartsFromParsed,
} from '../src/art-pack.js';

import { seedGameStatePoolsFromMemoryAnalysis } from '../src/seed-game-state-pools-from-memory-analysis.js';
import { putHandoff, deleteHandoff } from '../src/handoff-store.js';

import { writeJournal, readJournal, clearJournal, bytesToBase64, base64ToBytes } from '../src/work-journal.js';

import { PROJECT_JOURNAL_TOOL, frameDetailsOf, mergeJournalIntoParts, restoreJournalPrompt } from '../src/project-journal.js';
import {
  pickAndStoreHomeDirectory,
  clearHomeDirectoryHandle,
  getHomeStatus,
  requestHomeAccess,
  formatHomeStatusLabel,
  pickOpenVbpackFile,
  saveExportToHome,
} from '../src/project-home.js';


import { compositeColorFrameForEye } from '../src/color-layer.js';



import {
  decodeGroupTileColors,
  groupWithEncodedTileColors,
} from '../src/group-tile-colors.js';



















import {
  frameRowFrom,
  vipMatchKey,
  findFrameRegistryEntry,
  formatPaintToolFrameLabelFromRegistry,
  normalizeVipJsonForFrameField,
} from './painter/frame-registry.js';

import { bindPainterUiEvents } from './painter/events.js';















import { onLayerArtDecoded } from '../src/layer-art.js';


import { installLayerArtDecoder } from '../src/layer-art-png.js';



import { discardProjectChangesPrompt } from '../src/unsaved-work.js';




import { projectFromParsed, colourOptions } from '../src/project.js';

import {
  HANDOFF_KEY_PROJECT_STATE,
} from './shared/project-return.js';



import {
  bindNewPoseDialogEvents,
} from './painter/sprite-profiles-ui.js';


import { recordGroupUse } from './shared/recent-groups.js';
import {
  initReferenceImages,
  primeReferenceStore,
  refreshFrameReference,
} from './painter/reference-images.js';


import {
  initFrameData,
  findPoolVariantForFrameByRam,
  primeRamDumpStore,
  primeScreenshotStore,
  runMemoryAnalysisOnLoadedPack,
} from './painter/frame-data.js';

import {
  initFrameActions,
  drawReferenceOverlay,
  drawScreenshotOverlay,
  refreshFrameScreenshot,
  updateFrameMenuState,
} from './painter/frame-actions.js';

import {
  initPackRules,
  clearStrayTransparentPaint,
  convertLoadedOverlaysToTouchUps,
  getActiveV2VariantId,
  paintTopTileToV2Rule,
  reapplyPackVipAuthoringOverlaysFromLoadedPack,
  restorePainterVipOverlaysFromPack,
  serializeOverridesForSave,
  serializePainterVipOverlaysForSave,
  setV2AuthoringVisible,
  syncV2VariantSelect,
  updatePaintV2TopButton,
} from './painter/pack-rules.js';

import {
  initSelection,
  clearSelection,
  normWorldKey,
  refreshInspectorFromSelection,
  resetMarqueeAndPickStatePreserveZoom,
  syncLastTopTileFromSelection,
  updateSelectionUi,
} from './painter/selection.js';


import {
  initViewFilters,
  drawEye,
  filterStateForView,
  getEye,
  stateForComposite,
  updateWorldFilterDebug,
} from './painter/view-filters.js';

import {
  initZoomTarget,
  collectFullFrameIndicesMatchingGroup,
  drawMatchesGroup,
  getSelectedPaintGroupOrNull,
  getZoomPaintBlockedReason,
  selectAllMatchingSelectedTile,
  useVipOverlayForZoomPaint,
} from './painter/zoom-target.js';


import {
  initScreensUi,
  currentFrameWram,
  rebuildScreenIndex,
  setGameStates,
} from './painter/screens-ui.js';


import {
  initWorldGrid,
  buildWorldGrid,
  drawSelectionOverlay,
  syncWorldButtons,
} from './painter/world-grid.js';

import {
  initPaintInventoryUi,
  openPaintInventory,
  renderPaintInventory,
  setPaintInventoryFilter,
} from './painter/paint-inventory-ui.js';


import {
  initGroupDetail,
  HEALTH_DELAY_MS,
  frameStatesByIndex,
  refreshNewGroupMembershipBanner,
  updateGroupDetail,
} from './painter/group-detail.js';



import {
  initProjectDialogs,
  gameStatesDialog,
  healthDialog,
  openGameStatesDialog,
  openHealthDialog,
  openStorageDialog,
  scheduleHealthCheck,
  storageDialog,
  syncHealthUi,
} from './painter/project-dialogs.js';
import {
  initPools,
  clearGroupDerivedFilters,
  fillNewGroupPoolVariantSelect,
  findDefaultPoolVariantForFrame,
  getCurrentFrameSelectIndex,
  getRegistryFrameIdForFrameIndex,
  selectTilesUnassignedInEditorPoolVariant,
  updateGroupsPoolContextHint,
} from './painter/pools.js';
import {
  initGroupDialogs,
  applyRenameGroupFromInspector,
  confirmDuplicateGroup,
  createGroupFromDialog,
  deleteGroupById,
  handlePoseAction,
  openDuplicateGroupDialog,
  openNewGroupDialog,
  openNewPoseFromSelection,
  readNewGroupKind,
  refreshNewGroupOverlapBanner,
  refreshNewGroupPoolVariantHint,
  submitNewPoseFromDialog,
  suggestKindFromSelection,
  wireCanvasSize,
} from './painter/group-dialogs.js';

import {
  initSave,
  HANDOFF_KEY_SPRITE_STUDIO,
  captureProjectReturnState,
  maybeLoadHandoffPack,
  maybeLoadSpriteStudioReturn,
  preparePainterVbpackParts,
  runPainterSaveAndPlay,
  runPainterVbpackSave,
  updateSaveAndPlayEnabled,
} from './painter/save.js';

import {
  initGroupsPanel,
  bindGroupSearch,
  createGroupRow,
  updateGroupsPanel,
  updatePoolSummary,
} from './painter/groups-panel.js';
import {
  initFrameList,
  FRAME_FILTER_KEY,
  applyFrameFilter,
  applyFrameHighlight,
  frameFilter,
  loadVipFromJson,
  populateFrames,
  setFrameFilter,
  setFrameHighlight,
  shownFrameOptions,
  stepFrame,
  syncFrameHighlightUi,
  syncFrameStepButtons,
} from './painter/frame-list.js';

import {
  initZoomPaint,
  addSelectedHashesToGroupCriteria,
  affineCopyPixels,
  affineMapForEye,
  clearGroupAnchor,
  collectVisibleIndicesForHit,
  countSameHashWorldLayerEye,
  ensureGroupTileColorMap,
  getPackRgba256ForHash,
  hitDrawIndices,
  invalidateGroupColorIndex,
  isAffineRecord,
  isBlankDraw,
  paintStoreNote,
  paintTargetGroupOrNull,
  paintTargetHasHash,
  readZoomPaintColor,
  removeSelectedHashesFromGroupCriteria,
  startAnchorPickForGroup,
} from './painter/zoom-paint.js';

import {
  initInspector,
  explainFromComposite,
  explainInspectPoint,
  syncOverlayAlphaUi,
  updateInspector,
} from './painter/inspector.js';
import {
  initVipOverlayPaint,
  blendVipAuthoringIntoImageData,
  clearVipAuthoringOverlay,
  ensureVipAuthoringOverlay,
  ensureVipOverlayBufferForGroupEye,
  fillGroupMemberVipFootprintMask,
  footprintMaskScratch,
} from './painter/vip-overlay-paint.js';
import {
  initPaintHistory,
  commitPaintUndoStroke,
  paintRedoStack,
  pushPaintUndo,
  recordPackUndoSnapForHash,
} from './painter/paint-history.js';
import {
  initFileMenu,
  cleanUpFrames,
  clearPainterVbpackSaveFileHandle,
  closePainterFileMenu,
  exportForPlayer,
  getVbpackSaveSuggestedFileName,
  importFromAnotherPack,
  importFromAnotherPackFromMenu,
  importVbcpPack,
  importVbcpPackFromMenu,
  savePainterVbpackBlob,
} from './painter/file-menu.js';
import {
  initCanvasInput,
  wireCanvas,
  wireKeyboard,
  wireToolbar,
} from './painter/canvas-input.js';

/** Resolve toolbar PNG paths relative to this module (`tools/painter.js` → repo `toolbar_images/`). */
function toolbarImg(/** @type {string} */ file) {
  return new URL(`../toolbar_images/${file}`, import.meta.url).href;
}

const W = 384;
const H = 224;
const ZOOM_SQUARE = 384;
/** Ramp for a freshly painted tile: the Project tool's starter reds (src/starter-paint.js). */
const ZOOM_DEFAULT_RAMP = [[0, 0, 0], ...STARTER_SHADES[1].slice(1)];

/** Full-frame composite buffer for zoom crop. */
const scratchComposite = /** @type {HTMLCanvasElement} */ (document.createElement('canvas'));
scratchComposite.width = W;
scratchComposite.height = H;
const scratchCompositeCtx = scratchComposite.getContext('2d');
/** Full-frame overlay (selection + marquee) before zoom crop. */
const scratchOverlay = /** @type {HTMLCanvasElement} */ (document.createElement('canvas'));
scratchOverlay.width = W;
scratchOverlay.height = H;
const scratchOverlayCtx = scratchOverlay.getContext('2d');

const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('main-canvas'));
const overlayCanvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('selection-overlay'));
const ctx = canvas?.getContext('2d') ?? null;
const octx = overlayCanvas?.getContext('2d') ?? null;
const statusEl = document.getElementById('status');
const frameSelect = document.getElementById('frame-select');
const eyeSelect = document.getElementById('eye-select');
const layerSelect = document.getElementById('layer-select');
const fileVbpack = document.getElementById('file-vbpack');
const fileMenu = /** @type {HTMLDetailsElement|null} */ (document.getElementById('file-menu'));
const fileMenuOpen = document.getElementById('file-menu-open');
const fileMenuSave = document.getElementById('file-menu-save');
const fileMenuSaveAs = document.getElementById('file-menu-save-as');
const fileMenuHomeChoose = document.getElementById('file-menu-home-choose');
const fileMenuHomeClear = document.getElementById('file-menu-home-clear');
const fileMenuHomeLabel = document.getElementById('file-menu-home-label');
const fileMenuHomeGrant = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-home-grant'));
const btnSaveAndPlay = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-save-and-play'));
const btnRetryHandoff = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-retry-handoff'));
const btnReload = document.getElementById('btn-reload');
const frameMenu = /** @type {HTMLDetailsElement|null} */ (document.getElementById('frame-menu'));
const frameMenuLabel = document.getElementById('frame-menu-label');
const frameMenuExportShot = /** @type {HTMLButtonElement|null} */ (document.getElementById('frame-menu-export-shot'));
const frameMenuAddReference = /** @type {HTMLButtonElement|null} */ (document.getElementById('frame-menu-add-reference'));
const frameMenuRemoveReference = /** @type {HTMLButtonElement|null} */ (document.getElementById('frame-menu-remove-reference'));
const frameMenuRename = /** @type {HTMLButtonElement|null} */ (document.getElementById('frame-menu-rename'));
const frameMenuTags = /** @type {HTMLButtonElement|null} */ (document.getElementById('frame-menu-tags'));
const referenceInput = /** @type {HTMLInputElement|null} */ (document.getElementById('reference-input'));
const toggleReferenceOverlay = /** @type {HTMLInputElement|null} */ (document.getElementById('toggle-reference-overlay'));
const btnReferenceTransform = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-reference-transform'));
const btnReferenceRevert = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-reference-revert'));
const referenceStatus = document.getElementById('reference-status');
const frameDetailsDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('frame-details-dialog'));
const frameDetailsForm = /** @type {HTMLFormElement|null} */ (document.getElementById('frame-details-form'));
const frameDetailsName = /** @type {HTMLInputElement|null} */ (document.getElementById('frame-details-name'));
const frameDetailsTags = /** @type {HTMLInputElement|null} */ (document.getElementById('frame-details-tags'));
const frameDetailsSummary = document.getElementById('frame-details-summary');
const frameDetailsCancel = /** @type {HTMLButtonElement|null} */ (document.getElementById('frame-details-cancel'));
const toggleShotOverlay = /** @type {HTMLInputElement|null} */ (document.getElementById('toggle-shot-overlay'));
const shotOverlayAlpha = /** @type {HTMLInputElement|null} */ (document.getElementById('shot-overlay-alpha'));
const toggleBlankTiles = /** @type {HTMLInputElement|null} */ (document.getElementById('toggle-blank-tiles'));
const btnSelectMatching = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-select-matching'));
const btnStackPanel = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-stack-panel'));
/** Draw-stack panel: lists every draw under the last clicked pixel. */
// Every draw under the clicked pixel, listed in the inspector's Details.
const stackPanelEnabled = true;
/** The VIP pixel last clicked, which the inspector explains (src/pixel-explain.js); null before any click. */
let inspectPoint = /** @type {{ x: number, y: number } | null} */ (null);
/** Its explanation as of the last render. */
let inspectAnswer = /** @type {ReturnType<typeof explainPixel> | null} */ (null);
/** How a click / box changes the selection: replace it, add to it, or subtract from it. */
let selectionMode = /** @type {'replace'|'add'|'remove'} */ ('replace');
const BLANK_TILES_KEY = 'painter.includeBlankTiles';
/** Blank cells (all pixels palette 0) are most of a frame's BG draws and share one hash; off = unselectable. */
let includeBlankTiles = (() => {
  try {
    return localStorage.getItem(BLANK_TILES_KEY) === '1';
  } catch {
    return false;
  }
})();
const previewBrightnessInput = /** @type {HTMLInputElement|null} */ (document.getElementById('preview-brightness'));
const previewBrightnessValue = document.getElementById('preview-brightness-value');
const PREVIEW_BRIGHTNESS_KEY = 'painter.previewBrightness';
const PREVIEW_BRIGHTNESS_DEFAULT = 1.25;
const PREVIEW_BRIGHTNESS_MIN = 0.5;
const PREVIEW_BRIGHTNESS_MAX = 2.5;
/** Gain for unpainted (captured mono) preview pixels; painted colors stay true to the emulator. */
let previewBrightness = loadPreviewBrightness();

/** @returns {number} */
function loadPreviewBrightness() {
  try {
    const v = Number(localStorage.getItem(PREVIEW_BRIGHTNESS_KEY));
    if (Number.isFinite(v) && v >= PREVIEW_BRIGHTNESS_MIN && v <= PREVIEW_BRIGHTNESS_MAX) return v;
  } catch {}
  return PREVIEW_BRIGHTNESS_DEFAULT;
}

/** @param {number} value */
function setPreviewBrightness(value) {
  previewBrightness = Math.min(PREVIEW_BRIGHTNESS_MAX, Math.max(PREVIEW_BRIGHTNESS_MIN, value));
  if (previewBrightnessInput) previewBrightnessInput.value = String(previewBrightness);
  if (previewBrightnessValue) previewBrightnessValue.textContent = `${Math.round(previewBrightness * 100)}%`;
  try {
    localStorage.setItem(PREVIEW_BRIGHTNESS_KEY, String(previewBrightness));
  } catch {}
}
const worldGrid = document.getElementById('world-grid');
const poolSummary = document.getElementById('pool-summary');
const inspector = document.getElementById('inspector');
const groupsTree = document.getElementById('groups-tree');
const groupDetail = document.getElementById('group-detail');
const cursorPos = document.getElementById('cursor-pos');
const v2Authoring = /** @type {HTMLDetailsElement|null} */ (document.getElementById('v2-authoring'));
const v2VariantSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('v2-variant-select'));
const btnPaintV2Top = document.getElementById('btn-paint-v2-top');
const btnV2VariantAuto = document.getElementById('btn-v2-variant-auto');
const btnCanvasSelect = document.getElementById('btn-canvas-select');
const btnZoomSelection = document.getElementById('btn-zoom-selection');
const btnZoomGrid = document.getElementById('btn-zoom-grid');
const btnPaintFill = document.getElementById('btn-paint-fill');
const fillAcrossTilesInput = /** @type {HTMLInputElement|null} */ (document.getElementById('fill-across-tiles'));
const btnPaintBrush = document.getElementById('btn-paint-brush');
const btnPaintErase = document.getElementById('btn-paint-erase');
const btnPaintColorPick = document.getElementById('btn-paint-color-pick');
const btnImportAsset = document.getElementById('btn-import-asset');
const tileSelectionHint = document.getElementById('tile-selection-hint');
const canvasWrap = document.querySelector('.canvas-wrap');
const worldFilterDebug = document.getElementById('world-filter-debug');
const btnNewGroupFromSelection = document.getElementById('btn-new-group-from-selection');
const btnNewPoseFromSelection = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-new-pose-from-selection'));
const btnClearGroupFilter = document.getElementById('btn-clear-group-filter');
const btnSelectUnassignedPoolTiles = document.getElementById('btn-select-unassigned-pool-tiles');
const newGroupDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('new-group-dialog'));
const newGroupForm = document.getElementById('new-group-form');
const newGroupOverlap = document.getElementById('new-group-overlap');
const newGroupMembership = document.getElementById('new-group-membership');
const newGroupName = /** @type {HTMLInputElement|null} */ (document.getElementById('new-group-name'));
const newGroupPoolVariant = /** @type {HTMLSelectElement|null} */ (document.getElementById('new-group-pool-variant'));
const newGroupKindBg = /** @type {HTMLInputElement|null} */ (document.getElementById('new-group-kind-bg'));
const newGroupKindObj = /** @type {HTMLInputElement|null} */ (document.getElementById('new-group-kind-obj'));
const newGroupSuggestKind = document.getElementById('new-group-suggest-kind');
const newGroupCancel = document.getElementById('new-group-cancel');
const duplicateGroupDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('duplicate-group-dialog'));
const paintInventoryDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('paint-inventory-dialog'));
const dupGroupPoolVariant = /** @type {HTMLSelectElement|null} */ (document.getElementById('dup-group-pool-variant'));
const dupGroupCancel = document.getElementById('dup-group-cancel');
const dupGroupConfirm = document.getElementById('dup-group-confirm');

/** Set when the new-group dialog opens: suggested `pool::variant` value + hint copy. */
let newGroupDialogFrameVariant =
  /** @type {{ value: string, hintLine: string, frameMapped: boolean } | null} */ (null);

/** Source group id while duplicate-group dialog is open. */
let pendingDuplicateSourceId = /** @type {string|null} */ (null);

const painterWorldDebug =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('painterWorldDebug') === '1';
/** Log zoom brush/fill hit-test misses to the console (append `?painterDebugPaint=1` to the page URL). */
const painterPaintDebug =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('painterDebugPaint') === '1';

/** @type {import('../src/vip-dump.js').VIPStateObject|null} */
let currentState = null;
/** @type {Map<number, Uint8Array>} */
let pack = new Map();
/** @type {Array<{ hash: number, xMin: number, yMin: number, xMax: number, yMax: number, rgba: Uint8Array, layer?: number, groupId?: string, ramConditions?: unknown[] }>} */
let overrides = [];
/** @type {Array<{ id: string, name: string, criteria: object, visible?: boolean, statePoolId?: string, stateVariantId?: string, ramConditions?: unknown[], anchorHash?: number, authoringKind?: string }>} */
let groups = [];
/** @type {unknown[]} */
let gameStatePools = [];
/** The project's game states (groups.json `gameStates`, src/game-states.js); conditions name them. */
let gameStates = [];
/** @type {unknown[]} */
let overridePresets = [];
/** @type {number|undefined} */
let loadedGroupsSchemaVersion = undefined;
/** True after add/delete groups until saved to a new .vbpack. */
let groupsDirty = false;
/** The last Check project result (src/project-health.js). */
let health = { issues: /** @type {import('../src/project-health.js').HealthIssue[] | null} */ (null), frames: 0, checking: false };
/** The .vbpack's size on disk: as opened, then as last saved; null for a project never saved. */
let packFileBytes = /** @type {number|null} */ (null);
/** Recording id → its memory samples, read once. */
let recordingSamplesCache = new Map();
/** @type {{ label: string, vipFile: string, json: string, frameRegistryEntry?: Record<string, unknown>|null }[]} */
let availableFrames = [];
/** @type {Array<Record<string, unknown>>|null} */
let lastFrameRegistry = null;
/** frame stem (lowercase, no `.wram.bin`) -> 64 KiB WRAM captured with that frame. */
let ramDumpsByStem = /** @type {Map<string, Uint8Array>} */ (new Map());
/** screenshot leaf filename (lowercase) -> object URL. */
let screenshotUrlByName = /** @type {Map<string, string>} */ (new Map());
/** screenshot stem (no extension, lowercase) -> object URL. */
let screenshotUrlByStem = /** @type {Map<string, string>} */ (new Map());
/** Blob URLs to revoke when loading a new pack. */
let screenshotObjectUrls = /** @type {string[]} */ ([]);
/** Loaded frame screenshot image for overlay compare. */
let activeFrameScreenshotImage = /** @type {HTMLImageElement|null} */ (null);
/** Object URL tied to `activeFrameScreenshotImage` (race guard). */
let activeFrameScreenshotUrl = /** @type {string|null} */ (null);
/** Painter screenshot overlay settings (visual compare only). */
let screenshotOverlayEnabled = false;
let screenshotOverlayOpacity = 0.45;
/** Colour references imported by hand: `{ items, active }` from the manifest, plus the images. */
let packReferences = /** @type {{ items: any[], active: Record<string, string> }} */ ({ items: [], active: {} });
let referenceBlobs = /** @type {Map<string, Blob>} */ (new Map());
let referenceUrls = /** @type {Map<string, string>} */ (new Map());
let activeReferenceMeta = /** @type {any|null} */ (null);
let activeReferenceImage = /** @type {HTMLImageElement|null} */ (null);
let activeReferenceUrl = /** @type {string|null} */ (null);
/** Where the reference sits on the frame: `scale` plus a top-left in frame pixels. */
let activeReferenceTransform = /** @type {{ scale: number, dx: number, dy: number }|null} */ (null);
let referenceOverlayEnabled = false;
/** Move & scale tool: takes over canvas dragging while it is on. */
let referenceTransformMode = false;
let referenceDrag = /** @type {{ handle: string, startX: number, startY: number, startTransform: any, pointerId: number }|null} */ (null);
/** Unsaved reference or frame name/tag edits — both live in the manifest. */
let referencesDirty = false;
let frameRegistryDirty = false;
/** Paint strokes since the last save, so leaving the page can warn about losing them. */
let paintEditsSinceSave = 0;

/** Anything edited that a save would write and leaving the page would lose. */
function hasUnsavedPainterEdits() {
  return groupsDirty || referencesDirty || frameRegistryDirty || paintEditsSinceSave > 0;
}
/** Set just before navigating away on purpose: the page's own buttons ask or hand the work on. */
let leavingPainterOnPurpose = false;

/** Navigate without the close-tab prompt (the caller has asked, saved, or handed the work on). */
function leavePainterTo(url) {
  leavingPainterOnPurpose = true;
  location.href = url;
}

// Closing the tab or reloading with unsaved edits asks first, like the Emulator button does.
window.addEventListener('beforeunload', (e) => {
  if (leavingPainterOnPurpose || !hasUnsavedPainterEdits()) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ------------------------------------------------------- unsaved-work journal */
// Recovery: a copy of the unsaved work kept in browser storage (src/project-journal.js) a moment
// after you stop editing, cleared when a save succeeds. If the tab dies first, opening the same
// pack offers it back. Any click, key or field change schedules a write; it only writes while
// something is unsaved.

const JOURNAL_IDLE_MS = 3000;
let journalTimer = 0;
/** The write in flight, so a clear waits for it instead of racing it. */
let journalWrite = Promise.resolve();
/** The pack name the last journal was written under (Save as… can change the name). */
let journalWrittenLabel = '';
let journalFailed = false;

function scheduleProjectJournal() {
  if (!loadedPackParts) return;
  clearTimeout(journalTimer);
  journalTimer = setTimeout(() => {
    journalWrite = journalWrite.then(writeProjectJournal);
  }, JOURNAL_IDLE_MS);
}
for (const type of ['pointerup', 'keyup', 'change']) document.addEventListener(type, scheduleProjectJournal, true);

async function writeProjectJournal() {
  if (!loadedPackParts || !hasUnsavedPainterEdits()) return;
  const label = loadedPackName;
  try {
    await writeJournal(PROJECT_JOURNAL_TOOL, label, projectJournalSnapshot());
    journalWrittenLabel = label;
    journalFailed = false;
  } catch (e) {
    // Storage full or refused: the work is still here to save; say so once rather than per change.
    if (!journalFailed) setStatus(`Could not keep a recovery copy of your unsaved work (${e?.message || e}) — save soon.`);
    journalFailed = true;
  }
}

/** What a restore needs (src/project-journal.js); nothing in the project changes. */
function projectJournalSnapshot() {
  const overlays = serializePainterVipOverlaysForSave().json;
  return {
    label: loadedPackName,
    savedAt: new Date().toISOString(),
    frames: (lastFrameRegistry || []).length,
    groups: groups.map(groupWithEncodedTileColors),
    vbcolor: bytesToBase64(buildVBColorPack(loadedVbcolorGameId || 'vb-pack', pack)),
    overrides: serializeOverridesForSave(),
    overridePresets: Array.isArray(overridePresets) ? overridePresets : [],
    gameStatePools: Array.isArray(gameStatePools) ? gameStatePools : [],
    gameStates,
    ...(painterV2Rules && { painterV2Rules }),
    ...(overlays != null && { painterV2VipOverlays: overlays }),
    frameDetails: frameDetailsOf(lastFrameRegistry),
  };
}

/** After a successful save, or when the work is handed on or let go on purpose. */
async function clearProjectJournal() {
  clearTimeout(journalTimer);
  await journalWrite;
  for (const label of new Set([loadedPackName, journalWrittenLabel].filter(Boolean))) {
    await clearJournal(PROJECT_JOURNAL_TOOL, label).catch(() => {});
  }
  journalWrittenLabel = '';
}

/**
 * Just after a pack opens: unsaved work kept for it, if any, put back over it (asking first), or
 * forgotten when declined. Reopens the pack through the normal load path with the work merged in.
 */
async function offerProjectJournalRestore() {
  if (!loadedPackParts) return;
  const label = loadedPackName;
  const journal = await readJournal(PROJECT_JOURNAL_TOOL, label).catch(() => null);
  if (!journal) return;
  if (!window.confirm(restoreJournalPrompt(packDisplayName || label, journal, (lastFrameRegistry || []).length))) {
    await clearJournal(PROJECT_JOURNAL_TOOL, label).catch(() => {});
    setStatus('Discarded the unsaved work from before.');
    return;
  }
  setStatus('Restoring your unsaved work…');
  try {
    const merged = mergeJournalIntoParts(artPackPartsFromParsed(loadedPackParts), journal, base64ToBytes);
    const blob = await buildArtPack(merged);
    const handle = painterVbpackSaveFileHandle;
    const display = packDisplayName;
    await loadVbpackBuffer(await blob.arrayBuffer(), label);
    painterVbpackSaveFileHandle = handle;
    packDisplayName = display;
    groupsDirty = true;
    frameRegistryDirty = true;
    journalWrittenLabel = label;
    setStatus(`Restored your unsaved work from ${new Date(journal.savedAt).toLocaleString()} — Save to keep it.`);
  } catch (e) {
    console.warn('[painter] Could not restore the journal:', e);
    setStatus(`Could not restore the unsaved work (${e?.message || e}). It is still kept: open the pack again to retry.`);
  }
}
/** Manifest `currentVipStateRef` (for registry → “Current” frame), set when a pack loads. */
let lastManifestCurrentVipRef = 'vipstate-current.json';
/** World filter: 'all' | Set<string> normalized world ids */
let worldFilter = /** @type {'all' | Set<string>} */ ('all');
/** Draw indices into `currentState.drawList` (full frame) for the active tile selection. */
const selectedDrawFullIndices = /** @type {Set<number>} */ (new Set());
/** Marquee in VIP pixels while dragging (before release). */
let marqueeState = /** @type {{ x0: number, y0: number, x1: number, y1: number } | null} */ (null);
/** @type {{ startVx: number, startVy: number, pointerId: number } | null} */
let activeMarqueePointer = null;
/** When set, main canvas shows this sub-rectangle of the VIP frame (pixels). */
let zoomViewport = /** @type {{ x: number, y: number, w: number, h: number } | null} */ (null);
/** Active painting tool: fill works at full VIP or zoomed; brush only while zoomed (null = selection / marquee). */
let zoomPaintTool = /** @type {'fill' | 'brush' | null} */ (null);
/** The brush takes paint off instead of putting it on (the Eraser button). */
let zoomEraseMode = false;
/** What the brush lays down: the paint colour, or nothing at all when erasing. */
const brushColor = () => (zoomEraseMode ? { r: 0, g: 0, b: 0, a: 0 } : readZoomPaintColor());
/** When true, bucket fill may cross 8×8 tile edges (within the paint group footprint). */
let fillAcrossTilesEnabled = false;
/** While non-null, brush stroke is in progress (VIP pixel coords). */
let activeZoomPaintPointer = /** @type {{ pointerId: number, lastVx: number, lastVy: number } | null} */ (null);
/** True from brush pointerdown (after paint checks) until stroke end — avoids per-pixel group gating. */
let zoomPaintStrokeAllowed = false;
/** During zoom brush/fill, map tile hash → 256-byte RGBA snapshot before first mutation in this stroke (for undo). */
let activePaintUndoMap = /** @type {Map<number, Uint8Array>|null} */ (null);
/** Which store the in-progress stroke writes to: a group id, null for the global pack, undefined until the first pixel. */
let activePaintUndoGroupId = /** @type {string|null|undefined} */ (undefined);
/**
 * Zoom paint undo: either per-hash vbcolor tiles (`pack`) or one full VIP snapshot (`vip`) for anchor overlay mode.
 * Max {@link PAINT_UNDO_MAX} entries.
 */
const paintUndoStack =
  /** @type {Array<{ kind: 'pack'; map: Map<number, Uint8Array> } | { kind: 'vip'; groupId: string; eye: number; prev: Uint8Array }>} */ ([]);
const PAINT_UNDO_MAX = 30;

/**
 * Full VIP RGBA (384×224×4), a=0 transparent. Outer key = group id; inner = eye 0|1 so L/R toggles match composite.
 * Switching the selected group does not clear other groups’ overlay buffers.
 */
const vipAuthoringByGroupAndEye = /** @type {Map<string, Map<number, Uint8Array>>} */ (new Map());
/** Scratch buffer for composited underlay (no VIP overlay) used by overlay-mode bucket fill. */
let vipUnderlayScratchForFill = /** @type {ImageData|null} */ (null);
/** Stroke-start snapshot for undo in overlay mode. */
let activeVipOverlayUndoSnapshot = /** @type {{ groupId: string; eye: number; prev: Uint8Array } | null} */ (null);

initVipOverlayPaint({
  get activeVipOverlayUndoSnapshot() { return activeVipOverlayUndoSnapshot; },
  set activeVipOverlayUndoSnapshot(v) { activeVipOverlayUndoSnapshot = v; },
  get groups() { return groups; },
  get H() { return H; },
  get selectedGroupId() { return selectedGroupId; },
  get viewGroupFilterId() { return viewGroupFilterId; },
  get vipAuthoringByGroupAndEye() { return vipAuthoringByGroupAndEye; },
  get W() { return W; },
  get worldFilter() { return worldFilter; },
});

initPaintHistory({
  markGroupsDirty,
  get activePaintUndoGroupId() { return activePaintUndoGroupId; },
  set activePaintUndoGroupId(v) { activePaintUndoGroupId = v; },
  get activePaintUndoMap() { return activePaintUndoMap; },
  set activePaintUndoMap(v) { activePaintUndoMap = v; },
  get activeVipOverlayUndoSnapshot() { return activeVipOverlayUndoSnapshot; },
  set activeVipOverlayUndoSnapshot(v) { activeVipOverlayUndoSnapshot = v; },
  get groups() { return groups; },
  set groups(v) { groups = v; },
  get pack() { return pack; },
  get PAINT_UNDO_MAX() { return PAINT_UNDO_MAX; },
  get paintEditsSinceSave() { return paintEditsSinceSave; },
  set paintEditsSinceSave(v) { paintEditsSinceSave = v; },
  get paintInventoryDialog() { return paintInventoryDialog; },
  get paintUndoStack() { return paintUndoStack; },
  render,
  get selectedGroupId() { return selectedGroupId; },
  setStatus,
  get zoomEraseMode() { return zoomEraseMode; },
});

/** True after eyedropper click until the next main-canvas click samples RGB (fallback when Screen EyeDropper API is unavailable). */
let paintColorPickAwaitingCanvasClick = false;

/** Draw tile grid in zoomed view. */
let zoomGridEnabled = true;
/** @type {string|null} */
let selectedGroupId = null;
/**
 * Captured frames indexed for "which screens show this group" (src/group-screens.js), built in
 * the background after a pack loads. Empty until `screenIndexReady`.
 * `screen` is "" for frames that are not a screen (screensForGroup skips them).
 * @type {Array<{ screen: string, frameIndex: number, index: { keys: Set<string> } }>}
 */
let screenIndexFrames = [];
let screenIndexReady = false;
let screenIndexGeneration = 0;
/** The "Shared by several screens" section of the groups tree starts open. */
let sharedGroupsOpen = true;
/**
 * When set (via **Filter view to group**), {@link filterStateForView} keeps only draws matching that
 * group’s full criteria (world + layer strip + hashes), not every draw in the same world.
 */
let viewGroupFilterId = /** @type {string|null} */ (null);
/** BG anchor UX: click a highlighted group tile to set `anchorHash`; cleared on Esc or cancel. */
let anchorPickGroupId = /** @type {string|null} */ (null);
/** @type {Awaited<ReturnType<typeof parseArtPack>>|null} */
let loadedPackParts = null;
/** @type {string} */
let loadedPackName = 'pack.vbpack';
/**
 * Display name for Colorize! / Save and Play overwrite warning.
 * When it ends with ` (editing)`, Save and Play skips a download and treats the pack as an in-place update.
 */
let packDisplayName = 'none';
/** Chromium File System Access: set after Save/Save as; Save overwrites this file. Cleared on load. */
let painterVbpackSaveFileHandle = /** @type {any} */ (null);
/** gameId embedded in color.vbcolor (preserved on load; used when rebuilding vbcolor on save). */
let loadedVbcolorGameId = 'vb-pack';
/** True if the loaded zip contained a `groups.json` member (even if empty). False = brand-new colorization pack until first save. */
let packHadGroupsJsonOnLoad = false;
/** True when Painter synthesized `gameStatePools` from `manifest.memoryAnalysis` (no groups.json on disk). */
let memoryAnalysisSeededPools = false;
/** @type {Record<string, unknown>|null} */
let painterV2Rules = null;
/** Hash of frontmost tile at last canvas click (full-frame VIP hash); null if none. */
let lastTopTileHash = /** @type {number|null} */ (null);
/**
 * When set, preview + v2 tile8 writes use this variant id.
 * When null, variant is chosen automatically (first pool variant, else __default__).
 * @type {string|null}
 */
let v2Tile8VariantOverride = null;
/** Last frame index used for groups accordion; when it differs from current, reset open state to match the new frame. */
let lastFrameIndexForGroupsAccordion = /** @type {number|null|undefined} */ (undefined);

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

initFileMenu({
  get btnReferenceRevert() { return btnReferenceRevert; },
  get btnReferenceTransform() { return btnReferenceTransform; },
  get canvas() { return canvas; },
  get canvasWrap() { return canvasWrap; },
  clearProjectJournal,
  downloadBlob,
  get fileMenu() { return fileMenu; },
  get frameDetailsCancel() { return frameDetailsCancel; },
  get frameDetailsDialog() { return frameDetailsDialog; },
  get frameDetailsForm() { return frameDetailsForm; },
  get frameMenu() { return frameMenu; },
  get frameMenuAddReference() { return frameMenuAddReference; },
  get frameMenuExportShot() { return frameMenuExportShot; },
  get frameMenuRemoveReference() { return frameMenuRemoveReference; },
  get frameMenuRename() { return frameMenuRename; },
  get frameMenuTags() { return frameMenuTags; },
  get groupsDirty() { return groupsDirty; },
  set groupsDirty(v) { groupsDirty = v; },
  hasUnsavedPainterEdits,
  leavePainterTo,
  get loadedPackName() { return loadedPackName; },
  set loadedPackName(v) { loadedPackName = v; },
  get loadedPackParts() { return loadedPackParts; },
  loadVbpackBuffer,
  get painterVbpackSaveFileHandle() { return painterVbpackSaveFileHandle; },
  set painterVbpackSaveFileHandle(v) { painterVbpackSaveFileHandle = v; },
  get referenceDrag() { return referenceDrag; },
  set referenceDrag(v) { referenceDrag = v; },
  get referenceInput() { return referenceInput; },
  get referenceOverlayEnabled() { return referenceOverlayEnabled; },
  set referenceOverlayEnabled(v) { referenceOverlayEnabled = v; },
  get referenceTransformMode() { return referenceTransformMode; },
  render,
  setStatus,
  get toggleReferenceOverlay() { return toggleReferenceOverlay; },
});

initFrameData({
  get activeFrameScreenshotImage() { return activeFrameScreenshotImage; },
  set activeFrameScreenshotImage(v) { activeFrameScreenshotImage = v; },
  get activeFrameScreenshotUrl() { return activeFrameScreenshotUrl; },
  set activeFrameScreenshotUrl(v) { activeFrameScreenshotUrl = v; },
  get availableFrames() { return availableFrames; },
  fillNewGroupPoolVariantSelect,
  get gameStatePools() { return gameStatePools; },
  set gameStatePools(v) { gameStatePools = v; },
  get lastFrameRegistry() { return lastFrameRegistry; },
  get loadedPackParts() { return loadedPackParts; },
  markGroupsDirty,
  get memoryAnalysisSeededPools() { return memoryAnalysisSeededPools; },
  set memoryAnalysisSeededPools(v) { memoryAnalysisSeededPools = v; },
  populateFrames,
  get ramDumpsByStem() { return ramDumpsByStem; },
  set ramDumpsByStem(v) { ramDumpsByStem = v; },
  get screenshotObjectUrls() { return screenshotObjectUrls; },
  set screenshotObjectUrls(v) { screenshotObjectUrls = v; },
  get screenshotUrlByName() { return screenshotUrlByName; },
  set screenshotUrlByName(v) { screenshotUrlByName = v; },
  get screenshotUrlByStem() { return screenshotUrlByStem; },
  set screenshotUrlByStem(v) { screenshotUrlByStem = v; },
  setStatus,
  updatePoolSummary,
});

initReferenceImages({
  get activePaintUndoGroupId() { return activePaintUndoGroupId; },
  set activePaintUndoGroupId(v) { activePaintUndoGroupId = v; },
  get activePaintUndoMap() { return activePaintUndoMap; },
  set activePaintUndoMap(v) { activePaintUndoMap = v; },
  get activeReferenceImage() { return activeReferenceImage; },
  set activeReferenceImage(v) { activeReferenceImage = v; },
  get activeReferenceMeta() { return activeReferenceMeta; },
  set activeReferenceMeta(v) { activeReferenceMeta = v; },
  get activeReferenceTransform() { return activeReferenceTransform; },
  set activeReferenceTransform(v) { activeReferenceTransform = v; },
  get activeReferenceUrl() { return activeReferenceUrl; },
  set activeReferenceUrl(v) { activeReferenceUrl = v; },
  get availableFrames() { return availableFrames; },
  get btnReferenceRevert() { return btnReferenceRevert; },
  get btnReferenceTransform() { return btnReferenceTransform; },
  get canvasWrap() { return canvasWrap; },
  commitPaintUndoStroke,
  get currentState() { return currentState; },
  ensureVipOverlayBufferForGroupEye,
  findPoolVariantForFrameByRam,
  get frameMenuRemoveReference() { return frameMenuRemoveReference; },
  getCurrentFrameSelectIndex,
  getEye,
  getPackRgba256ForHash,
  getSelectedPaintGroupOrNull,
  get H() { return H; },
  get packReferences() { return packReferences; },
  set packReferences(v) { packReferences = v; },
  get paintEditsSinceSave() { return paintEditsSinceSave; },
  set paintEditsSinceSave(v) { paintEditsSinceSave = v; },
  get paintInventoryDialog() { return paintInventoryDialog; },
  paintTargetGroupOrNull,
  paintTargetHasHash,
  pushPaintUndo,
  get referenceBlobs() { return referenceBlobs; },
  set referenceBlobs(v) { referenceBlobs = v; },
  get referenceDrag() { return referenceDrag; },
  set referenceDrag(v) { referenceDrag = v; },
  get referenceOverlayEnabled() { return referenceOverlayEnabled; },
  set referenceOverlayEnabled(v) { referenceOverlayEnabled = v; },
  get referencesDirty() { return referencesDirty; },
  set referencesDirty(v) { referencesDirty = v; },
  get referenceStatus() { return referenceStatus; },
  get referenceTransformMode() { return referenceTransformMode; },
  set referenceTransformMode(v) { referenceTransformMode = v; },
  get referenceUrls() { return referenceUrls; },
  set referenceUrls(v) { referenceUrls = v; },
  render,
  renderPaintInventory,
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  setStatus,
  syncLastTopTileFromSelection,
  syncOverlayAlphaUi,
  get toggleReferenceOverlay() { return toggleReferenceOverlay; },
  updatePaintV2TopButton,
  updateSelectionUi,
  useVipOverlayForZoomPaint,
  get W() { return W; },
  get zoomPaintTool() { return zoomPaintTool; },
  set zoomPaintTool(v) { zoomPaintTool = v; },
  get zoomViewport() { return zoomViewport; },
});

initFrameActions({
  get activeFrameScreenshotImage() { return activeFrameScreenshotImage; },
  set activeFrameScreenshotImage(v) { activeFrameScreenshotImage = v; },
  get activeFrameScreenshotUrl() { return activeFrameScreenshotUrl; },
  set activeFrameScreenshotUrl(v) { activeFrameScreenshotUrl = v; },
  get activeReferenceImage() { return activeReferenceImage; },
  get activeReferenceTransform() { return activeReferenceTransform; },
  get availableFrames() { return availableFrames; },
  get ctx() { return ctx; },
  downloadBlob,
  get frameDetailsDialog() { return frameDetailsDialog; },
  get frameDetailsName() { return frameDetailsName; },
  get frameDetailsSummary() { return frameDetailsSummary; },
  get frameDetailsTags() { return frameDetailsTags; },
  get frameMenuAddReference() { return frameMenuAddReference; },
  get frameMenuExportShot() { return frameMenuExportShot; },
  get frameMenuLabel() { return frameMenuLabel; },
  get frameMenuRename() { return frameMenuRename; },
  get frameMenuTags() { return frameMenuTags; },
  get frameRegistryDirty() { return frameRegistryDirty; },
  set frameRegistryDirty(v) { frameRegistryDirty = v; },
  get frameSelect() { return frameSelect; },
  getCurrentFrameSelectIndex,
  getEye,
  get H() { return H; },
  get lastFrameRegistry() { return lastFrameRegistry; },
  set lastFrameRegistry(v) { lastFrameRegistry = v; },
  get loadedVbcolorGameId() { return loadedVbcolorGameId; },
  populateFrames,
  get referenceOverlayEnabled() { return referenceOverlayEnabled; },
  get referenceTransformMode() { return referenceTransformMode; },
  render,
  get screenshotOverlayEnabled() { return screenshotOverlayEnabled; },
  get screenshotOverlayOpacity() { return screenshotOverlayOpacity; },
  get screenshotUrlByName() { return screenshotUrlByName; },
  get screenshotUrlByStem() { return screenshotUrlByStem; },
  setStatus,
  get shotOverlayAlpha() { return shotOverlayAlpha; },
  get toggleShotOverlay() { return toggleShotOverlay; },
  get W() { return W; },
  get zoomViewport() { return zoomViewport; },
});

initPackRules({
  get availableFrames() { return availableFrames; },
  get btnPaintV2Top() { return btnPaintV2Top; },
  get currentState() { return currentState; },
  ensureVipOverlayBufferForGroupEye,
  get gameStatePools() { return gameStatePools; },
  get groups() { return groups; },
  set groups(v) { groups = v; },
  get groupsDirty() { return groupsDirty; },
  set groupsDirty(v) { groupsDirty = v; },
  get H() { return H; },
  invalidateGroupColorIndex,
  get lastTopTileHash() { return lastTopTileHash; },
  get loadedPackParts() { return loadedPackParts; },
  markGroupsDirty,
  get overrides() { return overrides; },
  get pack() { return pack; },
  set pack(v) { pack = v; },
  get paintEditsSinceSave() { return paintEditsSinceSave; },
  set paintEditsSinceSave(v) { paintEditsSinceSave = v; },
  get painterV2Rules() { return painterV2Rules; },
  set painterV2Rules(v) { painterV2Rules = v; },
  render,
  setStatus,
  get v2Authoring() { return v2Authoring; },
  get v2Tile8VariantOverride() { return v2Tile8VariantOverride; },
  get v2VariantSelect() { return v2VariantSelect; },
  get vipAuthoringByGroupAndEye() { return vipAuthoringByGroupAndEye; },
  get W() { return W; },
});

initSelection({
  get activeMarqueePointer() { return activeMarqueePointer; },
  set activeMarqueePointer(v) { activeMarqueePointer = v; },
  get activePaintUndoMap() { return activePaintUndoMap; },
  set activePaintUndoMap(v) { activePaintUndoMap = v; },
  get activeVipOverlayUndoSnapshot() { return activeVipOverlayUndoSnapshot; },
  set activeVipOverlayUndoSnapshot(v) { activeVipOverlayUndoSnapshot = v; },
  get activeZoomPaintPointer() { return activeZoomPaintPointer; },
  set activeZoomPaintPointer(v) { activeZoomPaintPointer = v; },
  affineCopyPixels,
  affineMapForEye,
  get anchorPickGroupId() { return anchorPickGroupId; },
  set anchorPickGroupId(v) { anchorPickGroupId = v; },
  get btnCanvasSelect() { return btnCanvasSelect; },
  get btnImportAsset() { return btnImportAsset; },
  get btnNewGroupFromSelection() { return btnNewGroupFromSelection; },
  get btnNewPoseFromSelection() { return btnNewPoseFromSelection; },
  get btnPaintBrush() { return btnPaintBrush; },
  get btnPaintColorPick() { return btnPaintColorPick; },
  get btnPaintErase() { return btnPaintErase; },
  get btnPaintFill() { return btnPaintFill; },
  get btnSelectMatching() { return btnSelectMatching; },
  get btnZoomGrid() { return btnZoomGrid; },
  get btnZoomSelection() { return btnZoomSelection; },
  get canvas() { return canvas; },
  get canvasWrap() { return canvasWrap; },
  collectVisibleIndicesForHit,
  get currentState() { return currentState; },
  drawEye,
  drawMatchesGroup,
  drawSelectionOverlay,
  escapeHtml,
  get fillAcrossTilesEnabled() { return fillAcrossTilesEnabled; },
  get fillAcrossTilesInput() { return fillAcrossTilesInput; },
  filterStateForView,
  getEye,
  getZoomPaintBlockedReason,
  get groups() { return groups; },
  get H() { return H; },
  get includeBlankTiles() { return includeBlankTiles; },
  get inspector() { return inspector; },
  isAffineRecord,
  isBlankDraw,
  get lastFrameRegistry() { return lastFrameRegistry; },
  get lastTopTileHash() { return lastTopTileHash; },
  set lastTopTileHash(v) { lastTopTileHash = v; },
  get loadedPackParts() { return loadedPackParts; },
  get marqueeState() { return marqueeState; },
  set marqueeState(v) { marqueeState = v; },
  get overlayCanvas() { return overlayCanvas; },
  get paintColorPickAwaitingCanvasClick() { return paintColorPickAwaitingCanvasClick; },
  render,
  sameHashDuplicateStatsForSingleSelection,
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  syncFrameStepButtons,
  get tileSelectionHint() { return tileSelectionHint; },
  toolbarImg,
  updateGroupsPoolContextHint,
  updateInspector,
  get W() { return W; },
  get ZOOM_SQUARE() { return ZOOM_SQUARE; },
  get zoomEraseMode() { return zoomEraseMode; },
  get zoomGridEnabled() { return zoomGridEnabled; },
  get zoomPaintStrokeAllowed() { return zoomPaintStrokeAllowed; },
  set zoomPaintStrokeAllowed(v) { zoomPaintStrokeAllowed = v; },
  get zoomPaintTool() { return zoomPaintTool; },
  set zoomPaintTool(v) { zoomPaintTool = v; },
  get zoomViewport() { return zoomViewport; },
  set zoomViewport(v) { zoomViewport = v; },
});

initViewFilters({
  // Saved frame summaries (tools/painter/frame-summaries.js).
  get loadedPackParts() { return loadedPackParts; },
  get availableFrames() { return availableFrames; },
  get currentState() { return currentState; },
  drawMatchesGroup,
  escapeHtml,
  get eyeSelect() { return eyeSelect; },
  get groups() { return groups; },
  get H() { return H; },
  get layerSelect() { return layerSelect; },
  get painterWorldDebug() { return painterWorldDebug; },
  syncWorldButtons,
  get viewGroupFilterId() { return viewGroupFilterId; },
  get W() { return W; },
  get worldFilter() { return worldFilter; },
  get worldFilterDebug() { return worldFilterDebug; },
  get zoomViewport() { return zoomViewport; },
});

initZoomTarget({
  affineMapForEye,
  collectVisibleIndicesForHit,
  countSameHashWorldLayerEye,
  get currentState() { return currentState; },
  drawSelectionOverlay,
  escapeHtml,
  get gameStatePools() { return gameStatePools; },
  get groups() { return groups; },
  hitDrawIndices,
  get includeBlankTiles() { return includeBlankTiles; },
  isAffineRecord,
  isBlankDraw,
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  get selectedGroupId() { return selectedGroupId; },
  setStatus,
  get stackPanelEnabled() { return stackPanelEnabled; },
  get W() { return W; },
});

initPaintInventoryUi({
  get currentState() { return currentState; },
  ensureGroupTileColorMap,
  escapeHtml,
  get groups() { return groups; },
  set groups(v) { groups = v; },
  get H() { return H; },
  invalidateGroupColorIndex,
  markGroupsDirty,
  get pack() { return pack; },
  get PAINT_UNDO_MAX() { return PAINT_UNDO_MAX; },
  get paintEditsSinceSave() { return paintEditsSinceSave; },
  set paintEditsSinceSave(v) { paintEditsSinceSave = v; },
  get paintInventoryDialog() { return paintInventoryDialog; },
  get paintUndoStack() { return paintUndoStack; },
  pushPaintUndo,
  render,
  setStatus,
  updateGroupDetail,
  updateGroupsPanel,
  get vipAuthoringByGroupAndEye() { return vipAuthoringByGroupAndEye; },
  get W() { return W; },
});

/** Let go of the selected group: no cyan outlines, no group-scoped view filter. */
function deselectGroup(message = '') {
  if (!selectedGroupId) return;
  selectedGroupId = null;
  if (viewGroupFilterId) viewGroupFilterId = null;
  updateGroupsPanel();
  updateGroupDetail(null);
  drawSelectionOverlay();
  updateSelectionUi();
  render();
  if (message) setStatus(message);
}

/** Filters changed: a selected group with nothing left on screen stops being selected. */
function deselectSelectedGroupIfFilteredOut() {
  if (!selectedGroupId || !currentState?.drawList?.length) return;
  const g = groups.find((x) => x.id === selectedGroupId);
  if (!g || viewGroupFilterId === g.id) return; // its own filter is meant to narrow the view
  if (collectFullFrameIndicesMatchingGroup(g).length > 0) return;
  deselectGroup(`“${g.name || g.id}” has no tiles left in this view, so it was deselected.`);
}

function selectAllDrawsMatchingGroup(g) {
  if (!currentState?.drawList) {
    setStatus('Load a frame first.');
    return;
  }
  const indices = collectFullFrameIndicesMatchingGroup(g);
  selectedDrawFullIndices.clear();
  for (const fi of indices) selectedDrawFullIndices.add(fi);
  syncLastTopTileFromSelection();
  drawSelectionOverlay();
  updateSelectionUi();
  refreshInspectorFromSelection();
  updatePaintV2TopButton();
  setStatus(`Selected ${indices.length} draw(s) matching group “${g.name || g.id}” (same rules as Zoom to group).`);
}

/**
 * Make every tile of the group on this frame visible: turn on the worlds it is drawn in
 * (added to the worlds already on, never replacing them) and drop a layer filter that hides
 * some of it.
 * @returns {{ count: number, addedWorlds: string[], layerReset: boolean }}
 */
function revealGroupOnFrame(g) {
  const res = { count: 0, addedWorlds: /** @type {string[]} */ ([]), layerReset: false };
  if (!currentState?.drawList) return res;
  const worlds = new Set();
  const layers = new Set();
  for (const fi of collectFullFrameIndicesMatchingGroup(g)) {
    const d = currentState.drawList[fi];
    res.count++;
    if (d.world != null) worlds.add(normWorldKey(d.world));
    if (d.layer != null) layers.add(String(d.layer));
  }
  if (!res.count) return res;
  if (worldFilter !== 'all') {
    const missing = [...worlds].filter((w) => !worldFilter.has(w));
    if (missing.length) {
      worldFilter = new Set([...worldFilter, ...missing]);
      res.addedWorlds = missing.sort((a, b) => Number(a) - Number(b));
    }
  }
  const layerNow = layerSelect?.value;
  if (layerSelect && layerNow && layerNow !== 'all' && [...layers].some((l) => l !== layerNow)) {
    layerSelect.value = 'all';
    res.layerReset = true;
  }
  if (res.addedWorlds.length || res.layerReset) {
    syncWorldButtons();
    updateWorldFilterDebug();
  }
  return res;
}

/** Clicking a group in the tree: select it and all of its tiles on this frame, made visible. */
function selectGroupFromTree(g) {
  selectedGroupId = g.id;
  recordGroupUse(g.id); // the New pose dialog lists recently used groups first
  viewGroupFilterId = null;
  const shown = revealGroupOnFrame(g);
  updateGroupsPanel();
  updateGroupDetail(g);
  const label = g.name || g.id;
  if (!shown.count) {
    selectedDrawFullIndices.clear();
    drawSelectionOverlay();
    updateSelectionUi();
    render();
    setStatus(`“${label}” is selected — it has no tiles on this frame.`);
    return;
  }
  selectAllDrawsMatchingGroup(g);
  render();
  const turnedOn = [
    shown.addedWorlds.length ? `turned on world${shown.addedWorlds.length > 1 ? 's' : ''} ${shown.addedWorlds.join(', ')}` : '',
    shown.layerReset ? 'showing all layers' : '',
  ].filter(Boolean);
  setStatus(`Selected “${label}”: ${shown.count} tile(s) on this frame${turnedOn.length ? ` · ${turnedOn.join(' · ')} so you can see them` : ''}.`);
}

initScreensUi({
  // Saved frame summaries (tools/painter/frame-summaries.js).
  get loadedPackParts() { return loadedPackParts; },
  get availableFrames() { return availableFrames; },
  createGroupRow,
  escapeHtml,
  frameStatesByIndex,
  get gameStatePools() { return gameStatePools; },
  get gameStates() { return gameStates; },
  set gameStates(v) { gameStates = v; },
  getCurrentFrameSelectIndex,
  get groupDetail() { return groupDetail; },
  get groups() { return groups; },
  set groups(v) { groups = v; },
  get groupsTree() { return groupsTree; },
  markGroupsDirty,
  render,
  get screenIndexFrames() { return screenIndexFrames; },
  set screenIndexFrames(v) { screenIndexFrames = v; },
  get screenIndexGeneration() { return screenIndexGeneration; },
  set screenIndexGeneration(v) { screenIndexGeneration = v; },
  get screenIndexReady() { return screenIndexReady; },
  set screenIndexReady(v) { screenIndexReady = v; },
  get selectedGroupId() { return selectedGroupId; },
  setStatus,
  get sharedGroupsOpen() { return sharedGroupsOpen; },
  set sharedGroupsOpen(v) { sharedGroupsOpen = v; },
  updateGroupDetail,
  updateGroupsPanel,
});

/**
 * When exactly one tile is selected, count draws on the active eye that share its pattern hash (including the selected draw).
 * @returns {{ hash: number, sameHashCount: number, otherCount: number } | null}
 */
function sameHashDuplicateStatsForSingleSelection() {
  if (selectedDrawFullIndices.size !== 1 || !currentState?.patternTable) return null;
  const [onlyFi] = [...selectedDrawFullIndices];
  const d0 = currentState.drawList[onlyFi];
  if (!d0 || drawEye(d0) !== getEye()) return null;
  const pt = currentState.patternTable;
  const targetHash = hashTile(getTileBytes(pt, d0.tileIndex)) >>> 0;
  const eye = getEye();
  let sameHashCount = 0;
  for (let fi = 0; fi < currentState.drawList.length; fi++) {
    const d = currentState.drawList[fi];
    if (!d || drawEye(d) !== eye) continue;
    if ((hashTile(getTileBytes(pt, d.tileIndex)) >>> 0) === targetHash) sameHashCount++;
  }
  return { hash: targetHash, sameHashCount, otherCount: sameHashCount - 1 };
}

initWorldGrid({
  affineMapForEye,
  get anchorPickGroupId() { return anchorPickGroupId; },
  get currentState() { return currentState; },
  deselectSelectedGroupIfFilteredOut,
  get groups() { return groups; },
  get H() { return H; },
  isAffineRecord,
  get layerSelect() { return layerSelect; },
  get marqueeState() { return marqueeState; },
  get octx() { return octx; },
  get overlayCanvas() { return overlayCanvas; },
  render,
  get scratchOverlay() { return scratchOverlay; },
  get scratchOverlayCtx() { return scratchOverlayCtx; },
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  get selectedGroupId() { return selectedGroupId; },
  set selectedGroupId(v) { selectedGroupId = v; },
  setStatus,
  updateGroupDetail,
  updateGroupsPanel,
  updateGroupsPoolContextHint,
  updatePoolSummary,
  get viewGroupFilterId() { return viewGroupFilterId; },
  set viewGroupFilterId(v) { viewGroupFilterId = v; },
  get W() { return W; },
  get worldFilter() { return worldFilter; },
  set worldFilter(v) { worldFilter = v; },
  get worldGrid() { return worldGrid; },
  get zoomGridEnabled() { return zoomGridEnabled; },
  get zoomViewport() { return zoomViewport; },
});

initGroupDetail({
  addSelectedHashesToGroupCriteria,
  applyRenameGroupFromInspector,
  get availableFrames() { return availableFrames; },
  clearGroupAnchor,
  get currentState() { return currentState; },
  deleteGroupById,
  deselectGroup,
  escapeHtml,
  findDefaultPoolVariantForFrame,
  get gameStatePools() { return gameStatePools; },
  getCurrentFrameSelectIndex,
  get groupDetail() { return groupDetail; },
  get groups() { return groups; },
  set groups(v) { groups = v; },
  handlePoseAction,
  get loadedPackParts() { return loadedPackParts; },
  markGroupsDirty,
  get memoryAnalysisSeededPools() { return memoryAnalysisSeededPools; },
  get newGroupMembership() { return newGroupMembership; },
  openDuplicateGroupDialog,
  get packHadGroupsJsonOnLoad() { return packHadGroupsJsonOnLoad; },
  paintStoreNote,
  readNewGroupKind,
  removeSelectedHashesFromGroupCriteria,
  render,
  selectAllDrawsMatchingGroup,
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  get selectedGroupId() { return selectedGroupId; },
  setStatus,
  startAnchorPickForGroup,
  toolbarImg,
  updateGroupsPanel,
  get viewGroupFilterId() { return viewGroupFilterId; },
});

initProjectDialogs({
  get availableFrames() { return availableFrames; },
  cleanUpFrames,
  explainInspectPoint,
  get frameSelect() { return frameSelect; },
  get gameStatePools() { return gameStatePools; },
  get gameStates() { return gameStates; },
  getCurrentFrameSelectIndex,
  getRegistryFrameIdForFrameIndex,
  get groups() { return groups; },
  set groups(v) { groups = v; },
  get health() { return health; },
  set health(v) { health = v; },
  get inspectPoint() { return inspectPoint; },
  set inspectPoint(v) { inspectPoint = v; },
  get loadedPackParts() { return loadedPackParts; },
  markGroupsDirty,
  get pack() { return pack; },
  get packFileBytes() { return packFileBytes; },
  get recordingSamplesCache() { return recordingSamplesCache; },
  set recordingSamplesCache(v) { recordingSamplesCache = v; },
  render,
  get selectedGroupId() { return selectedGroupId; },
  selectGroupFromTree,
  setStatus,
  updateGroupsPanel,
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initPools({
  get availableFrames() { return availableFrames; },
  get btnClearGroupFilter() { return btnClearGroupFilter; },
  get currentState() { return currentState; },
  escapeHtml,
  get frameSelect() { return frameSelect; },
  get gameStatePools() { return gameStatePools; },
  get gameStates() { return gameStates; },
  get groups() { return groups; },
  get groupsDirty() { return groupsDirty; },
  set groupsDirty(v) { groupsDirty = v; },
  get lastFrameRegistry() { return lastFrameRegistry; },
  get lastManifestCurrentVipRef() { return lastManifestCurrentVipRef; },
  get layerSelect() { return layerSelect; },
  get loadedPackParts() { return loadedPackParts; },
  get newGroupPoolVariant() { return newGroupPoolVariant; },
  get packHadGroupsJsonOnLoad() { return packHadGroupsJsonOnLoad; },
  render,
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  setStatus,
  updatePoolSummary,
  get viewGroupFilterId() { return viewGroupFilterId; },
  set viewGroupFilterId(v) { viewGroupFilterId = v; },
  get worldFilter() { return worldFilter; },
  set worldFilter(v) { worldFilter = v; },
});

initGroupDialogs({
  markGroupsDirty,
  get anchorPickGroupId() { return anchorPickGroupId; },
  set anchorPickGroupId(v) { anchorPickGroupId = v; },
  get availableFrames() { return availableFrames; },
  countSameHashWorldLayerEye,
  get currentState() { return currentState; },
  get dupGroupPoolVariant() { return dupGroupPoolVariant; },
  get duplicateGroupDialog() { return duplicateGroupDialog; },
  escapeHtml,
  get gameStatePools() { return gameStatePools; },
  get groups() { return groups; },
  set groups(v) { groups = v; },
  invalidateGroupColorIndex,
  get newGroupDialog() { return newGroupDialog; },
  get newGroupDialogFrameVariant() { return newGroupDialogFrameVariant; },
  set newGroupDialogFrameVariant(v) { newGroupDialogFrameVariant = v; },
  get newGroupKindBg() { return newGroupKindBg; },
  get newGroupKindObj() { return newGroupKindObj; },
  get newGroupName() { return newGroupName; },
  get newGroupOverlap() { return newGroupOverlap; },
  get newGroupPoolVariant() { return newGroupPoolVariant; },
  get overrides() { return overrides; },
  set overrides(v) { overrides = v; },
  get pack() { return pack; },
  get packHadGroupsJsonOnLoad() { return packHadGroupsJsonOnLoad; },
  get pendingDuplicateSourceId() { return pendingDuplicateSourceId; },
  set pendingDuplicateSourceId(v) { pendingDuplicateSourceId = v; },
  pushPaintUndo,
  render,
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  get selectedGroupId() { return selectedGroupId; },
  set selectedGroupId(v) { selectedGroupId = v; },
  setStatus,
  updateGroupsPanel,
  get viewGroupFilterId() { return viewGroupFilterId; },
  set viewGroupFilterId(v) { viewGroupFilterId = v; },
  get vipAuthoringByGroupAndEye() { return vipAuthoringByGroupAndEye; },
});

initSave({
  markGroupsDirty,
  get availableFrames() { return availableFrames; },
  set availableFrames(v) { availableFrames = v; },
  get btnRetryHandoff() { return btnRetryHandoff; },
  get btnSaveAndPlay() { return btnSaveAndPlay; },
  clearProjectJournal,
  closePainterFileMenu,
  get currentState() { return currentState; },
  downloadBlob,
  get eyeSelect() { return eyeSelect; },
  get frameRegistryDirty() { return frameRegistryDirty; },
  set frameRegistryDirty(v) { frameRegistryDirty = v; },
  get frameSelect() { return frameSelect; },
  get gameStatePools() { return gameStatePools; },
  get gameStates() { return gameStates; },
  getVbpackSaveSuggestedFileName,
  get groups() { return groups; },
  set groups(v) { groups = v; },
  get groupsDirty() { return groupsDirty; },
  set groupsDirty(v) { groupsDirty = v; },
  hasUnsavedPainterEdits,
  get lastFrameRegistry() { return lastFrameRegistry; },
  set lastFrameRegistry(v) { lastFrameRegistry = v; },
  get layerSelect() { return layerSelect; },
  leavePainterTo,
  get loadedGroupsSchemaVersion() { return loadedGroupsSchemaVersion; },
  set loadedGroupsSchemaVersion(v) { loadedGroupsSchemaVersion = v; },
  get loadedPackName() { return loadedPackName; },
  set loadedPackName(v) { loadedPackName = v; },
  get loadedPackParts() { return loadedPackParts; },
  get loadedVbcolorGameId() { return loadedVbcolorGameId; },
  loadVbpackBuffer,
  offerProjectJournalRestore,
  get overridePresets() { return overridePresets; },
  get overrides() { return overrides; },
  get pack() { return pack; },
  get packDisplayName() { return packDisplayName; },
  set packDisplayName(v) { packDisplayName = v; },
  get packFileBytes() { return packFileBytes; },
  set packFileBytes(v) { packFileBytes = v; },
  get packReferences() { return packReferences; },
  get paintEditsSinceSave() { return paintEditsSinceSave; },
  set paintEditsSinceSave(v) { paintEditsSinceSave = v; },
  get painterVbpackSaveFileHandle() { return painterVbpackSaveFileHandle; },
  set painterVbpackSaveFileHandle(v) { painterVbpackSaveFileHandle = v; },
  populateFrames,
  get referencesDirty() { return referencesDirty; },
  set referencesDirty(v) { referencesDirty = v; },
  render,
  savePainterVbpackBlob,
  get selectedGroupId() { return selectedGroupId; },
  set selectedGroupId(v) { selectedGroupId = v; },
  setStatus,
  updateGroupsPanel,
  get viewGroupFilterId() { return viewGroupFilterId; },
  set viewGroupFilterId(v) { viewGroupFilterId = v; },
  get zoomViewport() { return zoomViewport; },
  set zoomViewport(v) { zoomViewport = v; },
});

initGroupsPanel({
  get currentState() { return currentState; },
  get gameStatePools() { return gameStatePools; },
  get groups() { return groups; },
  get groupsTree() { return groupsTree; },
  get lastFrameIndexForGroupsAccordion() { return lastFrameIndexForGroupsAccordion; },
  set lastFrameIndexForGroupsAccordion(v) { lastFrameIndexForGroupsAccordion = v; },
  get memoryAnalysisSeededPools() { return memoryAnalysisSeededPools; },
  get packHadGroupsJsonOnLoad() { return packHadGroupsJsonOnLoad; },
  get poolSummary() { return poolSummary; },
  get selectedGroupId() { return selectedGroupId; },
  selectGroupFromTree,
});

initFrameList({
  get availableFrames() { return availableFrames; },
  get btnReload() { return btnReload; },
  clearVipAuthoringOverlay,
  get currentState() { return currentState; },
  set currentState(v) { currentState = v; },
  get frameSelect() { return frameSelect; },
  get gameStatePools() { return gameStatePools; },
  get groups() { return groups; },
  get loadedPackParts() { return loadedPackParts; },
  get overrides() { return overrides; },
  get pack() { return pack; },
  get painterV2Rules() { return painterV2Rules; },
  get paintUndoStack() { return paintUndoStack; },
  render,
  get selectedGroupId() { return selectedGroupId; },
  set selectedGroupId(v) { selectedGroupId = v; },
  setStatus,
  get v2Tile8VariantOverride() { return v2Tile8VariantOverride; },
  set v2Tile8VariantOverride(v) { v2Tile8VariantOverride = v; },
  get viewGroupFilterId() { return viewGroupFilterId; },
  set viewGroupFilterId(v) { viewGroupFilterId = v; },
});

initZoomPaint({
  markGroupsDirty,
  get activePaintUndoGroupId() { return activePaintUndoGroupId; },
  set activePaintUndoGroupId(v) { activePaintUndoGroupId = v; },
  get activePaintUndoMap() { return activePaintUndoMap; },
  get anchorPickGroupId() { return anchorPickGroupId; },
  set anchorPickGroupId(v) { anchorPickGroupId = v; },
  get canvas() { return canvas; },
  get ctx() { return ctx; },
  get currentState() { return currentState; },
  ensureVipAuthoringOverlay,
  get fillAcrossTilesEnabled() { return fillAcrossTilesEnabled; },
  fillGroupMemberVipFootprintMask,
  get gameStatePools() { return gameStatePools; },
  get groups() { return groups; },
  set groups(v) { groups = v; },
  get H() { return H; },
  get includeBlankTiles() { return includeBlankTiles; },
  get overrides() { return overrides; },
  get pack() { return pack; },
  get painterPaintDebug() { return painterPaintDebug; },
  get painterV2Rules() { return painterV2Rules; },
  recordPackUndoSnapForHash,
  render,
  get scratchCompositeCtx() { return scratchCompositeCtx; },
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  setStatus,
  get viewGroupFilterId() { return viewGroupFilterId; },
  footprintMaskScratch,
  get vipUnderlayScratchForFill() { return vipUnderlayScratchForFill; },
  set vipUnderlayScratchForFill(v) { vipUnderlayScratchForFill = v; },
  get W() { return W; },
  get ZOOM_DEFAULT_RAMP() { return ZOOM_DEFAULT_RAMP; },
  get zoomEraseMode() { return zoomEraseMode; },
  get zoomPaintStrokeAllowed() { return zoomPaintStrokeAllowed; },
  get zoomViewport() { return zoomViewport; },
});

initInspector({
  get activeReferenceMeta() { return activeReferenceMeta; },
  get currentState() { return currentState; },
  escapeHtml,
  get gameStatePools() { return gameStatePools; },
  get groups() { return groups; },
  get inspectAnswer() { return inspectAnswer; },
  set inspectAnswer(v) { inspectAnswer = v; },
  get inspector() { return inspector; },
  get inspectPoint() { return inspectPoint; },
  set inspectPoint(v) { inspectPoint = v; },
  get layerSelect() { return layerSelect; },
  get overrides() { return overrides; },
  get pack() { return pack; },
  get referenceUrls() { return referenceUrls; },
  render,
  get screenshotOverlayEnabled() { return screenshotOverlayEnabled; },
  selectGroupFromTree,
  get worldFilter() { return worldFilter; },
});

function render() {
  if (!ctx || !canvas || !scratchCompositeCtx) return;
  const dw = canvas.width || W;
  const dh = canvas.height || H;
  if (!currentState?.drawList?.length || !currentState.patternTable) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, dw, dh);
    drawSelectionOverlay();
    updateWorldFilterDebug();
    updateGroupsPoolContextHint();
    return;
  }
  const viewState = stateForComposite(currentState);
  const imageData = ctx.createImageData(W, H);
  // The tools' preview (src/project.js) in the Project tool's red ramp, at its preview brightness.
  compositeColorFrameForEye(viewState, pack, imageData, colourOptions({ overrides, groups, gameStatePools, painterV2Rules }, 'toolPreview', {
    eye: getEye(),
    wram: currentFrameWram(),
    painterV2VariantId: getActiveV2VariantId(),
    diagnosticMonoFallback: true,
    monoFallbackGain: previewBrightness,
  }));

  if (inspectPoint) explainFromComposite(viewState);
  blendVipAuthoringIntoImageData(imageData, viewState);
  applyFrameHighlight(imageData, viewState);
  scratchCompositeCtx.putImageData(imageData, 0, 0);
  if (zoomViewport) {
    const { x, y, w, h } = zoomViewport;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(scratchComposite, x, y, w, h, 0, 0, dw, dh);
    drawScreenshotOverlay(dw, dh);
    drawReferenceOverlay(dw, dh);
  } else {
    ctx.putImageData(imageData, 0, 0);
    drawScreenshotOverlay(dw, dh);
    drawReferenceOverlay(dw, dh);
  }
  drawSelectionOverlay();
  updateWorldFilterDebug();
  updateGroupsPoolContextHint();
}

/**
 * Open a .vbpack using the File System Access API when available so **Save** can overwrite the same file.
 * Prefers the project home folder as `startIn`. Falls back to the hidden file input (no retained handle).
 */
async function openVbpackFromMenu() {
  const discarding = hasUnsavedPainterEdits();
  if (discarding && !window.confirm(discardProjectChangesPrompt('Open pack'))) return;
  const picked = await pickOpenVbpackFile();
  if (picked.status === 'ok') {
    if (discarding) await clearProjectJournal();
    await loadVbpackBuffer(picked.buffer, picked.name);
    painterVbpackSaveFileHandle = picked.fileHandle;
    await offerProjectJournalRestore();
    return;
  }
  if (picked.status === 'aborted') return;
  if (picked.status === 'error') {
    console.warn('[painter] showOpenFilePicker failed, using legacy file input:', picked.error);
  }
  fileVbpack?.click();
}

async function refreshPainterProjectHomeUi() {
  const status = await getHomeStatus().catch(() => ({ state: 'unset', name: '' }));
  if (fileMenuHomeLabel) {
    fileMenuHomeLabel.textContent = `Home: ${formatHomeStatusLabel(status)}`;
  }
  if (fileMenuHomeChoose) {
    fileMenuHomeChoose.disabled = status.state === 'unsupported';
    fileMenuHomeChoose.title =
      status.state === 'unsupported'
        ? 'Folder picker requires Chromium (File System Access API).'
        : 'Choose a folder for Open / Save (shared with the emulator).';
  }
  // Chrome forgets folder permission when the tab closes; one click restores it.
  if (fileMenuHomeGrant) {
    fileMenuHomeGrant.hidden = status.state !== 'needs-permission';
    fileMenuHomeGrant.title = `Let this page use “${status.name}” again (browsers ask once per session).`;
  }
  if (fileMenuHomeClear) {
    fileMenuHomeClear.disabled = status.state === 'unsupported' || status.state === 'unset';
  }
}

async function loadVbpackBuffer(buffer, label) {
  clearPainterVbpackSaveFileHandle();
  const result = await parseArtPack(buffer);
  // Count of overlay layers restored after VIP load (loadVipFromJson clears authoring; see end of this function).
  let vipOverlayLayersLoaded = 0;
  packHadGroupsJsonOnLoad = result.groupsJsonInPack === true;
  lastFrameIndexForGroupsAccordion = undefined;
  anchorPickGroupId = null;
  loadedPackParts = result;
  loadedPackName = label || 'pack.vbpack';
  packDisplayName = loadedPackName;
  // The colour project, read the way every app reads it (src/project.js): pack colours, overrides,
  // groups through the group schema, screens, game states, the older rules.
  const project = projectFromParsed(result, { label: loadedPackName });
  painterV2Rules = project.painterV2Rules ? { ...project.painterV2Rules } : null;
  pack = project.pack;
  paintUndoStack.length = 0;
  paintRedoStack.length = 0;
  activePaintUndoMap = null;
  activeVipOverlayUndoSnapshot = null;
  clearVipAuthoringOverlay();
  zoomPaintStrokeAllowed = false;
  loadedVbcolorGameId = project.gameId || 'vb-pack';
  overrides = project.overrides;
  groups = project.groups;
  gameStatePools = project.gameStatePools;
  setGameStates(project.gameStates);
  overridePresets = Array.isArray(result.overridePresets) ? result.overridePresets : [];
  loadedGroupsSchemaVersion = typeof result.groupsSchemaVersion === 'number' ? result.groupsSchemaVersion : undefined;
  memoryAnalysisSeededPools = false;
  groupsDirty = false;
  if (loadedPackParts) {
    try {
      loadedPackParts.groups = structuredClone(groups);
    } catch {
      loadedPackParts.groups = JSON.parse(JSON.stringify(groups));
    }
  }
  if (!packHadGroupsJsonOnLoad) {
    const seeded = seedGameStatePoolsFromMemoryAnalysis(result.manifest?.memoryAnalysis);
    if (seeded.length > 0) {
      gameStatePools = seeded;
      loadedGroupsSchemaVersion = 2;
      memoryAnalysisSeededPools = true;
      groupsDirty = true;
      if (loadedPackParts) {
        try {
          loadedPackParts.gameStatePools = structuredClone(gameStatePools);
        } catch {
          loadedPackParts.gameStatePools = JSON.parse(JSON.stringify(gameStatePools));
        }
        loadedPackParts.groupsSchemaVersion = 2;
      }
    }
  }

  // Frames without a short number get one (src/frame-numbers.js); the next Save keeps them.
  lastFrameRegistry = project.frameRegistry;
  primeScreenshotStore(result.screenshotsFolder);
  primeReferenceStore(result.referencesFolder, result.manifest?.references);
  frameRegistryDirty = false;
  primeRamDumpStore(result.ramdumpsFolder);
  lastManifestCurrentVipRef =
    result.manifest && typeof result.manifest.currentVipStateRef === 'string' && result.manifest.currentVipStateRef.trim()
      ? result.manifest.currentVipStateRef.trim()
      : 'vipstate-current.json';

  const vipStateStr = normalizeVipJsonForFrameField(result.vipState);
  let vipLoadedFromRootVip = false;
  if (vipStateStr != null && vipStateStr.length > 0) {
    try {
      const v = validateVIPState(JSON.parse(vipStateStr));
      vipLoadedFromRootVip = v.valid;
    } catch {
      vipLoadedFromRootVip = false;
    }
  }

  availableFrames = [];
  if (vipStateStr != null && vipStateStr.length > 0) {
    const curLeaf = lastManifestCurrentVipRef.trim().replace(/^vipstates\//i, '');
    const curLeafFile = curLeaf.endsWith('.json') ? curLeaf : `${curLeaf}.json`;
    const curEnt = findFrameRegistryEntry(lastFrameRegistry, curLeafFile);
    const human = formatPaintToolFrameLabelFromRegistry(curEnt, curLeafFile);
    availableFrames.push({
      label: `Current — ${human}`,
      vipFile: curLeafFile,
      json: vipStateStr,
      frameRegistryEntry: curEnt,
    });
  }
  if (result.vipStatesFolder && result.vipStatesFolder.length > 0) {
    for (const item of result.vipStatesFolder) {
      const name = item.name;
      const ent = findFrameRegistryEntry(lastFrameRegistry, name);
      // Lazily read frames stay compressed until shown (src/lazy-entries.js).
      const row = frameRowFrom({ label: formatPaintToolFrameLabelFromRegistry(ent, name), vipFile: name, frameRegistryEntry: ent }, item);
      if (row) availableFrames.push(row);
    }
  }
  {
    const seen = new Set();
    availableFrames = availableFrames.filter((row) => {
      const k = vipMatchKey(row.vipFile || '');
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  populateFrames();
  rebuildScreenIndex();
  updateGroupsPanel();
  updateGroupDetail(null);
  v2Tile8VariantOverride = null;
  syncV2VariantSelect();
  setV2AuthoringVisible(true);

  if (availableFrames.length > 0) {
    let defaultIdx = vipLoadedFromRootVip ? 0 : availableFrames.length - 1;
    const savedVipLeaf =
      result.manifest && typeof result.manifest.painterV2LastVipFile === 'string'
        ? result.manifest.painterV2LastVipFile.trim()
        : '';
    if (savedVipLeaf) {
      const want = vipMatchKey(savedVipLeaf);
      const idx = availableFrames.findIndex((row) => vipMatchKey(row.vipFile || '') === want);
      if (idx >= 0) defaultIdx = idx;
    }
    if (frameSelect) frameSelect.value = String(defaultIdx);
    refreshFrameScreenshot(defaultIdx);
    refreshFrameReference(defaultIdx);
    updateFrameMenuState();
    loadVipFromJson(availableFrames[defaultIdx].json);
  } else {
    currentState = null;
    selectedGroupId = null;
    viewGroupFilterId = null;
    clearSelection();
    setV2AuthoringVisible(!!loadedPackParts);
    updatePaintV2TopButton();
    setStatus('Pack has no VIP state JSON.');
    refreshFrameScreenshot(-1);
    refreshFrameReference(-1);
    updateFrameMenuState();
    render();
    updatePoolSummary();
  }

  vipOverlayLayersLoaded = restorePainterVipOverlaysFromPack(
    typeof result.painterV2VipOverlays === 'string' ? result.painterV2VipOverlays : '',
  );
  const touchUpConversion = convertLoadedOverlaysToTouchUps();
  const strayCleared = clearStrayTransparentPaint();
  // Starter shades from before Oct 9 2026 move to the new ones, which no one picks by accident.
  const starters = convertOldStarterShades(pack, groups, decodeGroupTileColors);
  if (starters.pixels) {
    pack = starters.pack;
    groups = starters.groups;
    invalidateGroupColorIndex();
  }
  if (strayCleared?.pixels) render();
  if (touchUpConversion.converted > 0) {
    vipOverlayLayersLoaded = [...vipAuthoringByGroupAndEye.values()].reduce((n, byEye) => n + byEye.size, 0);
  }
  if (vipOverlayLayersLoaded > 0 || touchUpConversion.converted > 0) {
    updateGroupsPanel();
    render();
  }

  const v2rules =
    painterV2Rules && typeof painterV2Rules.schemaVersion === 'number'
      ? ` · painter-v2-rules.json (schema ${painterV2Rules.schemaVersion})`
      : painterV2Rules
        ? ' · painter-v2-rules.json present'
        : '';
  const seedStatus =
    memoryAnalysisSeededPools && gameStatePools.length > 0
      ? ` · Auto-seeded ${gameStatePools.length} gameStatePool(s) from manifest.memoryAnalysis (save to write groups.json)`
      : '';
  const vipLoadNote =
    vipOverlayLayersLoaded > 0
      ? ` · painter-v2-vip-overlays: ${vipOverlayLayersLoaded} layer${vipOverlayLayersLoaded === 1 ? '' : 's'} restored`
      : result.painterV2VipOverlays && String(result.painterV2VipOverlays).length > 0
        ? ' · painter-v2-vip-overlays present (0 layers applied — check dimensions/schema)'
        : '';
  const strayNote = strayCleared?.pixels
    ? ` · Cleared ${strayCleared.pixels} stray pixel(s) of paint on transparent pixels in ${strayCleared.tiles} tile(s) — they never showed; save to keep`
    : '';
  const touchUpNote = touchUpConversion.converted
    ? ` · Converted ${touchUpConversion.converted} overlay${touchUpConversion.converted === 1 ? '' : 's'} to touch-ups — save to keep` +
      (touchUpConversion.kept ? ` (${touchUpConversion.kept} kept: anchor not on any frame)` : '')
    : '';
  setStatus(
    `${label} · ${pack.size} pack tiles · ${overrides.length} overrides · ${groups.length} groups${v2rules}${seedStatus}${vipLoadNote}${touchUpNote}${strayNote}`,
  );
  if (fileMenuSave) fileMenuSave.disabled = !loadedPackParts;
  if (fileMenuSaveAs) fileMenuSaveAs.disabled = !loadedPackParts;
  updateSaveAndPlayEnabled();
  setV2AuthoringVisible(!!loadedPackParts);
  updatePaintV2TopButton();
  updateGroupsPoolContextHint();
  health = { issues: null, frames: 0, checking: false };
  syncHealthUi();
  scheduleHealthCheck(HEALTH_DELAY_MS);
  recordingSamplesCache = new Map();
  packFileBytes = buffer?.byteLength ?? null;
}

/** The groups changed: Save lights up, the loaded pack's copy follows, and Check project runs again. */
function markGroupsDirty() {
  groupsDirty = true;
  scheduleHealthCheck();
  if (loadedPackParts && Array.isArray(groups)) {
    try {
      loadedPackParts.groups = structuredClone(groups);
    } catch {
      loadedPackParts.groups = JSON.parse(JSON.stringify(groups));
    }
  }
  if (loadedPackParts) {
    if (gameStates.length) loadedPackParts.gameStates = gameStates.map((x) => ({ ...x, conditions: x.conditions.map((c) => ({ ...c })) }));
    else delete loadedPackParts.gameStates;
  }
  updateGroupsPoolContextHint();
}

/** Hook up every control; each part binds its own. */
function wireEvents() {
  wireMenus();
  wireCanvas();
  wireToolbar();
  wireKeyboard();
}

/** The File and Frame menus, dialogs, the frame list controls and the toolbar's view settings. */
function wireMenus() {
  fileMenuHomeChoose?.addEventListener('click', async () => {
    closePainterFileMenu();
    const result = await pickAndStoreHomeDirectory();
    if (result.status === 'ok') {
      setStatus(`Project home set to “${result.handle.name || 'folder'}”. Open/Save prefer this folder.`);
    } else if (result.status === 'unsupported') {
      setStatus('Project home requires Chromium (File System Access API).');
    } else if (result.status === 'error') {
      console.warn('[painter] Project home choose failed:', result.error);
      setStatus('Could not set project home folder.');
    }
    await refreshPainterProjectHomeUi();
  });
  fileMenuHomeGrant?.addEventListener('click', async () => {
    closePainterFileMenu();
    const ok = await requestHomeAccess();
    setStatus(
      ok
        ? 'Project home access restored — Open / Save use that folder again.'
        : 'Folder access was not granted; Open / Save will use the browser dialog.',
    );
    await refreshPainterProjectHomeUi();
  });
  fileMenuHomeClear?.addEventListener('click', async () => {
    closePainterFileMenu();
    await clearHomeDirectoryHandle();
    await refreshPainterProjectHomeUi();
    setStatus('Project home cleared. Open/Save use the default picker / download.');
  });
  void refreshPainterProjectHomeUi();

  // Layer art is saved as PNG: decode it for the preview, and redraw when it is ready.
  installLayerArtDecoder();
  onLayerArtDecoded(() => render());

  bindPainterUiEvents({
    fileMenuOpen,
    fileVbpack,
    closePainterFileMenu,
    onOpenPack: () => openVbpackFromMenu(),
    onSave: (saveAs) => {
      void runPainterVbpackSave(saveAs);
    },
    fileMenuSave,
    fileMenuSaveAs,
    onPickFile: async (f) => {
      const buf = await f.arrayBuffer();
      await loadVbpackBuffer(buf, f.name);
      await offerProjectJournalRestore();
    },
    frameSelect,
    onFrameSelectChange: (i) => {
      const row = availableFrames[i];
      refreshFrameScreenshot(i);
    refreshFrameReference(i);
    updateFrameMenuState();
      clearSelection();
      v2Tile8VariantOverride = null;
      selectedGroupId = null;
      viewGroupFilterId = null;
      syncV2VariantSelect();
      updateGroupsPanel();
      updateGroupDetail(null);
      if (row?.json) {
        loadVipFromJson(row.json);
        reapplyPackVipAuthoringOverlaysFromLoadedPack();
      } else {
        updatePoolSummary();
        updateGroupsPoolContextHint();
      }
    },
    eyeSelect,
    onEyeChange: () => {
      viewGroupFilterId = null;
      resetMarqueeAndPickStatePreserveZoom();
      render();
      updateGroupsPoolContextHint();
    },
    layerSelect,
    onLayerChange: () => {
      viewGroupFilterId = null;
      resetMarqueeAndPickStatePreserveZoom();
      render();
      updateGroupsPoolContextHint();
      deselectSelectedGroupIfFilteredOut();
    },
    btnReload,
    onReloadFrame: () => {
      const i = Number(frameSelect?.value);
      const row = availableFrames[i];
      refreshFrameScreenshot(i);
    refreshFrameReference(i);
    updateFrameMenuState();
      if (row?.json) {
        loadVipFromJson(row.json);
        reapplyPackVipAuthoringOverlaysFromLoadedPack();
      }
    },
    v2VariantSelect,
    onVariantChange: (value) => {
      v2Tile8VariantOverride = value || null;
      render();
      updateGroupsPoolContextHint();
    },
    toggleShotOverlay,
    onToggleScreenshotOverlay: (on) => {
      screenshotOverlayEnabled = !!on;
      syncOverlayAlphaUi();
      render();
    },
    shotOverlayAlpha,
    onScreenshotOpacityInput: (raw) => {
      screenshotOverlayOpacity = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.45;
      render();
    },
    btnV2VariantAuto,
    onVariantAuto: () => {
      v2Tile8VariantOverride = null;
      syncV2VariantSelect();
      render();
      updateGroupsPoolContextHint();
    },
    btnPaintV2Top,
    onPaintV2Top: () => {
      paintTopTileToV2Rule();
    },
    btnNewGroupFromSelection,
    onNewGroupFromSelection: () => openNewGroupDialog(),
    btnClearGroupFilter,
    onClearGroupFilter: () => clearGroupDerivedFilters(),
    btnSelectUnassignedPoolTiles,
    onSelectUnassignedPoolTiles: () => selectTilesUnassignedInEditorPoolVariant(),
    newGroupCancel,
    newGroupDialog,
    newGroupSuggestKind,
    onSuggestGroupKind: () => {
      const k = suggestKindFromSelection();
      if (k === 'bg') {
        if (newGroupKindBg) newGroupKindBg.checked = true;
      } else if (newGroupKindObj) newGroupKindObj.checked = true;
      refreshNewGroupMembershipBanner();
    },
    newGroupPoolVariant,
    onNewGroupPoolVariantChange: () => {
      refreshNewGroupPoolVariantHint();
      refreshNewGroupMembershipBanner();
      refreshNewGroupOverlapBanner();
    },
    onNewGroupDialogClick: (t, e) => {
      if (!t || t.id !== 'new-group-use-frame-pool') return;
      e.preventDefault();
      const v = newGroupDialogFrameVariant?.value;
      if (v && newGroupPoolVariant) {
        newGroupPoolVariant.value = v;
        refreshNewGroupPoolVariantHint();
        refreshNewGroupMembershipBanner();
        refreshNewGroupOverlapBanner();
      }
    },
    newGroupForm,
    onNewGroupSubmit: (e) => {
      e.preventDefault();
      if (!newGroupName?.value.trim()) {
        newGroupName?.focus();
        return;
      }
      createGroupFromDialog();
      newGroupDialog?.close();
    },
    dupGroupCancel,
    onDuplicateCancel: () => {
      pendingDuplicateSourceId = null;
      duplicateGroupDialog?.close();
    },
    dupGroupConfirm,
    onDuplicateConfirm: () => confirmDuplicateGroup(),
    dupGroupPoolVariant,
    onDuplicatePoolVariantChange: () => {
      const err = document.getElementById('dup-group-error');
      if (err) {
        err.hidden = true;
        err.textContent = '';
      }
    },
    duplicateGroupDialog,
    onDuplicateDialogClose: () => {
      pendingDuplicateSourceId = null;
    },
  });
  btnNewPoseFromSelection?.addEventListener('click', openNewPoseFromSelection);
  wireCanvasSize();
  document.getElementById('btn-paint-inventory')?.addEventListener('click', openPaintInventory);
  document.getElementById('paint-inventory-close')?.addEventListener('click', () => paintInventoryDialog?.close());
  document.getElementById('paint-inventory-filter')?.addEventListener('change', (e) => {
    setPaintInventoryFilter(/** @type {HTMLSelectElement} */ (e.target).value);
    renderPaintInventory();
  });
  setPreviewBrightness(previewBrightness);
  document.querySelectorAll('[data-select-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectionMode = /** @type {'replace'|'add'|'remove'} */ (btn.getAttribute('data-select-mode'));
      document
        .querySelectorAll('[data-select-mode]')
        .forEach((b) => b.classList.toggle('active', b.getAttribute('data-select-mode') === selectionMode));
      setStatus(
        selectionMode === 'replace'
          ? 'Selection: clicks and boxes replace the selection.'
          : selectionMode === 'add'
            ? 'Selection: clicks and boxes add to the selection.'
            : 'Selection: clicks and boxes subtract from the selection.',
      );
    });
  });
  btnSelectMatching?.addEventListener('click', () => selectAllMatchingSelectedTile());
  btnStackPanel?.addEventListener('click', () => {
    stackPanelEnabled = !stackPanelEnabled;
    btnStackPanel.classList.toggle('active', stackPanelEnabled);
    const panel = document.getElementById('draw-stack-panel');
    if (panel && !stackPanelEnabled) panel.innerHTML = '';
    setStatus(
      stackPanelEnabled
        ? 'Draw stack on — click the canvas to list every draw under that pixel.'
        : 'Draw stack off.',
    );
  });
  document.getElementById('btn-frame-prev')?.addEventListener('click', () => stepFrame(-1));
  const frameFilterSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('frame-filter'));
  if (frameFilterSelect) {
    frameFilterSelect.value = frameFilter;
    frameFilterSelect.addEventListener('change', () => {
      setFrameFilter(UNCOLOURED_FILTERS[frameFilterSelect.value] ? frameFilterSelect.value : 'all');
      try {
        localStorage.setItem(FRAME_FILTER_KEY, frameFilter);
      } catch {
        /* the filter just isn't remembered */
      }
      applyFrameFilter(true);
      syncFrameHighlightUi();
      render();
      if (frameFilter !== 'all') {
        const n = shownFrameOptions().length;
        setStatus(`Showing ${n} of ${availableFrames.length} frame(s) ${frameFilter === 'tiles' ? 'with tiles that have no paint' : 'with pixels nothing colours'}.`);
      }
    });
  }
  syncFrameHighlightUi();
  document.getElementById('frame-highlight')?.addEventListener('change', (e) => setFrameHighlight(/** @type {HTMLInputElement} */ (e.target).checked));
  // Paint may have changed since the list was counted: recount (only if so) before it opens.
  frameSelect?.addEventListener('mousedown', () => applyFrameFilter());
  frameSelect?.addEventListener('focus', () => applyFrameFilter());
  document.getElementById('btn-frame-next')?.addEventListener('click', () => stepFrame(1));
  document.getElementById('btn-open-sprite-studio')?.addEventListener('click', async () => {
    if (!loadedPackParts) {
      setStatus('Open a .vbpack first.');
      return;
    }
    setStatus('Handing this pack to SpriteStudio…');
    try {
      const prepared = await preparePainterVbpackParts({ updateCurrentVip: true });
      if (!prepared.ok) return;
      const blob = await buildArtPack(prepared.merged);
      await putHandoff(HANDOFF_KEY_SPRITE_STUDIO, await blob.arrayBuffer());
      await putHandoff(`${HANDOFF_KEY_SPRITE_STUDIO}-name`, loadedPackName || 'pack.vbpack');
      if (selectedGroupId) await putHandoff(`${HANDOFF_KEY_SPRITE_STUDIO}-group`, selectedGroupId);
      else await deleteHandoff(`${HANDOFF_KEY_SPRITE_STUDIO}-group`).catch(() => {});
      // So SpriteStudio's way back lands on this frame, group and zoom, saving to the same file.
      await putHandoff(HANDOFF_KEY_PROJECT_STATE, captureProjectReturnState());
      // The work goes with the pack; SpriteStudio keeps its own recovery copy from here.
      await clearProjectJournal();
      leavePainterTo('/tools/sprite-studio.html?from=painter');
    } catch (e) {
      setStatus(`Could not hand off to SpriteStudio: ${e?.message || e}`);
    }
  });
  document.getElementById('file-menu-export-player')?.addEventListener('click', () => {
    closePainterFileMenu();
    void exportForPlayer();
  });
  document.getElementById('file-menu-import-pack')?.addEventListener('click', () => {
    closePainterFileMenu();
    void importFromAnotherPackFromMenu();
  });
  document.getElementById('file-menu-import-vbcp')?.addEventListener('click', () => {
    closePainterFileMenu();
    importVbcpPackFromMenu();
  });
  document.getElementById('file-import-vbcp')?.addEventListener('change', async (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files?.[0];
    input.value = '';
    if (file) await importVbcpPack(await file.arrayBuffer(), file.name);
  });
  bindGroupSearch();
  document.getElementById('file-menu-check-project')?.addEventListener('click', () => {
    closePainterFileMenu();
    openHealthDialog();
  });
  document.getElementById('btn-health-count')?.addEventListener('click', () => openHealthDialog());
  document.getElementById('file-menu-game-states')?.addEventListener('click', () => {
    closePainterFileMenu();
    openGameStatesDialog();
  });
  document.getElementById('game-states-close')?.addEventListener('click', () => gameStatesDialog?.close());
  document.getElementById('file-menu-storage')?.addEventListener('click', () => {
    closePainterFileMenu();
    openStorageDialog();
  });
  document.getElementById('storage-close')?.addEventListener('click', () => storageDialog?.close());
  document.getElementById('health-close')?.addEventListener('click', () => healthDialog?.close());
  document.getElementById('file-menu-cleanup-frames')?.addEventListener('click', () => {
    closePainterFileMenu();
    void cleanUpFrames();
  });
  document.getElementById('file-import-vbpack')?.addEventListener('change', async (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files?.[0];
    input.value = '';
    if (file) await importFromAnotherPack(await file.arrayBuffer(), file.name);
  });
  document.getElementById('file-menu-analyze-memory')?.addEventListener('click', async () => {
    closePainterFileMenu();
    await runMemoryAnalysisOnLoadedPack();
  });
  document.getElementById('file-menu-export-png')?.addEventListener('click', async () => {
    closePainterFileMenu();
    if (!currentState?.drawList?.length || !scratchComposite) {
      setStatus('Load a frame first.');
      return;
    }
    const blob = await new Promise((resolve) => scratchComposite.toBlob(resolve, 'image/png'));
    if (!blob) {
      setStatus('Could not render the frame to PNG.');
      return;
    }
    const base = (loadedPackName || 'frame').replace(/\.(vbpack|zip)$/i, '');
    const frameLabel = availableFrames[getCurrentFrameSelectIndex() ?? 0]?.label || 'frame';
    const name = `${base}-${String(frameLabel).replace(/[^a-z0-9-_]+/gi, '-')}-eye${getEye()}.png`;
    const wrote = await saveExportToHome(blob, name);
    if (!wrote) downloadBlob(blob, name);
    setStatus(wrote ? `Wrote ${wrote} to your project home folder.` : `Exported ${name}.`);
  });
  if (toggleBlankTiles) {
    toggleBlankTiles.checked = includeBlankTiles;
    toggleBlankTiles.addEventListener('change', () => {
      includeBlankTiles = toggleBlankTiles.checked;
      try {
        localStorage.setItem(BLANK_TILES_KEY, includeBlankTiles ? '1' : '0');
      } catch {}
      setStatus(
        includeBlankTiles
          ? 'Blank tiles can now be selected (they paint nothing and share one hash — avoid adding them to groups).'
          : 'Blank tiles are ignored by clicks and box select.',
      );
    });
  }
  previewBrightnessInput?.addEventListener('input', () => {
    setPreviewBrightness(Number(previewBrightnessInput.value));
    render();
  });
  previewBrightnessInput?.addEventListener('dblclick', () => {
    setPreviewBrightness(PREVIEW_BRIGHTNESS_DEFAULT);
    render();
  });
  bindNewPoseDialogEvents({ onSubmit: submitNewPoseFromDialog });

  newGroupKindBg?.addEventListener('change', () => refreshNewGroupMembershipBanner());
  newGroupKindObj?.addEventListener('change', () => refreshNewGroupMembershipBanner());

}

initCanvasInput({
  get activeMarqueePointer() { return activeMarqueePointer; },
  set activeMarqueePointer(v) { activeMarqueePointer = v; },
  get activePaintUndoMap() { return activePaintUndoMap; },
  set activePaintUndoMap(v) { activePaintUndoMap = v; },
  get activeReferenceImage() { return activeReferenceImage; },
  get activeReferenceTransform() { return activeReferenceTransform; },
  get activeVipOverlayUndoSnapshot() { return activeVipOverlayUndoSnapshot; },
  set activeVipOverlayUndoSnapshot(v) { activeVipOverlayUndoSnapshot = v; },
  get activeZoomPaintPointer() { return activeZoomPaintPointer; },
  set activeZoomPaintPointer(v) { activeZoomPaintPointer = v; },
  get anchorPickGroupId() { return anchorPickGroupId; },
  set anchorPickGroupId(v) { anchorPickGroupId = v; },
  get brushColor() { return brushColor; },
  get btnCanvasSelect() { return btnCanvasSelect; },
  get btnImportAsset() { return btnImportAsset; },
  get btnPaintBrush() { return btnPaintBrush; },
  get btnPaintColorPick() { return btnPaintColorPick; },
  get btnPaintErase() { return btnPaintErase; },
  get btnPaintFill() { return btnPaintFill; },
  get btnZoomGrid() { return btnZoomGrid; },
  get btnZoomSelection() { return btnZoomSelection; },
  get canvas() { return canvas; },
  get ctx() { return ctx; },
  get currentState() { return currentState; },
  get cursorPos() { return cursorPos; },
  deselectGroup,
  get duplicateGroupDialog() { return duplicateGroupDialog; },
  get fillAcrossTilesEnabled() { return fillAcrossTilesEnabled; },
  set fillAcrossTilesEnabled(v) { fillAcrossTilesEnabled = v; },
  get fillAcrossTilesInput() { return fillAcrossTilesInput; },
  get frameDetailsDialog() { return frameDetailsDialog; },
  get groups() { return groups; },
  get inspectPoint() { return inspectPoint; },
  set inspectPoint(v) { inspectPoint = v; },
  get marqueeState() { return marqueeState; },
  set marqueeState(v) { marqueeState = v; },
  get newGroupDialog() { return newGroupDialog; },
  get paintColorPickAwaitingCanvasClick() { return paintColorPickAwaitingCanvasClick; },
  set paintColorPickAwaitingCanvasClick(v) { paintColorPickAwaitingCanvasClick = v; },
  get paintUndoStack() { return paintUndoStack; },
  get referenceDrag() { return referenceDrag; },
  set referenceDrag(v) { referenceDrag = v; },
  get referenceTransformMode() { return referenceTransformMode; },
  render,
  get selectedDrawFullIndices() { return selectedDrawFullIndices; },
  get selectedGroupId() { return selectedGroupId; },
  get selectionMode() { return selectionMode; },
  setStatus,
  get stackPanelEnabled() { return stackPanelEnabled; },
  get zoomEraseMode() { return zoomEraseMode; },
  set zoomEraseMode(v) { zoomEraseMode = v; },
  get zoomGridEnabled() { return zoomGridEnabled; },
  set zoomGridEnabled(v) { zoomGridEnabled = v; },
  get zoomPaintStrokeAllowed() { return zoomPaintStrokeAllowed; },
  set zoomPaintStrokeAllowed(v) { zoomPaintStrokeAllowed = v; },
  get zoomPaintTool() { return zoomPaintTool; },
  set zoomPaintTool(v) { zoomPaintTool = v; },
  get zoomViewport() { return zoomViewport; },
});

buildWorldGrid();
wireEvents();
btnSaveAndPlay?.addEventListener('click', () => {
  void runPainterSaveAndPlay();
});
if (toggleShotOverlay) toggleShotOverlay.disabled = true;
if (shotOverlayAlpha) {
  shotOverlayAlpha.value = String(screenshotOverlayOpacity);
  shotOverlayAlpha.disabled = false;
}
updateGroupDetail(null);
updateSelectionUi();
updateWorldFilterDebug();
updateSaveAndPlayEnabled();
if (new URLSearchParams(location.search).get('from') === 'spritestudio') void maybeLoadSpriteStudioReturn();
else void maybeLoadHandoffPack();
