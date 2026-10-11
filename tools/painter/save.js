/**
 * The Project tool's Save, Save as and Save and Play: checking the pack, building it, writing it
 * to disk, and the hand-off to and back from SpriteStudio and the emulator. Split out of tools/painter.js, which passes in the state and functions it shares (initSave).
 */
import { withFrameNumbers } from '../../src/frame-numbers.js';
import { serializeVIPState } from '../../src/vip-dump.js';
import { buildVBColorPack } from '../../src/vbcolor-pack.js';
import { parseArtPack, buildArtPack, artPackPartsFromParsed, defaultPainterV2Rules, copyBinaryToArrayBuffer } from '../../src/art-pack.js';
import { getHandoff, putHandoff, deleteHandoff } from '../../src/handoff-store.js';
import { pickSaveVbpackFile, normalizeVbpackFileName, ensureHandlePermission } from '../../src/project-home.js';
import { groupWithEncodedTileColors } from '../../src/group-tile-colors.js';
import { VBPACK_HANDOFF_STEPS } from '../../src/save-progress.js';
import { requiredGroupsSchemaVersion } from '../../src/obj-sprite-profiles.js';
import { formatPaintToolFrameLabelFromRegistry } from './frame-registry.js';
import { resolvePoseSourcesForSave } from './pose-sources.js';
import { buildReturnState, readReturnState, frameIndexForReturn, HANDOFF_KEY_RETURN_PACK, HANDOFF_KEY_RETURN_STATE } from '../shared/project-return.js';
import { generateFrameId } from '../../src/frame-capture.js';
import { referencesFolderForSave } from './reference-images.js';
import { primeRamDumpStore } from './frame-data.js';
import { encodeTouchUpsForSave, ensurePainterV2Rules, serializeOverridesForSave, serializePainterVipOverlaysForSave } from './pack-rules.js';
import { updateSelectionUi } from './selection.js';
import { framePatternsForIndex, rebuildScreenIndex } from './screens-ui.js';
import { formatByteSize, saveUi } from './paint-inventory-ui.js';
import { refreshAnimatedShadeRamps, updateGroupDetail } from './group-detail.js';
import { getCurrentFrameSelectIndex, getPainterV2LastVipFileForManifest, getRegistryFrameIdForFrameIndex, variantExistsInPools } from './pools.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initSave(context) {
  ctx = context;
}

