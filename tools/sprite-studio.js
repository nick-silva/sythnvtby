/**
 * SpriteStudio — sprite-first view of a colorization project.
 *
 * The Project tool (tools/project.html) isolates and names assets frame by
 * frame; this page works the other way round: pick a sprite, see its poses as a
 * filmstrip, and watch them play over the real background they were captured
 * on. Painting lands here next.
 */




import {
  loadPackSession,
  spriteGroups,
  paintTargetGroupFor,
  usedColorsForGroup,
  buildPackBlob,
  FRAME_W,
  FRAME_H,
  buildFrameSummaries,
  frameLabel,
} from './shared/pack-session.js';
import { posesNeedingPaint, pickPoseNeedingPaint } from './shared/poses-needing-paint.js';






import { createSaveProgressUi } from './shared/save-progress-ui.js';

import {
  fillTilesFromReference,
  paletteFromTiles,
} from '../src/reference-fill.js';







import { zoomAt, panBy, viewFromCrop } from './shared/stage-view.js';

import {
  isObjGroup,
  addTrackToGroup,
  removeTrackFromGroup,
  updateTrack,
  trackLengthFrames,
  trackStepAtFrame,
} from '../src/obj-sprite-profiles.js';



import { normalizeGroup } from '../src/group-schema.js';
import { withPictureSettings } from '../src/picture-store.js';

import { parseVBColorPack, buildVBColorPack } from '../src/vbcolor-pack.js';
import { groupWithEncodedTileColors } from '../src/group-tile-colors.js';
import {
  pickOpenFile,
  pickSaveVbpackFile,
  writeBlobToFileHandle,
  writeBackupCopy,
  getUsableHomeDirectory,
  ensureHandlePermission,
} from '../src/project-home.js';
import { getHandoff, putHandoff, deleteHandoff } from '../src/handoff-store.js';
import { writeJournal, readJournal, clearJournal, bytesToBase64, base64ToBytes } from '../src/work-journal.js';
import { VBPACK_HANDOFF_STEPS } from '../src/save-progress.js';
import { HANDOFF_KEY_PROJECT_STATE, HANDOFF_KEY_RETURN_PACK, HANDOFF_KEY_RETURN_STATE, frameIndexForReturn } from './shared/project-return.js';
import { downloadBlob } from '../src/art-pack.js';



import {
  layerArtOf,
  artPixelsFor,
} from '../src/layer-art.js';



import {
  cropOverpaint,
} from '../src/overpaint.js';




import { foldPoseGroups, linkPosePictures } from '../src/pose-overpaint.js';


import { damagedPictures, setAside, itemsFromRecoveryFolder } from '../src/recovery.js';




import {
  installLayerArtDecoder,
  encodePngBase64,
  imageFromPasteEvent,
} from '../src/layer-art-png.js';






import {
  initOverpaint,
  activePicture,
  convertSessionToOverpaint,
  encodeEditedLayerArt,
  findArtTarget,
  finishArtStroke,
  loadLayerArtForSession,
  overpaintMode,
  pictureStore,
  setPaintOn,
  showTouchUps,
  usePictureImage,
} from './sprite-studio/overpaint.js';




import {
  initGroupList,
  bindGroupSearch,
  clearEmptyFolders,
  markActiveRow,
  renderSpriteLists,
} from './sprite-studio/group-list.js';

import {
  initTracks,
  currentTrack,
  currentTracks,
  renderTimeline,
  renderTracksPanel,
  setTrackSteps,
} from './sprite-studio/tracks.js';
import {
  initRecovery,
  overpaintPanelBody,
  recoveredPicturesPart,
} from './sprite-studio/recovery.js';
import {
  initReference,
  currentGroupPlacements,
  fillFromReference,
  primeReferences,
  refreshActiveReference,
} from './sprite-studio/reference.js';


import {
  initPoses,
  buildPoseViews,
  deletePose,
  isAnimatedGroup,
  refreshPoseThumbs,
  refreshShadeRamp,
  renamePose,
  renderStrip,
  selectGroup,
  setPoseIndex,
  storedPose,
  syncPoseScrub,
} from './sprite-studio/poses.js';

import {
  initHistory,
  dropErasedTiles,
  pushUndo,
  redoStack,
  redoStroke,
  syncUndoButtons,
  undoStack,
  undoStroke,
} from './sprite-studio/history.js';
import {
  initRender,
  composeFrame,
  composePoseLayer,
  drawStage,
  invalidateRender,
  onionOn,
  onionPick,
  pixelPaintState,
  renderDetail,
  renderOnionOptions,
  setOriginalPeek,
  showUnpainted,
} from './sprite-studio/render.js';
import { initAutopaint, openAutopaint } from './sprite-studio/autopaint.js';
import { initFindPoses } from './sprite-studio/find-poses.js';
import { initFindSprites } from './sprite-studio/find-sprites.js';
import {
  initGhostBox,
  colourForHash,
  defaultGhostBox,
  endGhostDrag,
  onGhostPointerDown,
  onGhostPointerMove,
  paintStore,
  paneAt,
  pasteIntoBox,
  setGhostBox,
  updateGhostUi,
} from './sprite-studio/ghost-box.js';
import {
  initPick,
  hideExplainBubble,
} from './sprite-studio/pick.js';
import {
  initPainting,
  floodFillAt,
  paintAt,
  paintColor,
  pickAt,
  pickFromReference,
  seedShadeCache,
  setTool,
  swapColourAt,
  tileUnderPointer,
  vipFromClient,
} from './sprite-studio/painting.js';
import {
  initPaintScope,
  OWN_PAINT_KEY,
  clearPaintForCurrentView,
  hasOverlayPaint,
  layerSession,
  offerToClearOverlay,
  ownPaintOnly,
  viewPatterns,
} from './sprite-studio/paint-scope.js';

/** Set by the Project tool's "SpriteStudio →" button (bytes, `-name`, `-group`). */
const HANDOFF_KEY = 'sprite-studio-pack';

const el = (id) => /** @type {any} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ (el('stage-canvas'));
const stageCtx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

/** Offscreen full-frame composite; the stage draws a crop of it. */
const frameCanvas = document.createElement('canvas');
frameCanvas.width = FRAME_W;
frameCanvas.height = FRAME_H;
const frameCtx = /** @type {CanvasRenderingContext2D} */ (frameCanvas.getContext('2d', { willReadFrequently: true }));
const frameImage = frameCtx.createImageData(FRAME_W, FRAME_H);

/** The sprite on its own: VIP worlds in front of it would otherwise hide it. */
const poseCanvas = document.createElement('canvas');
poseCanvas.width = FRAME_W;
poseCanvas.height = FRAME_H;
const poseCtx = /** @type {CanvasRenderingContext2D} */ (poseCanvas.getContext('2d', { willReadFrequently: true }));
const poseImage = poseCtx.createImageData(FRAME_W, FRAME_H);

/** Neighbouring poses, drawn faintly when onion skinning is on. */
const ghostCanvas = document.createElement('canvas');
ghostCanvas.width = FRAME_W;
ghostCanvas.height = FRAME_H;
const ghostCtx = /** @type {CanvasRenderingContext2D} */ (ghostCanvas.getContext('2d', { willReadFrequently: true }));
const ghostImage = ghostCtx.createImageData(FRAME_W, FRAME_H);

/** @type {any} */
let session = null;
/** @type {any} */
let selectedGroup = null;
/** @type {Array<{ pose: any, frameIndex: number, origin: { x: number, y: number } | null, matched: number, total: number }>} */
let poseViews = [];
let poseIndex = 0;
let playTimer = 0;

/** 'look' | 'brush' | 'erase' | 'fill' | 'pick' | 'clone' | 'swap' */
let tool = 'look';
/** @type {Map<number, Uint8Array>|null} */
let strokeSnapshot = null;
let painting = false;
let dirty = false;

/** Active animation track and where playback sits inside it, in VB frames. */
let activeTrackId = null;
let trackFrame = 0;
/** True while showing a track step marked mirrored: the pose is drawn flipped left↔right. */
let stageMirror = false;

/** Background frame pinned across poses, so the scene does not jump while animating. */
let pinnedFrameIndex = -1;

/** @type {HTMLImageElement|null} */
/** Reference images from the pack: refId → { meta, url, image }. */
let referenceStore = new Map();
/** The one that applies to the frame on screen: { meta, image, transform }. */
let activeReference = null;
/** True while R is held: show the reference at full strength. */
let referencePeek = false;
/** The reference shown belongs to another frame: colours only, no usable placement. */
let referenceIsForAnotherFrame = false;
/**
 * Flip the *view* only — of the sprite, and separately of the reference. The stored pose,
 * its tiles and the paint stay in the orientation they were captured in, so nothing about
 * how the emulator draws them changes; `tileUnderPointer` un-flips the pointer to match.
 */
