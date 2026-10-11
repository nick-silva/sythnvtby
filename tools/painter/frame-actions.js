/**
 * The Project tool's Frame menu actions — export screenshot, frame details (name and tags), copy
 * reference, go to frame — and the screenshot and reference overlays drawn on the canvas. Split out of tools/painter.js, which passes in the state and functions it shares
 * (initFrameActions).
 */
import { frameReference, findFrame } from '../../src/frame-numbers.js';
import { frameDisplayName, frameTags, parseTags, updateFrameEntry } from '../../src/frame-metadata.js';
import { formatPaintToolFrameLabelFromRegistry } from './frame-registry.js';
import { frameToCanvasMapping, referenceRectInFrame, updateReferenceUi } from './reference-images.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initFrameActions(context) {
  ctx = context;
}

export async function exportCurrentFrameScreenshot() {
  const i = ctx.getCurrentFrameSelectIndex();
  const url = i == null ? null : resolveScreenshotUrlForFrameIndex(i);
  if (!url) {
    ctx.setStatus('This frame has no captured screenshot.');
    return;
  }
  const ent = ctx.availableFrames[i]?.frameRegistryEntry;
  const name = frameDisplayName(ent, ctx.availableFrames[i]?.label || 'frame');
  const safe = `${ctx.loadedVbcolorGameId || 'vbpack'}__${name}`.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-');
  try {
    const blob = await (await fetch(url)).blob();
    ctx.downloadBlob(blob, `${safe}.png`);
    ctx.setStatus(`Exported ${safe}.png — colorize it, then Frame ▸ Add colorized reference…`);
  } catch (err) {
    ctx.setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function openFrameDetailsDialog(focusField) {
  const i = ctx.getCurrentFrameSelectIndex();
  if (i == null || !ctx.frameDetailsDialog) return;
  const ent = ctx.availableFrames[i]?.frameRegistryEntry;
  const frameId = typeof ent?.frameId === 'string' ? ent.frameId.trim() : '';
  if (!frameId) {
    ctx.setStatus('This frame has no id in the pack, so it cannot be named yet.');
    return;
  }
  if (ctx.frameDetailsSummary) {
    const state = [ent?.stateName, ent?.subStateName].filter(Boolean).join(' / ') || '(no captured state)';
    ctx.frameDetailsSummary.textContent = `Captured as ${state} · ${frameId}`;
  }
  if (ctx.frameDetailsName) ctx.frameDetailsName.value = typeof ent?.name === 'string' ? ent.name : '';
  if (ctx.frameDetailsTags) ctx.frameDetailsTags.value = frameTags(ent).join(', ');
  ctx.frameDetailsDialog.showModal();
  const focus = focusField === 'tags' ? ctx.frameDetailsTags : ctx.frameDetailsName;
  if (focus) focus.focus();
}

export function saveFrameDetailsFromDialog() {
  const i = ctx.getCurrentFrameSelectIndex();
  const ent = i == null ? null : ctx.availableFrames[i]?.frameRegistryEntry;
  const frameId = typeof ent?.frameId === 'string' ? ent.frameId.trim() : '';
  if (!frameId) return;
  const name = ctx.frameDetailsName ? ctx.frameDetailsName.value : '';
  const tags = ctx.frameDetailsTags ? ctx.frameDetailsTags.value : '';
  ctx.lastFrameRegistry = updateFrameEntry(ctx.lastFrameRegistry || [], frameId, { name, tags });
  const updated = (ctx.lastFrameRegistry || []).find((e) => String(e?.frameId || '') === frameId) || null;
  // availableFrames holds its own copy of the entry, and its label is what the picker shows.
  for (const row of ctx.availableFrames) {
    if (String(row?.frameRegistryEntry?.frameId || '') !== frameId) continue;
    row.frameRegistryEntry = updated;
    const label = formatPaintToolFrameLabelFromRegistry(updated, row.vipFile);
    row.label = row.label.startsWith('Current — ') ? `Current — ${label}` : label;
  }
  ctx.frameRegistryDirty = true;
  const keep = ctx.frameSelect ? ctx.frameSelect.value : '0';
  ctx.populateFrames();
  if (ctx.frameSelect) ctx.frameSelect.value = keep;
  updateFrameMenuState();
  ctx.setStatus(`Frame details saved${parseTags(tags).length ? ` (${parseTags(tags).length} tag(s))` : ''}. Save the pack to keep them.`);
}

/** Frame ▸ Copy reference: "#57 · InGame · f-…" on the clipboard, for a note or a message. */
export async function copyFrameReference() {
  const i = ctx.getCurrentFrameSelectIndex();
  const row = i == null ? null : ctx.availableFrames[i];
  if (!row) return;
  const ref = row.frameRegistryEntry ? frameReference(row.frameRegistryEntry) : row.label;
  try {
    await navigator.clipboard.writeText(ref);
    ctx.setStatus(`Copied “${ref}”.`);
  } catch {
    window.prompt('Copy this reference:', ref);
  }
}

/** Frame ▸ Go to frame…: a number (#57), a name, or an id — a typo or two in an id is forgiven. */
export function goToFrameTyped() {
  const typed = window.prompt('Go to frame — its number (#57), name or id:', '');
  if (!typed || !typed.trim()) return;
  const found = findFrame(ctx.availableFrames.map((r) => r.frameRegistryEntry), typed);
  const index = found ? ctx.availableFrames.findIndex((r) => r.frameRegistryEntry === found.entry) : -1;
  if (index < 0 || !ctx.frameSelect) {
    ctx.setStatus(`No frame matches “${typed.trim()}”.`);
    return;
  }
  ctx.frameSelect.value = String(index);
  ctx.frameSelect.dispatchEvent(new Event('change', { bubbles: true }));
  const ref = frameReference(found.entry);
  ctx.setStatus(found.how === 'near' ? `No frame is “${typed.trim()}”; the closest is ${ref}.` : `Frame ${ref}.`);
}

export function updateFrameMenuState() {
  const i = ctx.getCurrentFrameSelectIndex();
  const ent = i == null ? null : ctx.availableFrames[i]?.frameRegistryEntry;
  const frameId = typeof ent?.frameId === 'string' ? ent.frameId.trim() : '';
  const hasFrame = i != null;
  if (ctx.frameMenuLabel) {
    ctx.frameMenuLabel.textContent = hasFrame
      ? frameDisplayName(ent, ctx.availableFrames[i]?.label || 'Frame')
      : 'No frame';
  }
  if (ctx.frameMenuExportShot) ctx.frameMenuExportShot.disabled = !hasFrame || !resolveScreenshotUrlForFrameIndex(i);
  if (ctx.frameMenuAddReference) ctx.frameMenuAddReference.disabled = !hasFrame;
  if (ctx.frameMenuRename) ctx.frameMenuRename.disabled = !frameId;
  if (ctx.frameMenuTags) ctx.frameMenuTags.disabled = !frameId;
  const copyRef = /** @type {HTMLButtonElement|null} */ (document.getElementById('frame-menu-copy-ref'));
  if (copyRef) copyRef.disabled = !hasFrame;
  const goTo = /** @type {HTMLButtonElement|null} */ (document.getElementById('frame-menu-go-to'));
  if (goTo) goTo.disabled = !ctx.availableFrames.length;
  updateReferenceUi();
}

function resolveScreenshotUrlForFrameIndex(i) {
  if (!Number.isFinite(i) || i < 0 || i >= ctx.availableFrames.length) return null;
  const row = ctx.availableFrames[i];
  const ent = row?.frameRegistryEntry;
  const screenshotRef = typeof ent?.screenshotFile === 'string' ? ent.screenshotFile.trim() : '';
  if (screenshotRef) {
    const leaf = screenshotRef.replace(/^screenshots\//i, '').toLowerCase();
    const url = ctx.screenshotUrlByName.get(leaf);
    if (url) return url;
  }
  const frameId = typeof ent?.frameId === 'string' ? ent.frameId.trim().toLowerCase() : '';
  if (frameId) {
    const byFrame = ctx.screenshotUrlByStem.get(frameId);
    if (byFrame) return byFrame;
  }
  const vipStem = String(row?.vipFile || '')
    .replace(/^vipstates\//i, '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.json$/i, '')
    .toLowerCase();
  if (vipStem) return ctx.screenshotUrlByStem.get(vipStem) || null;
  return null;
}

export function refreshFrameScreenshot(i) {
  const nextUrl = resolveScreenshotUrlForFrameIndex(i);
  ctx.activeFrameScreenshotImage = null;
  ctx.activeFrameScreenshotUrl = nextUrl;
  if (!nextUrl) {
    if (ctx.toggleShotOverlay) ctx.toggleShotOverlay.disabled = true;
    if (ctx.shotOverlayAlpha) ctx.shotOverlayAlpha.disabled = true;
    ctx.render();
    return;
  }
  if (ctx.toggleShotOverlay) ctx.toggleShotOverlay.disabled = false;
  if (ctx.shotOverlayAlpha) ctx.shotOverlayAlpha.disabled = false;
  const img = new Image();
  img.onload = () => {
    if (ctx.activeFrameScreenshotUrl !== nextUrl) return;
    ctx.activeFrameScreenshotImage = img;
    ctx.render();
  };
  img.onerror = () => {
    if (ctx.activeFrameScreenshotUrl !== nextUrl) return;
    ctx.activeFrameScreenshotImage = null;
    ctx.render();
  };
  img.src = nextUrl;
}

/**
 * Map captured PNG pixels → VIP framebuffer rectangle (384×224 space).
 * Emulator canvases are often a few pixels off exact 768×224; strict equality was squeezing the full width into 384×224.
 */
function getScreenshotVipSourceRect(img) {
  const fullW = img.naturalWidth || img.width || ctx.W;
  const fullH = img.naturalHeight || img.height || ctx.H;
  const tolH = 8;
  const tolX = 12;
  const targetAr = ctx.W / ctx.H;
  // Side-by-side stereo (~2× VIP width, ~VIP height)
  if (fullW >= ctx.W * 2 - tolX && Math.abs(fullH - ctx.H) <= tolH) {
    const half = Math.floor(fullW / 2);
    const sx = ctx.getEye() === 1 ? half : 0;
    return { sx, sy: 0, sw: half, sh: fullH };
  }
  const ar = fullW / fullH;
  if (Math.abs(ar - targetAr) < 0.04) {
    return { sx: 0, sy: 0, sw: fullW, sh: fullH };
  }
  // Letterbox / odd aspect: center-crop to VIP aspect, then scale to W×H
  let cw = fullW;
  let ch = fullH;
  if (ar > targetAr) {
    cw = Math.round(fullH * targetAr);
    ch = fullH;
  } else {
    cw = fullW;
    ch = Math.round(fullW / targetAr);
  }
  cw = Math.max(1, Math.min(cw, fullW));
  ch = Math.max(1, Math.min(ch, fullH));
  const sx = Math.floor((fullW - cw) / 2);
  const sy = Math.floor((fullH - ch) / 2);
  return { sx, sy, sw: cw, sh: ch };
}

/**
 * Center-crop a screenshot sub-rectangle so its aspect ratio exactly matches VIP (W:H).
 * Without this, e.g. 385×224 or 384×226 scaled to 384×224 is anisotropic and looks “crushed”;
 * memory analysis uses a plain img element, which does not force that stretch onto the VIP buffer.
 */
function cropSourceRectToVipAspect(sx0, sy0, sw0, sh0) {
  const targetAr = ctx.W / ctx.H;
  const ar = sw0 / sh0;
  if (!(sw0 > 0 && sh0 > 0)) return { sx: sx0, sy: sy0, sw: Math.max(1, sw0), sh: Math.max(1, sh0) };
  if (Math.abs(ar - targetAr) < 1e-4) return { sx: sx0, sy: sy0, sw: sw0, sh: sh0 };
  if (ar > targetAr) {
    const nw = Math.max(1, Math.floor(sh0 * targetAr));
    const nh = sh0;
    return { sx: sx0 + Math.floor((sw0 - nw) / 2), sy: sy0, sw: nw, sh: nh };
  }
  const nw = sw0;
  const nh = Math.max(1, Math.floor(sw0 / targetAr));
  return { sx: sx0, sy: sy0 + Math.floor((sh0 - nh) / 2), sw: nw, sh: nh };
}

export function drawScreenshotOverlay(dw, dh) {
  if (!ctx.ctx || !ctx.activeFrameScreenshotImage || !ctx.screenshotOverlayEnabled || ctx.screenshotOverlayOpacity <= 0) return;
  const img = ctx.activeFrameScreenshotImage;
  const raw = getScreenshotVipSourceRect(img);
  const { sx, sy, sw, sh } = cropSourceRectToVipAspect(raw.sx, raw.sy, raw.sw, raw.sh);
  const scale = sw / ctx.W;
  ctx.ctx.save();
  ctx.ctx.globalAlpha = ctx.screenshotOverlayOpacity;
  ctx.ctx.imageSmoothingEnabled = true;
  try {
    ctx.ctx.imageSmoothingQuality = 'high';
  } catch (_) {
    /* older browsers */
  }
  if (ctx.zoomViewport) {
    const { x, y, w, h } = ctx.zoomViewport;
    const ix = sx + x * scale;
    const iy = sy + y * scale;
    const iw = w * scale;
    const ih = h * scale;
    ctx.ctx.drawImage(img, ix, iy, iw, ih, 0, 0, dw, dh);
  } else {
    ctx.ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  }
  ctx.ctx.restore();
}

/** The colorized reference, placed by its transform; in Move & scale mode, its outline too. */
export function drawReferenceOverlay(dw, dh) {
  if (!ctx.ctx || !ctx.activeReferenceImage || !ctx.activeReferenceTransform) return;
  const rect = referenceRectInFrame();
  if (!rect) return;
  const { vx, vy, kx, ky } = frameToCanvasMapping(dw, dh);
  const x = (rect.x - vx) * kx;
  const y = (rect.y - vy) * ky;
  const w = rect.w * kx;
  const h = rect.h * ky;
  if (ctx.referenceOverlayEnabled && ctx.screenshotOverlayOpacity > 0) {
    ctx.ctx.save();
    ctx.ctx.globalAlpha = ctx.screenshotOverlayOpacity;
    ctx.ctx.imageSmoothingEnabled = true;
    ctx.ctx.drawImage(ctx.activeReferenceImage, x, y, w, h);
    ctx.ctx.restore();
  }
  if (!ctx.referenceTransformMode) return;
  ctx.ctx.save();
  // The outline shows where the image is even when it reaches past the canvas.
  ctx.ctx.lineWidth = 1;
  ctx.ctx.setLineDash([4, 3]);
  ctx.ctx.strokeStyle = '#000';
  ctx.ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.ctx.strokeStyle = '#3ad2ff';
  ctx.ctx.setLineDash([4, 3]);
  ctx.ctx.lineDashOffset = 4;
  ctx.ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.ctx.setLineDash([]);
  ctx.ctx.fillStyle = '#3ad2ff';
  const hs = 5;
  for (const [hx, hy] of [[x, y], [x + w / 2, y], [x + w, y], [x, y + h / 2], [x + w, y + h / 2], [x, y + h], [x + w / 2, y + h], [x + w, y + h]]) {
    ctx.ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  }
  ctx.ctx.restore();
}
