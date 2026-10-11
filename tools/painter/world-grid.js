/**
 * The Project tool's view of one group and the world grid: filter the view to a group, zoom to
 * it, the world buttons, affine marks and the selection overlay drawn on the canvas. Split out of tools/painter.js, which passes in the state and functions it shares
 * (initWorldGrid).
 */
import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { clusterTilePositions, pickCluster } from '../../src/tile-clusters.js';
import { updatePaintV2TopButton } from './pack-rules.js';
import { clearSelection, enterZoomFromSelection, normWorldKey, refreshInspectorFromSelection, syncLastTopTileFromSelection, updateSelectionUi } from './selection.js';
import { drawEye, getEye, updateWorldFilterDebug } from './view-filters.js';
import { collectFullFrameIndicesMatchingGroup, findAnchorDrawForGroup } from './zoom-target.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initWorldGrid(context) {
  ctx = context;
}

/**
 * Set world + layer strip from group criteria (preview only). Clears tile selection.
 * @param {typeof groups[0]} g
 */
/** Turn the group view filter off and put the world/layer strip back to everything. */
function clearViewGroupFilter(g) {
  ctx.viewGroupFilterId = null;
  ctx.worldFilter = 'all';
  syncWorldButtons();
  if (ctx.layerSelect) ctx.layerSelect.value = 'all';
  clearSelection();
  ctx.updateGroupsPanel();
  ctx.updateGroupDetail(g || null);
  updateSelectionUi();
  ctx.render();
  updateWorldFilterDebug();
  ctx.updatePoolSummary();
  ctx.updateGroupsPoolContextHint();
  ctx.setStatus(`View filter off — showing all draws on this frame again.`);
}

export function filterViewToGroup(g) {
  // Toggle: clicking the filter again is how you get everything back.
  if (ctx.viewGroupFilterId === g.id) {
    clearViewGroupFilter(g);
    return;
  }
  const c = g.criteria || {};
  const windowIds = Array.isArray(c.windowIds) ? c.windowIds : Array.isArray(c.worldIds) ? c.worldIds : [];
  const layers = Array.isArray(c.layers) ? c.layers : [];
  if (windowIds.length > 0) {
    /** @type {Set<string>} */
    const next = new Set();
    for (const w of windowIds) {
      const n = Number(w);
      if (!Number.isFinite(n) || n < 0 || n > 31) continue;
      next.add(normWorldKey(n));
    }
    ctx.worldFilter = next.size > 0 ? next : 'all';
  } else {
    ctx.worldFilter = 'all';
  }
  syncWorldButtons();
  if (ctx.layerSelect) {
    if (layers.length === 1 && (layers[0] === 0 || layers[0] === 1 || layers[0] === 2)) {
      ctx.layerSelect.value = String(layers[0]);
    } else {
      ctx.layerSelect.value = 'all';
    }
  }
  clearSelection();
  ctx.selectedGroupId = g.id;
  ctx.viewGroupFilterId = g.id;
  ctx.updateGroupsPanel();
  ctx.updateGroupDetail(g);
  updateSelectionUi();
  ctx.render();
  updateWorldFilterDebug();
  ctx.updatePoolSummary();
  ctx.updateGroupsPoolContextHint();
  const wNote = ctx.worldFilter === 'all' ? 'all worlds' : [...ctx.worldFilter].sort((a, b) => Number(a) - Number(b)).join(', ');
  const lNote = ctx.layerSelect?.value === 'all' || !ctx.layerSelect?.value ? 'all layers' : `layer ${ctx.layerSelect.value}`;
  ctx.setStatus(`Filtered view to group “${g.name || g.id}”: ${wNote} · ${lNote} · canvas shows only draws matching this group’s criteria (hashes + worlds + layers).`);
}

/**
 * Select all draws matching the group (current eye) and zoom the canvas to their bounding box.
 * @param {typeof groups[0]} g
 */