let flipViewX = false;
let flipViewY = false;
let flipReferenceX = false;
let flipReferenceY = false;
/** Colours pulled out of the reference for hand-painting, shown above the used colours. */
let referencePalette = [];
/** Which reference you picked, when a state holds more than one. */
let chosenReferenceId = null;
/** Ghost box, in frame pixels: where paint lands, and where the colours are taken from. */
let ghostStage = /** @type {{x:number,y:number,w:number,h:number}|null} */ (null);
let ghostRef = /** @type {{x:number,y:number,w:number,h:number}|null} */ (null);
let ghostDrag = /** @type {{pane:'stage'|'ref', handle:string, startX:number, startY:number, start:any}|null} */ (null);
/** Width of the painted pane, so pointer coords can tell the two panes apart. */
let stagePaneW = 0;
const PANE_GAP = 8;

const sideBySide = () => !!el('toggle-side-by-side')?.checked;

/** Where the stage last drew the frame, so pointer coords can be mapped back to VIP pixels. */
let stageCrop = { x: 0, y: 0, w: FRAME_W, h: FRAME_H };
let stageScale = 1;

const STAGE_PAD = 12;
/** Once the wheel or a pan takes over from Fit: a whole-pixel scale and a centre in frame pixels. */
let freeView = /** @type {import('./shared/stage-view.js').StageView|null} */ (null);
let panDrag = /** @type {{ x: number, y: number, view: any }|null} */ (null);
/** Stage pixels available at the last draw, for mapping the wheel into the next one. */
let stageAvail = { w: FRAME_W * 2, h: FRAME_H * 2 };
/** With One set on, the other copies of a repeating pattern stay visible at this strength. */
const OTHER_COPIES_ALPHA = 0.3;
const THUMB_SCALE = 3;
const THUMB_MAX_W = 240;
const THUMB_MAX_H = 96;
/** Onion skin opacity when nothing is remembered. */
const ONION_ALPHA = 0.35;
const ONION_ALPHA_KEY = 'spriteStudio.onionAlpha';
/** Timeline sizing: a step never gets narrower than its controls need. */
const STEP_MIN_REM = 7.5;
const STEP_MIN_UNIT_REM = 0.9;
const STEP_MAX_UNIT_REM = 2.5;
const MS_PER_VB_FRAME = 20;

function setStatus(msg) {
  el('status').textContent = msg;
}

/** Poses at which a group's cards take long enough to build that picking it shows the spinner. */
const BUSY_POSES = 40;
let busyCount = 0;

/**
 * Show the busy spinner, let it paint, then run `fn`: building a big scaled group's cards blocks
 * the page for a moment, and this says it is working, not stuck. The spinner keeps turning while
 * `fn` runs (its animation is off the main thread) and fades in late, so a quick one never shows.
 * @param {string} label @param {() => void} fn
 */
function whileBusy(label, fn) {
  el('busy-text').textContent = label;
  el('busy').hidden = false;
  busyCount++;
  requestAnimationFrame(() =>
    setTimeout(() => {
      try {
        fn();
      } finally {
        if (--busyCount === 0) el('busy').hidden = true;
      }
    }, 0),
  );
}

/** Select a group you picked: with the spinner when its cards are slow to build (scaled poses, or many). */
function pickGroup(group) {
  const poses = Array.isArray(group?.poses) ? group.poses : [];
  const slow = poses.some((p) => p?.affine) || poses.length >= BUSY_POSES;
  if (!slow || group.id === selectedGroup?.id) {
    selectGroup(group);
    return;
  }
  whileBusy(`Loading ${poses.length} poses of ${group.name || group.id}…`, () => selectGroup(group));
}

function eye() {
  return Number(el('eye-select').value) === 1 ? 1 : 0;
}

/** Behind the sprite where the scene is not drawn. Loud by default, and remembered. */
const STAGE_BG_KEY = 'sprite-studio.stageBackground';
const STAGE_BG_DEFAULT = '#ff00aa';

function stageBackgroundColor() {
  const input = el('stage-bg-color');
  return (input && input.value) || STAGE_BG_DEFAULT;
}

