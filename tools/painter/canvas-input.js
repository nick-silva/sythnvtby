/**
 * The Project tool's canvas and keyboard input: pointer handling on the canvas (selecting, zoom
 * painting, moving the reference), the zoom and paint tool buttons, and keyboard shortcuts. Split out of tools/painter.js, which passes in the state and functions it shares
 * (initCanvasInput).
 */
import { clientToFrameFloat, frameToCanvasMapping, referenceHandleAt, setReferenceTransformModeQuiet } from './reference-images.js';
import { updatePaintV2TopButton } from './pack-rules.js';
import { collectDrawIndicesInMarquee, enterZoomFromSelection, exitZoom, fullDrawIndexFromDraw, refreshInspectorFromSelection, syncLastTopTileFromSelection, updateSelectionUi } from './selection.js';
import { clientToVipFrame, filterStateForView } from './view-filters.js';
import { getSelectedPaintGroupOrNull, getZoomPaintBlockedReason, updateDrawStackPanel, useVipOverlayForZoomPaint } from './zoom-target.js';
import { drawSelectionOverlay } from './world-grid.js';
import { updateGroupDetail } from './group-detail.js';
import { updateGroupsPanel } from './groups-panel.js';
import { frameFilter, frameHighlight, setFrameHighlight } from './frame-list.js';
import { applyHexToZoomPaintColorInput, applyRgbToZoomPaintColorInput, handleAnchorPickClick, hitDrawIndices, normalizeColorInputHex, paintBrushLineOnPack, paintBrushPixelOnPack, readMainCanvasPixelAtPointer, readZoomPaintColor, zoomFloodFillAtVip } from './zoom-paint.js';
import { explainInspectPoint } from './inspector.js';
import { snapshotVipOverlayForStrokeUndo } from './vip-overlay-paint.js';
import { commitPaintUndoStroke, paintRedoStack, redoLastZoomPaint, undoLastZoomPaint } from './paint-history.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initCanvasInput(context) {
  ctx = context;
}

