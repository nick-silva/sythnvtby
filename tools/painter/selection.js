/**
 * The Project tool's tile selection: marquee, the selection panel and inspector refresh, zooming
 * into a selection. Split out of tools/painter.js, which passes in the state and functions it shares (initSelection).
 */
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { updateReferenceUi } from './reference-images.js';
import { updatePaintV2TopButton } from './pack-rules.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initSelection(context) {
  ctx = context;
}

export function fullDrawIndexFromDraw(d) {
  if (!ctx.currentState?.drawList || !d) return -1;
  return ctx.currentState.drawList.indexOf(d);
}

export function exitZoom() {
  ctx.zoomViewport = null;
  if (ctx.zoomPaintTool === 'brush') ctx.zoomPaintTool = null;
  ctx.activeZoomPaintPointer = null;
  ctx.activePaintUndoMap = null;
  ctx.zoomPaintStrokeAllowed = false;
}

function setCanvasAspectForZoom(zoomed) {
  if (!ctx.canvas || !ctx.overlayCanvas) return;
  let targetW = ctx.W;
  let targetH = ctx.H;
  if (zoomed) {
    // Match the viewport's shape so nothing is stretched; ZOOM_SQUARE is the budget
    // for the longer side.
    const vw = Math.max(1, ctx.zoomViewport?.w || ctx.ZOOM_SQUARE);
    const vh = Math.max(1, ctx.zoomViewport?.h || ctx.ZOOM_SQUARE);
    const scale = Math.max(1, Math.min(ctx.ZOOM_SQUARE / vw, ctx.ZOOM_SQUARE / vh));
    targetW = Math.max(1, Math.round(vw * scale));
    targetH = Math.max(1, Math.round(vh * scale));
  }
  if (ctx.canvas.width !== targetW || ctx.canvas.height !== targetH) {
    ctx.canvas.width = targetW;
    ctx.canvas.height = targetH;
  }
  if (ctx.overlayCanvas.width !== targetW || ctx.overlayCanvas.height !== targetH) {
    ctx.overlayCanvas.width = targetW;
    ctx.overlayCanvas.height = targetH;
  }
}

/** @param {unknown} world */
export function normWorldKey(world) {
  if (world == null) return '';
  const n = Number(world);
  if (Number.isFinite(n)) return String(Math.trunc(n));
  const s = String(world).trim();
  return s;
}

/**
 * @param {number} rx0 @param {number} ry0 @param {number} rx1 @param {number} ry1
 * @param {number} tx @param {number} ty tile origin (8×8)
 */
function rectIntersectsTile(rx0, ry0, rx1, ry1, tx, ty) {
  const x0 = Math.min(rx0, rx1);
  const x1 = Math.max(rx0, rx1);
  const y0 = Math.min(ry0, ry1);
  const y1 = Math.max(ry0, ry1);
  const tx1 = tx + 8;
  const ty1 = ty + 8;
  return !(tx1 <= x0 || tx >= x1 || ty1 <= y0 || ty >= y1);
}

/** @returns {number[]} full draw indices */
export function collectDrawIndicesInMarquee(vx0, vy0, vx1, vy1) {
  if (!ctx.currentState?.drawList?.length) return [];
  const view = ctx.filterStateForView(ctx.currentState);
  const eye = ctx.getEye();
  const affine = ctx.affineMapForEye();
  // Affine tiles are in the box when any pixel inside it reads them (one record per tile).
  /** @type {Set<string>} */
  const affineInBox = new Set();
  if (affine) {
    const xa = Math.max(0, Math.min(vx0, vx1));
    const xb = Math.min(ctx.W - 1, Math.max(vx0, vx1));
    const ya = Math.max(0, Math.min(vy0, vy1));
    const yb = Math.min(ctx.H - 1, Math.max(vy0, vy1));
    for (const [world, px] of affine) {
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const ch = px.char[y * ctx.W + x];
        if (ch >= 0) affineInBox.add(`${world}|${ch}`);
      }
    }
  }
  /** @type {number[]} */
  const out = [];
  for (const d of view.drawList) {
    if (ctx.drawEye(d) !== eye) continue;
    if (!ctx.includeBlankTiles && ctx.isBlankDraw(d)) continue;
    if (ctx.isAffineRecord(d, affine)) {
      const key = `${d.world}|${d.tileIndex}`;
      if (!affineInBox.delete(key)) continue;
    } else if (!rectIntersectsTile(vx0, vy0, vx1, vy1, d.x, d.y)) continue;
    const fi = fullDrawIndexFromDraw(d);
    if (fi >= 0) out.push(fi);
  }
  return out;
}