function brightness() {
  const v = Number(el('brightness').value);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/* ---------------------------------------------------------------- loading */

/**
 * The file Save writes: the one you opened, or the one the Project tool saves to. Null until
 * there is one, and then Save asks where — never a same-named file somewhere else.
 */
let saveFileHandle = /** @type {any} */ (null);

const canWriteHandle = (h) => !!h && typeof h.createWritable === 'function';

/** The pack name says which file Save writes. */
function syncSaveTarget() {
  const name = el('pack-name');
  if (!name || !session) return;
  name.title = canWriteHandle(saveFileHandle)
    ? `Save writes ${saveFileHandle.name || session.label}; Save as… writes another file`
    : 'Save asks where to save once (this pack was not opened from a file it can write back to), then writes that file';
}

async function openPack(buffer, label, preferGroupId = null, fileHandle = null) {
  setStatus(`Loading ${label}…`);
  session = await loadPackSession(buffer, label);
  session.baseBytes = buffer.byteLength;
  // Brief per-frame summaries, built in the background, so "where is this group?" decodes only
  // the frames that can show it.
  void buildFrameSummaries(session);
  const journal = await journalToRestore(label);
  if (journal) restoreJournal(journal);
  saveFileHandle = canWriteHandle(fileHandle) ? fileHandle : null;
  syncSaveTarget();
  seedShadeCache.clear();
  invalidateRender();
  el('pack-name').textContent = label;
  el('btn-save').disabled = true;
  el('btn-save-as').disabled = false;
  dirty = false;
  undoStack.length = 0;
  redoStack.length = 0;
  syncUndoButtons();
  primeReferences();
  // Groups the old "Overpaint just this pose" made become pose pictures inside their character.
  const folded = foldPoseGroups(session.groups);
  // Pose pictures made before they were tied to a saved pose get theirs, by their patterns.
  session.groups = folded.groups.map(linkPosePictures);
  const linked = session.groups.filter((g, i) => g !== folded.groups[i]).length;
  const foldedInto = new Map(folded.moved.map((m) => [m.from, m.to.slice(0, m.to.lastIndexOf('#pose:'))]));
  if (foldedInto.has(preferGroupId)) preferGroupId = foldedInto.get(preferGroupId);
  // Recovery (src/recovery.js): pictures set aside before, and any whose stored image is not the
  // size its settings say — drawn, it would land in the wrong place, so it is set aside too.
  const recovered = journal
    ? { items: journal.recovered || [], unreadableFiles: journal.recoveryUnreadable || [], unreadable: 0 }
    : itemsFromRecoveryFolder(session.parsed?.recoveryFolder);
  session.recovered = recovered.items;
  session.recoveryUnreadable = recovered.unreadableFiles;
  const damaged = damagedPictures(session.groups);
  for (const d of damaged) {
    const r = setAside(session.groups, { key: d.key, png: d.settings.png, reason: `found when the pack opened: ${d.reason}` });
    session.groups = r.groups;
    session.recovered.push(r.item);
  }
  loadLayerArtForSession();
  const conversion = await convertSessionToOverpaint();
  const converted = conversion.touchUps + conversion.layerArt;
  const stray = session.strayTransparentCleared;
  if (converted || stray?.pixels || folded.moved.length || linked || damaged.length) {
    dirty = true;
    el('btn-save').disabled = false;
  }
  if (journal) markDirty();
  clearEmptyFolders();
  renderSpriteLists();
  el('btn-find-sprites').disabled = !session.frames.length;
  const { objs, rest } = spriteGroups(session);
  const preferred = preferGroupId ? session.groups.find((g) => g.id === preferGroupId) : null;
  selectGroup(preferred || objs[0] || rest[0] || null);
  setStatus(
    `${label} · ${session.frames.length} frame(s) · ${objs.length} sprite group(s), ${rest.length} other · ${session.pack.size} painted tile pattern(s)`
      + (journal ? ` · restored unsaved work from ${new Date(journal.savedAt).toLocaleString()} — save to keep it` : '')
      + (converted
        ? ` · turned ${[conversion.touchUps && `${conversion.touchUps} touch-up(s)`, conversion.layerArt && `${conversion.layerArt} layer art`].filter(Boolean).join(' and ')} into overpaint, pinned to each layer — save to keep`
        : '')
      + (conversion.kept ? ` · ${conversion.kept} old touch-up(s) kept as they were: no captured frame shows them` : '')
      + (folded.moved.length ? ` · ${folded.moved.length} pose group(s) are now pose pictures inside their group — save to keep` : '')
      + (linked ? ` · tied the pose pictures of ${linked} group(s) to their saved poses — save to keep` : '')
      + (damaged.length ? ` · set aside ${damaged.length} damaged picture(s) (${[...new Set(damaged.map((d) => d.group.name || d.group.id))].join(', ')}): see Recovered pictures in their Overpaint panel` : '')
      + (session.recovered.length > damaged.length ? ` · ${session.recovered.length - damaged.length} recovered picture(s) waiting to be put back` : '')
      + (recovered.unreadable ? ` · ${recovered.unreadable} file(s) in the pack's recovery folder could not be read (kept as they are)` : '')
      + (stray?.pixels ? ` · cleared ${stray.pixels} stray pixel(s) of paint on transparent pixels — they never showed; save to keep` : ''),
  );
}

async function openViaPicker() {
  const res = await pickOpenFile({
    types: [{ description: 'VB art pack', accept: { 'application/zip': ['.vbpack', '.zip'] } }],
  });
  if (res.status === 'ok') {
    forgetProjectReturn();
    await openPack(res.buffer, res.name, null, res.fileHandle);
    return;
  }
  if (res.status === 'aborted') return;
  if (res.status === 'unsupported') {
    el('file-input').click();
    return;
  }
  setStatus(`Could not open the file: ${res.error}`);
}

initGroupList({
  get el() { return el; },
  markDirty,
  pickGroup,
  renderDetail,
  get selectedGroup() { return selectedGroup; },
  set selectedGroup(v) { selectedGroup = v; },
  selectGroup,
  get session() { return session; },
  setStatus,
});

initPoses({
  get activeTrackId() { return activeTrackId; },
  set activeTrackId(v) { activeTrackId = v; },
  colourForHash,
  composeFrame,
  composePoseLayer,
  drawStage,
  get el() { return el; },
  eye,
  get frameCanvas() { return frameCanvas; },
  get freeView() { return freeView; },
  set freeView(v) { freeView = v; },
  hideExplainBubble,
  invalidateRender,
  markDirty,
  get pinnedFrameIndex() { return pinnedFrameIndex; },
  set pinnedFrameIndex(v) { pinnedFrameIndex = v; },
  get poseCanvas() { return poseCanvas; },
  get poseIndex() { return poseIndex; },
  set poseIndex(v) { poseIndex = v; },
  get poseViews() { return poseViews; },
  set poseViews(v) { poseViews = v; },
  get redoStack() { return redoStack; },
  get referencePalette() { return referencePalette; },
  set referencePalette(v) { referencePalette = v; },
  renderDetail,
  renderOnionOptions,
  renderPalette,
  replaceSelectedGroup,
  get seedShadeCache() { return seedShadeCache; },
  get selectedGroup() { return selectedGroup; },
  set selectedGroup(v) { selectedGroup = v; },
  get session() { return session; },
  setStatus,
  stageBackgroundColor,
  get stageMirror() { return stageMirror; },
  set stageMirror(v) { stageMirror = v; },
  stopPlayback,
  syncUndoButtons,
  get THUMB_MAX_H() { return THUMB_MAX_H; },
  get THUMB_MAX_W() { return THUMB_MAX_W; },
  get THUMB_SCALE() { return THUMB_SCALE; },
  get trackFrame() { return trackFrame; },
  set trackFrame(v) { trackFrame = v; },
  get undoStack() { return undoStack; },
});

/** The selected group changed: store it, and the lists and panels follow. */
function replaceSelectedGroup(next) {
  session.groups = session.groups.map((g) => (g.id === next.id ? next : g));
  selectedGroup = next;
  markDirty();
  renderTracksPanel();
  renderSpriteLists();
  markActiveRow();
}

/** Unsaved changes: Save lights up, and the journal keeps a copy (src/work-journal.js). */
function markDirty() {
  dirty = true;
  el('btn-save').disabled = false;
  refreshShadeRamp(selectedGroup);
  scheduleJournal();
}

initTracks({
  markDirty,
  replaceSelectedGroup,
  get activeTrackId() { return activeTrackId; },
  set activeTrackId(v) { activeTrackId = v; },
  get el() { return el; },
  get poseViews() { return poseViews; },
  get selectedGroup() { return selectedGroup; },
  set selectedGroup(v) { selectedGroup = v; },
  get session() { return session; },
  setPoseIndex,
  setStatus,
  get STEP_MAX_UNIT_REM() { return STEP_MAX_UNIT_REM; },
  get STEP_MIN_REM() { return STEP_MIN_REM; },
  get STEP_MIN_UNIT_REM() { return STEP_MIN_UNIT_REM; },
  stopPlayback,
  get trackFrame() { return trackFrame; },
  set trackFrame(v) { trackFrame = v; },
});

/* ------------------------------------------------------- unsaved-work journal */
// Recovery: a copy of the unsaved work kept in browser storage (src/work-journal.js) a
// moment after each change, cleared when Save (or the hand-back to the Project tool) succeeds.
// If the tab dies first, opening the same pack offers it back.

const JOURNAL_TOOL = 'sprite-studio';
const JOURNAL_DELAY_MS = 2000;
let journalTimer = 0;
/** The write in flight, so a clear waits for it instead of racing it. */
let journalWrite = Promise.resolve();

function scheduleJournal() {
  if (!session) return;
  clearTimeout(journalTimer);
  journalTimer = setTimeout(() => {
    journalWrite = journalWrite.then(writeStudioJournal);
  }, JOURNAL_DELAY_MS);
}

async function writeStudioJournal() {
  if (!session || !dirty || saveUi.isOpen()) return;
  try {
    await writeJournal(JOURNAL_TOOL, session.label, await journalSnapshot());
  } catch (e) {
    // Storage full or refused: the work is still here to save; say so once rather than per change.
    if (!journalFailed) setStatus(`Could not keep a recovery copy of your unsaved work (${e?.message || e}) — save soon.`);
    journalFailed = true;
  }
}
let journalFailed = false;

/**
 * What a restore needs: the groups (pictures being painted encoded as they are now), the painted
 * tiles, pools and recovered pictures. Nothing in the session changes.
 */
async function journalSnapshot() {
  let groups = session.groups;
  for (const key of pictureStore.editedKeys()) {
    const group = findArtTarget(key);
    const art = group ? layerArtOf(group) : null;
    const px = art ? artPixelsFor(key, '') : null;
    // Out of step pictures are Save's to set aside; the journal keeps their last stored form.
    if (!art || !px || px.width !== art.width || px.height !== art.height) continue;
    const stored = cropOverpaint(art, px);
    groups = withPictureSettings(groups, key, stored ? { ...stored.op, png: await encodePngBase64(stored.pixels) } : null);
  }
  return {
    label: session.label,
    savedAt: new Date().toISOString(),
    frames: session.frames.length,
    baseBytes: session.baseBytes,
    groups: groups.map(groupWithEncodedTileColors),
    vbcolor: bytesToBase64(buildVBColorPack(session.gameId || 'vb-pack', session.pack)),
    gameStatePools: session.gameStatePools,
    recovered: session.recovered || [],
    recoveryUnreadable: session.recoveryUnreadable || [],
  };
}

/** After a successful save: the file has the work now. */
async function clearStudioJournal() {
  clearTimeout(journalTimer);
  const label = session?.label;
  await journalWrite;
  if (label) await clearJournal(JOURNAL_TOOL, label).catch(() => {});
}

/**
 * On open: unsaved work kept for this pack, if any, and whether to use it. Returns the journal to
 * restore, or null (and forgets it when declined).
 */
async function journalToRestore(label) {
  const journal = await readJournal(JOURNAL_TOOL, label).catch(() => null);
  if (!journal) return null;
  const when = new Date(journal.savedAt).toLocaleString();
  const sameBase = journal.frames === session.frames.length && journal.baseBytes === session.baseBytes;
  const ok = confirm(
    `SpriteStudio has unsaved work for ${label} from ${when} — the page closed before it was saved.\n\n`
      + (sameBase ? '' : 'The pack has changed since (it was saved from somewhere else): restoring puts back the groups and painted tiles as they were then, over those changes.\n\n')
      + 'Restore it? (Cancel discards it.)',
  );
  if (!ok) {
    await clearJournal(JOURNAL_TOOL, label).catch(() => {});
    return null;
  }
  return journal;
}

/** Put a journal's work into the freshly opened session. */
function restoreJournal(journal) {
  session.groups = journal.groups.map(normalizeGroup);
  const vb = parseVBColorPack(base64ToBytes(journal.vbcolor).buffer);
  if (vb) session.pack = new Map(vb.entries);
  if (Array.isArray(journal.gameStatePools)) session.gameStatePools = journal.gameStatePools;
}

initPainting({
  get canvas() { return canvas; },
  get el() { return el; },
  eye,
  get flipViewX() { return flipViewX; },
  get flipViewY() { return flipViewY; },
  markDirty,
  markPaletteSelection,
  get poseIndex() { return poseIndex; },
  get poseViews() { return poseViews; },
  referenceImageData,
  renderDetail,
  renderPalette,
  get selectedGroup() { return selectedGroup; },
  get session() { return session; },
  setStatus,
  get sideBySide() { return sideBySide; },
  get stageCrop() { return stageCrop; },
  get stageMirror() { return stageMirror; },
  get stagePaneW() { return stagePaneW; },
  get strokeSnapshot() { return strokeSnapshot; },
  set strokeSnapshot(v) { strokeSnapshot = v; },
  get tool() { return tool; },
  set tool(v) { tool = v; },
});

initAutopaint({
  get el() { return el; },
  eye,
  markDirty,
  get poseViews() { return poseViews; },
  renderPalette,
  get selectedGroup() { return selectedGroup; },
  get session() { return session; },
  setStatus,
});
el('btn-autopaint').addEventListener('click', openAutopaint);

initFindPoses({
  get el() { return el; },
  get selectedGroup() { return selectedGroup; },
  get session() { return session; },
  setStatus,
});

initFindSprites({
  get el() { return el; },
  markDirty,
  renderSpriteLists,
  selectGroup,
  get session() { return session; },
  setStatus,
});

initPick({
  brightness,
  get el() { return el; },
  eye,
  markDirty,
  pickGroup,
  get poseIndex() { return poseIndex; },
  get poseViews() { return poseViews; },
  get selectedGroup() { return selectedGroup; },
  set selectedGroup(v) { selectedGroup = v; },
  get session() { return session; },
  setStatus,
  get stageMirror() { return stageMirror; },
  vipFromClient,
});

initOverpaint({
  brightness,
  drawStage,
  get el() { return el; },
  eye,
  get frameImage() { return frameImage; },
  invalidateRender,
  isAnimatedGroup,
  layerSession,
  markActiveRow,
  markDirty,
  markPaletteSelection,
  overpaintPanelBody,
  paintColor,
  get poseImage() { return poseImage; },
  get poseIndex() { return poseIndex; },
  get poseViews() { return poseViews; },
  pushUndo,
  recoveredPicturesPart,
  referenceImageData,
  renderDetail,
  renderSpriteLists,
  renderStrip,
  renderTracksPanel,
  get selectedGroup() { return selectedGroup; },
  set selectedGroup(v) { selectedGroup = v; },
  selectGroup,
  get session() { return session; },
  setStatus,
  get stageMirror() { return stageMirror; },
  stopPlayback,
  get tool() { return tool; },
  get undoStack() { return undoStack; },
  vipFromClient,
});
initRecovery({
  markDirty,
  replaceSelectedGroup,
  drawStage,
  eye,
  invalidateRender,
  renderDetail,
  renderStrip,
  get selectedGroup() { return selectedGroup; },
  set selectedGroup(v) { selectedGroup = v; },
  get session() { return session; },
  setStatus,
});

initReference({
  markDirty,
  get activeReference() { return activeReference; },
  set activeReference(v) { activeReference = v; },
  get chosenReferenceId() { return chosenReferenceId; },
  drawStage,
  get el() { return el; },
  eye,
  hasOverlayPaint,
  invalidateRender,
  meanBrightness,
  offerToClearOverlay,
  paintStore,
  get poseIndex() { return poseIndex; },
  get poseViews() { return poseViews; },
  pushUndo,
  referenceImageData,
  get referenceIsForAnotherFrame() { return referenceIsForAnotherFrame; },
  set referenceIsForAnotherFrame(v) { referenceIsForAnotherFrame = v; },
  get referenceStore() { return referenceStore; },
  set referenceStore(v) { referenceStore = v; },
  renderPalette,
  renderStrip,
  get selectedGroup() { return selectedGroup; },
  get session() { return session; },
  setStatus,
  get undoStack() { return undoStack; },
});

initGhostBox({
  get activeReference() { return activeReference; },
  get canvas() { return canvas; },
  get el() { return el; },
  get ghostDrag() { return ghostDrag; },
  set ghostDrag(v) { ghostDrag = v; },
  get ghostRef() { return ghostRef; },
  set ghostRef(v) { ghostRef = v; },
  get ghostStage() { return ghostStage; },
  set ghostStage(v) { ghostStage = v; },
  ownPaintOnly,
  get PANE_GAP() { return PANE_GAP; },
  get poseIndex() { return poseIndex; },
  get poseViews() { return poseViews; },
  referenceImageData,
  get selectedGroup() { return selectedGroup; },
  get session() { return session; },
  setStatus,
  get sideBySide() { return sideBySide; },
  get stageCrop() { return stageCrop; },
  get stagePaneW() { return stagePaneW; },
  get stageScale() { return stageScale; },
});

initPaintScope({
  get el() { return el; },
  markDirty,
  get poseIndex() { return poseIndex; },
  get poseViews() { return poseViews; },
  renderPalette,
  get selectedGroup() { return selectedGroup; },
  get session() { return session; },
  setStatus,
});

/** Mean brightness of what a fill took, 0..255 — near 0 means it sampled empty space. */
function meanBrightness(tiles) {
  let sum = 0;
  let n = 0;
  for (const rgba of tiles.values()) {
    for (let i = 0; i < 64; i++) {
      if (rgba[i * 4 + 3] === 0) continue;
      sum += (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
      n++;
    }
  }
  return n ? sum / n : 0;
}

function paletteFromReference() {
  if (!activeReference) return;
  const { placements, patterns } = currentGroupPlacements();
  const image = referenceImageData();
  if (!image || !placements.length) return;
  const out = fillTilesFromReference(image, placements, (hash) => patterns.get(hash) || null);
  const colors = paletteFromTiles(out.tiles, 24);
  if (!colors.length) {
    setStatus('No colours under this group in the reference.');
    return;
  }
  referencePalette = colors;
  renderPalette();
  setStatus(`${colors.length} colour(s) from the reference — click one to paint with it.`);
}

/** The reference as pixels, drawn once into a scratch canvas so it can be sampled. */
let referencePixels = null;
let referencePixelsKey = '';
function referenceImageData() {
  if (!activeReference?.image) return null;
  const img = activeReference.image;
  const key = `${activeReference.meta.refId}|${img.naturalWidth}x${img.naturalHeight}`;
  if (referencePixelsKey !== key) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx = c.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, c.width, c.height);
    referencePixels = { data: data.data, width: c.width, height: c.height };
    referencePixelsKey = key;
  }
  return { ...referencePixels, transform: activeReference.transform };
}