/** The canvas: hover, and pointer down / move / up for selecting, zoom painting and moving the reference. */
export function wireCanvas() {
  const canvasStack = document.querySelector('.canvas-wrap');
  const DRAG_THRESH_VIP = 4;

  canvasStack?.addEventListener('mousemove', (e) => {
    if (!ctx.canvas || !ctx.cursorPos) return;
    const { px, py } = clientToVipFrame(e, ctx.canvas);
    ctx.cursorPos.textContent = `X: ${String(px).padStart(3, '0')}  Y: ${String(py).padStart(3, '0')}`;
  });

  canvasStack?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !ctx.canvas || !canvasStack) return;
    if (ctx.paintColorPickAwaitingCanvasClick && ctx.ctx) {
      ctx.paintColorPickAwaitingCanvasClick = false;
      ctx.btnPaintColorPick?.classList.remove('active');
      const px = readMainCanvasPixelAtPointer(e);
      if (px) {
        applyRgbToZoomPaintColorInput(px.r, px.g, px.b);
        const zc = /** @type {HTMLInputElement|null} */ (document.getElementById('zoom-paint-color'));
        ctx.setStatus(`Paint color set to ${zc?.value ?? ''} (preview sample).`);
      } else ctx.setStatus('Could not read that pixel — try again.');
      e.preventDefault();
      return;
    }
    // Move & scale owns the canvas while it is on, so a drag never paints or selects.
    if (ctx.referenceTransformMode && ctx.activeReferenceImage && ctx.activeReferenceTransform) {
      const { fx, fy } = clientToFrameFloat(e, ctx.canvas);
      const { kx } = frameToCanvasMapping(ctx.canvas.width, ctx.canvas.height);
      const handle = referenceHandleAt(fx, fy, 6 / Math.max(0.0001, kx));
      if (handle) {
        ctx.referenceDrag = { handle, startX: fx, startY: fy, startTransform: { ...ctx.activeReferenceTransform }, pointerId: e.pointerId };
        try {
          canvasStack.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      e.preventDefault();
      return;
    }
    if (!ctx.currentState) return;
    if (ctx.activeMarqueePointer || ctx.activeZoomPaintPointer) return;
    const { px, py } = clientToVipFrame(e, ctx.canvas);

    // Setting an anchor is modal and one-shot, so it outranks whichever paint tool is
    // selected — otherwise Fill/Brush take the pointer here and the pick never resolves.
    if (ctx.anchorPickGroupId) {
      handleAnchorPickClick(px, py);
      e.preventDefault();
      return;
    }

    if (ctx.zoomPaintTool === 'fill') {
      const paintWhy = getZoomPaintBlockedReason();
      if (paintWhy) {
        ctx.setStatus(paintWhy);
        e.preventDefault();
        return;
      }
      try {
        canvasStack.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      ctx.activePaintUndoMap = new Map();
      const gPaint = getSelectedPaintGroupOrNull();
      if (gPaint && useVipOverlayForZoomPaint(gPaint)) ctx.activeVipOverlayUndoSnapshot = snapshotVipOverlayForStrokeUndo();
      const undoDepthBefore = ctx.paintUndoStack.length;
      zoomFloodFillAtVip(px, py, readZoomPaintColor());
      commitPaintUndoStroke();
      const didFill = ctx.paintUndoStack.length > undoDepthBefore;
      try {
        canvasStack.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      ctx.render();
      syncLastTopTileFromSelection();
      updatePaintV2TopButton();
      ctx.setStatus(
        didFill
          ? gPaint && useVipOverlayForZoomPaint(gPaint)
            ? ctx.fillAcrossTilesEnabled
              ? 'Fill applied on VIP paint layer across group tiles (underlay match).'
              : 'Fill applied on VIP paint layer (this 8×8 only).'
            : ctx.fillAcrossTilesEnabled
              ? 'Fill applied across group tiles (pack tile8; underlay match).'
              : 'Fill applied (8×8 on this tile’s pattern hash in the pack).'
          : gPaint && useVipOverlayForZoomPaint(gPaint)
            ? 'No fill — pick another seed or color on the VIP paint layer.'
            : 'No fill — click a group tile (or a hole on an anchored BG tile) with a different color than the fill.',
      );
      e.preventDefault();
      return;
    }

    if (ctx.zoomViewport && ctx.zoomPaintTool === 'brush') {
      const paintWhy = getZoomPaintBlockedReason();
      if (paintWhy) {
        ctx.setStatus(paintWhy);
        e.preventDefault();
        return;
      }
      ctx.zoomPaintStrokeAllowed = true;
      ctx.activePaintUndoMap = new Map();
      const gBrush = getSelectedPaintGroupOrNull();
      if (gBrush && useVipOverlayForZoomPaint(gBrush)) ctx.activeVipOverlayUndoSnapshot = snapshotVipOverlayForStrokeUndo();
      ctx.activeZoomPaintPointer = { pointerId: e.pointerId, lastVx: px, lastVy: py };
      paintBrushPixelOnPack(px, py, ctx.brushColor());
      try {
        canvasStack.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      ctx.render();
      e.preventDefault();
      return;
    }

    if (ctx.zoomViewport && ctx.zoomPaintTool == null) {
      ctx.setStatus('Zoomed: choose Fill or Brush — zoom out to change tile selection with the marquee.');
      e.preventDefault();
      return;
    }

    // Selection mode comes from the toolbar; Shift is a shortcut for Add. (Other modifier+drag
    // combinations never reach the page in Chrome, so the toolbar is the reliable control.)
    ctx.activeMarqueePointer = {
      startVx: px,
      startVy: py,
      pointerId: e.pointerId,
      mode: e.shiftKey ? 'add' : ctx.selectionMode,
    };
    ctx.marqueeState = { x0: px, y0: py, x1: px, y1: py };
    try {
      canvasStack.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
    drawSelectionOverlay();
  });

  canvasStack?.addEventListener('pointermove', (e) => {
    if (ctx.activeZoomPaintPointer && e.pointerId === ctx.activeZoomPaintPointer.pointerId && ctx.zoomViewport && ctx.zoomPaintTool === 'brush') {
      const { px, py } = clientToVipFrame(e, ctx.canvas);
      const z = ctx.activeZoomPaintPointer;
      paintBrushLineOnPack(z.lastVx, z.lastVy, px, py, ctx.brushColor());
      z.lastVx = px;
      z.lastVy = py;
      ctx.render();
      e.preventDefault();
      return;
    }
    if (!ctx.activeMarqueePointer || e.pointerId !== ctx.activeMarqueePointer.pointerId || !ctx.canvas) return;
    const { px, py } = clientToVipFrame(e, ctx.canvas);
    ctx.marqueeState = {
      x0: ctx.activeMarqueePointer.startVx,
      y0: ctx.activeMarqueePointer.startVy,
      x1: px,
      y1: py,
    };
    drawSelectionOverlay();
  });

  const finishZoomBrushPointer = (e) => {
    if (!ctx.activeZoomPaintPointer || e.pointerId !== ctx.activeZoomPaintPointer.pointerId) return;
    try {
      canvasStack?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    ctx.activeZoomPaintPointer = null;
    commitPaintUndoStroke();
    ctx.zoomPaintStrokeAllowed = false;
    syncLastTopTileFromSelection();
    updatePaintV2TopButton();
    const gEnd = getSelectedPaintGroupOrNull();
    ctx.setStatus(
      gEnd && useVipOverlayForZoomPaint(gEnd)
        ? 'Brush stroke on VIP paint layer (authoring only until macro / pack export).'
        : 'Brush stroke written to vbcolor pack (pattern hash for each tile touched).',
    );
  };

  const finishMarqueePointer = (e) => {
    if (!ctx.activeMarqueePointer || e.pointerId !== ctx.activeMarqueePointer.pointerId || !ctx.canvas || !ctx.currentState) return;
    const { startVx, startVy, pointerId, mode: marqueeMode } = ctx.activeMarqueePointer;
    try {
      canvasStack?.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    ctx.activeMarqueePointer = null;
    const { px, py } = clientToVipFrame(e, ctx.canvas);
    ctx.marqueeState = null;
    const clickLike = Math.hypot(px - startVx, py - startVy) < DRAG_THRESH_VIP;

    // An anchor pick never reaches here: `pointerdown` resolves it and returns.

    updateGroupsPanel();
    const gKeep = ctx.selectedGroupId ? ctx.groups.find((x) => x.id === ctx.selectedGroupId) : null;
    updateGroupDetail(gKeep ?? null);
    const mode = marqueeMode || 'replace';
    if (clickLike) {
      const hits = hitDrawIndices(startVx, startVy);
      if (mode === 'replace') ctx.selectedDrawFullIndices.clear();
      if (hits.length) {
        const view = filterStateForView(ctx.currentState);
        const d = view.drawList[hits[0]];
        const fi = fullDrawIndexFromDraw(d);
        if (fi >= 0) {
          if (mode === 'remove') ctx.selectedDrawFullIndices.delete(fi);
          else ctx.selectedDrawFullIndices.add(fi);
        }
      }
      if (ctx.stackPanelEnabled) updateDrawStackPanel(startVx, startVy);
      ctx.inspectPoint = { x: startVx, y: startVy };
      explainInspectPoint();
    } else {
      const found = collectDrawIndicesInMarquee(startVx, startVy, px, py);
      if (mode === 'replace') ctx.selectedDrawFullIndices.clear();
      for (const fi of found) {
        if (mode === 'remove') ctx.selectedDrawFullIndices.delete(fi);
        else ctx.selectedDrawFullIndices.add(fi);
      }
    }
    syncLastTopTileFromSelection();
    drawSelectionOverlay();
    updateSelectionUi();
    refreshInspectorFromSelection();
    updatePaintV2TopButton();
  };

  canvasStack?.addEventListener('pointerup', (e) => {
    if (ctx.activeZoomPaintPointer && e.pointerId === ctx.activeZoomPaintPointer.pointerId) {
      finishZoomBrushPointer(e);
      return;
    }
    finishMarqueePointer(e);
  });
  canvasStack?.addEventListener('pointercancel', (e) => {
    if (ctx.activeZoomPaintPointer && e.pointerId === ctx.activeZoomPaintPointer.pointerId) {
      finishZoomBrushPointer(e);
      return;
    }
    finishMarqueePointer(e);
  });

}

/** The zoom and paint tool buttons: Zoom, Grid, Fill, Brush, Eraser, colour pick, Select. */
export function wireToolbar() {
  ctx.btnZoomSelection?.addEventListener('click', () => {
    if (ctx.zoomViewport) {
      exitZoom();
      updateSelectionUi();
      ctx.render();
    } else {
      enterZoomFromSelection();
    }
  });
  ctx.btnZoomGrid?.addEventListener('click', () => {
    ctx.zoomGridEnabled = !ctx.zoomGridEnabled;
    updateSelectionUi();
    drawSelectionOverlay();
  });

  ctx.btnPaintFill?.addEventListener('click', () => {
    setReferenceTransformModeQuiet(false);
    const w = getZoomPaintBlockedReason();
    if (w) {
      ctx.setStatus(w);
      ctx.zoomPaintTool = null;
      updateSelectionUi();
      return;
    }
    if (!ctx.currentState?.drawList?.length) {
      ctx.setStatus('Load a frame first.');
      ctx.zoomPaintTool = null;
      updateSelectionUi();
      return;
    }
    ctx.zoomPaintTool = 'fill';
    updateSelectionUi();
  });

  ctx.fillAcrossTilesInput?.addEventListener('change', () => {
    ctx.fillAcrossTilesEnabled = !!ctx.fillAcrossTilesInput.checked;
    updateSelectionUi();
    ctx.setStatus(
      ctx.fillAcrossTilesEnabled
        ? 'Fill across tiles on — bucket crosses 8×8 edges inside the paint group (same underlay color).'
        : 'Fill across tiles off — bucket stays inside one 8×8 tile.',
    );
  });

  /** Brush or Eraser: the same tool, putting paint on or taking it off. */
  const chooseBrush = (erase) => {
    setReferenceTransformModeQuiet(false);
    if (!ctx.zoomViewport) return;
    const w = getZoomPaintBlockedReason();
    if (w) {
      ctx.setStatus(w);
      ctx.zoomPaintTool = null;
      updateSelectionUi();
      return;
    }
    ctx.zoomPaintTool = 'brush';
    ctx.zoomEraseMode = erase;
    if (erase) ctx.setStatus('Eraser: drag over paint to take it off. Ctrl+Z undoes it.');
    updateSelectionUi();
  };
  ctx.btnPaintBrush?.addEventListener('click', () => chooseBrush(false));
  ctx.btnPaintErase?.addEventListener('click', () => chooseBrush(true));

  ctx.btnPaintColorPick?.addEventListener('click', async () => {
    setReferenceTransformModeQuiet(false);
    if (ctx.paintColorPickAwaitingCanvasClick) {
      ctx.paintColorPickAwaitingCanvasClick = false;
      ctx.btnPaintColorPick?.classList.remove('active');
      ctx.setStatus('Preview color pick cancelled.');
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === true && 'EyeDropper' in window) {
      try {
        const Ed = /** @type {new () => { open: () => Promise<{ sRGBHex: string }> }} */ (
          /** @type {unknown} */ (window).EyeDropper
        );
        const result = await new Ed().open();
        const hex = result?.sRGBHex;
        if (hex) {
          applyHexToZoomPaintColorInput(hex);
          const norm = normalizeColorInputHex(hex);
          ctx.setStatus(`Paint color set to ${norm || hex} (screen sample).`);
        } else ctx.setStatus('Screen pick returned no color.');
      } catch {
        ctx.setStatus('Screen color pick cancelled.');
      }
      return;
    }
    if (!ctx.canvas || !ctx.ctx) return;
    ctx.paintColorPickAwaitingCanvasClick = true;
    ctx.btnPaintColorPick?.classList.add('active');
    ctx.setStatus('Click the preview to sample a color (Esc to cancel).');
  });

  ctx.btnImportAsset?.addEventListener('click', () => {
    ctx.setStatus('Import asset — not implemented yet.');
  });

  ctx.btnCanvasSelect?.addEventListener('click', () => {
    if (ctx.zoomViewport) {
      ctx.setStatus('Zoom out to use tile selection on the full canvas.');
      return;
    }
    ctx.zoomPaintTool = null;
    updateSelectionUi();
  });

}

/** Keyboard shortcuts. */
export function wireKeyboard() {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && ctx.anchorPickGroupId) {
        ctx.anchorPickGroupId = null;
        ctx.setStatus('Anchor pick cancelled.');
        drawSelectionOverlay();
      }
      if (e.key === 'Escape' && ctx.paintColorPickAwaitingCanvasClick) {
        ctx.paintColorPickAwaitingCanvasClick = false;
        ctx.btnPaintColorPick?.classList.remove('active');
        ctx.setStatus('Preview color pick cancelled.');
      }
      // Escape with nothing else pending lets go of the selected group.
      if (e.key === 'Escape' && !ctx.anchorPickGroupId && !ctx.paintColorPickAwaitingCanvasClick && ctx.selectedGroupId) {
        const target = /** @type {HTMLElement|null} */ (e.target);
        const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        if (!typing && !ctx.newGroupDialog?.open && !ctx.duplicateGroupDialog?.open && !ctx.frameDetailsDialog?.open) {
          ctx.deselectGroup('Group deselected (Esc) — its outlines are off.');
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      // H toggles Highlight while a Show filter is on (not while typing or in a dialog).
      if (!mod && !e.altKey && (e.key === 'h' || e.key === 'H') && frameFilter !== 'all') {
        const el = /** @type {HTMLElement|null} */ (e.target);
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        if (!typing && !document.querySelector('dialog[open]')) {
          e.preventDefault();
          setFrameHighlight(!frameHighlight);
        }
      }
      if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        const t = /** @type {EventTarget|null} */ (e.target);
        const el = t && /** @type {HTMLElement} */ (t).nodeType === 1 ? /** @type {HTMLElement} */ (t) : null;
        /** Let undo run while the paint color well is focused (still an <input type="color">). */
        const paintColorInputFocused = el?.tagName === 'INPUT' && el.id === 'zoom-paint-color';
        if (
          el &&
          !paintColorInputFocused &&
          (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            /** @type {HTMLElement} */ (el).isContentEditable)
        ) {
          return;
        }
        if (ctx.newGroupDialog?.open || ctx.duplicateGroupDialog?.open) return;
        if (ctx.paintUndoStack.length === 0) return;
        e.preventDefault();
        undoLastZoomPaint();
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y, outside text fields and dialogs, like undo.
      if (mod && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || (!e.shiftKey && (e.key === 'y' || e.key === 'Y')))) {
        const el = /** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target : null);
        const typing = el && el.id !== 'zoom-paint-color' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        if (typing || ctx.newGroupDialog?.open || ctx.duplicateGroupDialog?.open || paintRedoStack.length === 0) return;
        e.preventDefault();
        redoLastZoomPaint();
      }
    },
    true,
  );
}