/**
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateVbpackForSave() {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const label = (g) => `“${g.name || g.id}” (${g.id})`;

  /** @type {Set<string>} */
  const seenIds = new Set();
  for (const g of ctx.groups) {
    const id = typeof g.id === 'string' ? g.id.trim() : '';
    if (!id) {
      errors.push('Every group must have a non-empty id.');
      continue;
    }
    if (id.length > 160) errors.push(`Group id too long (${id.length} chars): ${id.slice(0, 40)}…`);
    if (seenIds.has(id)) errors.push(`Duplicate group id: ${id}`);
    seenIds.add(id);
    const nm = typeof g.name === 'string' ? g.name.trim() : '';
    if (!nm) warnings.push(`Group ${label(g)} has an empty display name (will fall back to id in some tools).`);
    if (nm.length > 200) errors.push(`Group ${label(g)}: display name exceeds 200 characters.`);

    const sid = typeof g.statePoolId === 'string' ? g.statePoolId.trim() : '';
    const vid = typeof g.stateVariantId === 'string' ? g.stateVariantId.trim() : '';
    if (sid || vid) {
      if (!sid || !vid) {
        errors.push(`Group ${label(g)}: set both statePoolId and stateVariantId, or omit both for legacy.`);
      } else if (!variantExistsInPools(sid, vid)) {
        errors.push(`Group ${label(g)}: statePoolId/stateVariantId do not resolve to a variant in gameStatePools.`);
      }
    }

    if (g.authoringKind != null && g.authoringKind !== 'bg' && g.authoringKind !== 'obj') {
      errors.push(`Group ${label(g)}: authoringKind must be "bg", "obj", or omitted (got ${JSON.stringify(g.authoringKind)}).`);
    }

    const c = g.criteria || {};
    const hashes = Array.isArray(c.hashes) ? c.hashes : [];
    const windowIds = Array.isArray(c.windowIds)
      ? c.windowIds
      : Array.isArray(c.worldIds)
        ? c.worldIds
        : [];
    const layers = Array.isArray(c.layers) ? c.layers : [];
    for (let i = 0; i < hashes.length; i++) {
      const h = hashes[i];
      if (typeof h !== 'number' || !Number.isFinite(h)) {
        errors.push(`Group ${label(g)}: criteria.hashes[${i}] must be a finite number.`);
      }
    }
    for (let i = 0; i < windowIds.length; i++) {
      const w = windowIds[i];
      const n = Number(w);
      if (!Number.isFinite(n) || n < 0 || n > 31) {
        errors.push(`Group ${label(g)}: criteria.windowIds[${i}] must be a window index 0–31.`);
      }
    }
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      if (L !== 0 && L !== 1 && L !== 2) {
        errors.push(`Group ${label(g)}: criteria.layers[${i}] must be 0, 1, or 2.`);
      }
    }
    if (hashes.length === 0 && windowIds.length === 0 && layers.length === 0) {
      warnings.push(`Group ${label(g)}: criteria do not restrict hashes, worlds, or layers — matches every draw (usually unintentional).`);
    }
  }

  const groupIdSet = new Set(ctx.groups.map((gr) => gr.id));
  for (let i = 0; i < ctx.overrides.length; i++) {
    const gid = ctx.overrides[i]?.groupId;
    if (typeof gid !== 'string' || !gid.trim()) continue;
    if (!groupIdSet.has(gid.trim())) {
      errors.push(`overrides[${i}] references unknown groupId “${gid.trim()}”.`);
    }
  }

  const presets = Array.isArray(ctx.overridePresets) ? ctx.overridePresets : [];
  for (let i = 0; i < presets.length; i++) {
    const p = presets[i];
    const psid = typeof p?.statePoolId === 'string' ? p.statePoolId.trim() : '';
    const pvid = typeof p?.stateVariantId === 'string' ? p.stateVariantId.trim() : '';
    if (!psid && !pvid) continue;
    const presetLabel = typeof p?.name === 'string' && p.name.trim() ? p.name.trim() : String(p?.id ?? i);
    if (!psid || !pvid || !variantExistsInPools(psid, pvid)) {
      errors.push(`overridePresets[${i}] (“${presetLabel}”): invalid or incomplete statePoolId / stateVariantId.`);
    }
  }

  const rules = ensurePainterV2Rules();
  /** @type {Set<string>} */
  const poolVariantIds = new Set();
  for (const pool of ctx.gameStatePools) {
    const vars = pool?.variants;
    if (!Array.isArray(vars)) continue;
    for (const v of vars) {
      const vid = typeof v?.id === 'string' ? v.id.trim() : '';
      if (vid) poolVariantIds.add(vid);
    }
  }
  const t8 = rules.tile8ByVariant;
  if (t8 != null && typeof t8 === 'object' && !Array.isArray(t8)) {
    for (const variantKey of Object.keys(t8)) {
      const k = variantKey.trim();
      if (!k) continue;
      if (!poolVariantIds.has(k)) {
        warnings.push(
          `painter-v2-rules tile8ByVariant has key “${k}” with no matching variant id in gameStatePools (may be intentional if pools are incomplete in this preview).`,
        );
      }
    }
  }
  const macro = rules.macroByVariant;
  if (macro != null && typeof macro === 'object' && !Array.isArray(macro)) {
    for (const variantKey of Object.keys(macro)) {
      const k = variantKey.trim();
      if (!k) continue;
      if (!poolVariantIds.has(k)) {
        warnings.push(`painter-v2-rules macroByVariant has key “${k}” with no matching variant id in gameStatePools.`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * A pose captured on the Current (Colorize!) frame has no registry frame to point at, and the
 * next Colorize! replaces that frame — which left the pose blank in SpriteStudio. Before saving,
 * point each such pose at a saved frame that shows it, or save the Current frame as one.
 */
function giveEveryPoseASourceFrame() {
  const result = resolvePoseSourcesForSave({
    groups: ctx.groups,
    frames: ctx.availableFrames,
    frameIdAt: (i) => getRegistryFrameIdForFrameIndex(i),
    isCurrentAt: (i) => /^current\b/i.test(String(ctx.availableFrames[i]?.label || '').trim()),
    saveState: ctx.loadedPackParts?.saveState,
    newFrameId: generateFrameId,
    patternsAt: framePatternsForIndex(),
  });
  if (!result || result.resolved === 0) return;
  const { promotion } = result;
  if (promotion) {
    const add = (key, file) => {
      if (file) ctx.loadedPackParts[key] = [...(ctx.loadedPackParts[key] || []), file];
    };
    add('vipStatesFolder', promotion.vipFile);
    add('saveStatesFolder', promotion.saveStateFile);
    add('ramdumpsFolder', promotion.ramdumpFile);
    if (promotion.ramdumpFile) primeRamDumpStore(ctx.loadedPackParts.ramdumpsFolder);
    ctx.lastFrameRegistry = withFrameNumbers([...(ctx.lastFrameRegistry || []), promotion.registryEntry]).registry;
    const entry = ctx.lastFrameRegistry[ctx.lastFrameRegistry.length - 1];
    const { name, json } = promotion.vipFile;
    ctx.availableFrames = [
      ...ctx.availableFrames,
      { label: formatPaintToolFrameLabelFromRegistry(entry, name), vipFile: name, json, frameRegistryEntry: entry },
    ];
    const selected = ctx.frameSelect?.value;
    ctx.populateFrames();
    if (ctx.frameSelect && selected != null) ctx.frameSelect.value = selected;
    rebuildScreenIndex();
  }
  ctx.groups = result.groups;
  ctx.markGroupsDirty();
}

/**
 * Build the in-memory .vbpack parts for Save / Save and Play (current edits + sidecars).
 * @param {{ updateCurrentVip?: boolean }} [opts]
 * @returns {Promise<{ ok: true, merged: Record<string, unknown>, vipOverlayLayers: number, vipOverlaysJson: string|null } | { ok: false, cancelled?: boolean }>}
 */
export async function preparePainterVbpackParts(opts = {}) {
  const updateCurrentVip = opts.updateCurrentVip !== false;
  if (!ctx.loadedPackParts) {
    ctx.setStatus('Load a .vbpack first.');
    return { ok: false };
  }
  const { errors, warnings } = validateVbpackForSave();
  if (errors.length > 0) {
    const msg = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
    window.alert(`Save blocked — fix and try again:\n\n${msg}`);
    ctx.setStatus(`Save blocked: ${errors.length} validation error(s).`);
    return { ok: false };
  }
  if (warnings.length > 0) {
    const msg = warnings.map((e, i) => `${i + 1}. ${e}`).join('\n');
    const ok = window.confirm(`Warnings (${warnings.length}):\n\n${msg}\n\nSave anyway?`);
    if (!ok) {
      ctx.setStatus('Save cancelled after validation warnings.');
      return { ok: false, cancelled: true };
    }
  }
  // Everything above is validation; everything below builds the files. The save window
  // reports them as separate steps, so it is told where the line is.
  if (typeof opts.onCollectStart === 'function') await opts.onCollectStart();
  await encodeTouchUpsForSave();
  giveEveryPoseASourceFrame();
  refreshAnimatedShadeRamps();
  const rules = ensurePainterV2Rules();
  const base = artPackPartsFromParsed(ctx.loadedPackParts);
  const vbcolorBuf = buildVBColorPack(ctx.loadedVbcolorGameId || 'vb-pack', ctx.pack);
  const { json: vipOverlaysJson, layers: vipOverlayLayers } = serializePainterVipOverlaysForSave();
  const lastVipFileForManifest = getPainterV2LastVipFileForManifest();
  const vipStateJson =
    updateCurrentVip && ctx.currentState
      ? JSON.stringify(serializeVIPState({ ...ctx.currentState, drawList: (ctx.currentState.drawList || []).filter((d) => !d.standIn) }))
      : base.vipState;
  const groupsSchemaVersion = requiredGroupsSchemaVersion(ctx.groups, ctx.loadedGroupsSchemaVersion);
  const merged = {
    ...base,
    vbcolor: vbcolorBuf,
    overrides: serializeOverridesForSave(),
    // Live authoring buffers become the stored base64 form on the way into groups.json.
    groups: ctx.groups.map(groupWithEncodedTileColors),
    ...(Array.isArray(ctx.overridePresets) && ctx.overridePresets.length > 0 && { overridePresets: ctx.overridePresets }),
    ...(Array.isArray(ctx.gameStatePools) && ctx.gameStatePools.length > 0 && { gameStatePools: ctx.gameStatePools }),
    ...(ctx.gameStates.length > 0 && { gameStates: ctx.gameStates }),
    ...(typeof groupsSchemaVersion === 'number' && { groupsSchemaVersion }),
    painterV2Rules: {
      ...defaultPainterV2Rules(),
      ...rules,
    },
    ...(vipStateJson != null && vipStateJson !== '' && { vipState: vipStateJson }),
    manifest: {
      ...(base.manifest && typeof base.manifest === 'object' ? base.manifest : {}),
      updatedAt: new Date().toISOString(),
      ...(lastVipFileForManifest ? { painterV2LastVipFile: lastVipFileForManifest } : {}),
      // Frame names and tags live on the registry entries; references are their own block.
      ...(Array.isArray(ctx.lastFrameRegistry) && ctx.lastFrameRegistry.length > 0 && { frameRegistry: ctx.lastFrameRegistry }),
      ...(ctx.packReferences.items.length > 0
        ? { references: ctx.packReferences }
        : base.manifest && 'references' in base.manifest
          ? { references: { items: [], active: {} } }
          : {}),
    },
  };
  const referencesForSave = referencesFolderForSave();
  if (referencesForSave.length > 0) merged.referencesFolder = referencesForSave;
  else delete merged.referencesFolder;
  if (vipOverlaysJson) merged.painterV2VipOverlays = vipOverlaysJson;
  else if (typeof base.painterV2VipOverlays === 'string' && base.painterV2VipOverlays.length > 0) {
    // loadVipFromJson clears in-memory overlays; switching frames then Save used to drop this file from the zip.
    merged.painterV2VipOverlays = base.painterV2VipOverlays;
  } else delete merged.painterV2VipOverlays;
  return { ok: true, merged, vipOverlayLayers, vipOverlaysJson: vipOverlaysJson || null };
}

function syncLoadedPackPartsAfterSave(merged, vipOverlaysJson, baseVipOverlays) {
  ctx.groupsDirty = false;
  ctx.referencesDirty = false;
  ctx.frameRegistryDirty = false;
  ctx.paintEditsSinceSave = 0;
  // The file has the work now.
  void ctx.clearProjectJournal();
  if (merged.referencesFolder) ctx.loadedPackParts.referencesFolder = merged.referencesFolder;
  else delete ctx.loadedPackParts.referencesFolder;
  try {
    ctx.loadedPackParts.groups = structuredClone(ctx.groups);
  } catch {
    ctx.loadedPackParts.groups = JSON.parse(JSON.stringify(ctx.groups));
  }
  try {
    ctx.loadedPackParts.overrides = structuredClone(serializeOverridesForSave());
  } catch {
    ctx.loadedPackParts.overrides = JSON.parse(JSON.stringify(serializeOverridesForSave()));
  }
  if (vipOverlaysJson) ctx.loadedPackParts.painterV2VipOverlays = vipOverlaysJson;
  else if (typeof baseVipOverlays === 'string' && baseVipOverlays.length > 0) {
    ctx.loadedPackParts.painterV2VipOverlays = baseVipOverlays;
  } else delete ctx.loadedPackParts.painterV2VipOverlays;
  ctx.loadedPackParts.manifest = merged.manifest;
  if (merged.painterV2Rules) ctx.loadedPackParts.painterV2Rules = merged.painterV2Rules;
  if (Array.isArray(ctx.gameStatePools)) {
    try {
      ctx.loadedPackParts.gameStatePools = structuredClone(ctx.gameStatePools);
    } catch {
      ctx.loadedPackParts.gameStatePools = JSON.parse(JSON.stringify(ctx.gameStatePools));
    }
  }
  if (typeof merged.groupsSchemaVersion === 'number') ctx.loadedGroupsSchemaVersion = merged.groupsSchemaVersion;
  if (typeof ctx.loadedGroupsSchemaVersion === 'number') {
    ctx.loadedPackParts.groupsSchemaVersion = ctx.loadedGroupsSchemaVersion;
  }
}

/** @param {boolean} saveAs When true, always show the save picker (new path / new handle). */
export async function runPainterVbpackSave(saveAs) {
  // Where it goes is settled while the click still counts: the browser asks for permission to
  // write a file, or shows a Save As dialog, only during the click — not after seconds of packing.
  let picked = null;
  if (saveAs) {
    picked = await pickSaveVbpackFile(normalizeVbpackFileName(ctx.getVbpackSaveSuggestedFileName()));
    if (picked.status === 'aborted') {
      ctx.closePainterFileMenu();
      ctx.setStatus('Save cancelled.');
      return;
    }
  } else if (ctx.painterVbpackSaveFileHandle && typeof ctx.painterVbpackSaveFileHandle.createWritable === 'function') {
    if (!(await ensureHandlePermission(ctx.painterVbpackSaveFileHandle, 'readwrite'))) {
      ctx.closePainterFileMenu();
      ctx.setStatus(`The browser did not allow writing ${ctx.painterVbpackSaveFileHandle.name || 'the pack'}, so nothing was saved. Save again and allow it, or use Save As to choose a file.`);
      return;
    }
  }
  await saveUi.begin(`Saving ${ctx.getVbpackSaveSuggestedFileName()}`);
  await saveUi.step('check');
  const prepared = await preparePainterVbpackParts({
    updateCurrentVip: false,
    onCollectStart: async () => {
      saveUi.finish('check');
      await saveUi.step('collect');
    },
  });
  if (!prepared.ok) {
    if (prepared.cancelled) saveUi.abandon();
    else saveUi.end({ failedAt: 'check', message: 'The project did not pass its checks.' });
    ctx.closePainterFileMenu();
    return;
  }
  const { merged, vipOverlayLayers, vipOverlaysJson } = prepared;
  const baseVipOverlays =
    typeof ctx.loadedPackParts.painterV2VipOverlays === 'string' && ctx.loadedPackParts.painterV2VipOverlays.length > 0
      ? ctx.loadedPackParts.painterV2VipOverlays
      : null;

  saveUi.finish('collect', `${ctx.pack.size} pack tile(s), ${ctx.groups.length} group(s)`);

  await saveUi.step('zip');
  let blob;
  try {
    blob = await buildArtPack(merged, {
      onUpdate: ({ percent, currentFile }) => {
        saveUi.update('zip', percent, currentFile);
      },
    });
  } catch (err) {
    saveUi.end({ failedAt: 'zip', message: `Could not pack the file: ${err?.message || err}` });
    ctx.closePainterFileMenu();
    ctx.setStatus('Save failed while packing the .vbpack.');
    return;
  }
  saveUi.finish('zip', formatByteSize(blob.size));
  ctx.packFileBytes = blob.size;

  await saveUi.step('write');
  let result;
  try {
    result = await ctx.savePainterVbpackBlob(blob, { saveAs, picked });
  } catch (err) {
    // Nothing else is written quietly, but the window offers the ways out with the same project.
    saveUi.end({
      failedAt: 'write',
      message: `Could not write the file: ${err?.message || err}`,
      actions: [
        {
          id: 'btn-save-failed-save-as',
          label: 'Save as…',
          title: 'Write the same project to another file',
          run: async () => {
            let retried;
            try {
              retried = await ctx.savePainterVbpackBlob(blob, { saveAs: true });
            } catch (again) {
              ctx.setStatus(`Save as… failed too: ${again?.message || again}. Use Download a copy.`);
              return;
            }
            if (!retried.ok && retried.mode === 'aborted') {
              ctx.setStatus('Save as… was cancelled — nothing was written. The project is still unsaved here.');
              return;
            }
            syncLoadedPackPartsAfterSave(merged, vipOverlaysJson, baseVipOverlays);
            ctx.setStatus(`Saved ${retried.name || ctx.getVbpackSaveSuggestedFileName()} (after the first write failed).`);
          },
        },
        {
          id: 'btn-save-failed-download',
          label: 'Download a copy',
          title: 'Download the same project to your downloads folder',
          run: () => {
            const copyName = ctx.getVbpackSaveSuggestedFileName();
            ctx.downloadBlob(blob, copyName);
            ctx.setStatus(`Downloaded a copy of the project as ${copyName}. It is still marked unsaved here: Save again once the file can be written.`);
          },
        },
      ],
    });
    ctx.closePainterFileMenu();
    ctx.setStatus('Save failed while writing to disk — use Save as… or Download a copy in the save window.');
    return;
  }
  ctx.closePainterFileMenu();
  if (!result.ok && result.mode === 'aborted') {
    saveUi.abandon();
    ctx.setStatus('Save cancelled.');
    return;
  }
  saveUi.finish('write', result.name || '');

  await saveUi.step('sync');
  syncLoadedPackPartsAfterSave(merged, vipOverlaysJson, baseVipOverlays);
  saveUi.finish('sync');
  saveUi.end();
  const label = result.name || ctx.getVbpackSaveSuggestedFileName();
  const preservedOverlays = !vipOverlaysJson && !!baseVipOverlays;
  const vipNote = vipOverlaysJson
    ? ` + painter-v2-vip-overlays.json (${vipOverlayLayers} layer${vipOverlayLayers === 1 ? '' : 's'})`
    : preservedOverlays
      ? ' + painter-v2-vip-overlays.json (unchanged — re-open frame or Reload if edits look missing)'
      : '';
  // A file handle can't reach its own folder, so backups need a project home.
  const backupNote =
    result.mode === 'overwrite'
      ? result.backup
        ? ` · previous version kept as ${result.backup}`
        : ' · no backup (set a project home folder to keep one)'
      : '';
  ctx.setStatus(
    `Saved ${label} — ${formatByteSize(ctx.packFileBytes ?? 0)} (${ctx.pack.size} pack tiles · color.vbcolor + overrides.json + groups.json + painter-v2-rules.json${vipNote})${backupNote}`,
  );
}

const HANDOFF_KEY_COLORIZE = 'colorize-current';
const HANDOFF_KEY_COLORIZE_PACK_NAME = 'colorize-pack-name';
/** The emulator's file for this pack, so Save / Save and Play update it instead of writing a new one. */
const HANDOFF_KEY_COLORIZE_FILE_HANDLE = 'colorize-pack-file-handle';
const HANDOFF_KEY_SAVE_AND_PLAY = 'save-and-play';
/** Pack bytes (+ `-name`, `-group`) passed to SpriteStudio so it opens what you were just editing. */
export const HANDOFF_KEY_SPRITE_STUDIO = 'sprite-studio-pack';
const HANDOFF_KEY_SAVE_AND_PLAY_FILE_HANDLE = 'save-and-play-pack-file-handle';

export function updateSaveAndPlayEnabled() {
  if (ctx.btnSaveAndPlay) ctx.btnSaveAndPlay.disabled = !ctx.loadedPackParts;
}

/** Where the Project tool is, so a trip through SpriteStudio can come back to it. */
export function captureProjectReturnState() {
  const fi = getCurrentFrameSelectIndex();
  return buildReturnState({
    packName: ctx.loadedPackName,
    displayName: ctx.packDisplayName,
    fileHandle: ctx.painterVbpackSaveFileHandle,
    frameVipFile: fi != null ? ctx.availableFrames[fi]?.vipFile : null,
    eye: ctx.eyeSelect?.value,
    layer: ctx.layerSelect?.value,
    selectedGroupId: ctx.selectedGroupId,
    viewGroupFilterId: ctx.viewGroupFilterId,
    zoomViewport: ctx.zoomViewport,
    unsaved: ctx.hasUnsavedPainterEdits(),
  });
}

/** @param {HTMLSelectElement|null} select @param {string|null} value */
function restoreSelectValue(select, value) {
  if (!select || value == null || select.value === value) return;
  if (![...select.options].some((o) => o.value === value)) return;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * After reloading the pack: put the save target, frame, eye, layer, group, isolate filter and zoom
 * back as `state` (from {@link captureProjectReturnState}) had them.
 * @returns {{ fi: number, group: any }} the frame index found (-1 if gone) and the group (or null)
 */
export function restoreProjectView(state) {
  if (state.displayName) ctx.packDisplayName = state.displayName;
  if (state.fileHandle) ctx.painterVbpackSaveFileHandle = state.fileHandle;

  const fi = frameIndexForReturn(ctx.availableFrames, state.frameVipFile);
  if (fi >= 0) restoreSelectValue(ctx.frameSelect, String(fi));
  restoreSelectValue(ctx.eyeSelect, state.eye);
  restoreSelectValue(ctx.layerSelect, state.layer);

  const group = state.selectedGroupId ? ctx.groups.find((g) => g.id === state.selectedGroupId) : null;
  if (group) {
    ctx.selectedGroupId = group.id;
    ctx.viewGroupFilterId = state.viewGroupFilterId && ctx.groups.some((g) => g.id === state.viewGroupFilterId) ? state.viewGroupFilterId : null;
    ctx.updateGroupsPanel();
    updateGroupDetail(group);
  }
  if (state.zoomViewport) ctx.zoomViewport = { ...state.zoomViewport };
  updateSelectionUi();
  ctx.render();
  return { fi, group };
}

/**
 * Back from SpriteStudio: load the pack it handed back (the Project tool's own unsaved edits
 * plus what was painted there), then put the frame, eye, layer, group, isolate filter, zoom and
 * save target back the way they were when you left.
 */
export async function maybeLoadSpriteStudioReturn() {
  const buffer = await getHandoff(HANDOFF_KEY_RETURN_PACK).catch(() => null);
  const state = readReturnState(await getHandoff(HANDOFF_KEY_RETURN_STATE).catch(() => null));
  try {
    history.replaceState({}, '', location.pathname);
  } catch (_) {}
  if (!buffer || !(buffer.byteLength > 0)) {
    ctx.setStatus('Nothing came back from SpriteStudio — open a .vbpack to carry on.');
    return;
  }
  ctx.setStatus('Loading what SpriteStudio handed back…');
  await ctx.loadVbpackBuffer(buffer, state?.packName || 'pack.vbpack');
  await deleteHandoff(HANDOFF_KEY_RETURN_PACK).catch(() => {});
  await deleteHandoff(HANDOFF_KEY_RETURN_STATE).catch(() => {});
  if (!state) {
    ctx.groupsDirty = true;
    ctx.setStatus('Back from SpriteStudio. Its changes are not saved yet — Save to keep them.');
    return;
  }
  const { fi, group } = restoreProjectView(state);

  const unsaved = state.unsaved || state.spriteStudioChanged;
  if (unsaved) ctx.groupsDirty = true;
  const lost = [state.frameVipFile && fi < 0 && 'frame', state.selectedGroupId && !group && 'group'].filter(Boolean);
  ctx.setStatus(
    `Back from SpriteStudio${state.spriteStudioChanged ? ' with its changes' : ''}.`
      + (unsaved ? ` Not saved yet — Save writes ${ctx.painterVbpackSaveFileHandle ? ctx.painterVbpackSaveFileHandle.name || 'the same file' : 'the pack'}.` : '')
      + (lost.length ? ` The ${lost.join(' and ')} you were on is no longer in the pack.` : ''),
  );
}

/** Load pack from emulator Colorize! IndexedDB handoff. */
export async function maybeLoadHandoffPack() {
  const fromEmulator = new URLSearchParams(location.search).get('from') === 'emulator';
  if (ctx.btnRetryHandoff) ctx.btnRetryHandoff.style.display = 'none';
  ctx.setStatus(fromEmulator ? 'Reading pack from emulator…' : 'Checking for pack from emulator…');
  try {
    await new Promise((r) => setTimeout(r, fromEmulator ? 300 : 50));
    let buffer = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 80 + attempt * 100));
      if (fromEmulator) ctx.setStatus(`Reading pack… (attempt ${attempt + 1})`);
      buffer = await getHandoff(HANDOFF_KEY_COLORIZE);
      if (buffer && buffer.byteLength > 0) break;
    }
    if (!buffer || !(buffer.byteLength > 0)) {
      // A pack opened by hand while this check was retrying keeps its own status line.
      if (ctx.loadedPackParts) return;
      if (fromEmulator) {
        ctx.setStatus(
          'No pack in handoff. Click Colorize! on the emulator page (same tab); you’ll be sent here with the frame.',
        );
        if (ctx.btnRetryHandoff) {
          ctx.btnRetryHandoff.style.display = 'inline-block';
          ctx.btnRetryHandoff.onclick = () => {
            if (ctx.btnRetryHandoff) ctx.btnRetryHandoff.style.display = 'none';
            void maybeLoadHandoffPack();
          };
        }
      } else {
        ctx.setStatus(
          'Open a .vbpack — preview uses compositeColorFrame (WRAM off). Frame names use manifest.frameRegistry when present. Or use Colorize! from the emulator.',
        );
      }
      return;
    }
    if (ctx.btnRetryHandoff) ctx.btnRetryHandoff.style.display = 'none';
    ctx.setStatus(`Got pack (${(buffer.byteLength / 1024).toFixed(1)} KB). Loading…`);
    await ctx.loadVbpackBuffer(buffer, 'From Colorize');
    await deleteHandoff(HANDOFF_KEY_COLORIZE).catch(() => {});
    const handoffName = await getHandoff(HANDOFF_KEY_COLORIZE_PACK_NAME);
    const romStem =
      typeof ctx.loadedPackParts?.manifest?.romFileName === 'string'
        ? String(ctx.loadedPackParts.manifest.romFileName).replace(/\.(vb|bin)$/i, '').trim()
        : '';
    const manifestId =
      typeof ctx.loadedPackParts?.manifest?.gameId === 'string' ? ctx.loadedPackParts.manifest.gameId.trim() : '';
    const prefer =
      (handoffName && typeof handoffName === 'string' && handoffName.trim()) ||
      romStem ||
      (manifestId && !/^vb-pack$/i.test(manifestId) ? manifestId : '') ||
      'untitled-pack';
    const nice =
      /^vb-pack$/i.test(prefer) && romStem
        ? romStem
        : /^vb-pack$/i.test(prefer)
          ? 'untitled-pack'
          : prefer;
    ctx.packDisplayName = `${nice} (editing)`;
    ctx.loadedPackName = `${nice}.vbpack`;
    if (handoffName) await deleteHandoff(HANDOFF_KEY_COLORIZE_PACK_NAME).catch(() => {});
    const handoffFileHandle = await getHandoff(HANDOFF_KEY_COLORIZE_FILE_HANDLE).catch(() => null);
    await deleteHandoff(HANDOFF_KEY_COLORIZE_FILE_HANDLE).catch(() => {});
    if (handoffFileHandle && typeof handoffFileHandle.createWritable === 'function') {
      ctx.painterVbpackSaveFileHandle = handoffFileHandle;
      ctx.loadedPackName = handoffFileHandle.name || ctx.loadedPackName;
    }
    // Drop ?from=emulator so refresh does not imply a fresh handoff is waiting.
    if (fromEmulator) {
      try {
        history.replaceState({}, '', location.pathname);
      } catch (_) {}
    }
    ctx.setStatus(
      ctx.currentState
        ? `Loaded from emulator (${ctx.packDisplayName}). Edit, then Save and Play to resume at this frame.`
        : `Pack loaded from emulator (${ctx.packDisplayName}) — no frame in pack. Use the Frame dropdown or open a pack with VIP state.`,
    );
    await ctx.offerProjectJournalRestore();
  } catch (err) {
    console.warn('[painter] Failed to load handoff pack:', err);
    ctx.setStatus(`Handoff error: ${err?.message || String(err)}`);
    if (fromEmulator && ctx.btnRetryHandoff) {
      ctx.btnRetryHandoff.style.display = 'inline-block';
      ctx.btnRetryHandoff.onclick = () => {
        if (ctx.btnRetryHandoff) ctx.btnRetryHandoff.style.display = 'none';
        void maybeLoadHandoffPack();
      };
    }
  }
}

/** Write updated pack to handoff and return to the emulator (restore Colorize! save state). */
export async function runPainterSaveAndPlay() {
  if (!ctx.loadedPackParts) {
    ctx.setStatus('Load a .vbpack first (or use Colorize! from the emulator).');
    return;
  }
  // Save and Play writes the pack before returning: its own file when we know it (keeping a .bak
  // copy), else project home, else one save dialog. It never silently creates a second .vbpack.
  const displayName = ctx.packDisplayName.replace(/ \(editing\)$/, '').trim() || 'this pack';
  await saveUi.begin('Save and Play', VBPACK_HANDOFF_STEPS);
  await saveUi.step('check');
  const prepared = await preparePainterVbpackParts({
    updateCurrentVip: true,
    onCollectStart: async () => {
      saveUi.finish('check');
      await saveUi.step('collect');
    },
  });
  if (!prepared.ok) {
    saveUi.abandon();
    return;
  }
  saveUi.finish('collect', `${ctx.pack.size} pack tile(s), ${ctx.groups.length} group(s)`);
  const { merged } = prepared;

  // Force ROM + save state from the Colorize! handoff / loaded pack (do not rely on spread alone).
  const romBuf = copyBinaryToArrayBuffer(ctx.loadedPackParts.rom) || copyBinaryToArrayBuffer(merged.rom);
  const saveBuf =
    copyBinaryToArrayBuffer(ctx.loadedPackParts.saveState) || copyBinaryToArrayBuffer(merged.saveState);
  if (!romBuf) {
    window.alert(
      'This pack has no ROM. Save and Play cannot restart the emulator.\n\n' +
        'Go back to the emulator, load a ROM or .vbpack, click Colorize! again, then Save and Play.',
    );
    ctx.setStatus('Save and Play blocked: pack has no ROM.');
    saveUi.abandon();
    return;
  }
  merged.rom = romBuf;
  if (saveBuf) {
    merged.saveState = saveBuf;
    if (!merged.saveStatesFolder?.length) {
      merged.saveStatesFolder = [{ name: 'current.state', buffer: saveBuf }];
    }
  } else {
    const cont = window.confirm(
      'This pack has no emulator save state. The game will likely boot from the title screen instead of your Colorize! frame. Continue anyway?',
    );
    if (!cont) {
      ctx.setStatus('Save and Play cancelled (no save state).');
      saveUi.abandon();
      return;
    }
  }
  if (
    !merged.saveStatesFolder?.length &&
    ctx.loadedPackParts.saveStatesFolder?.length
  ) {
    merged.saveStatesFolder = ctx.loadedPackParts.saveStatesFolder;
  }

  // Prefer a human name over placeholder gameId "vb-pack" for the returned pack / Last pack button.
  const niceName =
    (!/^vb-pack$/i.test(displayName) && displayName) ||
    (typeof merged.manifest?.romFileName === 'string'
      ? String(merged.manifest.romFileName).replace(/\.(vb|bin)$/i, '').trim()
      : '') ||
    'untitled-pack';
  if (merged.manifest && typeof merged.manifest === 'object') {
    if (!merged.manifest.gameId || /^vb-pack$/i.test(String(merged.manifest.gameId))) {
      merged.manifest.gameId = niceName;
    }
    if (!merged.manifest.name || /^vb-pack$/i.test(String(merged.manifest.name))) {
      merged.manifest.name = niceName;
    }
  }

  try {
    ctx.setStatus('Building pack for emulator…');
    await saveUi.step('zip');
    const blob = await buildArtPack(merged, {
      onUpdate: ({ percent, currentFile }) => {
        saveUi.update('zip', percent, currentFile);
      },
    });
    saveUi.finish('zip', formatByteSize(blob.size));
  ctx.packFileBytes = blob.size;
    await saveUi.step('write');
    const buffer = await blob.arrayBuffer();
    // Sanity: re-parse to confirm ROM + save state survived the zip round-trip.
    const check = await parseArtPack(buffer);
    const romOk = (check.rom?.byteLength ?? 0) > 0;
    const saveOk = (check.saveState?.byteLength ?? 0) > 0;
    if (!romOk) {
      window.alert('Internal error: built Save and Play pack is missing the ROM.');
      ctx.setStatus('Save and Play failed: ROM missing from built pack.');
      saveUi.end({ failedAt: 'write', message: 'The built pack is missing its ROM.' });
      return;
    }
    if (saveBuf && !saveOk) {
      window.alert('Internal error: built Save and Play pack is missing the save state.');
      ctx.setStatus('Save and Play failed: save state missing from built pack.');
      saveUi.end({ failedAt: 'write', message: 'The built pack is missing its save state.' });
      return;
    }
    // Always keep the work: overwrite the pack's own file, else write into project home, else ask once.
    let wrote = null;
    try {
      const saved = await ctx.savePainterVbpackBlob(blob, { saveAs: false });
      if (saved.ok) wrote = saved.name || ctx.getVbpackSaveSuggestedFileName();
    } catch (err) {
      console.warn('[painter] Save and Play could not write the pack:', err);
      window.alert(
        `Could not write the pack to disk (${err?.message || err}).\n\n` +
          'Returning to the emulator anyway — your changes are in the emulator and in Last pack, ' +
          'but use File → Save as… to write a file.',
      );
    }
    saveUi.finish('write');
    await saveUi.step('sync');
    await putHandoff(HANDOFF_KEY_SAVE_AND_PLAY, buffer);
    await putHandoff('save-and-play-pack-name', niceName);
    if (ctx.painterVbpackSaveFileHandle) {
      await putHandoff(HANDOFF_KEY_SAVE_AND_PLAY_FILE_HANDLE, ctx.painterVbpackSaveFileHandle).catch(() => {});
    } else {
      await deleteHandoff(HANDOFF_KEY_SAVE_AND_PLAY_FILE_HANDLE).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 400));
    const verify = await getHandoff(HANDOFF_KEY_SAVE_AND_PLAY);
    if (!verify || verify.byteLength === 0) {
      window.alert('Failed to store the Save and Play handoff. Try again.');
      ctx.setStatus('Save and Play handoff verify failed.');
      saveUi.end({ failedAt: 'write', message: 'The handoff could not be verified.' });
      return;
    }
    ctx.setStatus(
      `Returning to emulator… (${wrote ? `saved to ${wrote}` : 'in memory only — use File → Save to write a file'}` +
        `, rom ${(check.rom.byteLength / 1024).toFixed(0)} KB` +
        (saveOk ? `, save ${(check.saveState.byteLength / 1024).toFixed(1)} KB` : ', no save state') +
        ')',
    );
    ctx.leavePainterTo('/?from=painter');
  } catch (err) {
    console.warn('[painter] Save and Play failed:', err);
    saveUi.end({ failedAt: saveUi.runningStepId() || 'zip', message: `${err?.message || String(err)}` });
    ctx.setStatus(`Save and Play failed: ${err?.message || String(err)}`);
  }
}