function endStroke() {
  if (!painting) return;
  painting = false;
  if (finishArtStroke()) {
    setStatus('Painted the overpaint — pinned to this layer, so it shows wherever the layer is on screen; the tile colours are unchanged. Undo takes the stroke back.');
    return;
  }
  if (strokeSnapshot?.size) {
    if (tool === 'erase') dropErasedTiles(strokeSnapshot.keys());
    pushUndo({ groupId: paintTargetGroupFor(selectedGroup)?.id ?? null, map: strokeSnapshot });
    if (undoStack.length > 50) undoStack.shift();
    el('btn-undo').disabled = false;
    markDirty();
    // Only the poses showing a painted pattern look different; the rest of the strip stays.
    refreshPoseThumbs(new Set(strokeSnapshot.keys()));
    renderPalette();
    renderDetail();
    const tiles = strokeSnapshot.size;
    if (selectedGroup && !isObjGroup(selectedGroup)) {
      const copies = (poseViews[poseIndex]?.pose.tiles || []).filter((t) => strokeSnapshot.has(t.hash >>> 0)).length;
      setStatus(`Painted ${tiles} tile pattern(s) — ${copies} cop${copies === 1 ? 'y' : 'ies'} on this screen changed with ${tiles === 1 ? 'it' : 'them'}.`);
    } else {
      setStatus(`Painted ${tiles} tile pattern(s) — every pose using ${tiles === 1 ? 'it' : 'them'} updates together.`);
    }
  }
  strokeSnapshot = null;
}

initHistory({
  drawStage,
  get el() { return el; },
  invalidateRender,
  markDirty,
  paintStore,
  renderDetail,
  renderPalette,
  get session() { return session; },
  setStatus,
});

/* ---------------------------------------------------------------- palette */

function renderPalette() {
  const host = el('palette');
  host.textContent = '';
  if (referencePalette.length) host.append(swatchRow(referencePalette.map((hex) => ({ hex, count: 0 })), 'From the reference'));
  const colors = selectedGroup ? usedColorsForGroup(session, selectedGroup) : [];
  if (!colors.length && referencePalette.length) return;
  if (!colors.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Painted colours show up here.';
    host.append(p);
    return;
  }
  host.append(swatchRow(colors));
  markPaletteSelection();
}

/** A row of clickable colours; clicking one becomes the brush colour. */
function swatchRow(colors, label = '') {
  const box = document.createElement('div');
  if (label) {
    const h = document.createElement('p');
    h.className = 'empty';
    h.style.margin = '0 0 0.2rem 0';
    h.textContent = label;
    box.append(h);
  }
  const wrap = document.createElement('div');
  wrap.className = 'swatches';
  for (const { hex, count } of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.hex = hex;
    b.style.background = hex;
    b.title = count ? `${hex} · ${count} pixel(s)` : hex;
    b.addEventListener('click', () => {
      el('paint-color').value = hex;
      if (tool === 'look') setTool('brush');
      markPaletteSelection();
    });
    wrap.append(b);
  }
  box.append(wrap);
  return box;
}

function markPaletteSelection() {
  const cur = (el('paint-color').value || '').toLowerCase();
  for (const b of document.querySelectorAll('.swatch')) {
    b.classList.toggle('active', b.dataset.hex?.toLowerCase() === cur);
  }
}

/* --------------------------------------------------------------- playback */

function stopPlayback() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = 0;
  }
  el('btn-play').textContent = '▶ Play';
  el('btn-track-play').textContent = '▶ Play track';
}