export function topSelectedDrawFullIndex() {
  if (!ctx.currentState?.drawList?.length || ctx.selectedDrawFullIndices.size === 0) return null;
  const view = ctx.filterStateForView(ctx.currentState);
  const drawList = view.drawList;
  const eye = ctx.getEye();
  const sorted = ctx.collectVisibleIndicesForHit(view).filter((i) => ctx.drawEye(drawList[i]) === eye);
  for (let k = sorted.length - 1; k >= 0; k--) {
    const i = sorted[k];
    const fi = fullDrawIndexFromDraw(drawList[i]);
    if (fi >= 0 && ctx.selectedDrawFullIndices.has(fi)) return fi;
  }
  return null;
}

export function syncLastTopTileFromSelection() {
  const fi = topSelectedDrawFullIndex();
  if (fi == null || !ctx.currentState?.patternTable) {
    ctx.lastTopTileHash = null;
    return;
  }
  const d = ctx.currentState.drawList[fi];
  const tb = getTileBytes(ctx.currentState.patternTable, d.tileIndex);
  ctx.lastTopTileHash = hashTile(tb);
}

function selectionGroupRollup() {
  if (!ctx.currentState?.patternTable || ctx.selectedDrawFullIndices.size === 0) {
    return { drawsInSomeGroup: 0, groupNames: /** @type {string[]} */ ([]) };
  }
  const pt = ctx.currentState.patternTable;
  /** @type {Set<string>} */
  const names = new Set();
  let drawsInSomeGroup = 0;
  for (const fi of ctx.selectedDrawFullIndices) {
    const d = ctx.currentState.drawList[fi];
    if (!d) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex));
    let any = false;
    for (const g of ctx.groups) {
      if (ctx.drawMatchesGroup(d, g, h)) {
        any = true;
        names.add(g.name || g.id);
      }
    }
    if (any) drawsInSomeGroup++;
  }
  return { drawsInSomeGroup, groupNames: [...names].sort() };
}

