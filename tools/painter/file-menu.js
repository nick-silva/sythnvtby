/**
 * The Project tool's File and Frame menus: export for the player, import from another pack, clean
 * up frames (archive), and writing the .vbpack to disk. Split out of tools/painter.js, which passes in the state and functions it shares (initFileMenu).
 */
import { buildPlayPack, PLAY_PACK_EXTENSION } from '../../src/play-pack.js';
import { comparePacks, mergePacks } from '../../src/pack-merge.js';
import { splitFrames, archivePackParts, coverageOfStates, withArchivedCoverage, frameBytes } from '../../src/frame-cleanup.js';
import { analyzeFrames, chooseFramesToRemove } from './frame-cleanup-ui.js';
import { measureUncoloured } from '../../src/uncoloured.js';
import { deserializeVIPState } from '../../src/vip-dump.js';
import { parseArtPack, buildArtPack, artPackPartsFromParsed } from '../../src/art-pack.js';
import { getUsableHomeDirectory, pickOpenVbpackFile, pickSaveVbpackFile, writeBlobToFileHandle, writeBlobToHomeDirectory, writeBackupCopy, normalizeVbpackFileName } from '../../src/project-home.js';
import { formatPaintToolFrameLabelFromRegistry } from './frame-registry.js';
import { readReturnState } from '../shared/project-return.js';
import { REFERENCE_CURSORS, addColorizedReferenceFromFile, applyReferenceDrag, clientToFrameFloat, commitReferenceTransform, fillSelectionFromReference, frameToCanvasMapping, referenceHandleAt, referenceRectInFrame, removeActiveReference, revertReferenceTransform, setReferenceTransformMode } from './reference-images.js';
import { copyFrameReference, exportCurrentFrameScreenshot, goToFrameTyped, openFrameDetailsDialog, saveFrameDetailsFromDialog, updateFrameMenuState } from './frame-actions.js';
import { updateSelectionUi } from './selection.js';
import { formatByteSize } from './paint-inventory-ui.js';
import { captureProjectReturnState, preparePainterVbpackParts, restoreProjectView } from './save.js';
import { paintForMeasure } from './frame-list.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initFileMenu(context) {
  ctx = context;
  wireFrameMenu();
}

export function closePainterFileMenu() {
  if (ctx.fileMenu) ctx.fileMenu.open = false;
  if (ctx.frameMenu) ctx.frameMenu.open = false;
}