function togglePlayback() {
  if (playTimer) {
    stopPlayback();
    return;
  }
  const fps = Math.min(30, Math.max(1, Number(el('fps').value) || 6));
  playTimer = setInterval(() => setPoseIndex(poseIndex + 1), 1000 / fps);
  el('btn-play').textContent = '⏸ Pause';
}

/** Play the named track, honoring each step's hold in VB frames. */
function toggleTrackPlayback() {
  if (playTimer) {
    stopPlayback();
    return;
  }
  const track = currentTrack();
  if (!track?.steps.length) return;
  const total = trackLengthFrames(track);
  playTimer = setInterval(() => {
    trackFrame = (trackFrame + 1) % total;
    const at = trackStepAtFrame(track, trackFrame);
    if (!at) return;
    const idx = poseViews.findIndex((v) => v.pose.poseId === at.step.poseId);
    const mirror = at.step.flipH === true;
    // The same pose can appear twice in a row, once mirrored — switch on either change.
    if (idx >= 0 && (idx !== poseIndex || mirror !== stageMirror)) setPoseIndex(idx, { keepTrackFrame: true, mirror });
    renderTimeline(track);
  }, MS_PER_VB_FRAME);
  el('btn-track-play').textContent = '⏸ Pause';
}

initRender({
  get activeReference() { return activeReference; },
  brightness,
  get canvas() { return canvas; },
  colourForHash,
  get stageCtx() { return stageCtx; },
  get el() { return el; },
  eye,
  get flipReferenceX() { return flipReferenceX; },
  get flipReferenceY() { return flipReferenceY; },
  get flipViewX() { return flipViewX; },
  get flipViewY() { return flipViewY; },
  get frameCanvas() { return frameCanvas; },
  get frameCtx() { return frameCtx; },
  get frameImage() { return frameImage; },
  get freeView() { return freeView; },
  get ghostCanvas() { return ghostCanvas; },
  get ghostCtx() { return ghostCtx; },
  get ghostImage() { return ghostImage; },
  get ghostRef() { return ghostRef; },
  get ghostStage() { return ghostStage; },
  hasOverlayPaint,
  layerSession,
  get ONION_ALPHA() { return ONION_ALPHA; },
  get OTHER_COPIES_ALPHA() { return OTHER_COPIES_ALPHA; },
  ownPaintOnly,
  get PANE_GAP() { return PANE_GAP; },
  get pinnedFrameIndex() { return pinnedFrameIndex; },
  get poseCanvas() { return poseCanvas; },
  get poseCtx() { return poseCtx; },
  get poseImage() { return poseImage; },
  get poseIndex() { return poseIndex; },
  get poseViews() { return poseViews; },
  get referencePeek() { return referencePeek; },
  get selectedGroup() { return selectedGroup; },
  get session() { return session; },
  get sideBySide() { return sideBySide; },
  get STAGE_PAD() { return STAGE_PAD; },
  get stageAvail() { return stageAvail; },
  set stageAvail(v) { stageAvail = v; },
  stageBackgroundColor,
  get stageCrop() { return stageCrop; },
  set stageCrop(v) { stageCrop = v; },
  get stageMirror() { return stageMirror; },
  get stagePaneW() { return stagePaneW; },
  set stagePaneW(v) { stagePaneW = v; },
  get stageScale() { return stageScale; },
  set stageScale(v) { stageScale = v; },
  viewPatterns,
});

/* ------------------------------------------------------------------ wiring */

el('btn-open').addEventListener('click', () => {
  openViaPicker().catch((e) => setStatus(`Open failed: ${e?.message || e}`));
});
el('file-input').addEventListener('change', async (e) => {
  const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (!file) return;
  try {
    forgetProjectReturn();
    await openPack(await file.arrayBuffer(), file.name);
  } catch (err) {
    setStatus(`Open failed: ${err?.message || err}`);
  }
});
el('btn-play').addEventListener('click', togglePlayback);
el('btn-track-play').addEventListener('click', toggleTrackPlayback);

const saveUi = createSaveProgressUi();

/** A byte count the way a person reads it, for the save window. */
function formatByteSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** The Project tool's state from the handoff, carried back so it reopens where you left it. */
let projectReturn = /** @type {any} */ (null);

function forgetProjectReturn() {
  projectReturn = null;
  syncProjectLink();
}

/** The header link goes back to the Project tool with this pack when it came from there. */
function syncProjectLink() {
  const link = el('nav-project');
  if (!link) return;
  const back = !!projectReturn && !!session;
  link.textContent = back ? '← Project tool' : 'Project tool';
  link.title = back ? 'Back to the Project tool with what you changed here, where you left it' : '';
}

/**
 * Hand the pack back to the Project tool: SpriteStudio's changes on top of what the Project
 * tool handed over, plus the state it was in, so it reopens on the same frame and group and
 * still saves to the same file. Nothing is written to disk here — the Project tool's Save does that.
 */
async function handBackToProjectTool() {
  stopPlayback();
  await saveUi.begin('Back to the Project tool', VBPACK_HANDOFF_STEPS);
  await saveUi.step('check');
  saveUi.finish('check');
  await saveUi.step('collect');
  saveUi.finish('collect', `${session.pack.size} pack tile(s), ${session.groups.length} group(s)`);
  let blob;
  try {
    await saveUi.step('zip');
    await encodeEditedLayerArt();
    blob = await buildPackBlob(session, { onUpdate: ({ percent, currentFile }) => saveUi.update('zip', percent, currentFile) });
    saveUi.finish('zip', formatByteSize(blob.size));
    await saveUi.step('write');
    await putHandoff(HANDOFF_KEY_RETURN_PACK, await blob.arrayBuffer());
    await putHandoff(HANDOFF_KEY_RETURN_STATE, { ...projectReturn, spriteStudioChanged: dirty });
    saveUi.finish('write');
  } catch (e) {
    saveUi.end({ failedAt: saveUi.runningStepId() || 'zip', message: `Could not hand the pack back: ${e?.message || e}` });
    setStatus(`Could not go back to the Project tool: ${e?.message || e}`);
    return;
  }
  await saveUi.step('sync');
  // The changes travel with the pack now; leaving must not warn about losing them.
  dirty = false;
  await clearStudioJournal();
  projectReturn = { ...projectReturn, unsaved: false };
  saveUi.finish('sync');
  saveUi.end();
  location.href = '/tools/project.html?from=spritestudio';
}

el('nav-project')?.addEventListener('click', (e) => {
  if (!projectReturn || !session) return;
  e.preventDefault();
  void handBackToProjectTool();
});

/**
 * Where Save (or Save as…) writes, settled while the click still counts: the browser only asks for
 * permission to write a file, or shows a Save As dialog, during the click itself — not after the
 * seconds packing takes. Save writes the file the pack came from (asking the browser's permission
 * once per session); Save as…, or a pack opened from no file SpriteStudio can write back to, asks
 * where.
 * @param {boolean} saveAs
 * @returns {Promise<{ handle: any, overwrite: boolean } | { download: true } | { cancelled: true } | { denied: string }>}
 */
async function chooseSaveTarget(saveAs, name) {
  if (!saveAs && canWriteHandle(saveFileHandle)) {
    if (await ensureHandlePermission(saveFileHandle, 'readwrite')) return { handle: saveFileHandle, overwrite: true };
    return { denied: saveFileHandle.name || name };
  }
  const picked = await pickSaveVbpackFile(name);
  if (picked.status === 'aborted') return { cancelled: true };
  if (picked.status === 'ok') return { handle: picked.handle, overwrite: false };
  if (picked.status === 'error') console.warn('[sprite-studio] Save picker failed, downloading instead:', picked.error);
  return { download: true };
}

/**
 * Write the pack where `target` says. Overwriting keeps a .bak copy in the home folder first, as
 * the Project tool does; a file chosen in Save as… becomes the one Save writes from then on.
 * @returns {Promise<{ name: string, message: string }>}
 */
async function writePackFile(blob, name, target) {
  if ('download' in target) {
    downloadBlob(blob, name);
    return { name, message: `Downloaded ${name} (this browser cannot write files in place).` };
  }
  const file = target.handle.name || name;
  if (target.overwrite) {
    const backup = await writeBackupCopy(target.handle, await getUsableHomeDirectory('readwrite'));
    await writeBlobToFileHandle(target.handle, blob);
    return { name: file, message: `Saved ${file}.${backup ? ` The previous version is in ${backup}.` : ''}` };
  }
  await writeBlobToFileHandle(target.handle, blob);
  saveFileHandle = target.handle;
  return { name: file, message: `Saved ${file}. Save writes this file from now on.` };
}

