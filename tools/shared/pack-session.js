/**
 * Shared, UI-free view of a loaded `.vbpack`: frames, groups, paint data, and a
 * frame renderer. The Project tool (tools/painter.js) keeps its own module-level
 * state; SpriteStudio builds on this instead of a second copy of that monolith.
 */
import { ReadOnGetMap, RecentMap } from '../../src/lazy-entries.js';

/** Decoded frames SpriteStudio keeps (each is a few MB of draws and tables). */
const STATE_CACHE_FRAMES = 100;
import { parseArtPack, artPackPartsFromParsed, buildArtPack, PACK_ENTRIES } from '../../src/art-pack.js';
import { buildVBColorPack } from '../../src/vbcolor-pack.js';
import { deserializeVIPState } from '../../src/vip-dump.js';
import { getTileBytes, hashTile, isBlankTile, tileLocalFromVip } from '../../src/vip-state.js';
import { stereoTwins } from '../../src/stereo-twin.js';
import { tileToRgba } from '../../src/vb-2bpp.js';
import { clusterTilePositions, pickCluster } from '../../src/tile-clusters.js';
import { placePoseTile, poseOrientations } from '../../src/pose-mirror.js';
import { DEFAULT_FADE_RESPONSE, getCompositePixelInfo } from '../../src/color-layer.js';
import { overlayBrightness, overlayGroupsOnScreen } from '../../src/painter-v2-vip-overlay.js';
import { decodeGroupTileColors, groupWithEncodedTileColors } from '../../src/group-tile-colors.js';
import { activeTouchUps, paintTouchUp } from '../../src/touch-up.js';
import { layerArtOf, layerArtPixels, activeLayerArts, paintLayerArt } from '../../src/layer-art.js';
import { paintOverpaintOnCells } from '../../src/overpaint.js';
import { wholePoseHashes, wholePoseOn } from '../../src/overpaint-switch.js';
import { posePictureGroups } from '../../src/pose-overpaint.js';
import { recoveryFolderFrom } from '../../src/recovery.js';
import { affinePixelMap, affineStandInDraws, affineWorlds } from '../../src/affine-world.js';
import { affineBaseDraws, affineBaseState } from '../../src/affine-base.js';
import { getWindowsTableBytesFromState } from '../../src/vip-world-clip.js';
import { brightnessReference, masterBrightnessLevels } from '../../src/fade.js';
import { summarizeFrameForPack, savedSummaryFor, toPatternSummary, brightnessLevelsFor, frameSummariesJson, parseFrameSummaries } from '../../src/frame-summary.js';
import { findFrameWram, frameStem } from '../../src/frame-wram.js';
import { setProjectGameStates } from '../../src/game-states.js';
import { isStarterColour, STARTER_SHADES, convertOldStarterShades } from '../../src/starter-paint.js';
import {
  getEffectivePoses,
  isObjGroup,
  requiredGroupsSchemaVersion,
} from '../../src/obj-sprite-profiles.js';
import { projectFromParsed, renderProjectFrame, withoutStrayTransparentPaint } from '../../src/project.js';
import { frameRowFrom,
  vipMatchKey,
  findFrameRegistryEntry,
  formatPaintToolFrameLabelFromRegistry,
  normalizeVipJsonForFrameField,
} from '../painter/frame-registry.js';

export const FRAME_W = 384;
export const FRAME_H = 224;

/** @param {string} b64 */
function base64ToUint8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Per-group, per-eye full-frame RGBA authoring layers saved by the Project tool
 * as `painter-v2-vip-overlays.json`.
 * @param {string} jsonStr
 * @returns {Map<string, Map<number, Uint8Array>>}
 */
function parseVipOverlays(jsonStr) {
  /** @type {Map<string, Map<number, Uint8Array>>} */
  const byGroup = new Map();
  if (!jsonStr || typeof jsonStr !== 'string') return byGroup;
  let doc;
  try {
    doc = JSON.parse(jsonStr);
  } catch {
    return byGroup;
  }
  if (!doc || doc.schemaVersion !== 1 || doc.width !== FRAME_W || doc.height !== FRAME_H) return byGroup;
  if (!Array.isArray(doc.entries)) return byGroup;
  for (const e of doc.entries) {
    const groupId = typeof e?.groupId === 'string' ? e.groupId.trim() : '';
    const b64 = typeof e?.rgbaBase64 === 'string' ? e.rgbaBase64 : '';
    if (!groupId || !b64) continue;
    let rgba;
    try {
      rgba = base64ToUint8(b64);
    } catch {
      continue;
    }
    if (rgba.length !== FRAME_W * FRAME_H * 4) continue;
    let byEye = byGroup.get(groupId);
    if (!byEye) byGroup.set(groupId, (byEye = new Map()));
    byEye.set(e?.eye === 1 ? 1 : 0, rgba);
  }
  return byGroup;
}

/**
 * The frames a session can show: every saved frame, then the Current (Colorize!) frame. A pose
 * captured on Current may be drawn nowhere else, so leaving it out left that pose blank. It goes
 * last so saved-frame indices do not move, and is skipped when a saved frame is the same snapshot.
 * @param {{ vipState?: unknown, vipStatesFolder?: Array<{ name: string, json: unknown }> }} parsed
 * @param {any[]|null} registry
 * @returns {Array<{ label: string, vipFile: string, json: string, registryEntry: any }>}
 */
export function sessionFramesFromParsed(parsed, registry) {
  const frames = [];
  for (const item of parsed.vipStatesFolder || []) {
    const name = item.name;
    const ent = findFrameRegistryEntry(registry, name);
    // Lazily read frames stay compressed until shown (src/lazy-entries.js).
    const row = frameRowFrom({ label: formatPaintToolFrameLabelFromRegistry(ent, name), vipFile: name, registryEntry: ent }, item);
    if (row) frames.push(row);
  }
  const current = parsed.vipState != null ? normalizeVipJsonForFrameField(parsed.vipState) : null;
  // Sizes first: comparing every frame's text would read every frame.
  if (current && !frames.some((f) => f.jsonSize === current.length && f.json === current)) {
    frames.push({ label: 'Current (Colorize!)', vipFile: PACK_ENTRIES.VIPSTATE_CURRENT, json: current, registryEntry: null });
  }
  return frames;
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} label
 */
export async function loadPackSession(buffer, label = 'pack.vbpack') {
  const raw = await parseArtPack(buffer);
  // The colour project, read the way every app reads it (src/project.js); frames without a short
  // number get one (src/frame-numbers.js), kept when the pack is saved.
  const project = projectFromParsed(raw, { label });
  const parsed = project.manifest === raw.manifest ? raw : { ...raw, manifest: project.manifest };
  const frames = sessionFramesFromParsed(parsed, project.frameRegistry);

  const session = {
    ...project,
    parsed,
    frames,
    vipOverlays: parseVipOverlays(typeof parsed.painterV2VipOverlays === 'string' ? parsed.painterV2VipOverlays : ''),
    /** @type {Map<string, any>} deserialized VIP states, by vipFile */
    // Decoded frames kept for the frames being worked on, not every frame ever shown.
    _stateCache: new RecentMap(STATE_CACHE_FRAMES),
    /** Frame index → summarizeFrame(), for skipping frames that cannot show a group. */
    _summaries: new Map(),
    /** Frame summaries saved in the pack (src/frame-summary.js), by frame file; null for an older pack. */
    _savedSummaries: parseFrameSummaries(parsed.frameSummaries),
    /** Summaries worked out this session, by frame file, saved with the pack. */
    _freshSummaries: new Map(),
    /** @type {null | { pixels: number, tiles: number, unknown: number }} stray paint cleared on open */
    strayTransparentCleared: null,
  };
  // Frames with a saved summary are known without decoding them.
  session.frames.forEach((f, i) => {
    const s = savedSummaryFor(session._savedSummaries, f.vipFile, frameTextLength(f));
    if (s) session._summaries.set(i, toPatternSummary(s));
  });
  clearStrayTransparentPaint(session);
  // Starter shades from before Oct 9 2026 move to the new ones, which no one picks by accident.
  const starters = convertOldStarterShades(session.pack, session.groups, decodeGroupTileColors);
  session.pack = starters.pack;
  session.groups = starters.groups;
  setProjectGameStates(session.gameStates);
  return session;
}