export function updateSelectionUi() {
  updateReferenceUi(); // the fill-from-reference button follows the selection
  ctx.updateGroupsPoolContextHint();
  const n = ctx.selectedDrawFullIndices.size;
  const zoomed = ctx.zoomViewport != null;
  const paintBlocked = ctx.getZoomPaintBlockedReason();
  const canPaintAtVip = paintBlocked == null && !!ctx.currentState?.drawList?.length;
  const canPaintZoom = zoomed && canPaintAtVip;
  if (paintBlocked && (ctx.zoomPaintTool === 'fill' || ctx.zoomPaintTool === 'brush')) ctx.zoomPaintTool = null;
  setCanvasAspectForZoom(zoomed);
  if (ctx.btnZoomSelection) {
    ctx.btnZoomSelection.disabled = !zoomed && n === 0;
    const zoomLabel = zoomed ? 'Zoom out' : 'Zoom to selection';
    ctx.btnZoomSelection.setAttribute('aria-label', zoomLabel);
    ctx.btnZoomSelection.title = zoomLabel;
    const zimg = ctx.btnZoomSelection.querySelector('img');
    if (zimg) zimg.src = ctx.toolbarImg(zoomed ? 'toolbar_zoom_out.png' : 'toolbar_zoom_in.png');
  }
  if (ctx.btnZoomGrid) {
    ctx.btnZoomGrid.disabled = !zoomed;
    ctx.btnZoomGrid.classList.toggle('active', zoomed && ctx.zoomGridEnabled);
  }
  if (ctx.btnPaintFill) {
    ctx.btnPaintFill.disabled = !canPaintAtVip;
    ctx.btnPaintFill.classList.toggle('active', ctx.zoomPaintTool === 'fill');
  }
  if (ctx.fillAcrossTilesInput) {
    ctx.fillAcrossTilesInput.disabled = !canPaintAtVip;
    ctx.fillAcrossTilesInput.checked = ctx.fillAcrossTilesEnabled;
  }
  if (ctx.btnPaintBrush) {
    ctx.btnPaintBrush.disabled = !canPaintZoom;
    ctx.btnPaintBrush.classList.toggle('active', zoomed && ctx.zoomPaintTool === 'brush' && !ctx.zoomEraseMode);
  }
  if (ctx.btnPaintErase) {
    ctx.btnPaintErase.disabled = !canPaintZoom;
    ctx.btnPaintErase.classList.toggle('active', zoomed && ctx.zoomPaintTool === 'brush' && ctx.zoomEraseMode);
  }
  if (ctx.btnImportAsset) ctx.btnImportAsset.disabled = true;
  if (ctx.btnPaintColorPick) {
    const canPick =
      (typeof window !== 'undefined' && window.isSecureContext === true && 'EyeDropper' in window) ||
      !!ctx.currentState;
    ctx.btnPaintColorPick.disabled = !canPick;
    if (!ctx.paintColorPickAwaitingCanvasClick) ctx.btnPaintColorPick.classList.remove('active');
  }
  if (ctx.btnCanvasSelect) {
    ctx.btnCanvasSelect.disabled = zoomed;
    ctx.btnCanvasSelect.classList.toggle('active', !zoomed && ctx.zoomPaintTool == null);
    ctx.btnCanvasSelect.title = zoomed ? 'Zoom out to select tiles on the full canvas.' : 'Select tiles (marquee)';
  }
  const zc = /** @type {HTMLInputElement|null} */ (document.getElementById('zoom-paint-color'));
  if (zc) zc.disabled = !canPaintAtVip;
  ctx.canvasWrap?.classList.toggle('zoomed', zoomed);

  if (ctx.btnNewGroupFromSelection) {
    ctx.btnNewGroupFromSelection.disabled = !ctx.loadedPackParts || !ctx.currentState || n === 0;
  }
  if (ctx.btnNewPoseFromSelection) {
    ctx.btnNewPoseFromSelection.disabled = !ctx.loadedPackParts || !ctx.currentState || n === 0;
  }
  if (ctx.btnSelectMatching) ctx.btnSelectMatching.disabled = !ctx.currentState || n !== 1;
  const exportPngItem = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-export-png'));
  if (exportPngItem) exportPngItem.disabled = !ctx.currentState?.drawList?.length;
  const exportPlayerItem = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-export-player'));
  if (exportPlayerItem) exportPlayerItem.disabled = !ctx.loadedPackParts;
  const importPackItem = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-import-pack'));
  if (importPackItem) importPackItem.disabled = !ctx.loadedPackParts;
  const importVbcpItem = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-import-vbcp'));
  if (importVbcpItem) importVbcpItem.disabled = !ctx.loadedPackParts;
  const cleanupFramesItem = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-cleanup-frames'));
  if (cleanupFramesItem) cleanupFramesItem.disabled = !ctx.loadedPackParts;
  const gameStatesItem = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-game-states'));
  if (gameStatesItem) gameStatesItem.disabled = !ctx.loadedPackParts;
  const storageItem = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-storage'));
  if (storageItem) storageItem.disabled = !ctx.loadedPackParts;
  const analyzeItem = /** @type {HTMLButtonElement|null} */ (document.getElementById('file-menu-analyze-memory'));
  if (analyzeItem) analyzeItem.disabled = !ctx.loadedPackParts || !(ctx.lastFrameRegistry || []).length;
  const spriteStudioBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-open-sprite-studio'));
  if (spriteStudioBtn) spriteStudioBtn.disabled = !ctx.loadedPackParts;
  ctx.syncFrameStepButtons();
  if (!ctx.tileSelectionHint) return;
  let dupHint = '';
  if (n === 1) {
    const dup = ctx.sameHashDuplicateStatsForSingleSelection();
    if (dup && dup.otherCount > 0) {
      dupHint = ` <span class="muted">· <span style="color:#e8a060">Amber dashed</span>: ${dup.otherCount} other draw${dup.otherCount === 1 ? '' : 's'} same hash #${dup.hash.toString(16).toUpperCase()} (${dup.sameHashCount} total on this eye)</span>`;
    }
  }
  if (n === 0) {
    const paintHint = zoomed
      ? paintBlocked
        ? ` Paint: ${paintBlocked}`
        : ' Paint: unique anchor → VIP overlay; reused anchor hash / no anchor → vbcolor tile8 (all copies). Fill: optional Across tiles. Ctrl/Cmd+Z undoes.'
      : canPaintAtVip && ctx.zoomPaintTool === 'fill'
        ? ctx.fillAcrossTilesEnabled
          ? ' Fill: click to bucket across tiles in the group.'
          : ' Fill: click to bucket-fill one 8×8 (toggle Across tiles to spill).'
        : canPaintAtVip
          ? ' Choose Fill (toolbar) to bucket-fill; Across tiles toggles multi-tile spill.'
          : paintBlocked
            ? ` Paint: ${paintBlocked}`
            : '';
    ctx.tileSelectionHint.textContent = zoomed ? `Zoomed · no tiles selected.${paintHint}` : `No tiles selected.${paintHint}`;
    return;
  }
  if (!ctx.groups.length) {
    ctx.tileSelectionHint.innerHTML = `<strong>${n}</strong> tile${n === 1 ? '' : 's'} selected <span class="muted">· No groups in pack.</span>${dupHint}`;
    return;
  }
  const { drawsInSomeGroup, groupNames } = selectionGroupRollup();
  const ungrouped = n - drawsInSomeGroup;
  let groupPart = '';
  if (groupNames.length) {
    const shown = groupNames.slice(0, 4);
    const more = groupNames.length > shown.length ? ` +${groupNames.length - shown.length}` : '';
    groupPart = ` · <span class="muted">In groups:</span> ${ctx.escapeHtml(shown.join(', '))}${ctx.escapeHtml(more)}`;
  } else {
    groupPart = ` · <span class="muted">None of these tiles match a group’s criteria.</span>`;
  }
  const ug =
    ungrouped > 0
      ? ` <span class="muted">(${ungrouped} draw${ungrouped === 1 ? '' : 's'} not in any group)</span>`
      : '';
  const zoomPaintLine =
    zoomed && paintBlocked
      ? ` <span class="muted">· Paint: ${ctx.escapeHtml(paintBlocked)}</span>`
      : zoomed
        ? ` <span class="muted">· Paint: unique anchor → VIP overlay; else per-hash vbcolor (all copies).</span>`
        : canPaintAtVip && ctx.zoomPaintTool === 'fill'
          ? ` <span class="muted">· Fill: click the preview (full VIP).</span>`
          : canPaintAtVip
            ? ` <span class="muted">· Fill works at full size; brush needs zoom.</span>`
            : paintBlocked
              ? ` <span class="muted">· Paint: ${ctx.escapeHtml(paintBlocked)}</span>`
              : '';
  ctx.tileSelectionHint.innerHTML = `<strong>${n}</strong> tile${n === 1 ? '' : 's'}${zoomed ? ' <span class="muted">(zoomed)</span>' : ''}${groupPart}${ug}${dupHint}${zoomPaintLine}`;
}