/** Save (or Save as…): pack the session and write it. */
async function saveStudio(saveAs) {
  if (!session) return;
  const name = session.label || 'pack.vbpack';
  const target = await chooseSaveTarget(saveAs, name);
  if ('cancelled' in target) {
    setStatus('Save cancelled — nothing was written.');
    return;
  }
  if ('denied' in target) {
    setStatus(`The browser did not allow SpriteStudio to write ${target.denied}, so nothing was saved. Click Save again and allow it, or use Save as… to choose a file.`);
    return;
  }
  // Same window as the Project tool: a real project takes seconds here too, and the status
  // line could only speak once it was over.
  await saveUi.begin(`Saving ${'handle' in target ? target.handle.name || name : name}`);
  await saveUi.step('check');
  saveUi.finish('check');
  await saveUi.step('collect');
  saveUi.finish('collect', `${session.pack.size} pack tile(s), ${session.groups.length} group(s)`);

  let blob;
  try {
    await saveUi.step('zip');
    await encodeEditedLayerArt();
    blob = await buildPackBlob(session, {
      onUpdate: ({ percent, currentFile }) => saveUi.update('zip', percent, currentFile),
    });
    saveUi.finish('zip', formatByteSize(blob.size));
  } catch (e) {
    saveUi.end({ failedAt: 'zip', message: `Could not pack the file: ${e?.message || e}` });
    setStatus(`Save failed: ${e?.message || e}`);
    return;
  }

  await writeStudioPack(blob, name, target);
}

/**
 * Write a packed project and finish the save. When writing fails nothing else is written
 * quietly, but the save window offers the ways out with the same contents: Save as… another
 * file, or Download a copy (recovery: the work is never left only in memory).
 */
async function writeStudioPack(blob, name, target) {
  try {
    await saveUi.step('write');
    const wrote = await writePackFile(blob, name, target);
    saveUi.finish('write', wrote.name);
    await saveUi.step('sync');
    dirty = false;
    await clearStudioJournal();
    // Going back to the Project tool now: it saves to this same file, and has nothing unsaved.
    if (projectReturn) {
      projectReturn = {
        ...projectReturn,
        unsaved: false,
        fileHandle: saveFileHandle || projectReturn.fileHandle,
        packName: saveFileHandle?.name || projectReturn.packName,
      };
    }
    syncSaveTarget();
    saveUi.finish('sync');
    saveUi.end();
    setStatus(wrote.message);
  } catch (e) {
    saveUi.end({
      failedAt: 'write',
      message: `Could not write the file: ${e?.message || e}`,
      actions: [
        { id: 'btn-save-failed-save-as', label: 'Save as…', title: 'Write the same project to another file', run: () => retryStudioSaveAs(blob, name) },
        {
          id: 'btn-save-failed-download',
          label: 'Download a copy',
          title: 'Download the same project to your downloads folder',
          run: () => {
            downloadBlob(blob, name);
            setStatus(`Downloaded a copy of the project as ${name}. It is still marked unsaved here: Save again once the file can be written.`);
          },
        },
      ],
    });
    setStatus(`Save failed: ${e?.message || e}. Nothing else was written — use Save as… or Download a copy in the save window.`);
  }
}

/** Save as… after a failed write: the same packed project to a file chosen now. */
async function retryStudioSaveAs(blob, name) {
  const target = await chooseSaveTarget(true, name);
  if ('cancelled' in target || 'denied' in target) {
    setStatus('Save as… was cancelled — nothing was written. The project is still unsaved here.');
    return;
  }
  await saveUi.begin(`Saving ${'handle' in target ? target.handle.name || name : name}`);
  for (const id of ['check', 'collect', 'zip']) {
    await saveUi.step(id);
    saveUi.finish(id, id === 'zip' ? formatByteSize(blob.size) : '');
  }
  await writeStudioPack(blob, name, target);
}

el('btn-save').addEventListener('click', () => void saveStudio(false));
el('btn-save-as').addEventListener('click', () => void saveStudio(true));

/* Tracks */
el('track-select').addEventListener('change', (e) => {
  activeTrackId = /** @type {HTMLSelectElement} */ (e.target).value || null;
  trackFrame = 0;
  renderTracksPanel();
});
el('btn-track-new').addEventListener('click', () => {
  if (!selectedGroup) return;
  const name = window.prompt('Name this animation', `Animation ${currentTracks().length + 1}`);
  if (!name) return;
  const next = addTrackToGroup(selectedGroup, { name, steps: [] });
  activeTrackId = next.tracks[next.tracks.length - 1].id;
  replaceSelectedGroup(next);
  setStatus(`Added animation “${name}”. Show a pose and press “+ Pose” to build it up.`);
});
el('btn-track-rename').addEventListener('click', () => {
  const track = currentTrack();
  if (!track || !selectedGroup) return;
  const name = window.prompt('Rename animation', track.name);
  if (!name) return;
  replaceSelectedGroup(updateTrack(selectedGroup, track.id, { name }));
});
el('btn-track-delete').addEventListener('click', () => {
  const track = currentTrack();
  if (!track || !selectedGroup) return;
  if (!window.confirm(`Delete animation “${track.name}”?`)) return;
  stopPlayback();
  activeTrackId = null;
  replaceSelectedGroup(removeTrackFromGroup(selectedGroup, track.id));
  setStatus(`Deleted animation “${track.name}”.`);
});
el('btn-track-add-pose').addEventListener('click', () => {
  const track = currentTrack();
  const view = poseViews[poseIndex];
  if (!track || !view) return;
  const hold = Math.max(1, Number(el('track-hold').value) || 6);
  const mirrored = el('track-mirror').checked;
  setTrackSteps([
    ...track.steps,
    { poseId: view.pose.poseId, holdFrames: hold, ...(mirrored && { flipH: true }) },
  ]);
});

/* Painting */
el('btn-tool-none').addEventListener('click', () => setTool('look'));
el('btn-tool-brush').addEventListener('click', () => setTool('brush'));
el('btn-tool-erase').addEventListener('click', () => setTool('erase'));
try {
  if (localStorage.getItem(OWN_PAINT_KEY) === '0') el('toggle-own-paint').checked = false;
} catch {
  /* the default (on) */
}
el('toggle-own-paint').addEventListener('change', () => {
  try {
    localStorage.setItem(OWN_PAINT_KEY, ownPaintOnly() ? '1' : '0');
  } catch {
    /* remembered for this page only */
  }
  invalidateRender();
  renderStrip();
  drawStage();
  renderDetail();
  setStatus(ownPaintOnly() ? 'Showing only this group’s own paint on its tiles.' : 'Showing what the game shows: other groups’ paint on shared tiles too.');
});
el('btn-redo').addEventListener('click', redoStroke);
el('btn-tool-pick').addEventListener('click', () => setTool('pick'));
el('btn-tool-fill').addEventListener('click', () => setTool('fill'));
el('btn-tool-swap').addEventListener('click', () => setTool('swap'));
el('btn-tool-clone').addEventListener('click', () => {
  if (!activeReference) {
    setStatus('Clone needs a reference for this frame — add one in the Project tool.');
    return;
  }
  setTool('clone');
  setStatus('Clone: painting takes the reference’s colour at each pixel.');
});
el('paint-color').addEventListener('input', markPaletteSelection);
el('btn-undo').addEventListener('click', undoStroke);
canvas.addEventListener('pointerdown', (e) => {
  hideExplainBubble();
  if (poseViews.length && (e.button === 1 || (e.button === 0 && e.altKey))) {
    // Middle-drag or Alt+drag pans the stage; it never paints.
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    panDrag = { x: e.clientX, y: e.clientY, view: freeView || viewFromCrop(stageCrop, stageScale) };
    return;
  }
  // Side by side: the reference pane is for looking and sampling, and the boxes own dragging.
  if (sideBySide() && poseViews.length) {
    const { pane } = paneAt(e);
    if (pane === 'ref' && tool === 'pick') {
      pickFromReference(e);
      return;
    }
    e.preventDefault();
    if (onGhostPointerDown(e)) return;
    if (pane === 'ref') return;
  }
  if (tool === 'look' || !poseViews.length) return;
  // A BG group with overlay paint would hide what is painted here: settle that first. The
  // dialog swallows the pointer-up, so the stroke starts on the next click.
  if (tool !== 'pick' && hasOverlayPaint(selectedGroup)) {
    offerToClearOverlay(selectedGroup);
    return;
  }
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  if (tool === 'pick') {
    pickAt(e);
    return;
  }
  if (tool === 'fill') {
    floodFillAt(e);
    return;
  }
  if (tool === 'swap') {
    swapColourAt(e);
    return;
  }
  painting = true;
  strokeSnapshot = new Map();
  paintAt(e);
});
canvas.addEventListener('pointermove', (e) => {
  if (panDrag) {
    const r = canvas.getBoundingClientRect();
    const toStage = canvas.width / Math.max(1, r.width);
    freeView = panBy(panDrag.view, (e.clientX - panDrag.x) * toStage, (e.clientY - panDrag.y) * toStage);
    drawStage();
    return;
  }
  if (ghostDrag) {
    onGhostPointerMove(e);
    return;
  }
  if (painting && (tool === 'brush' || tool === 'erase' || tool === 'clone')) {
    paintAt(e);
    return;
  }
  // With Show unpainted on, the pointer says what an unpainted pixel will look like in the game.
  let note = '';
  if (showUnpainted() && !activePicture()) {
    const hit = tileUnderPointer(e);
    const state = hit ? pixelPaintState(hit) : null;
    if (state === 'none') note = 'Unpainted tile — the game shows its original picture here';
    else if (state === 'starter') note = 'Starting grey — the game shows this grey until you paint it';
  }
  if (canvas.title !== note) canvas.title = note;
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  canvas.addEventListener(ev, (e) => {
    panDrag = null;
    endGhostDrag(e);
    endStroke();
  });
}
// The middle button would otherwise start the browser's autoscroll.
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault();
});
// Wheel zooms around the pixel under the pointer, in whole-pixel steps.
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!poseViews.length || e.deltaY === 0) return;
    e.preventDefault();
    const { pane, fx, fy } = paneAt(e);
    if (pane !== 'stage') return;
    const view = freeView || viewFromCrop(stageCrop, stageScale);
    const px = (fx - stageCrop.x) * stageScale;
    const py = (fy - stageCrop.y) * stageScale;
    freeView = zoomAt(view, stageAvail, { fx, fy, px, py }, e.deltaY < 0 ? 1 : -1, { w: FRAME_W, h: FRAME_H });
    drawStage();
  },
  { passive: false },
);
el('btn-fit').addEventListener('click', () => {
  freeView = null;
  drawStage();
});
el('toggle-one-set').addEventListener('change', () => {
  freeView = null;
  drawStage();
});