export function enterZoomToGroup(g) {
  if (!ctx.currentState?.drawList) {
    ctx.setStatus('Load a frame first.');
    return;
  }
  const idx = collectFullFrameIndicesMatchingGroup(g);
  if (!idx.length) {
    ctx.setStatus(`No draws match group “${g.name || g.id}” on this frame for the current eye.`);
    return;
  }
  // Criteria match by pattern, so copies of these tiles can be scattered across
  // the frame; their bounding box is then the whole screen and "zoom" does
  // nothing useful. Zoom to one cluster — the anchor's if there is one.
  const clusters = clusterTilePositions(idx.map((fi) => ctx.currentState.drawList[fi]));
  const anchorDraw = findAnchorDrawForGroup(g);
  const anchorAt = anchorDraw ? idx.findIndex((fi) => ctx.currentState.drawList[fi] === anchorDraw) : -1;
  const cluster = pickCluster(clusters, anchorAt);
  const chosen = cluster ? cluster.indices.map((i) => idx[i]) : idx;

  ctx.selectedDrawFullIndices.clear();
  for (const fi of chosen) ctx.selectedDrawFullIndices.add(fi);
  enterZoomFromSelection();
  syncLastTopTileFromSelection();
  refreshInspectorFromSelection();
  updatePaintV2TopButton();
  const scattered =
    clusters.length > 1
      ? ` ${idx.length} draw(s) match across the frame in ${clusters.length} cluster(s)${anchorAt >= 0 ? ' — showing the anchor’s' : ' — showing the largest'}.`
      : '';
  ctx.setStatus(`Zoomed to ${chosen.length} tile(s) matching “${g.name || g.id}”.${scattered}`);
}

export function buildWorldGrid() {
  if (!ctx.worldGrid) return;
  ctx.worldGrid.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'all';
  allBtn.textContent = 'All worlds';
  allBtn.addEventListener('click', () => {
    ctx.worldFilter = 'all';
    syncWorldButtons();
    clearSelection();
    ctx.selectedGroupId = null;
    ctx.viewGroupFilterId = null;
    ctx.updateGroupsPanel();
    ctx.updateGroupDetail(null);
    ctx.render();
  });
  ctx.worldGrid.appendChild(allBtn);
  for (let w = 0; w < 32; w++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(w).padStart(2, '0');
    b.dataset.world = String(w);
    b.title = `World ${w}`;
    b.addEventListener('click', () => {
      if (ctx.worldFilter === 'all') ctx.worldFilter = new Set();
      const key = String(w);
      if (ctx.worldFilter.has(key)) ctx.worldFilter.delete(key);
      else ctx.worldFilter.add(key);
      if (ctx.worldFilter.size === 0) ctx.worldFilter = 'all';
      syncWorldButtons();
      ctx.viewGroupFilterId = null;
      clearSelection();
      ctx.render();
      ctx.deselectSelectedGroupIfFilteredOut();
    });
    ctx.worldGrid.appendChild(b);
  }
  syncWorldButtons();
}

/** Worlds with anything drawn on the current frame and eye (any layer), as filter keys. */
function worldsOnFrame() {
  const out = new Set();
  if (!ctx.currentState?.drawList) return out;
  const eye = getEye();
  for (const d of ctx.currentState.drawList) {
    if (d && drawEye(d) === eye && d.world !== undefined && d.world !== null) out.add(normWorldKey(d.world));
  }
  return out;
}