export function refreshInspectorFromSelection() {
  if (!ctx.inspector || !ctx.currentState?.patternTable) return;
  const fi = topSelectedDrawFullIndex();
  if (fi == null || ctx.selectedDrawFullIndices.size === 0) {
    ctx.updateInspector(null);
    return;
  }
  if (ctx.selectedDrawFullIndices.size === 1) {
    const view = ctx.filterStateForView(ctx.currentState);
    const d = ctx.currentState.drawList[fi];
    const vi = view.drawList.indexOf(d);
    if (vi >= 0) ctx.updateInspector([vi]);
    else ctx.updateInspector(null);
    return;
  }
  const d = ctx.currentState.drawList[fi];
  const tileBytes = getTileBytes(ctx.currentState.patternTable, d.tileIndex);
  const h = hashTile(tileBytes);
  const layerName = d.layer === 0 ? 'BG' : d.layer === 1 ? 'Affine' : d.layer === 2 ? 'OBJ' : '?';
  ctx.inspector.innerHTML = `
    <div><strong>${ctx.selectedDrawFullIndices.size} tiles</strong> selected <span class="muted">(frontmost for v2 actions: #${h.toString(16).toUpperCase()})</span></div>
    <div style="margin-top:0.35rem;font-size:0.72rem"><strong>Front tile</strong> · layer ${layerName} · world ${d.world ?? '—'}</div>
    <pre style="margin-top:0.35rem">${ctx.escapeHtml(JSON.stringify({ x: d.x, y: d.y, flipH: d.flipH, flipV: d.flipV, eye: d.eye }, null, 0))}</pre>
  `;
  updatePaintV2TopButton();
}