/* Reference */
for (const [id, get, set] of [
  ['btn-flip-x', () => flipViewX, (v) => { flipViewX = v; }],
  ['btn-flip-y', () => flipViewY, (v) => { flipViewY = v; }],
  ['btn-flip-ref-x', () => flipReferenceX, (v) => { flipReferenceX = v; }],
  ['btn-flip-ref-y', () => flipReferenceY, (v) => { flipReferenceY = v; }],
]) {
  el(id).addEventListener('click', () => {
    set(!get());
    el(id).setAttribute('aria-pressed', String(get()));
    el(id).classList.toggle('active', get());
    drawStage();
    setStatus(
      flipViewX || flipViewY || flipReferenceX || flipReferenceY
        ? 'Flipped view only — the pose and your paint keep the orientation they were captured in.'
        : 'View unflipped.',
    );
  });
}
el('btn-clear-paint').addEventListener('click', clearPaintForCurrentView);
el('btn-reference-fill').addEventListener('click', fillFromReference);
el('btn-reference-palette').addEventListener('click', paletteFromReference);
el('toggle-reference-clip').addEventListener('change', drawStage);
el('reference-pick').addEventListener('change', (e) => {
  chosenReferenceId = /** @type {HTMLSelectElement} */ (e.target).value || null;
  referencePixelsKey = '';
  refreshActiveReference();
});
el('btn-reference-paste').addEventListener('click', pasteIntoBox);
el('btn-reference-box-reset').addEventListener('click', () => {
  setGhostBox(defaultGhostBox());
  setStatus('Box reset over the whole group, aimed straight at the reference.');
});
el('toggle-side-by-side').addEventListener('change', () => {
  if (sideBySide() && !ghostStage) setGhostBox(defaultGhostBox());
  updateGhostUi();
  drawStage();
});
// Arrow keys nudge where a paste takes its colours from: 1 px, or 8 with Shift.
window.addEventListener('keydown', (e) => {
  if (!sideBySide() || !ghostRef || !e.key.startsWith('Arrow')) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const step = e.shiftKey ? 8 : 1;
  const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!by) return;
  e.preventDefault();
  ghostRef = { ...ghostRef, x: ghostRef.x + by[0], y: ghostRef.y + by[1] };
  updateGhostUi();
  drawStage();
});
// Esc puts Pick's answer away.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideExplainBubble();
});
// Hold R to see the reference at full strength, like the Project tool.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'r' && e.key !== 'R') return;
  if (e.repeat || isTextEntry(e.target)) return;
  referencePeek = true;
  drawStage();
});
window.addEventListener('keyup', (e) => {
  if (e.key !== 'r' && e.key !== 'R' || !referencePeek) return;
  referencePeek = false;
  drawStage();
});

/** Typing into a text box: the only focus that keeps letter keys from the tools. */
function isTextEntry(t) {
  return t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && ['text', 'number', 'search', 'email', 'url', 'tel', 'password'].includes(t.type));
}

// A toolbar control used with the mouse gives focus back, so arrows, Space and the tool keys reach
// the stage again. Keyboard use (Tab, arrows on a slider) keeps focus where it is.
let toolbarPointer = false;
document.addEventListener('pointerdown', (e) => {
  toolbarPointer = !!(e.target instanceof Element && e.target.closest('.stage-toolbar, .tool-rail'));
});
const releaseToolbarFocus = (e) => {
  const t = e.target;
  if (!toolbarPointer || !(t instanceof HTMLElement) || isTextEntry(t) || !t.closest('.stage-toolbar, .tool-rail')) return;
  toolbarPointer = false;
  (t.closest('button') || t).blur();
};
document.addEventListener('change', releaseToolbarFocus);
document.addEventListener('click', releaseToolbarFocus);

/** Onion's menu and opacity, and Original's opacity, show only while their toggle is on. */
function syncOverlayControls() {
  const onion = !!el('toggle-onion').checked;
  el('onion-pose').hidden = !onion;
  el('onion-alpha-label').hidden = !onion;
  el('original-alpha-label').hidden = !el('toggle-original').checked;
}
syncOverlayControls();
el('toggle-onion').addEventListener('change', syncOverlayControls);
el('toggle-original').addEventListener('change', syncOverlayControls);

// Hold O to see the pose's original picture (the game's monochrome) in place of the paint.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'o' && e.key !== 'O') return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return;
  e.preventDefault();
  setOriginalPeek(true);
  drawStage();
});
window.addEventListener('keyup', (e) => {
  if (e.key !== 'o' && e.key !== 'O') return;
  setOriginalPeek(false);
  drawStage();
});
// Switching away mid-hold would leave the original stuck on.
window.addEventListener('blur', () => {
  setOriginalPeek(false);
  drawStage();
});
el('toggle-original').addEventListener('change', drawStage);
el('original-alpha').addEventListener('input', () => {
  // Moving the slider means you want to see it.
  el('toggle-original').checked = true;
  drawStage();
});

for (const id of ['toggle-reference', 'reference-alpha']) {
  el(id).addEventListener('input', drawStage);
}
for (const id of ['toggle-onion', 'toggle-pin-background']) {
  el(id).addEventListener('change', drawStage);
}
// Choosing a pose to ghost turns the onion skin on.
el('onion-pose').addEventListener('change', () => {
  if (onionPick()) el('toggle-onion').checked = true;
  syncOverlayControls();
  drawStage();
});
try {
  const saved = Number(localStorage.getItem(ONION_ALPHA_KEY));
  if (Number.isFinite(saved) && saved > 0) el('onion-alpha').value = String(saved);
} catch {
  /* private mode: the default */
}
el('onion-alpha').addEventListener('input', () => {
  try {
    localStorage.setItem(ONION_ALPHA_KEY, el('onion-alpha').value);
  } catch {
    /* remembered for this page only */
  }
  if (onionOn()) drawStage();
});
const SHOW_UNPAINTED_KEY = 'spriteStudio.showUnpainted';
try {
  const saved = localStorage.getItem(SHOW_UNPAINTED_KEY);
  if (saved !== null) el('toggle-unpainted').checked = saved === '1';
} catch {
  /* private mode: keep the default (on) */
}
el('toggle-unpainted').addEventListener('change', () => {
  try {
    localStorage.setItem(SHOW_UNPAINTED_KEY, el('toggle-unpainted').checked ? '1' : '0');
  } catch {
    /* remembered for this page only */
  }
  invalidateRender();
  drawStage();
  renderStrip();
  renderDetail();
});
// Show scaled swaps a scaled group's base-tiles cards for the poses as the game drew them, staying on the same card.
el('toggle-show-scaled').addEventListener('change', () => {
  const n = poseViews.length;
  whileBusy(`${el('toggle-show-scaled').checked ? 'Loading scaled cards for' : 'Building base tiles for'} ${n} pose${n === 1 ? '' : 's'}…`, applyBaseTilesToggle);
});
function applyBaseTilesToggle() {
  if (!selectedGroup || !session) return;
  stopPlayback();
  freeView = null;
  const at = poseIndex;
  // Stay on the same captured frame: a base-tiles card stands in for the scaled card of its frame.
  const frameOf = (v) => v?.base?.sourceFrameIndex ?? v?.frameIndex;
  const wasOn = frameOf(poseViews[at]);
  poseViews = buildPoseViews(selectedGroup);
  const same = poseViews.findIndex((v) => frameOf(v) === wasOn);
  poseIndex = same >= 0 ? same : Math.max(0, Math.min(at, poseViews.length - 1));
  pinnedFrameIndex = poseViews[poseIndex]?.frameIndex ?? -1;
  invalidateRender();
  renderStrip();
  syncPoseScrub();
  refreshActiveReference();
  drawStage();
  renderDetail();
  const v = poseViews[poseIndex];
  setStatus(
    el('toggle-show-scaled').checked
      ? 'Showing each pose scaled, as on the frame it was captured from.'
      : v?.base
        ? `Base tiles: ${v.matched} tile(s) as they sit in the game's map, unscaled. Paint here colours every scaled copy.`
        : 'This card has no base tiles to show.',
  );
}
try {
  const saved = localStorage.getItem(STAGE_BG_KEY);
  if (saved) el('stage-bg-color').value = saved;
} catch {
  /* private mode: keep the default */
}
el('stage-bg-color').addEventListener('input', () => {
  try {
    localStorage.setItem(STAGE_BG_KEY, stageBackgroundColor());
  } catch {
    /* not worth failing a redraw over */
  }
  drawStage();
  // Thumbnails sit on this colour too when the background is off, so they go stale otherwise.
  renderStrip();
});
el('pose-scrub').addEventListener('input', (e) => {
  stopPlayback();
  setPoseIndex(Number(/** @type {HTMLInputElement} */ (e.target).value));
});
for (const id of ['toggle-background', 'toggle-outline', 'toggle-zoom']) {
  el(id).addEventListener('change', () => {
    if (id === 'toggle-zoom') freeView = null;
    drawStage();
    // Thumbnails follow the Background toggle too, so the strip has to be rebuilt.
    if (id === 'toggle-background') renderStrip();
  });
}
for (const id of ['eye-select', 'brightness']) {
  el(id).addEventListener('change', () => {
    invalidateRender();
    if (selectedGroup) selectGroup(selectedGroup);
    else drawStage();
  });
}
// The nav links leave the page, and painted tiles and tracks live only in memory
// until Save — warn rather than drop them.
// The Project tool's own unsaved edits came over in the hand-over too, and live only here now.
window.addEventListener('beforeunload', (e) => {
  if (!dirty && !projectReturn?.unsaved) return;
  e.preventDefault();
  e.returnValue = '';
});