/** Frame menu: per-frame utilities (export the capture, bring a colorized one back, name it). */
function wireFrameMenu() {
  if (ctx.frameMenu) {
    ctx.frameMenu.addEventListener('toggle', () => {
      if (!ctx.frameMenu.open) return;
      if (ctx.fileMenu) ctx.fileMenu.open = false;
      updateFrameMenuState();
    });
  }
  ctx.frameMenuExportShot?.addEventListener('click', () => {
    closePainterFileMenu();
    void exportCurrentFrameScreenshot();
  });
  ctx.frameMenuAddReference?.addEventListener('click', () => {
    closePainterFileMenu();
    if (ctx.referenceInput) {
      ctx.referenceInput.value = '';
      ctx.referenceInput.click();
    }
  });
  ctx.frameMenuRemoveReference?.addEventListener('click', () => {
    closePainterFileMenu();
    removeActiveReference();
  });
  ctx.frameMenuRename?.addEventListener('click', () => {
    closePainterFileMenu();
    openFrameDetailsDialog('name');
  });
  document.getElementById('frame-menu-copy-ref')?.addEventListener('click', () => {
    closePainterFileMenu();
    void copyFrameReference();
  });
  document.getElementById('frame-menu-go-to')?.addEventListener('click', () => {
    closePainterFileMenu();
    goToFrameTyped();
  });
  ctx.frameMenuTags?.addEventListener('click', () => {
    closePainterFileMenu();
    openFrameDetailsDialog('tags');
  });
  ctx.referenceInput?.addEventListener('change', (e) => {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (file) void addColorizedReferenceFromFile(file);
  });
  ctx.toggleReferenceOverlay?.addEventListener('change', () => {
    ctx.referenceOverlayEnabled = !!ctx.toggleReferenceOverlay.checked;
    ctx.render();
  });
  ctx.frameDetailsForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveFrameDetailsFromDialog();
    ctx.frameDetailsDialog?.close();
  });
  ctx.frameDetailsCancel?.addEventListener('click', () => ctx.frameDetailsDialog?.close());

  ctx.btnReferenceTransform?.addEventListener('click', () => setReferenceTransformMode(!ctx.referenceTransformMode));
  document.getElementById('btn-reference-fill-selection')?.addEventListener('click', fillSelectionFromReference);
  ctx.btnReferenceRevert?.addEventListener('click', () => revertReferenceTransform());

  // Dragging the reference: the canvas keeps the pointer until the button comes back up.
  const canvasForReference = ctx.canvasWrap;
  canvasForReference?.addEventListener('pointermove', (e) => {
    if (!ctx.referenceTransformMode || !ctx.canvas) return;
    const { fx, fy } = clientToFrameFloat(e, ctx.canvas);
    if (ctx.referenceDrag) {
      applyReferenceDrag(fx, fy);
      ctx.render();
      return;
    }
    const { kx } = frameToCanvasMapping(ctx.canvas.width, ctx.canvas.height);
    const handle = referenceHandleAt(fx, fy, 6 / Math.max(0.0001, kx));
    canvasForReference.style.cursor = handle ? REFERENCE_CURSORS[handle] || 'move' : '';
  });
  const endReferenceDrag = (e) => {
    if (!ctx.referenceDrag) return;
    try {
      canvasForReference?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    ctx.referenceDrag = null;
    commitReferenceTransform();
    const rect = referenceRectInFrame();
    if (rect) {
      ctx.setStatus(`Reference at ${Math.round(rect.x)},${Math.round(rect.y)} · ${Math.round(rect.w)}×${Math.round(rect.h)} px. Save the pack to keep it.`);
    }
    ctx.render();
  };
  canvasForReference?.addEventListener('pointerup', endReferenceDrag);
  canvasForReference?.addEventListener('pointercancel', endReferenceDrag);

  // Leaving for the emulator throws away everything unsaved, so it asks first.
  document.getElementById('btn-goto-emulator')?.addEventListener('click', () => {
    if (ctx.hasUnsavedPainterEdits()) {
      const ok = window.confirm('Leave for the emulator?\n\nUnsaved changes in this pack (paint, groups, references, frame details) will be lost. Save or Save and Play first to keep them.');
      if (!ok) return;
      void ctx.clearProjectJournal().finally(() => ctx.leavePainterTo('/'));
      return;
    }
    ctx.leavePainterTo('/');
  });
}


export function clearPainterVbpackSaveFileHandle() {
  ctx.painterVbpackSaveFileHandle = null;
}

/**
 * File ▸ Export for player…: a play pack (src/play-pack.js) of the project as it is now, saved
 * edits or not — the colours, groups and pictures, without the ROM or the captures.
 */
export async function exportForPlayer() {
  if (!ctx.loadedPackParts) {
    ctx.setStatus('Open a .vbpack first.');
    return;
  }
  const base = getVbpackSaveSuggestedFileName().replace(/\.vbpack$/i, '').replace(/-annotated$/i, '');
  const title = window.prompt('Title the player shows for this game:', base.replace(/[-_]+/g, ' '));
  if (title == null) return;
  ctx.setStatus('Exporting for the player…');
  try {
    const prepared = await preparePainterVbpackParts({ updateCurrentVip: false });
    if (!prepared.ok) {
      ctx.setStatus(prepared.cancelled ? 'Export for player cancelled.' : 'Export for player stopped: the project did not pass its checks.');
      return;
    }
    const { bytes, info } = await buildPlayPack(prepared.merged, { title: title.trim() || base });
    ctx.downloadBlob(new Blob([bytes], { type: 'application/zip' }), `${base}${PLAY_PACK_EXTENSION}`);
    ctx.setStatus(`Exported “${info.title}” for the player: ${base}${PLAY_PACK_EXTENSION} (${formatByteSize(bytes.length)}, no ROM inside). Open it in the player with the game’s ROM.`);
  } catch (err) {
    ctx.setStatus(`Could not export for the player: ${err?.message || err}`);
  }
}

/** One heading and list for the import summary; `items` are plain text. */
function importSummaryList(title, items) {
  const section = document.createElement('div');
  const h = document.createElement('h3');
  h.textContent = title;
  const ul = document.createElement('ul');
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  }
  section.append(h, ul);
  return section;
}

const countOf = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const GROUP_PICTURE_LABELS = { overpaint: 'overpaint', layerArt: 'layer art', touchUp: 'touch-up', shadeRamp: 'shade ramp' };

