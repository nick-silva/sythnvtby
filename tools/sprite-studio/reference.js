/**
 * SpriteStudio's reference images: a picture to paint from, laid over the stage, kept per pack
 * and frame. Split out of tools/sprite-studio.js, which passes in the state and functions it shares
 * (initReference).
 */
import { frameState, packRgbaForHash, paintTargetGroupFor } from '../shared/pack-session.js';
import { normalizeReferences, referenceForFrame } from '../../src/frame-metadata.js';
import { fillTilesFromReference } from '../../src/reference-fill.js';
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { isObjGroup } from '../../src/obj-sprite-profiles.js';
import { placePoseTile } from '../../src/pose-mirror.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initReference(context) {
  ctx = context;
}

/* -------------------------------------------------------------- reference */

/** Read the references out of the loaded pack; images become object URLs on demand. */
export function primeReferences() {
  for (const entry of ctx.referenceStore.values()) URL.revokeObjectURL(entry.url);
  ctx.referenceStore = new Map();
  ctx.activeReference = null;
  const refs = normalizeReferences(ctx.session?.manifest?.references);
  const files = Array.isArray(ctx.session?.parsed?.referencesFolder) ? ctx.session.parsed.referencesFolder : [];
  const byId = new Map(files.map((f) => [String(f.name || '').replace(/\.png$/i, ''), f.buffer]));
  for (const meta of refs.items) {
    const buffer = byId.get(meta.refId);
    if (!(buffer instanceof ArrayBuffer)) continue;
    ctx.referenceStore.set(meta.refId, { meta, url: URL.createObjectURL(new Blob([buffer], { type: 'image/png' })), image: null });
  }
  ctx.referenceStore.refs = refs;
}

/**
 * The game state a frame belongs to. The Project tool scopes a reference by memory pool;
 * matching pools needs WRAM, which this page does not load, so a pool-scoped reference is
 * matched through the captured state name of the frame it was made from.
 */
function stateNameOfFrame(frameIndex) {
  const e = ctx.session?.frames?.[frameIndex]?.registryEntry;
  return e ? [e.stateName, e.subStateName].filter(Boolean).join(' / ') : '';
}

export function refreshActiveReference() {
  const view = ctx.poseViews[ctx.poseIndex];
  const frameIndex = view?.frameIndex ?? -1;
  const entry = frameIndex >= 0 ? ctx.session?.frames?.[frameIndex]?.registryEntry : null;
  const frameId = typeof entry?.frameId === 'string' ? entry.frameId : '';
  const refs = ctx.referenceStore.refs || { items: [], active: {} };

  // Every reference that could apply here — a state may hold several concept variants.
  const want = frameIndex >= 0 ? stateNameOfFrame(frameIndex) : '';
  const applicable = refs.items.filter((r) => {
    if (frameId && r.scope === 'frame' && r.scopeId === frameId) return true;
    const from = ctx.session.frames.findIndex((f) => f.registryEntry?.frameId === r.sourceFrameId);
    return from >= 0 && !!want && stateNameOfFrame(from) === want;
  });
  renderReferencePicker(applicable);
  let meta = (ctx.chosenReferenceId && applicable.find((r) => r.refId === ctx.chosenReferenceId))
    || (frameId ? referenceForFrame(refs, { frameId }) : null)
    || applicable[0]
    || null;
  // A reference is placed in frame coordinates, for the frame it was made from. A background
  // sits still across a state's frames, so a state-scoped reference still lines up with a BG
  // group. A sprite does not: on another frame it stands somewhere else, and sampling would
  // take the colours of whatever happened to be at that spot. That is context, not alignment.
  const sameFrame = !meta?.sourceFrameId || meta.sourceFrameId === frameId;
  const backgroundGroup = !!ctx.selectedGroup && !isObjGroup(ctx.selectedGroup) && meta?.scope === 'pool';
  ctx.referenceIsForAnotherFrame = !!meta && !sameFrame && !backgroundGroup;
  const stored = meta ? ctx.referenceStore.get(meta.refId) : null;
  if (!stored) {
    ctx.activeReference = null;
    updateReferenceUi();
    return;
  }
  const transform = {
    scale: Number(meta.transform?.scale) > 0 ? Number(meta.transform.scale) : 1,
    dx: Number(meta.transform?.dx) || 0,
    dy: Number(meta.transform?.dy) || 0,
  };
  if (stored.image) {
    ctx.activeReference = { meta, image: stored.image, transform };
    updateReferenceUi();
    ctx.drawStage();
    return;
  }
  const img = new Image();
  img.onload = () => {
    stored.image = img;
    ctx.activeReference = { meta, image: img, transform };
    updateReferenceUi();
    ctx.drawStage();
  };
  img.onerror = () => {
    ctx.activeReference = null;
    updateReferenceUi();
  };
  img.src = stored.url;
}