/**
 * After the Project tool's hand-over: open the saved pose on the frame you were on that still has
 * pixels nothing colours (the group you had selected first, when it has one there). Otherwise the
 * group you had selected stays, as before.
 * @param {unknown} frameVipFile the Project tool's frame @param {string | null} preferGroupId
 */
async function goToPoseNeedingPaint(frameVipFile, preferGroupId) {
  if (!session || typeof frameVipFile !== 'string') return;
  const frameIndex = frameIndexForReturn(session.frames, frameVipFile);
  if (frameIndex < 0) return;
  const where = frameLabel(session, frameIndex) || 'that frame';
  let needs;
  try {
    needs = await posesNeedingPaint(session, frameIndex);
  } catch (e) {
    console.warn('[sprite-studio] Could not look for poses needing paint:', e);
    return;
  }
  const pick = pickPoseNeedingPaint(needs, preferGroupId);
  if (!pick) {
    setStatus(`Every saved pose on ${where} is coloured. Unpainted art there is in no saved pose yet — capture it as a pose to paint it here.`);
    return;
  }
  const group = session.groups.find((g) => g.id === pick.group.id);
  if (!group) return;
  if (selectedGroup?.id !== group.id) selectGroup(group);
  const id = pick.pose.poseId;
  const i = poseViews.findIndex((v) => v.pose?.poseId === id || v.pose?.poseId === `__base:${id}`);
  if (i >= 0) setPoseIndex(i);
  const rest = needs.length - 1;
  setStatus(
    `${group.name || group.id} · ${pick.pose.name || id}: ${pick.unpainted.toLocaleString()} px still uncoloured on ${where}.` +
      (rest ? ` ${rest} other pose${rest === 1 ? '' : 's'} there need${rest === 1 ? 's' : ''} paint too.` : ''),
  );
}

/** Open whatever the Project tool handed over, so the two pages feel like one workflow. */
// Only when the Project tool just sent you here, and only once: a reload or a visit from the
// tools page must not reopen an older hand-over (possibly another pack) that Save then writes.
(async () => {
  if (new URLSearchParams(location.search).get('from') !== 'painter') return;
  try {
    const buffer = await getHandoff(HANDOFF_KEY);
    const name = (await getHandoff(`${HANDOFF_KEY}-name`)) || 'pack.vbpack';
    const groupId = await getHandoff(`${HANDOFF_KEY}-group`).catch(() => null);
    const state = (await getHandoff(HANDOFF_KEY_PROJECT_STATE).catch(() => null)) || null;
    try {
      history.replaceState({}, '', location.pathname);
    } catch (_) {}
    if (!buffer || !buffer.byteLength) {
      setStatus('Nothing came over from the Project tool — open a .vbpack.');
      return;
    }
    // Save writes the file the Project tool saves to, and "← Project tool" goes back to it.
    await openPack(buffer, String(name), typeof groupId === 'string' ? groupId : null, state?.fileHandle);
    projectReturn = state;
    syncProjectLink();
    await goToPoseNeedingPaint(state?.frameVipFile, typeof groupId === 'string' ? groupId : null);
    // Opened: the hand-over has done its job (kept until now so a failed open loses nothing).
    for (const key of [HANDOFF_KEY, `${HANDOFF_KEY}-name`, `${HANDOFF_KEY}-group`, HANDOFF_KEY_PROJECT_STATE]) {
      await deleteHandoff(key).catch(() => {});
    }
  } catch (e) {
    setStatus(`Could not open the pack handed over from the Project tool: ${e?.message || e}`);
  }
})();

bindGroupSearch();

// Layer art and touch-ups: saved pictures are PNG; Ctrl+V pastes an image into the picture that
// strokes go to (the selected group's layer art, or its touch-up in Touch-up mode).
installLayerArtDecoder();
document.addEventListener('paste', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
  const pic = activePicture();
  if (!pic) return;
  const blob = imageFromPasteEvent(e);
  if (!blob) return;
  e.preventDefault();
  void usePictureImage(blob, 'Pasted', pic.key, pic.kind);
});

el('btn-paint-tiles').addEventListener('click', () => setPaintOn('tiles'));
el('btn-paint-touchup').addEventListener('click', () => setPaintOn('overpaint'));
el('toggle-touchup').addEventListener('change', () => {
  // Hiding it while painting it would make strokes invisible: drop back to tile paint.
  if (!showTouchUps() && overpaintMode()) setPaintOn('tiles');
  invalidateRender();
  // Every card of the group follows it, not just the stage.
  renderStrip();
  drawStage();
});

const TOOL_KEYS = { v: 'btn-tool-none', b: 'btn-tool-brush', e: 'btn-tool-erase', g: 'btn-tool-fill', i: 'btn-tool-pick', c: 'btn-tool-clone', s: 'btn-tool-swap', a: 'btn-autopaint' };
document.addEventListener('keydown', (e) => {
  // Letter keys are the tools unless you are typing: a checkbox, slider, menu or button you just
  // used in the toolbar keeps focus, and must not swallow B, G or I.
  const typing = isTextEntry(e.target);
  if (e.key.toLowerCase() === 't' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !el('paint-on').hidden) {
    e.preventDefault();
    setPaintOn(overpaintMode() ? 'tiles' : 'overpaint');
    return;
  }
  const toolButton = TOOL_KEYS[e.key.toLowerCase()];
  if (toolButton && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
    // A focused menu would also jump to an option starting with that letter.
    e.preventDefault();
    // Clicking the button keeps the rules in one place (Clone needs a reference).
    el(toolButton).click();
    return;
  }
  // Keys that a focused control uses itself stay with it: text undo in a text box, arrows in a
  // text box, dropdown (fps, hold, the Folder picker…) or slider. A colour well or checkbox
  // keeps focus after you use it, and must not swallow Ctrl+Z or the pose keys.
  const t = e.target;
  const textEntry = typing;
  const keysForControl = textEntry || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === 'range');
  if ((e.ctrlKey || e.metaKey) && ((e.key.toLowerCase() === 'z' && e.shiftKey) || (e.key.toLowerCase() === 'y' && !e.shiftKey))) {
    if (textEntry) return;
    e.preventDefault();
    redoStroke();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (textEntry) return;
    e.preventDefault();
    undoStroke();
    return;
  }
  if (keysForControl) return;
  if (!poseViews.length) return;
  if (e.key === 'ArrowRight') {
    stopPlayback();
    setPoseIndex(poseIndex + 1);
  } else if (e.key === 'ArrowLeft') {
    stopPlayback();
    setPoseIndex(poseIndex - 1);
  } else if (e.key === ' ' && poseViews.length > 1) {
    e.preventDefault();
    togglePlayback();
  } else if (e.key === 'Delete') {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const view = poseViews[poseIndex];
    if (view) deletePose(storedPose(view.pose).poseId);
  } else if (e.key === 'F2') {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const view = poseViews[poseIndex];
    if (!view) return;
    e.preventDefault();
    renamePose(storedPose(view.pose).poseId);
  }
});