/** One line for a group both packs have: what the other pack would add to it. */
function importGroupLine(g) {
  const bits = [];
  if (g.posesOnlyTheirs.length) bits.push(`poses ${g.posesOnlyTheirs.map((n) => `“${n}”`).join(', ')}`);
  if (g.posesSharingAnId.length) bits.push(`${countOf(g.posesSharingAnId.length, 'different pose')} under an id this project uses (both kept)`);
  if (g.tilesOnlyTheirs) bits.push(countOf(g.tilesOnlyTheirs, 'painted tile'));
  if (g.tileClashes) bits.push(`${countOf(g.tileClashes, 'tile')} painted differently`);
  if (g.criteriaAdds) bits.push(countOf(g.criteriaAdds, 'criteria entry', 'criteria entries'));
  if (g.tracksOnlyTheirs) bits.push(countOf(g.tracksOnlyTheirs, 'animation'));
  for (const p of g.pictures) bits.push(`${GROUP_PICTURE_LABELS[p.key] || p.key}${p.clash ? ' (both have one)' : ''}`);
  return `${g.name}: ${bits.join('; ')}`;
}

/** Fill the import dialog from {@link comparePacks}. */
function renderImportSummary(cmp, otherName) {
  const host = document.getElementById('import-pack-summary');
  const intro = document.getElementById('import-pack-intro');
  if (!host || !intro) return;
  host.textContent = '';
  const romNote = cmp.sameRom === false ? ' Warning: it was made from a different ROM, so its tiles may not be this game’s.' : '';
  intro.textContent = cmp.nothingToImport
    ? `“${otherName}” has nothing this project lacks.${romNote}`
    : `What “${otherName}” would add to this project.${romNote}`;
  if (cmp.groupsOnlyTheirs.length) {
    const lines = cmp.groupsOnlyTheirs.map((g) => `${g.name}: ${countOf(g.poses, 'pose')}, ${countOf(g.tiles, 'painted tile')}`);
    host.append(importSummaryList(`New groups (${lines.length})`, lines));
  }
  if (cmp.groups.length) host.append(importSummaryList(`Groups both packs have (${cmp.groups.length})`, cmp.groups.map(importGroupLine)));
  const other = [];
  if (cmp.framesOnlyTheirs) other.push(countOf(cmp.framesOnlyTheirs, 'captured frame'));
  if (cmp.referencesOnlyTheirs) other.push(countOf(cmp.referencesOnlyTheirs, 'reference picture'));
  if (cmp.spriteColoursOnlyTheirs) other.push(countOf(cmp.spriteColoursOnlyTheirs, 'sprite colour'));
  if (cmp.spriteColourClashes) other.push(`${countOf(cmp.spriteColourClashes, 'sprite tile')} painted differently`);
  if (cmp.overridesOnlyTheirs) other.push(countOf(cmp.overridesOnlyTheirs, 'position override'));
  if (other.length) host.append(importSummaryList('Also', other));
  const clash = document.getElementById('import-pack-clash');
  const legend = document.getElementById('import-pack-clash-legend');
  if (clash) clash.hidden = !cmp.clashes;
  if (legend) legend.textContent = `Where both packs have something different (${cmp.clashes})`;
  const keepMine = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="import-clash"][value="mine"]'));
  if (keepMine) keepMine.checked = true;
  const confirm = /** @type {HTMLButtonElement|null} */ (document.getElementById('import-pack-confirm'));
  if (confirm) confirm.disabled = cmp.nothingToImport;
}