/**
 * A pack saved before paint on transparent pixels was drawn (src/transparent-paint.js) may hold
 * stray strokes there that never showed: clear them once, so nothing changes on screen, and flag
 * the pack so SpriteStudio's Save writes that its transparent-pixel paint is intentional.
 */
function clearStrayTransparentPaint(session) {
  const r = withoutStrayTransparentPaint(session, session.frames.length, (i) => frameState(session, i));
  if (!r.cleared) return;
  session.pack = r.pack;
  session.groups = r.groups;
  session.manifest = r.manifest;
  session.parsed = { ...session.parsed, manifest: r.manifest };
  session.paintsTransparent = true;
  session.strayTransparentCleared = r.cleared;
}

/** @param {any} session @param {number} frameIndex */
export function frameState(session, frameIndex) {
  const row = session.frames[frameIndex];
  // Past the captured frames: a stand-in frame (base tiles), see addStandInFrame.
  if (!row) return session.standInFrames?.get(frameIndex)?.state ?? null;
  let state = session._stateCache.get(row.vipFile);
  if (!state) {
    try {
      state = deserializeVIPState(JSON.parse(row.json));
    } catch {
      return null;
    }
    // Fades are measured against the game's normal brightness (src/fade.js), so a game that
    // always runs dim still shows painted white as white.
    if (session.brightnessReference === undefined) {
      // Saved summaries carry each frame's level, so only frames without one are read.
      session.brightnessReference = brightnessReference(brightnessLevelsFor(session.frames, session._savedSummaries, masterBrightnessLevels));
    }
    state.brightnessReference = session.brightnessReference;
    session._stateCache.set(row.vipFile, state);
    if (!session._summaries.has(frameIndex)) session._summaries.set(frameIndex, summarizeFrame(state));
  }
  return state;
}

/**
 * What a frame shows, in brief: every pattern its draw list draws (either eye, any layer), and —
 * when `withStandIns` — the patterns its scaled (affine) layers show that the draw list never
 * records (src/affine-world.js stand-ins; sampling them costs ~30 ms a frame, so only the background
 * pass does it). Small enough to keep for every frame, so a pass over all frames ("where is this
 * group?") decodes only the frames that can show it.
 * @param {any} state @param {boolean} [withStandIns]
 * @returns {{ hashes: Set<number>, affine: boolean, standIns: Set<number> | null }}
 */
function summarizeFrame(state, withStandIns = false) {
  const hashes = new Set();
  const hashOf = hasherFor(state);
  for (const d of state.drawList || []) hashes.add(hashOf(d.tileIndex));
  let affine = false;
  let standIns = null;
  try {
    affine = affineWorlds(state, 0).length > 0 || affineWorlds(state, 1).length > 0;
    if (affine && withStandIns) standIns = new Set(drawsWithAffineStandIns(state).filter((d) => d.standIn).map((d) => hashOf(d.tileIndex)));
  } catch {
    affine = true;
    standIns = null;
  }
  return { hashes, affine, standIns: affine ? standIns : new Set() };
}

/**
 * Could frame `i` show any of these patterns? True when it might — no summary yet, no patterns to
 * look for, or (with `standIns`) a scaled layer whose unrecorded tiles are not summarised yet — so
 * a caller only ever skips frames that certainly cannot.
 * @param {any} session @param {number} i @param {Set<number> | null | undefined} hashes
 * @param {{ standIns?: boolean }} [opts] `standIns`: the caller also matches the tiles scaled layers
 *   show without a draw record (drawsWithAffineStandIns)
 */
export function mayShowPatterns(session, i, hashes, { standIns = false } = {}) {
  if (!hashes || !hashes.size) return true;
  const s = session._summaries?.get(i);
  if (!s) return true;
  for (const h of hashes) if (s.hashes.has(h)) return true;
  if (!standIns || !s.affine) return false;
  if (!s.standIns) return true;
  for (const h of hashes) if (s.standIns.has(h)) return true;
  return false;
}

/**
 * Summarise every frame not yet summarised, a few at a time so the page stays responsive. Frames
 * decoded here are not kept (the state cache holds the frames being worked on).
 * @param {any} session
 * @returns {Promise<number>} frames summarised
 */
export function buildFrameSummaries(session, sliceMs = 8) {
  return new Promise((resolve) => {
    let i = 0;
    let done = 0;
    const step = () => {
      const until = performance.now() + sliceMs;
      while (i < session.frames.length && performance.now() < until) {
        const at = i++;
        const had = session._summaries.get(at);
        if (had && (!had.affine || had.standIns)) continue;
        try {
          // A frame being worked on is in the state cache already; others are decoded and let go.
          const cached = session._stateCache.has(session.frames[at].vipFile);
          const state = cached ? frameState(session, at) : deserializeVIPState(JSON.parse(session.frames[at].json));
          const packed = summarizeFrameForPack(state, frameTextLength(session.frames[at]));
          session._freshSummaries.set(session.frames[at].vipFile, packed);
          session._summaries.set(at, toPatternSummary(packed));
          done++;
        } catch {
          /* an unreadable frame is looked at in full when asked about */
        }
      }
      if (i < session.frames.length) setTimeout(step, 0);
      else resolve(done);
    };
    setTimeout(step, 0);
  });
}

/**
 * A frame that is not in the pack — the unscaled base tiles of a scaled layer — given an index
 * past the captured frames, so every view, render and paint path can use it like a captured one.
 * Loops over `session.frames` never see it and it is never saved. The same key gets the same index.
 * @param {any} session @param {string} key @param {string} label @param {any} state
 * @returns {number}
 */
export function addStandInFrame(session, key, label, state) {
  if (!session.standInFrames) session.standInFrames = new Map();
  if (!session.standInKeys) session.standInKeys = new Map();
  let index = session.standInKeys.get(key);
  if (index === undefined) {
    index = session.frames.length + session.standInKeys.size;
    session.standInKeys.set(key, index);
  }
  session.standInFrames.set(index, { label, state });
  return index;
}

/**
 * The game memory captured with a frame (its RAM dump, else its save state; the Current frame
 * reads the pack's own save state), for groups limited to some screens (src/screen-gate.js).
 * @returns {Uint8Array|null} null for stand-in frames and frames without memory
 */