export function syncWorldButtons() {
  if (!ctx.worldGrid) return;
  const allBtn = ctx.worldGrid.querySelector('button.all');
  if (allBtn) allBtn.classList.toggle('on', ctx.worldFilter === 'all');
  // Worlds with nothing on this frame are disabled — worked out afresh for every frame and eye,
  // so a world empty on one frame of a screen is clickable again on the next frame that draws it.
  // A world you have selected stays clickable, so you can always turn its filter off.
  const present = ctx.currentState?.drawList ? worldsOnFrame() : null;
  ctx.worldGrid.querySelectorAll('button[data-world]').forEach((el) => {
    const btn = /** @type {HTMLButtonElement} */ (el);
    const w = btn.dataset.world || '';
    const on = ctx.worldFilter !== 'all' && ctx.worldFilter.has(w);
    btn.classList.toggle('on', on);
    const empty = !!present && !present.has(normWorldKey(w));
    btn.disabled = empty && !on;
    btn.classList.toggle('empty', empty);
    btn.title = empty ? `World ${w} — nothing drawn here on this frame (this eye)` : `World ${w}`;
  });
}

/** Scratch canvas for shading affine tiles into the selection overlay. */
let affineMarkCanvas = null;

/**
 * Shade each marked affine tile over every screen pixel that reads it, into the overlay.
 * @param {Map<number, import('../../src/affine-world.js').AffinePixels>} affine
 * @param {Map<number, Map<number, number[]>>} marks world → character → RGBA
 * @param {Map<number, number[]>} [pixelMarks] single pixels → RGBA, painted over the rest
 */
function paintAffineMarks(affine, marks, pixelMarks = new Map()) {
  if (!ctx.scratchOverlayCtx) return;
  if (!affineMarkCanvas) {
    affineMarkCanvas = document.createElement('canvas');
    affineMarkCanvas.width = ctx.W;
    affineMarkCanvas.height = ctx.H;
  }
  const mctx = affineMarkCanvas.getContext('2d');
  if (!mctx) return;
  const img = mctx.createImageData(ctx.W, ctx.H);
  for (const [world, byChar] of marks) {
    const px = affine.get(world);
    if (!px) continue;
    for (let p = 0; p < ctx.W * ctx.H; p++) {
      const ch = px.char[p];
      if (ch < 0) continue;
      const c = byChar.get(ch);
      if (c) img.data.set(c, p * 4);
    }
  }
  for (const [p, c] of pixelMarks) img.data.set(c, p * 4);
  mctx.putImageData(img, 0, 0);
  ctx.scratchOverlayCtx.drawImage(affineMarkCanvas, 0, 0);
}