/** Show the import dialog; resolves to the clash choice ('mine' | 'theirs'), or null when cancelled. */
function askImportChoice() {
  const dialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('import-pack-dialog'));
  if (!dialog) return Promise.resolve(null);
  return new Promise((resolve) => {
    const confirm = document.getElementById('import-pack-confirm');
    const cancel = document.getElementById('import-pack-cancel');
    const done = (value) => {
      confirm?.removeEventListener('click', onConfirm);
      cancel?.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onConfirm = () => {
      const picked = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="import-clash"]:checked'));
      done(picked?.value === 'theirs' ? 'theirs' : 'mine');
    };
    const onCancel = () => done(null);
    confirm?.addEventListener('click', onConfirm);
    cancel?.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}

/**
 * File ▸ Import from another pack…: merge another .vbpack's work into the open project
 * (src/pack-merge.js). The project reloads with the result, unsaved, on the same frame and group,
 * and Save still writes to the file it was opened from.
 */
export async function importFromAnotherPack(buffer, otherName) {
  if (!ctx.loadedPackParts) {
    ctx.setStatus('Open a .vbpack first.');
    return;
  }
  ctx.setStatus(`Reading “${otherName}”…`);
  let theirs;
  try {
    theirs = artPackPartsFromParsed(await parseArtPack(buffer));
  } catch (err) {
    ctx.setStatus(`Could not read “${otherName}”: ${err?.message || err}`);
    return;
  }
  const prepared = await preparePainterVbpackParts({ updateCurrentVip: false });
  if (!prepared.ok) {
    ctx.setStatus(prepared.cancelled ? 'Import cancelled.' : 'Import stopped: this project did not pass its checks.');
    return;
  }
  renderImportSummary(comparePacks(prepared.merged, theirs), otherName);
  const clash = await askImportChoice();
  if (!clash) {
    ctx.setStatus('Import cancelled.');
    return;
  }
  ctx.setStatus(`Importing from “${otherName}”…`);
  let merged;
  try {
    merged = mergePacks(prepared.merged, theirs, { clash });
    merged.blob = await buildArtPack(merged.parts);
  } catch (err) {
    ctx.setStatus(`Import failed: ${err?.message || err}. This project is unchanged.`);
    return;
  }
  const view = readReturnState(captureProjectReturnState());
  await ctx.loadVbpackBuffer(await merged.blob.arrayBuffer(), ctx.loadedPackName);
  if (view) restoreProjectView(view);
  ctx.groupsDirty = true;
  updateSelectionUi();
  const { log } = merged;
  console.info(`[painter] imported from ${otherName}:\n${log.join('\n')}`);
  const more = log.length > 3 ? ` (+${log.length - 3} more in the console)` : '';
  ctx.setStatus(`Imported from “${otherName}”: ${log.slice(0, 3).join(' ')}${more} Not saved yet — Save to keep it.`);
}

export async function importFromAnotherPackFromMenu() {
  const picked = await pickOpenVbpackFile();
  if (picked.status === 'ok') {
    await importFromAnotherPack(picked.buffer, picked.name);
    return;
  }
  if (picked.status === 'aborted') return;
  document.getElementById('file-import-vbpack')?.click();
}

/**
 * Write the archive of cleaned-out frames where the person chooses (a download where the browser
 * cannot ask). Resolves to the file name, or null when cancelled or it could not be written.
 */
async function writeFrameArchive(parts) {
  const date = new Date().toISOString().slice(0, 10);
  const name = `${getVbpackSaveSuggestedFileName().replace(/\.vbpack$/i, '')}-frames-${date}.vbpack`;
  const blob = await buildArtPack(parts);
  const picked = await pickSaveVbpackFile(name);
  if (picked.status === 'aborted') return null;
  if (picked.status === 'ok') {
    await writeBlobToFileHandle(picked.handle, blob);
    return picked.handle.name || name;
  }
  ctx.downloadBlob(blob, name);
  return name;
}

/**
 * File ▸ Clean up frames…: take captured frames out of the project (src/frame-cleanup.js),
 * archived into a separate .vbpack first or deleted. The project reloads, unsaved, on the same
 * frame (if it stayed) and group; Save writes the file it was opened from.
 */
export async function cleanUpFrames() {
  if (!ctx.loadedPackParts) {
    ctx.setStatus('Open a .vbpack first.');
    return;
  }
  const prepared = await preparePainterVbpackParts({ updateCurrentVip: false });
  if (!prepared.ok) {
    ctx.setStatus(prepared.cancelled ? 'Clean up cancelled.' : 'Clean up stopped: this project did not pass its checks.');
    return;
  }
  const parts = prepared.merged;
  ctx.setStatus(`Looking through ${(parts.vipStatesFolder || []).length} captured frame(s)…`);
  await new Promise((r) => setTimeout(r, 0));
  const paint = paintForMeasure();
  const analysis = analyzeFrames(
    parts,
    (entry, vipFile) => formatPaintToolFrameLabelFromRegistry(entry, vipFile),
    (state) => measureUncoloured(state, paint),
  );
  if (!analysis.items.length) {
    ctx.setStatus('This project has no captured frames to clean up.');
    return;
  }
  const choice = await chooseFramesToRemove(analysis, formatByteSize);
  if (!choice?.ids.length) {
    ctx.setStatus('Clean up cancelled — no frames were removed.');
    return;
  }
  const bytes = choice.ids.reduce((n, id) => n + frameBytes(parts, id), 0);
  let next;
  let archivedTo = null;
  try {
    const { kept, removed, count } = splitFrames(parts, choice.ids);
    // Auto-capture must still count what these frames showed as captured.
    const states = (removed.vipStatesFolder || []).map((f) => {
      try {
        return deserializeVIPState(JSON.parse(f.json));
      } catch {
        return null;
      }
    });
    kept.manifest = withArchivedCoverage(kept.manifest, coverageOfStates(states));
    if (choice.action === 'archive') {
      ctx.setStatus(`Archiving ${count} frame(s)…`);
      archivedTo = await writeFrameArchive(archivePackParts(parts.manifest, removed, { from: ctx.loadedPackName }));
      if (!archivedTo) {
        ctx.setStatus('Archive cancelled — no frames were removed.');
        return;
      }
    }
    next = { count, blob: await buildArtPack(kept) };
  } catch (err) {
    ctx.setStatus(`Clean up failed: ${err?.message || err}. This project is unchanged.`);
    return;
  }
  const view = readReturnState(captureProjectReturnState());
  await ctx.loadVbpackBuffer(await next.blob.arrayBuffer(), ctx.loadedPackName);
  if (view) restoreProjectView(view);
  ctx.groupsDirty = true;
  updateSelectionUi();
  const where = archivedTo ? `archived to ${archivedTo} (File ▸ Import from another pack brings them back)` : 'deleted';
  ctx.setStatus(`Took ${next.count} frame(s) out (${formatByteSize(bytes)} before compression), ${where}. Not saved yet — Save to keep it.`);
}

export function getVbpackSaveSuggestedFileName() {
  const base = (ctx.loadedPackName || 'pack.vbpack').trim() || 'pack.vbpack';
  return normalizeVbpackFileName(base);
}

/**
 * @param {Blob} blob
 * @param {{ saveAs: boolean, picked?: any }} opts `picked`: the Save As dialog's answer, asked during the click
 * @returns {Promise<{ ok: boolean; mode: string; name?: string }>}
 */
export async function savePainterVbpackBlob(blob, opts) {
  const { saveAs } = opts;
  const suggestedName = normalizeVbpackFileName(getVbpackSaveSuggestedFileName());
  if (!saveAs && ctx.painterVbpackSaveFileHandle && typeof ctx.painterVbpackSaveFileHandle.createWritable === 'function') {
    // A failed write is reported as one (the caller's save window says so); never quietly fall
    // back to a same-named file in the project home, which would be a different .vbpack.
    const home = await getUsableHomeDirectory('readwrite');
    const backup = await writeBackupCopy(ctx.painterVbpackSaveFileHandle, home);
    await writeBlobToFileHandle(ctx.painterVbpackSaveFileHandle, blob);
    return { ok: true, mode: 'overwrite', name: ctx.painterVbpackSaveFileHandle.name || suggestedName, backup };
  }
  // Save (without Save As): prefer writing into project home under the pack name when we have no file handle.
  if (!saveAs) {
    const home = await getUsableHomeDirectory('readwrite');
    if (home) {
      try {
        const fileHandle = await writeBlobToHomeDirectory(home, blob, suggestedName);
        ctx.painterVbpackSaveFileHandle = fileHandle;
        ctx.loadedPackName = fileHandle.name || suggestedName;
        return { ok: true, mode: 'home', name: ctx.loadedPackName };
      } catch (err) {
        console.warn('[painter] Could not write to project home, falling back:', err);
      }
    }
    ctx.downloadBlob(blob, suggestedName);
    return { ok: true, mode: 'download', name: suggestedName };
  }
  const picked = opts.picked || (await pickSaveVbpackFile(suggestedName));
  if (picked.status === 'ok') {
    try {
      await writeBlobToFileHandle(picked.handle, blob);
      ctx.painterVbpackSaveFileHandle = picked.handle;
      const name = picked.handle.name || suggestedName;
      ctx.loadedPackName = name;
      return { ok: true, mode: 'picked', name };
    } catch (err) {
      console.warn('[painter] Write to Save As handle failed:', err);
    }
  } else if (picked.status === 'aborted') {
    return { ok: false, mode: 'aborted' };
  } else if (picked.status === 'error') {
    console.warn('[painter] showSaveFilePicker failed:', picked.error);
  }
  ctx.downloadBlob(blob, suggestedName);
  return { ok: true, mode: 'download', name: suggestedName };
}