export function frameWram(session, frameIndex) {
  const row = session.frames[frameIndex];
  if (!row) return null;
  session._wramCache ||= new Map();
  if (session._wramCache.has(frameIndex)) return session._wramCache.get(frameIndex);
  // Entries are read only for the frames asked about (src/lazy-entries.js).
  const byStem = (folder) => {
    const m = new ReadOnGetMap((f) => (f?.buffer ? new Uint8Array(f.buffer) : null));
    for (const f of Array.isArray(folder) ? folder : []) {
      if (f?.name && (f.size ?? f.buffer?.byteLength)) m.set(frameStem(f.name), f);
    }
    return m;
  };
  session._ramDumpsByStem ||= byStem(session.parsed?.ramdumpsFolder);
  session._saveStatesByStem ||= byStem(session.parsed?.saveStatesFolder);
  const ent = row.registryEntry;
  const root = session.parsed?.saveState;
  let wram = null;
  try {
    wram = findFrameWram({
      names: [ent?.ramdumpFile, ent?.saveStateFile, row.vipFile, ent?.frameId].filter((n) => n != null && String(n).trim()).map(String),
      isCurrent: row.vipFile === PACK_ENTRIES.VIPSTATE_CURRENT,
      ramDumpsByStem: session._ramDumpsByStem,
      saveStatesByStem: session._saveStatesByStem,
      rootSaveState: root && root.byteLength ? new Uint8Array(root) : null,
    })?.wram ?? null;
  } catch (err) {
    console.warn('[SpriteStudio] Could not read the memory captured with frame', row.vipFile, err);
  }
  session._wramCache.set(frameIndex, wram);
  return wram;
}

/** A frame's label, captured or stand-in. */
export function frameLabel(session, frameIndex) {
  return session.frames[frameIndex]?.label ?? session.standInFrames?.get(frameIndex)?.label ?? '';
}

/** @param {any} session @param {string} vipFile */
export function frameIndexForVipFile(session, vipFile) {
  const key = vipMatchKey(vipFile || '');
  if (!key) return -1;
  return session.frames.findIndex((f) => vipMatchKey(f.vipFile) === key);
}

/** Poses record `sourceFrameId` from the frame registry, not a VIP file name. */
export function frameIndexForFrameId(session, frameId) {
  const want = String(frameId || '').trim().toLowerCase();
  if (!want) return -1;
  const byId = session.frames.findIndex((f) => String(f.registryEntry?.frameId || '').trim().toLowerCase() === want);
  return byId >= 0 ? byId : frameIndexForVipFile(session, want);
}

/** OBJ groups first — SpriteStudio is sprite-first, but every group is reachable. */
export function spriteGroups(session) {
  return {
    objs: session.groups.filter((g) => isObjGroup(g)),
    rest: session.groups.filter((g) => !isObjGroup(g)),
  };
}

/** @param {any} group */
export function posesOf(group) {
  return getEffectivePoses(group) || [];
}

/**
 * Composite one frame into `imageData`, then blend the saved authoring overlays.
 * @param {{
 *   session: any,
 *   state: any,
 *   imageData: ImageData,
 *   eye?: number,
 *   brightness?: number,
 *   monoFallback?: boolean,
 *   renderUnpackedFallback?: boolean,
 *   wram?: Uint8Array|null,
 * }} opts `wram`: the frame's memory, so groups limited to other screens are left out (frameWram)
 */
export function renderFrame(opts) {
  const {
    session,
    state,
    imageData,
    eye = 0,
    brightness = 1,
    monoFallback = false,
    renderUnpackedFallback = true,
    overlayGroupIds = null,
    touchUps = true,
    wram = null,
  } = opts;
  // The tools' preview (src/project.js): the frame's memory picks its screens and game states.
  renderProjectFrame(session, state, imageData, 'toolPreview', {
    eye,
    wram,
    groups: touchUps ? session.groups : withoutTouchUps(session.groups),
    diagnosticMonoFallback: monoFallback,
    renderUnpackedFallback,
    monoFallbackGain: brightness,
  });
  blendOverlays(session, imageData, eye, overlayGroupIds, null, state);
  return imageData;
}

/**
 * The groups with their overpaint (and any old touch-up) left out, for "Show overpaint" off. A
 * picture that hides the layer's tiles stays: without it the layer would show tiles it replaces.
 */
function withoutTouchUps(groups) {
  // The same array back while nothing it copied has changed: a new array per composite made the
  // compositor rebuild its paint index for every thumbnail. A group can change in place (its paint
  // turned live for painting), so each copy is checked against the group's fields it was made from.
  const cached = _withoutTouchUpsCache.get(groups);
  if (cached && cached.from.every((f, i) => f.group === groups[i] && f.tileColors === groups[i]?.tileColors && f.overpaint === groups[i]?.overpaint && f.touchUp === groups[i]?.touchUp)) {
    return cached.out;
  }
  const out = groups.map((g) => {
    const overpaint = g?.overpaint && !g.overpaint.hideTiles;
    if (!g?.touchUp && !overpaint) return g;
    const { touchUp: _hidden, ...rest } = g;
    if (overpaint) delete rest.overpaint;
    return rest;
  });
  _withoutTouchUpsCache.set(groups, { out, from: groups.map((g) => ({ group: g, tileColors: g?.tileColors, overpaint: g?.overpaint, touchUp: g?.touchUp })) });
  return out;
}
const _withoutTouchUpsCache = new WeakMap();

/**
 * @param {any} session @param {ImageData} imageData @param {number} eye
 * @param {string[]|null} [onlyGroupIds] when set, blend just these groups' layers
 * @param {Uint8Array|null} [mask] length FRAME_W*FRAME_H; when set, only pixels with mask≠0 are blended
 * @param {any} [state] the frame being rendered, so overlay paint fades with it like painted tiles do
 */
export function blendOverlays(session, imageData, eye, onlyGroupIds = null, mask = null, state = null) {
  const d = imageData.data;
  const k = state ? overlayBrightness(state, DEFAULT_FADE_RESPONSE) : 1;
  // An overlay is paint for one screen. With a frame to go by, draw only the overlays whose
  // group's anchor is on it — the emulator's rule. Without this every overlay landed on every
  // frame (Safety and Splash text over Level 1), and new layer art copied them in.
  const onScreen = state
    ? overlayGroupsOnScreen(state, eye, session.groups.filter((g) => session.vipOverlays.has(g.id)))
    : null;
  for (const [groupId, byEye] of session.vipOverlays) {
    if (onlyGroupIds && !onlyGroupIds.includes(groupId)) continue;
    if (onScreen && !onScreen.has(groupId)) continue;
    const o = byEye.get(eye & 1);
    if (!o) continue;
    // Deliberately *not* depth-masked. SpriteStudio's stage is an isolation view: it shows a
    // group's background context even when other worlds cover it, so you can see the sprite
    // against what it belongs to. The emulator and the Project tool preview do mask, because
    // they are showing the frame as the game draws it.
    for (let i = 0, n = FRAME_W * FRAME_H * 4; i < n; i += 4) {
      if (o[i + 3] === 0) continue;
      if (mask && !mask[i >> 2]) continue;
      d[i] = k === 1 ? o[i] : (o[i] * k) | 0;
      d[i + 1] = k === 1 ? o[i + 1] : (o[i + 1] * k) | 0;
      d[i + 2] = k === 1 ? o[i + 2] : (o[i + 2] * k) | 0;
      d[i + 3] = o[i + 3];
    }
  }
}

/**
 * For an affine (scaled) group pose: is this screen pixel one of the group's tiles, and which
 * texel does the VIP read there? Worlds are tried front to back (lower number in front).
 * @returns {null | { world: number, char: number, hash: number, tileBytes: Uint8Array, lx: number, ly: number, lit: boolean }}
 */
function affinePoseHit(state, eye, pose, x, y, hashOfChar) {
  if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return null;
  const map = affinePixelMap(state, eye);
  const { want, worlds } = affinePoseHashes(pose);
  const p = y * FRAME_W + x;
  for (const w of worlds) {
    const px = map.get(w);
    const ch = px ? px.char[p] : -1;
    if (ch < 0) continue;
    const hash = hashOfChar(ch);
    if (!want.has(hash)) continue;
    return { world: w, char: ch, hash, tileBytes: getTileBytes(state.patternTable, ch), lx: px.tx[p], ly: px.ty[p], lit: !!px.lit[p] };
  }
  return null;
}