export function drawSelectionOverlay() {
  if (!ctx.octx || !ctx.overlayCanvas || !ctx.scratchOverlayCtx) return;
  const dw = ctx.overlayCanvas.width || ctx.W;
  const dh = ctx.overlayCanvas.height || ctx.H;
  ctx.scratchOverlayCtx.clearRect(0, 0, ctx.W, ctx.H);
  // Tiles of a scaled (affine) layer are shaded where they really are on screen, not boxed at
  // their rigid draw-list records. Collected here, painted in one pass below; later marks win.
  const affine = ctx.affineMapForEye();
  /** @type {Map<number, Map<number, number[]>>} world → character → RGBA */
  const affineMarks = new Map();
  const markAffine = (d, rgba) => {
    if (!ctx.isAffineRecord(d, affine)) return false;
    if (!affineMarks.has(d.world)) affineMarks.set(d.world, new Map());
    affineMarks.get(d.world).set(d.tileIndex, rgba);
    return true;
  };
  if (!ctx.zoomViewport && ctx.marqueeState) {
    const x0 = Math.min(ctx.marqueeState.x0, ctx.marqueeState.x1);
    const y0 = Math.min(ctx.marqueeState.y0, ctx.marqueeState.y1);
    const rw = Math.abs(ctx.marqueeState.x1 - ctx.marqueeState.x0);
    const rh = Math.abs(ctx.marqueeState.y1 - ctx.marqueeState.y0);
    ctx.scratchOverlayCtx.save();
    ctx.scratchOverlayCtx.strokeStyle = 'rgba(94, 224, 208, 0.95)';
    ctx.scratchOverlayCtx.lineWidth = 1;
    ctx.scratchOverlayCtx.setLineDash([4, 3]);
    ctx.scratchOverlayCtx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, rw), Math.max(1, rh));
    ctx.scratchOverlayCtx.restore();
  }
  if (ctx.anchorPickGroupId && ctx.currentState?.drawList && ctx.currentState.patternTable) {
    const gPick = ctx.groups.find((gg) => gg.id === ctx.anchorPickGroupId);
    if (gPick) {
      ctx.scratchOverlayCtx.save();
      ctx.scratchOverlayCtx.strokeStyle = 'rgba(94, 224, 208, 0.9)';
      ctx.scratchOverlayCtx.lineWidth = 2;
      ctx.scratchOverlayCtx.setLineDash([3, 2]);
      for (const fi of collectFullFrameIndicesMatchingGroup(gPick)) {
        const d = ctx.currentState.drawList[fi];
        if (!d) continue;
        if (!markAffine(d, [94, 224, 208, 110])) ctx.scratchOverlayCtx.strokeRect(d.x + 0.5, d.y + 0.5, 7, 7);
      }
      ctx.scratchOverlayCtx.restore();
    }
  }
  // Group membership (cyan) + anchor-hash copies (green) — distinct from magenta selection.
  if (!ctx.anchorPickGroupId && !ctx.zoomViewport && ctx.selectedGroupId && ctx.currentState?.drawList && ctx.currentState.patternTable) {
    const gSel = ctx.groups.find((gg) => gg.id === ctx.selectedGroupId);
    if (gSel) {
      const pt = ctx.currentState.patternTable;
      const memberIndices = collectFullFrameIndicesMatchingGroup(gSel);
      ctx.scratchOverlayCtx.save();
      ctx.scratchOverlayCtx.strokeStyle = 'rgba(80, 170, 230, 0.88)';
      ctx.scratchOverlayCtx.lineWidth = 1.5;
      ctx.scratchOverlayCtx.setLineDash([4, 3]);
      for (const fi of memberIndices) {
        const d = ctx.currentState.drawList[fi];
        if (!d) continue;
        if (!markAffine(d, [80, 170, 230, 90])) ctx.scratchOverlayCtx.strokeRect(d.x + 0.5, d.y + 0.5, 7, 7);
      }
      ctx.scratchOverlayCtx.restore();
      if (typeof gSel.anchorHash === 'number' && Number.isFinite(gSel.anchorHash)) {
        const ah = gSel.anchorHash >>> 0;
        ctx.scratchOverlayCtx.save();
        ctx.scratchOverlayCtx.strokeStyle = 'rgba(120, 220, 100, 0.98)';
        ctx.scratchOverlayCtx.lineWidth = 2;
        ctx.scratchOverlayCtx.setLineDash([]);
        for (const fi of memberIndices) {
          const d = ctx.currentState.drawList[fi];
          if (!d) continue;
          if ((hashTile(getTileBytes(pt, d.tileIndex)) >>> 0) !== ah) continue;
          if (!markAffine(d, [120, 220, 100, 130])) ctx.scratchOverlayCtx.strokeRect(d.x - 0.5, d.y - 0.5, 9, 9);
        }
        ctx.scratchOverlayCtx.restore();
      }
    }
  }
  if (ctx.currentState?.patternTable && ctx.selectedDrawFullIndices.size > 0) {
    let minX = ctx.W;
    let minY = ctx.H;
    let maxX = 0;
    let maxY = 0;
    for (const fi of ctx.selectedDrawFullIndices) {
      const d = ctx.currentState.drawList[fi];
      if (!d || ctx.isAffineRecord(d, affine)) continue;
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + 8);
      maxY = Math.max(maxY, d.y + 8);
    }
    if (maxX > minX && maxY > minY) {
      ctx.scratchOverlayCtx.save();
      ctx.scratchOverlayCtx.strokeStyle = 'rgba(224, 112, 176, 0.32)';
      ctx.scratchOverlayCtx.lineWidth = 1;
      ctx.scratchOverlayCtx.setLineDash([]);
      ctx.scratchOverlayCtx.strokeRect(minX + 0.5, minY + 0.5, maxX - minX - 1, maxY - minY - 1);
      ctx.scratchOverlayCtx.restore();
    }
    if (ctx.selectedDrawFullIndices.size === 1) {
      const [onlyFi] = [...ctx.selectedDrawFullIndices];
      const d0 = ctx.currentState.drawList[onlyFi];
      const pt = ctx.currentState.patternTable;
      const eye = getEye();
      if (d0 && drawEye(d0) === eye) {
        const targetHash = hashTile(getTileBytes(pt, d0.tileIndex)) >>> 0;
        ctx.scratchOverlayCtx.save();
        ctx.scratchOverlayCtx.strokeStyle = 'rgba(232, 160, 96, 0.92)';
        ctx.scratchOverlayCtx.lineWidth = 1;
        ctx.scratchOverlayCtx.setLineDash([3, 2]);
        for (let fi = 0; fi < ctx.currentState.drawList.length; fi++) {
          if (fi === onlyFi) continue;
          const d = ctx.currentState.drawList[fi];
          if (!d || drawEye(d) !== eye) continue;
          if ((hashTile(getTileBytes(pt, d.tileIndex)) >>> 0) !== targetHash) continue;
          if (!markAffine(d, [232, 160, 96, 110])) ctx.scratchOverlayCtx.strokeRect(d.x + 0.5, d.y + 0.5, 7, 7);
        }
        ctx.scratchOverlayCtx.restore();
      }
    }
    ctx.scratchOverlayCtx.save();
    ctx.scratchOverlayCtx.strokeStyle = 'rgba(224, 112, 176, 0.95)';
    ctx.scratchOverlayCtx.lineWidth = 2;
    ctx.scratchOverlayCtx.setLineDash([]);
    for (const fi of ctx.selectedDrawFullIndices) {
      const d = ctx.currentState.drawList[fi];
      if (!d) continue;
      // Every copy of a selected affine tile: painting it changes them all, and the copy its
      // record points at can be far from where you clicked or dragged.
      if (!markAffine(d, [224, 112, 176, 170])) ctx.scratchOverlayCtx.strokeRect(d.x + 0.5, d.y + 0.5, 7, 7);
    }
    ctx.scratchOverlayCtx.restore();
  }
  if (affineMarks.size) paintAffineMarks(affine, affineMarks);
  ctx.octx.clearRect(0, 0, dw, dh);
  if (ctx.zoomViewport && ctx.scratchOverlay) {
    const { x, y, w, h } = ctx.zoomViewport;
    ctx.octx.imageSmoothingEnabled = false;
    ctx.octx.drawImage(ctx.scratchOverlay, x, y, w, h, 0, 0, dw, dh);
    if (ctx.zoomGridEnabled) {
      ctx.octx.save();
      ctx.octx.strokeStyle = 'rgba(220, 224, 236, 0.12)';
      ctx.octx.lineWidth = 1;
      const sx = dw / w;
      const sy = dh / h;
      for (let gx = Math.ceil(x / 8) * 8; gx < x + w; gx += 8) {
        const px = (gx - x) * sx;
        ctx.octx.beginPath();
        ctx.octx.moveTo(px + 0.5, 0);
        ctx.octx.lineTo(px + 0.5, dh);
        ctx.octx.stroke();
      }
      for (let gy = Math.ceil(y / 8) * 8; gy < y + h; gy += 8) {
        const py = (gy - y) * sy;
        ctx.octx.beginPath();
        ctx.octx.moveTo(0, py + 0.5);
        ctx.octx.lineTo(dw, py + 0.5);
        ctx.octx.stroke();
      }
      ctx.octx.restore();
    }
  } else {
    ctx.octx.drawImage(ctx.scratchOverlay, 0, 0, dw, dh);
  }
}