export function clearSelection() {
  exitZoom();
  ctx.anchorPickGroupId = null;
  ctx.selectedDrawFullIndices.clear();
  ctx.marqueeState = null;
  ctx.activeMarqueePointer = null;
  ctx.lastTopTileHash = null;
  ctx.drawSelectionOverlay();
  updateSelectionUi();
  ctx.updateInspector(null);
  updatePaintV2TopButton();
}

/** Clear tile selection only (e.g. when picking a group); keep zoom viewport if any. */
export function clearTileSelectionPreserveZoom() {
  ctx.selectedDrawFullIndices.clear();
  ctx.marqueeState = null;
  ctx.activeMarqueePointer = null;
  ctx.lastTopTileHash = null;
  ctx.drawSelectionOverlay();
  updateSelectionUi();
  ctx.updateInspector(null);
  updatePaintV2TopButton();
}

/**
 * Drop marquee/tile pick and any in-progress zoom stroke snapshot, but keep {@link zoomViewport},
 * zoom paint tool, VIP overlay, and undo stack — so L/R eye or layer strip changes do not wipe a zoom paint session.
 */
export function resetMarqueeAndPickStatePreserveZoom() {
  ctx.anchorPickGroupId = null;
  ctx.activePaintUndoMap = null;
  ctx.activeVipOverlayUndoSnapshot = null;
  ctx.zoomPaintStrokeAllowed = false;
  ctx.activeZoomPaintPointer = null;
  clearTileSelectionPreserveZoom();
}

export function enterZoomFromSelection() {
  if (!ctx.currentState?.drawList || ctx.selectedDrawFullIndices.size === 0) return;
  const pad = 8;
  const minSpan = 32;
  let minX = ctx.W;
  let minY = ctx.H;
  let maxX = 0;
  let maxY = 0;
  const affine = ctx.affineMapForEye();
  const affineSeen = new Set();
  for (const fi of ctx.selectedDrawFullIndices) {
    const d = ctx.currentState.drawList[fi];
    if (!d) continue;
    if (ctx.isAffineRecord(d, affine)) {
      // A scaled tile's bounds are where its copy's pixels are on screen.
      for (const p of ctx.affineCopyPixels(affine, d, affineSeen)) {
        const x = p % ctx.W;
        const y = (p / ctx.W) | 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + 1);
        maxY = Math.max(maxY, y + 1);
      }
      continue;
    }
    minX = Math.min(minX, d.x);
    minY = Math.min(minY, d.y);
    maxX = Math.max(maxX, d.x + 8);
    maxY = Math.max(maxY, d.y + 8);
  }
  if (maxX <= minX || maxY <= minY) return;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Keep the selection's shape. Forcing a square meant a wide, short group (a row
  // of text, say) got clamped to the frame height and centered, which reads as
  // "zoomed in a bit on the middle of the screen" and hides most of the group.
  let vw = Math.min(ctx.W, Math.max(minSpan, maxX - minX + pad * 2));
  let vh = Math.min(ctx.H, Math.max(minSpan, maxY - minY + pad * 2));
  if (vw < 1 || vh < 1) return;
  let x = Math.round(cx - vw / 2);
  let y = Math.round(cy - vh / 2);
  x = Math.max(0, Math.min(x, ctx.W - vw));
  y = Math.max(0, Math.min(y, ctx.H - vh));
  ctx.zoomViewport = { x, y, w: vw, h: vh };
  clearTileSelectionPreserveZoom();
  if (ctx.zoomPaintTool == null && ctx.getZoomPaintBlockedReason() == null) {
    ctx.zoomPaintTool = 'brush';
  }
  updateSelectionUi();
  ctx.render();
}