/** Only worth showing when a state has more than one reference to choose between. */
function renderReferencePicker(applicable) {
  const pick = ctx.el('reference-pick');
  pick.hidden = applicable.length < 2;
  if (pick.hidden) {
    pick.textContent = '';
    return;
  }
  pick.textContent = '';
  for (const r of applicable) {
    const o = document.createElement('option');
    o.value = r.refId;
    o.textContent = r.originalName || r.refId;
    pick.append(o);
  }
  if (ctx.chosenReferenceId && applicable.some((r) => r.refId === ctx.chosenReferenceId)) pick.value = ctx.chosenReferenceId;
}

export function updateReferenceUi() {
  const has = !!ctx.activeReference;
  const toggle = /** @type {HTMLInputElement} */ (ctx.el('toggle-reference'));
  toggle.disabled = !has;
  if (!has) toggle.checked = false;
  const aligned = has && !ctx.referenceIsForAnotherFrame;
  const canFill = aligned && !!ctx.poseViews[ctx.poseIndex]?.origin;
  ctx.el('btn-reference-fill').disabled = !canFill;
  ctx.el('btn-reference-palette').disabled = !canFill;
  // Side by side and Paste into box compare two placements; with a foreign reference there is
  // nothing meaningful to compare, so they are switched off rather than quietly misleading.
  const sbs = /** @type {HTMLInputElement} */ (ctx.el('toggle-side-by-side'));
  sbs.disabled = !aligned;
  if (!aligned && sbs.checked) sbs.checked = false;
  ctx.el('btn-reference-fill').textContent = ctx.selectedGroup && isObjGroup(ctx.selectedGroup) ? 'Fill pose from reference' : 'Fill group from reference';
  const name = ctx.el('reference-name');
  if (!ctx.session) name.textContent = 'Load a pack';
  else if (!has) name.textContent = 'No reference for this frame — add one in the Project tool';
  else {
    const m = ctx.activeReference.meta;
    name.textContent = ctx.referenceIsForAnotherFrame
      ? `${m.originalName || m.refId} — from another frame: colours only, not aligned here`
      : `${m.originalName || m.refId}${m.scope === 'pool' ? ' · this game state' : ' · this frame'}`;
  }
  ctx.el('reference-coverage').textContent = canFill ? referenceCoverageText() : '';
}

/** How much of this group the reference actually reaches — when to go get a second one. */
function referenceCoverageText() {
  const { placements, patterns } = currentGroupPlacements();
  const image = ctx.referenceImageData();
  if (!image || !placements.length) return '';
  const out = fillTilesFromReference(image, placements, (hash) => patterns.get(hash) || null);
  const total = patterns.size || 1;
  const pct = Math.round((out.patterns / total) * 100);
  const conflicts = out.conflicts.length ? ` · ${out.conflicts.length} conflict(s)` : '';
  return `covers ${pct}% of this ${ctx.selectedGroup && isObjGroup(ctx.selectedGroup) ? 'pose' : 'group'} · ${out.patterns}/${total} pattern(s), ${placements.length} tile(s)${conflicts}`;
}