const _affinePoseHashes = new WeakMap();
/** A pose's tile hashes and its affine worlds front to back, worked out once per pose. */
function affinePoseHashes(pose) {
  let v = _affinePoseHashes.get(pose);
  if (!v) {
    const hashes = Array.isArray(pose.affineHashes) ? pose.affineHashes : (pose.tiles || []).map((t) => t.hash);
    v = { want: new Set(hashes.map((h) => h >>> 0)), worlds: [...(pose.affineWorlds || [])].sort((a, b) => a - b) };
    _affinePoseHashes.set(pose, v);
  }
  return v;
}

/**
 * The screen pixels an affine group's tiles light: their bounds relative to `anchor`, and which of
 * the group's patterns actually show.
 */
function affineFootprint(state, eye, worlds, hashes, anchor) {
  const map = affinePixelMap(state, eye);
  const hashOf = hasherFor(state);
  const lit = new Set();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of worlds) {
    const px = map.get(w);
    if (!px) continue;
    for (let p = 0; p < px.char.length; p++) {
      const ch = px.char[p];
      if (ch < 0 || !px.lit[p]) continue;
      const hash = hashOf(ch);
      if (!hashes.has(hash)) continue;
      lit.add(hash);
      const x = p % FRAME_W, y = (p / FRAME_W) | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  const bounds = Number.isFinite(x0) ? { x0: x0 - anchor.x, y0: y0 - anchor.y, x1: x1 - anchor.x, y1: y1 - anchor.y } : null;
  return { bounds, lit };
}

/** A BG group's criteria in the form the per-frame search wants, or null if it has no patterns. */
function bgGroupCriteria(group) {
  const c = group?.criteria || {};
  const hashes = new Set((Array.isArray(c.hashes) ? c.hashes : []).map((h) => Number(h) >>> 0));
  if (hashes.size === 0) return null;
  const worldList = Array.isArray(c.windowIds) ? c.windowIds : Array.isArray(c.worldIds) ? c.worldIds : [];
  return {
    hashes,
    worlds: new Set(worldList.map(Number)),
    layers: new Set((Array.isArray(c.layers) ? c.layers : []).map(Number)),
    anchorHash: typeof group.anchorHash === 'number' ? group.anchorHash >>> 0 : null,
  };
}

/**
 * Where a BG group sits on one frame, as an in-memory pose: the connected cluster of matching
 * draws (the one holding the anchor, else the largest). `score` ranks frames: one showing the
 * anchor is the group's own screen, otherwise the fullest wins. `patterns` are the group's
 * patterns this view shows, which is what tells two frames' views apart.
 * @returns {null | { score: number, view: { pose: any, frameIndex: number, origin: {x: number, y: number}, matched: number, total: number }, patterns: Set<number> }}
 */
/** state → its draws plus affine stand-ins (src/affine-world.js), worked out once per frame. */
const _drawsWithStandIns = new WeakMap();
function drawsWithAffineStandIns(state) {
  let draws = _drawsWithStandIns.get(state);
  if (!draws) {
    const standIns = affineStandInDraws(state);
    draws = standIns.length ? state.drawList.concat(standIns) : state.drawList;
    _drawsWithStandIns.set(state, draws);
  }
  return draws;
}

function bgViewOnFrame(session, group, crit, i, eye) {
  const state = frameState(session, i);
  if (!state?.drawList?.length || !state.patternTable) return null;
  const { hashes, worlds, layers, anchorHash } = crit;
  const hashOf = hasherFor(state);
  // A background group covers its worlds when the game scales them too (affine, layer 1).
  const layerOk = (d) => !layers.size || layers.has(Number(d.layer)) || (Number(d.layer) === 1 && layers.has(0));
  const affine = affinePixelMap(state, eye);
  const win = getWindowsTableBytesFromState(state);
  // Right eye: a right-only twin of one of the group's left-only worlds draws the group's layer
  // from its own copy of the tiles, mostly other patterns (src/stereo-twin.js). On a frame where
  // the group is on that left world, the twin's tiles count as the group's.
  const twinWorlds = new Set();
  if (eye === 1 && worlds.size && win) {
    for (const [right, twin] of stereoTwins(win)) {
      if (!worlds.has(twin.left)) continue;
      const onLeft = state.drawList.some((d) => (d.eye ?? 0) === 0 && Number(d.world) === twin.left && layerOk(d) && hashes.has(hashOf(d.tileIndex)));
      if (onLeft) twinWorlds.add(right);
    }
  }
  const blank = new Map();
  const isBlank = (tileIndex) => {
    if (!blank.has(tileIndex)) blank.set(tileIndex, isBlankTile(getTileBytes(state.patternTable, tileIndex)));
    return blank.get(tileIndex);
  };
  // Scaled tiles the core never recorded (shrunk, or on rotated lines) count too, as in the
  // Project tool: without them a frame showing the group only that way has no card of its own.
  const matches = drawsWithAffineStandIns(state).filter(
    (d) =>
      (d.eye ?? 0) === eye &&
      layerOk(d) &&
      (twinWorlds.has(Number(d.world))
        ? !isBlank(d.tileIndex)
        : (!worlds.size || worlds.has(Number(d.world))) && hashes.has(hashOf(d.tileIndex))),
  );
  if (!matches.length) return null;
  const members = twinWorlds.size
    ? new Set([...hashes, ...matches.filter((d) => twinWorlds.has(Number(d.world))).map((d) => hashOf(d.tileIndex))])
    : hashes;
  // On a scaled (affine) layer the records are stand-ins scattered wherever a tile's corner is
  // read: the group is the layer's picture, drawn through the VIP's sampling, not a cluster.
  const affineWorlds = [...new Set(matches.filter((d) => Number(d.layer) === 1 && affine.has(d.world)).map((d) => d.world))];
  const anchorAt = anchorHash === null ? -1 : matches.findIndex((d) => hashOf(d.tileIndex) === anchorHash);
  const cluster = affineWorlds.length ? null : pickCluster(clusterTilePositions(matches), anchorAt);
  const draws = cluster ? cluster.indices.map((j) => matches[j]) : matches;
  const hasAnchor = anchorAt >= 0 && draws.includes(matches[anchorAt]);
  const anchor = hasAnchor ? matches[anchorAt] : draws[0];
  const tiles = draws.map((d) => ({ hash: hashOf(d.tileIndex), dx: d.x - anchor.x, dy: d.y - anchor.y }));
  const footprint = affineWorlds.length ? affineFootprint(state, eye, affineWorlds, members, anchor) : null;
  // Where the anchor's world is scrolled to: frames showing the same tiles at another scroll are
  // different cards for a group whose picture is placed in the layer (layer art, touch-up).
  const wb = Number(anchor.world) * 32;
  const scroll = win && win.length >= 1024 ? `${anchor.world}:${win[wb + 8] | (win[wb + 9] << 8)},${win[wb + 12] | (win[wb + 13] << 8)}` : '';
  return {
    score: (hasAnchor ? 1e6 : 0) + draws.length,
    scroll,
    // Every pattern of the group on the frame, not just the cluster's: a whole-pose group's card
    // needs the whole pose there (wholePoseOn).
    onFrame: new Set(matches.map((d) => hashOf(d.tileIndex))),
    patterns: footprint ? footprint.lit : new Set(tiles.map((t) => t.hash)),
    view: {
      frameIndex: i,
      origin: { x: anchor.x, y: anchor.y },
      matched: draws.length,
      total: draws.length,
      patterns: footprint ? [...footprint.lit] : [...new Set(tiles.map((t) => t.hash))],
      pose: {
        poseId: '__bg__',
        name: group.name || group.id,
        anchorHash: hashOf(anchor.tileIndex),
        tiles,
        ...(footprint && {
          affineWorlds,
          // The group's own pattern list decides membership on a scaled layer: tiles the core
          // never recorded on this frame (a thin line that skips its top row) still belong.
          affineHashes: [...members],
          affineBounds: footprint.bounds,
        }),
      },
    },
  };
}

/**
 * A BG group that kept no poses has nothing for a pose view to draw. Build the
 * equivalent from the group's criteria on the frame where it sits (see {@link bgViewOnFrame}).
 * It is never saved.
 * @param {any} session @param {any} group @param {number} [eye]
 * @returns {{ pose: any, frameIndex: number, origin: {x: number, y: number}, matched: number, total: number } | null}
 */
export function bgGroupView(session, group, eye = 0) {
  const crit = bgGroupCriteria(group);
  if (!crit) return null;
  let best = null;
  for (let i = 0; i < session.frames.length; i++) {
    const hit = bgViewOnFrame(session, group, crit, i, eye);
    if (hit && (!best || hit.score > best.score)) best = hit;
  }
  return best ? best.view : null;
}

/**
 * One view per captured frame that shows something new of a BG group: a frame whose visible
 * patterns all appear in a fuller frame's view is left out, so a static screen gives one card and
 * a character animated through distinct tiles gives one per drawing. The group's own screen (see
 * {@link bgGroupView}) comes first, the rest in frame order. Views are never saved; each is named
 * after its frame and has its own `poseId` (`__frame:<index>`).
 * @param {any} session @param {any} group @param {number} [eye]
 * @returns {Array<{ pose: any, frameIndex: number, origin: {x: number, y: number}, matched: number, total: number }>}
 */
export function bgGroupViews(session, group, eye = 0) {
  let hits = bgGroupFrameHits(session, group, eye);
  // A pose's group (Overpaint just this pose) shows only the frames its whole pose is on, where its
  // picture shows: a frame with a few of its tiles (another pose sharing them) is not this pose.
  if (wholePoseHashes(group)) {
    const whole = hits.filter((h) => wholePoseOn(group, h.onFrame));
    if (whole.length) hits = whole;
  }
  if (!hits.length) return [];
  const best = hits.reduce((a, b) => (b.score > a.score ? b : a));
  const covers = (big, small) => small.size <= big.size && [...small].every((h) => big.has(h));
  // A picture placed in the layer looks different at each scroll, so each scroll gets a card.
  const byScroll = !!(group.overpaint || group.layerArt || group.touchUp || group.poseOverpaints?.length);
  const kept = [best];
  for (const hit of [...hits].sort((a, b) => b.patterns.size - a.patterns.size)) {
    if (hit === best || kept.some((k) => (!byScroll || k.scroll === hit.scroll) && covers(k.patterns, hit.patterns))) continue;
    kept.push(hit);
  }
  const rest = kept.slice(1).sort((a, b) => a.view.frameIndex - b.view.frameIndex);
  return [best, ...rest].map(({ view }) => {
    const label = session.frames[view.frameIndex]?.label || `Frame ${view.frameIndex + 1}`;
    return { ...view, pose: { ...view.pose, poseId: `__frame:${view.frameIndex}`, name: label } };
  });
}

/**
 * A BG group on every captured frame that shows it: one hit per frame (its view, the patterns it
 * shows there, its scroll), before bgGroupViews keeps only frames that show something new.
 * @param {any} session @param {any} group @param {number} [eye]
 * @param {{ only?: (frameIndex: number) => boolean }} [opts] `only`: look at just the frames it allows
 *   (checked before a frame is decoded)
 * @returns {Array<{ score: number, scroll: string, onFrame: Set<number>, patterns: Set<number>, view: any }>}
 */
export function bgGroupFrameHits(session, group, eye = 0, { only = null } = {}) {
  const crit = bgGroupCriteria(group);
  if (!crit) return [];
  const hits = [];
  for (let i = 0; i < session.frames.length; i++) {
    if (only && !only(i)) continue;
    // Frames that cannot show any of its patterns are not decoded (src/lazy-entries.js keeps them compressed).
    if (!mayShowPatterns(session, i, crit.hashes, { standIns: true })) continue;
    const hit = bgViewOnFrame(session, group, crit, i, eye);
    if (hit && hit.patterns.size) hits.push(hit);
  }
  return hits;
}

/**
 * The view for an affine group's kept pose: the group drawn on the pose's own frame, else on the
 * frame that shows the most of the pose's patterns.
 * @param {any} session @param {any} group @param {any} pose @param {number} [eye]
 */
export function affinePoseView(session, group, pose, eye = 0) {
  const crit = bgGroupCriteria(group);
  if (!crit || !Array.isArray(pose?.tiles)) return null;
  const want = pose.tiles.map((t) => t.hash >>> 0);
  const own = pose.sourceFrameId ? frameIndexForFrameId(session, pose.sourceFrameId) : -1;
  const order = [...(own >= 0 ? [own] : []), ...session.frames.map((_, i) => i).filter((i) => i !== own)];
  const wanted = new Set(want);
  let best = null;
  for (const i of order) {
    // Once a frame has matched, frames that cannot show any of the pose's patterns cannot beat it
    // (and are not decoded: src/lazy-entries.js keeps them compressed).
    if (best && !mayShowPatterns(session, i, wanted, { standIns: true })) continue;
    const hit = bgViewOnFrame(session, group, crit, i, eye);
    if (!hit?.view.pose.affineWorlds) continue;
    const matched = want.filter((h) => hit.patterns.has(h)).length;
    if (!best || matched > best.matched) best = { view: hit.view, matched };
    if (matched === want.length) break;
  }
  if (!best) return null;
  return { ...best.view, matched: best.matched, total: want.length, pose: { ...best.view.pose, poseId: pose.poseId, name: pose.name } };
}

/**
 * The base tiles behind an affine view: the group's map cells on that view's frame laid out 1:1 in
 * a stand-in frame ({@link addStandInFrame}), as an ordinary background pose. Null when the view is
 * not scaled or its frame shows none of the group's cells.
 * @param {any} session @param {any} view a view from {@link bgGroupViews} or {@link affinePoseView}
 * @param {number} [eye]
 */
export function affineBaseView(session, view, eye = 0) {
  const pose = view?.pose;
  if (!pose?.affineWorlds?.length || view.frameIndex < 0) return null;
  const state = frameState(session, view.frameIndex);
  if (!state) return null;
  const want = new Set((pose.affineHashes || pose.tiles.map((t) => t.hash)).map((h) => h >>> 0));
  const draws = affineBaseDraws(state, eye, pose.affineWorlds, want).filter((d) => d.eye === (eye ? 1 : 0));
  if (!draws.length) return null;
  const label = `${frameLabel(session, view.frameIndex)} · base tiles`;
  const index = addStandInFrame(session, `base|${pose.affineWorlds.join(',')}|${view.frameIndex}|${eye ? 1 : 0}`, label, affineBaseState(state, draws));
  const hashOf = hasherFor(state);
  const anchor = draws[0];
  const tiles = draws.map((d) => ({ hash: hashOf(d.tileIndex), dx: d.x - anchor.x, dy: d.y - anchor.y }));
  return {
    pose: { poseId: `__base:${pose.poseId}`, name: `${pose.name} · base tiles`, anchorHash: tiles[0].hash, tiles },
    frameIndex: index,
    origin: { x: anchor.x, y: anchor.y },
    matched: tiles.length,
    total: tiles.length,
    base: { sourceFrameIndex: view.frameIndex, worlds: [...pose.affineWorlds] },
  };
}

/** Ramp for a freshly painted tile: the VB's four shades as SpriteStudio's starter greys (src/starter-paint.js), palette 0 clear. */
const DEFAULT_PAINT_RAMP = [[0, 0, 0, 0], ...STARTER_SHADES[0].slice(1).map((c) => [...c, 255])];

/**
 * The VB shade (0–3) the game shows each pixel value of this pattern in on this frame: the first
 * background draw of it decides the palette (GPLT). Sprites and frames without palettes show
 * values as they are. Paint starts from these shades, so a tile you start painting keeps looking
 * like the unpainted preview, which draws the same shades.
 * @param {any} state @param {number} hash
 * @returns {number[]} shade per pixel value 0–3
 */
export function patternShades(state, hash) {
  const identity = [0, 1, 2, 3];
  const gplt = state?.gplt;
  if (!Array.isArray(gplt) || !state.drawList || !state.patternTable) return identity;
  const hashOf = hasherFor(state);
  const d = state.drawList.find((x) => Number(x.layer) !== 2 && hashOf(x.tileIndex) === hash >>> 0);
  if (!d) return identity;
  const word = Number(gplt[(d.paletteSelector ?? 0) & 3]);
  return identity.map((v) => (word >> (v * 2)) & 3);
}

/** A tile's starting paint per pixel value, from the shades the game shows them in. */
function starterRamp(shades) {
  if (!shades) return DEFAULT_PAINT_RAMP;
  return [0, 1, 2, 3].map((v) => (v === 0 ? DEFAULT_PAINT_RAMP[0] : shades[v] === 0 ? [0, 0, 0, 255] : DEFAULT_PAINT_RAMP[shades[v]]));
}

/**
 * The pose tile under a VIP pixel, with flip-aware coordinates inside it.
 * Paint is stored per tile *pattern*, so this is what lets one stroke reach every
 * pose that reuses the tile.
 * @param {any} state @param {any} pose @param {{x: number, y: number}} origin
 * @param {number} vx @param {number} vy @param {number} [eye]
 * @returns {{ hash: number, tileBytes: Uint8Array, lx: number, ly: number, draw: any } | null}
 */
export function poseTileAtVip(state, pose, origin, vx, vy, eye = 0) {
  return poseTileLookup(state, pose, origin, eye)(vx, vy);
}

/**
 * {@link poseTileAtVip} for many pixels: the pose's draws are found once, not per pixel, which
 * is what makes a flood fill over a large region affordable.
 * @param {any} state @param {any} pose @param {{x: number, y: number}} origin @param {number} [eye]
 * @returns {(vx: number, vy: number) => ({ hash: number, tileBytes: Uint8Array, lx: number, ly: number, draw: any } | null)}
 */
export function poseTileLookup(state, pose, origin, eye = 0) {
  if (pose?.affineWorlds?.length && state?.patternTable) {
    // A scaled layer: what the VIP samples at the pixel, not a rigid 8×8 draw.
    const hashOf = hasherFor(state);
    return (vx, vy) => {
      const hit = affinePoseHit(state, eye, pose, vx, vy, hashOf);
      return hit ? { hash: hit.hash, tileBytes: hit.tileBytes, lx: hit.lx, ly: hit.ly, draw: { tileIndex: hit.char, world: hit.world, layer: 1, x: vx, y: vy, eye } } : null;
    };
  }
  const draws = poseDraws(state, pose, origin, eye).map((d) => {
    const tileBytes = getTileBytes(state.patternTable, d.tileIndex);
    return { d, tileBytes, hash: hashTile(tileBytes) >>> 0 };
  });
  return (vx, vy) => {
    /** @type {any} */
    let covering = null;
    // Front-most first: later draws sit on top in the order used elsewhere. A sprite's own
    // tiles overlap — a shadow tile can sit in front of the feet and be empty exactly there —
    // so the tile you can *see* is the front-most one that actually paints this pixel. Falling
    // through to a transparent tile in front would store paint that never renders.
    for (let i = draws.length - 1; i >= 0; i--) {
      const { d, tileBytes, hash } = draws[i];
      if (vx < d.x || vx >= d.x + 8 || vy < d.y || vy >= d.y + 8) continue;
      const local = tileLocalFromVip(d, vx, vy);
      if (!local) continue;
      const hit = { hash, tileBytes, lx: local.lx, ly: local.ly, draw: d };
      if (!covering) covering = hit;
      if (shadeAt(tileBytes, local.lx, local.ly) !== 0) return hit;
    }
    // Nothing lit here: hand back the front-most tile anyway, so painting a hole still works.
    return covering;
  };
}

/** A pattern pixel's 2-bit shade; 0 is transparent in the game. */
export function shadeAt(tileBytes, lx, ly) {
  const row = tileBytes[ly * 2] | (tileBytes[ly * 2 + 1] << 8);
  return (row >> (lx * 2)) & 3;
}

/**
 * Mutable 256-byte RGBA for a tile pattern, seeded from the VB shades so an
 * unpainted tile starts as its monochrome self rather than transparent.
 * @param {any} session @param {number} hash @param {Uint8Array} tileBytes
 * @param {any} [targetGroup] @param {number[]|null} [shades] shade per pixel value ({@link patternShades})
 */
export function packRgbaForHash(session, hash, tileBytes, targetGroup, shades = null) {
  const h = hash >>> 0;
  const own = targetGroup ? liveGroupTileColors(targetGroup) : null;
  if (own) {
    let buf = own.get(h);
    if (!buf || buf.length < 256) {
      buf = tileToRgba(tileBytes, starterRamp(shades));
      own.set(h, buf);
    }
    return buf;
  }
  let buf = session.pack.get(h);
  if (!buf || buf.length < 256) {
    buf = tileToRgba(tileBytes, starterRamp(shades));
    session.pack.set(h, buf);
  }
  return buf;
}

/**
 * A group's colours as a live Map that paint can write into, converting the stored base64
 * form on first use. The compositor reads a Map straight through.
 * @param {any} group
 * @returns {Map<number, Uint8Array>|null}
 */
export function liveGroupTileColors(group) {
  if (!group) return null;
  if (group.tileColors instanceof Map) return group.tileColors;
  const live = new Map(decodeGroupTileColors(group));
  group.tileColors = live;
  return live;
}

/**
 * The group a stroke should paint into, or null for the shared per-pattern pack.
 *
 * BG groups keep their colours to themselves so one pattern can differ per layer. Sprite
 * patterns stay shared: painting a pose tile is meant to update every pose that uses it.
 * @param {any} group
 */
export function paintTargetGroupFor(group) {
  // Not just `authoringKind === 'bg'`: older groups carry only criteria, and painting one of
  // those into the shared pack would recolour its patterns on every screen.
  return group && !isObjGroup(group) ? group : null;
}

/**
 * The Project tool's overlay document (`painter-v2-vip-overlays.json`) without one group's
 * layers. Overlay paint is blended over the finished frame, so it hides per-pattern paint on
 * the same group; SpriteStudio drops it when you choose to paint that group per pattern.
 * @param {string} jsonStr
 * @param {string} groupId
 * @returns {string} the new document, or '' when no layer is left (the file is then left out)
 */
export function overlaysJsonWithoutGroup(jsonStr, groupId) {
  if (!jsonStr) return '';
  let doc;
  try {
    doc = JSON.parse(jsonStr);
  } catch {
    return jsonStr;
  }
  if (!doc || !Array.isArray(doc.entries)) return jsonStr;
  const entries = doc.entries.filter((e) => String(e?.groupId || '').trim() !== groupId);
  return entries.length ? JSON.stringify({ ...doc, entries }) : '';
}

/**
 * Drop a group's overlay paint from the session, for Save and for the stage. Returns what was
 * there, so undo can put it back with `restoreGroupOverlay`.
 * @param {any} session @param {string} groupId
 */
export function clearGroupOverlay(session, groupId) {
  const saved = { groupId, byEye: session.vipOverlays.get(groupId) || null, json: session.parsed.painterV2VipOverlays };
  session.vipOverlays.delete(groupId);
  session.parsed.painterV2VipOverlays = overlaysJsonWithoutGroup(session.parsed.painterV2VipOverlays, groupId);
  return saved;
}

/** @param {any} session @param {ReturnType<typeof clearGroupOverlay>} saved */
export function restoreGroupOverlay(session, saved) {
  if (saved.byEye) session.vipOverlays.set(saved.groupId, saved.byEye);
  session.parsed.painterV2VipOverlays = saved.json;
}

/**
 * @param {any} session @param {number} hash @param {Uint8Array} tileBytes
 * @param {number} lx @param {number} ly
 * @param {{ r: number, g: number, b: number, a: number }} color
 * @returns {boolean} true when the pixel changed
 */
export function paintTilePixel(session, hash, tileBytes, lx, ly, color, targetGroup, shades = null) {
  if (lx < 0 || lx > 7 || ly < 0 || ly > 7) return false;
  const buf = packRgbaForHash(session, hash, tileBytes, targetGroup, shades);
  const i = (ly * 8 + lx) * 4;
  if (buf[i] === color.r && buf[i + 1] === color.g && buf[i + 2] === color.b && buf[i + 3] === color.a) return false;
  buf[i] = color.r;
  buf[i + 1] = color.g;
  buf[i + 2] = color.b;
  buf[i + 3] = color.a;
  return true;
}

/** Distinct colors already painted on a group's pose tiles, most used first. */
export function usedColorsForGroup(session, group) {
  const hashes = new Set();
  for (const pose of posesOf(group)) for (const t of pose.tiles || []) hashes.add(t.hash >>> 0);
  // A BG group's patterns are its criteria, whether or not it kept poses.
  if (!isObjGroup(group)) for (const h of group?.criteria?.hashes || []) hashes.add(Number(h) >>> 0);
  /** @type {Map<string, number>} */
  const counts = new Map();
  // A BG group's colours live on the group, so the palette has to look there first.
  const own = paintTargetGroupFor(group) ? decodeGroupTileColors(group) : null;
  for (const h of hashes) {
    const buf = own?.get(h) || session.pack.get(h);
    if (!buf) continue;
    for (let i = 0; i < 256; i += 4) {
      // Starter shades are where paint began, not colours anyone chose (src/starter-paint.js).
      if (buf[i + 3] === 0 || isStarterColour(buf[i], buf[i + 1], buf[i + 2])) continue;
      const key = `#${[buf[i], buf[i + 1], buf[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex, n]) => ({ hex, count: n }));
}

/**
 * Rebuild the `.vbpack` from the session: painted tiles and edited groups (poses,
 * tracks) replace what was loaded; everything else in the pack is carried over.
 * @param {any} session
 * @returns {Promise<Blob>}
 */
/**
 * @param {any} session
 * @param {{ onUpdate?: (p: { percent: number, currentFile: string|null }) => void }} [opts]
 *   forwarded to the zip, so the save window can report which file it is on.
 */
export async function buildPackBlob(session, opts = {}) {
  const base = artPackPartsFromParsed(session.parsed);
  return buildArtPack({
    ...base,
    vbcolor: buildVBColorPack(session.gameId || 'vb-pack', session.pack),
    // Live authoring buffers become the stored base64 form on the way into groups.json.
    groups: session.groups.map(groupWithEncodedTileColors),
    groupsSchemaVersion: requiredGroupsSchemaVersion(session.groups, session.parsed?.groupsSchemaVersion),
    // What each frame shows, so the next open need not decode them (src/frame-summary.js).
    ...withFrameSummaries(session),
    ...(session.gameStatePools?.length ? { gameStatePools: session.gameStatePools } : {}),
    // Pictures set aside instead of saved wrong (src/recovery.js); what was put back or discarded goes.
    // Files the tool could not read are written back as they were.
    ...(Array.isArray(session.recovered) && { recoveryFolder: [...recoveryFolderFrom(session.recovered), ...(session.recoveryUnreadable || [])] }),
  }, opts);
}

/** A frame's text length, its summary's fingerprint, read without decompressing the frame. */
function frameTextLength(row) {
  return row.jsonSize ?? (typeof row.json === 'string' ? row.json.length : 0);
}

/** `{ frameSummaries }` for the pack: this session's summaries, else the saved ones that still match. */
function withFrameSummaries(session) {
  const rows = session.frames.map((f) => ({ vipFile: f.vipFile, jsonSize: frameTextLength(f) }));
  const json = frameSummariesJson(rows, session._savedSummaries, session._freshSummaries);
  return json ? { frameSummaries: json } : {};
}

/** Tile-index → pattern hash, memoized for one state. */
function hasherFor(state) {
  /** @type {Map<number, number>} */
  const cache = new Map();
  return (tileIndex) => {
    let h = cache.get(tileIndex);
    if (h === undefined) {
      h = hashTile(getTileBytes(state.patternTable, tileIndex)) >>> 0;
      cache.set(tileIndex, h);
    }
    return h;
  };
}

/**
 * Where a pose sits in a given frame: poses store tile offsets relative to an
 * anchor *pattern*, so the anchor draw has to be found in the frame first. When
 * several draws share the anchor hash, the one whose neighbours match the most
 * pose tiles wins. A pose not found whole as captured is also tried mirrored
 * (src/pose-mirror.js) — a sprite facing the other way — unless *Mirror OK* is off;
 * `mirrorH` / `mirrorV` say which way it was found, and a tie goes to the pose as captured.
 * @param {any} state @param {any} pose @param {number} [eye]
 * @returns {{ x: number, y: number, matched: number, total: number, flipH: boolean, flipV: boolean, mirrorH: boolean, mirrorV: boolean } | null}
 */
export function locatePose(state, pose, eye = 0) {
  const tiles = Array.isArray(pose?.tiles) ? pose.tiles : [];
  if (!state?.drawList?.length || !state.patternTable || !tiles.length) return null;
  const anchorHash = typeof pose.anchorHash === 'number' ? pose.anchorHash >>> 0 : null;
  if (anchorHash === null) return null;
  const hashOf = hasherFor(state);

  /** @type {Map<string, Set<number>>} */
  const hashesAt = new Map();
  /** @type {Array<any>} */
  const candidates = [];
  for (const d of state.drawList) {
    if ((d.eye ?? 0) !== eye) continue;
    const h = hashOf(d.tileIndex);
    const key = `${d.x},${d.y}`;
    let set = hashesAt.get(key);
    if (!set) hashesAt.set(key, (set = new Set()));
    set.add(h);
    if (h === anchorHash) candidates.push(d);
  }

  let best = null;
  for (const orientation of poseOrientations(pose)) {
    // Mirrored is only worth trying when the pose as captured is not all there.
    if (best && best.matched === tiles.length) break;
    for (const c of candidates) {
      const origin = { x: c.x, y: c.y, ...orientation };
      let matched = 0;
      for (const t of tiles) {
        const at = placePoseTile(t, origin);
        if (hashesAt.get(`${at.x},${at.y}`)?.has(t.hash >>> 0)) matched++;
      }
      if (!best || matched > best.matched) {
        best = { ...origin, matched, total: tiles.length, flipH: c.flipH === true, flipV: c.flipV === true };
      }
    }
  }
  return best;
}

/**
 * The frame's draws that belong to a located pose. VIP worlds in front of the
 * sprite routinely cover it (the Project tool hides them with view filters), so
 * a sprite-first view has to composite these separately and draw them on top.
 * @param {any} state @param {any} pose @param {{ x: number, y: number }} origin @param {number} [eye]
 */
export function poseDraws(state, pose, origin, eye = 0) {
  const tiles = Array.isArray(pose?.tiles) ? pose.tiles : [];
  if (!state?.drawList?.length || !state.patternTable || !tiles.length || !origin) return [];
  const wanted = new Map();
  for (const t of tiles) {
    const at = placePoseTile(t, origin);
    wanted.set(`${at.x},${at.y}`, t.hash >>> 0);
  }
  const hashOf = hasherFor(state);
  return state.drawList.filter(
    (d) => (d.eye ?? 0) === eye && wanted.get(`${d.x},${d.y}`) === hashOf(d.tileIndex),
  );
}

/**
 * An affine group's layer: the frame composited as the VIP draws it (scaled worlds sampled),
 * keeping only the pixels that read one of the group's tiles.
 */
function renderAffinePoseLayer({ session, state, pose, imageData, eye, brightness, touchUp, monoFallback = false }) {
  renderFrame({ session, state, imageData, eye, brightness, overlayGroupIds: [], touchUps: touchUp, monoFallback });
  const hashOf = hasherFor(state);
  const d = imageData.data;
  let kept = 0;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const hit = affinePoseHit(state, eye, pose, x, y, hashOf);
      const i = (y * FRAME_W + x) * 4;
      // The group's pixels: lit ones, and see-through ones that are painted (drawn by the composite).
      if (hit && (hit.lit || d[i + 3])) kept++;
      else d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    }
  }
  return kept > 0;
}

/**
 * Composite just a pose's own draws, leaving everything else transparent.
 * @param {{ session: any, state: any, pose: any, origin: any, imageData: ImageData, eye?: number, brightness?: number }} opts
 * @returns {boolean} false when the pose has no draws in this frame
 */
export function renderPoseLayer({ session, state, pose, origin, imageData, eye = 0, brightness = 1, groupId = null, touchUp = true, monoFallback = false }) {
  if (pose?.affineWorlds?.length) return renderAffinePoseLayer({ session, state, pose, imageData, eye, brightness, touchUp, monoFallback });
  const draws = poseDraws(state, pose, origin, eye);
  if (!draws.length) {
    imageData.data.fill(0);
    return false;
  }
  // The right eye's copy of a left-only layer takes its colour from the left eye, which needs the
  // whole frame and its world table (src/stereo-twin.js); the footprint mask below still applies.
  const win = eye === 1 ? getWindowsTableBytesFromState(state) : null;
  const twins = win ? stereoTwins(win) : null;
  const twinned = !!twins?.size && draws.some((d) => twins.has(Number(d.world)));
  renderFrame({
    session,
    state: twinned ? state : { ...state, drawList: draws, windows: new Uint8Array(0) },
    imageData,
    eye,
    brightness,
    overlayGroupIds: [],
    touchUps: false,
    monoFallback,
  });

  // Keep the layer to the sprite's own 8×8 footprint: a filtered draw list can
  // still spill (windows, clipping), and another group's paint must not ride along.
  const inFootprint = new Uint8Array(FRAME_W * FRAME_H);
  for (const t of pose.tiles) {
    const { x: tx, y: ty } = placePoseTile(t, origin);
    for (let y = Math.max(0, ty); y < Math.min(FRAME_H, ty + 8); y++) {
      for (let x = Math.max(0, tx); x < Math.min(FRAME_W, tx + 8); x++) inFootprint[y * FRAME_W + x] = 1;
    }
  }
  const d = imageData.data;
  for (let p = 0; p < inFootprint.length; p++) {
    if (!inFootprint[p]) {
      const i = p * 4;
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    }
  }
  if (groupId) blendOverlays(session, imageData, eye, [groupId], inFootprint);
  // The group's overpaint (and an old touch-up) paints past its tiles by design, so it goes on
  // after the footprint mask: through the frame's scroll on a plain layer, or cell by cell on a
  // scaled layer's base tiles (whose draws carry their map cells).
  const group = groupId && touchUp ? session.groups.find((g) => g.id === groupId) : null;
  const op = group ? layerArtOf(group) : null;
  const opPixels = op && !op.hideTiles ? layerArtPixels(group) : null;
  // Recorded as picture pixels, like the compositor's own, so Show unpainted leaves them alone.
  const covered = opPixels ? getCompositePixelInfo().art : null;
  if (opPixels && draws.some((d) => Number.isInteger(d.cellX))) {
    paintOverpaintOnCells(imageData.data, draws, op, opPixels, eye, covered);
  } else if (opPixels) {
    const windows = getWindowsTableBytesFromState(state);
    for (const entry of activeLayerArts({ ...state, windows }, [group], eye)) paintLayerArt(imageData.data, null, windows, eye, entry, 1, covered);
  }
  // A character's pose pictures (its whole-pose groups) are part of how it looks on its cards.
  const poseGroups = group
    ? [...posePictureGroups(group), ...session.groups.filter((g) => g.wholePose === true && g.poseOf === group.id)].filter((g) => layerArtOf(g) && !layerArtOf(g).hideTiles)
    : [];
  if (poseGroups.length && !draws.some((d) => Number.isInteger(d.cellX))) {
    const windows = getWindowsTableBytesFromState(state);
    const marks = getCompositePixelInfo().art;
    for (const entry of activeLayerArts({ ...state, windows }, poseGroups, eye)) paintLayerArt(imageData.data, null, windows, eye, entry, 1, marks);
  }
  if (group?.touchUp) {
    const windows = getWindowsTableBytesFromState(state);
    for (const entry of activeTouchUps({ ...state, windows }, [group], eye)) {
      paintTouchUp(imageData.data, null, windows, eye, entry, 1);
    }
  }
  return true;
}

/**
 * Screen bounds of a pose's tiles once its anchor has been located.
 * @param {{ tiles?: Array<{ dx: number, dy: number }> }} pose
 * @param {{ x: number, y: number }} [origin] anchor position; defaults to 0,0 (pose-local)
 * @returns {{ x0: number, y0: number, x1: number, y1: number } | null}
 */
export function poseBounds(pose, origin = { x: 0, y: 0 }) {
  const tiles = Array.isArray(pose?.tiles) ? pose.tiles : [];
  if (!tiles.length) return null;
  const ax = Number(origin?.x) || 0;
  const ay = Number(origin?.y) || 0;
  // A scaled group's bounds are its pixels on screen, worked out when the view was built.
  const ab = pose.affineBounds;
  if (ab) return { x0: ax + ab.x0, y0: ay + ab.y0, x1: ax + ab.x1, y1: ay + ab.y1 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of tiles) {
    const { x, y } = placePoseTile(t, { ...origin, x: ax, y: ay });
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + 8 > x1) x1 = x + 8;
    if (y + 8 > y1) y1 = y + 8;
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1 };
}