/** Every drawn copy of this group's tiles on its own frame, with flips — what gets sampled. */
export function currentGroupPlacements() {
  const view = ctx.poseViews[ctx.poseIndex];
  if (!view?.origin || view.frameIndex < 0) return { placements: [], patterns: new Map() };
  const state = frameState(ctx.session, view.frameIndex);
  if (!state?.drawList?.length || !state.patternTable) return { placements: [], patterns: new Map() };
  const wanted = new Map();
  for (const t of view.pose.tiles || []) {
    const at = placePoseTile(t, view.origin);
    wanted.set(`${at.x},${at.y}`, t.hash >>> 0);
  }
  const placements = [];
  const patterns = new Map();
  for (const d of state.drawList) {
    if ((d.eye ?? 0) !== ctx.eye()) continue;
    const want = wanted.get(`${d.x},${d.y}`);
    if (want === undefined) continue;
    const bytes = getTileBytes(state.patternTable, d.tileIndex);
    if (!bytes || (hashTile(bytes) >>> 0) !== want) continue;
    placements.push({ hash: want, x: d.x, y: d.y, flipH: !!d.flipH, flipV: !!d.flipV });
    if (!patterns.has(want)) patterns.set(want, { bytes, shades: shadesOfTile(bytes) });
  }
  return { placements, patterns };
}

/** The 64 shades of a tile, in pattern order — 2 bits per pixel, 2 bytes per row. */
function shadesOfTile(bytes) {
  const shades = new Uint8Array(64);
  for (let py = 0; py < 8; py++) {
    const word = bytes[py * 2] | (bytes[py * 2 + 1] << 8);
    for (let px = 0; px < 8; px++) shades[py * 8 + px] = (word >> (px * 2)) & 3;
  }
  return shades;
}

export function fillFromReference() {
  if (!ctx.activeReference) return;
  // Per-pattern paint would sit under the group's overlay paint and never show.
  if (ctx.hasOverlayPaint(ctx.selectedGroup) && !ctx.offerToClearOverlay(ctx.selectedGroup)) return;
  const { placements, patterns } = currentGroupPlacements();
  if (!placements.length) {
    ctx.setStatus('Nothing to fill — this group has no tiles on its frame.');
    return;
  }
  const image = ctx.referenceImageData();
  if (!image) return;
  const out = fillTilesFromReference(image, placements, (hash) => patterns.get(hash) || null);
  if (!out.tiles.size) {
    ctx.setStatus('The reference does not reach any of this group’s tiles.');
    return;
  }
  applyFilledTiles(out, patterns);
  const conflicts = out.conflicts.length ? ` · ${out.conflicts.length} pattern(s) had copies coloured differently (majority used)` : '';
  const missed = out.skipped ? ` · ${out.skipped} not covered` : '';
  // A reference that is dark or misaligned here paints near-black and looks like nothing
  // happened, so say so rather than leave it a mystery.
  const dark = ctx.meanBrightness(out.tiles) < 24 ? ' · what it took is almost black — check the reference is the colorized image and lines up' : '';
  ctx.setStatus(`Filled ${out.patterns} tile pattern(s) from ${out.placements} tile(s)${conflicts}${missed}${dark}. Undo puts it back.`);
}

/** Write filled tiles into the pack as one undo entry, like a paint stroke. */
export function applyFilledTiles(out, patterns) {
  const snapshot = new Map();
  for (const [hash, rgba] of out.tiles) {
    const existing = ctx.paintStore().get(hash);
    snapshot.set(hash, existing ? Uint8Array.from(existing) : null);
    packRgbaForHash(ctx.session, hash, patterns.get(hash).bytes, paintTargetGroupFor(ctx.selectedGroup)).set(rgba);
  }
  ctx.pushUndo({ groupId: paintTargetGroupFor(ctx.selectedGroup)?.id ?? null, map: snapshot });
  if (ctx.undoStack.length > 50) ctx.undoStack.shift();
  ctx.el('btn-undo').disabled = false;
  ctx.markDirty();
  ctx.invalidateRender();
  ctx.drawStage();
  ctx.renderStrip();
  ctx.renderPalette();
  updateReferenceUi();
}
