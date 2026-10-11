/**
 * Phase 1B: Frame viewer — load vbstate.json, render frame in draw order with 4-color palette.
 */

import { deserializeVIPState, validateVIPState } from '../src/vip-dump.js';
import { getTileBytes } from '../src/vip-state.js';
import { drawTileIntoImageData } from '../src/vb-2bpp.js';
import { PALETTE_PRESETS } from '../src/palette-layer.js';

const W = 384;
const H = 224;

const canvas = document.getElementById('canvas');
const placeholder = document.getElementById('placeholder');
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('file-input');
const presetSelect = document.getElementById('palette-preset');

if (!canvas) throw new Error('canvas not found');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d context not available');
const imageData = ctx.createImageData(W, H);

/** @type {{ patternTable: Uint8Array, drawList: Array<{ tileIndex: number, x: number, y: number, flipH?: boolean, flipV?: boolean, eye?: number, layer?: number, paletteSelector?: number }>, screenshotDataURL?: string } | null} */
let currentState = null;
let offsetX = 0;
let offsetY = 0;
let lastClickedDrawIndex = null;
/** After a click: all draws under that pixel (back-to-front) for status/layers summary. */
let lastClickHits = [];
let lastClickPixel = null;

/** Current eye selection: 0 = left, 1 = right. Draws without eye use 0 (left). */
function getSelectedEye() {
  const v = document.getElementById('eye-select')?.value;
  const n = Number(v);
  return (n === 0 || n === 1) ? n : 0;
}

/** Layer filter: 'all' or 0=BG, 1=Affine, 2=OBJ. Draws without layer (legacy vbstate) only pass when 'all'. */
function getSelectedLayer() {
  const v = document.getElementById('layer-select')?.value;
  if (v === 'all' || v === '' || v == null) return 'all';
  return Number(v);
}

/** Normalize draw eye to 0 or 1 (handles missing/legacy and string from JSON). */
function drawEye(d) {
  const e = d.eye;
  if (e === 0 || e === 1) return e;
  const n = Number(e);
  return (n === 0 || n === 1) ? n : 0;
}

/** Draw list filtered to the selected eye and layer (for rendering and hit-test). */
function getDrawListForEye() {
  if (!currentState?.drawList?.length) return [];
  const eye = getSelectedEye();
  const layer = getSelectedLayer();
  return currentState.drawList.filter((d) => {
    if (drawEye(d) !== eye) return false;
    if (layer === 'all') return true;
    return d.layer === layer;
  });
}

/** Human-readable layer name for a draw (for status and console). */
function getLayerName(d) {
  if (d.layer === 0) return 'BG';
  if (d.layer === 1) return 'Affine';
  if (d.layer === 2) return 'OBJ';
  return '?';
}

/** Scale a [R,G,B] color by factor (0..1). */
function scaleColor(rgb, factor) {
  return [Math.round(rgb[0] * factor), Math.round(rgb[1] * factor), Math.round(rgb[2] * factor)];
}

/** Luminance for [R,G,B] (0–255) for shade ordering. */
function luminance(rgb) {
  if (!rgb || rgb.length < 3) return 0;
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/**
 * When using captured palettes in "Shaded" mode: map the 4 master colors to shade ranks 0–3
 * (darkest → 0, brightest → 3) so we can substitute the preset's ramp. Returns an array
 * where result[masterIndex] = shade rank 0–3. Ensures transparent/dark (rank 0) is consistent.
 */
function getShadeRankByMasterIndex(masterColors) {
  const indices = [0, 1, 2, 3];
  indices.sort((a, b) => luminance(masterColors[a] || [0, 0, 0]) - luminance(masterColors[b] || [0, 0, 0]));
  const rankByMaster = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) rankByMaster[indices[r]] = r;
  return rankByMaster;
}

/**
 * Return four 4-color palettes for per-tile palette selector (0..3).
 * When vbstate has captured gplt + masterColors and "Use captured palettes" is checked:
 *   - "Shaded (preset tint)": use captured structure (which slot is dark/transparent) but map to the
 *     selected preset so darkest/transparent always = preset[0] (same on all custom palettes).
 *   - "Exact": use game RGB as-is.
 * Otherwise use the selected preset (4 ramps dark → bright).
 * Legacy vbstates without paletteSelector are treated as palette 0.
 */
function getCurrentPaletteSet() {
  const useCaptured = document.getElementById('use-captured-palettes')?.checked !== false;
  const capturedMode = document.getElementById('captured-palette-mode')?.value || 'shaded';
  const gplt = currentState?.gplt;
  const masterColors = currentState?.masterColors;
  const hasCaptured = Array.isArray(gplt) && gplt.length >= 4 && Array.isArray(masterColors) && masterColors.length >= 4;
  if (hasCaptured && useCaptured) {
    const blackBg = document.getElementById('black-bg')?.checked ?? false;
    const key = presetSelect?.value || 'original';
    const base = PALETTE_PRESETS[key] || PALETTE_PRESETS.original;
    const preset4 = blackBg && base.length >= 4
      ? [[0, 0, 0], base[1] || [0, 0, 0], base[2] || [0, 0, 0], base[3] || [0, 0, 0]]
      : [base[0] || [0, 0, 0], base[1] || [0, 0, 0], base[2] || [0, 0, 0], base[3] || [0, 0, 0]];

    if (capturedMode === 'shaded') {
      const rankByMaster = getShadeRankByMasterIndex(masterColors);
      const set = [];
      for (let p = 0; p < 4; p++) {
        const reg = (gplt[p] >>> 0) & 0xFF;
        set.push([
          preset4[rankByMaster[(reg >> 0) & 3]] || [0, 0, 0],
          preset4[rankByMaster[(reg >> 2) & 3]] || [0, 0, 0],
          preset4[rankByMaster[(reg >> 4) & 3]] || [0, 0, 0],
          preset4[rankByMaster[(reg >> 6) & 3]] || [0, 0, 0],
        ]);
      }
      return set;
    }
    const set = [];
    for (let p = 0; p < 4; p++) {
      const reg = (gplt[p] >>> 0) & 0xFF;
      set.push([
        masterColors[(reg >> 0) & 3] || [0, 0, 0],
        masterColors[(reg >> 2) & 3] || [0, 0, 0],
        masterColors[(reg >> 4) & 3] || [0, 0, 0],
        masterColors[(reg >> 6) & 3] || [0, 0, 0],
      ]);
    }
    return set;
  }
  const key = presetSelect?.value || 'original';
  const base = PALETTE_PRESETS[key] || PALETTE_PRESETS.original;
  const blackBg = document.getElementById('black-bg')?.checked ?? false;
  const palette2Black = document.getElementById('palette-2-black')?.checked ?? false;
  const factors = [0.45, 0.65, 0.85, 1.0]; // palette 0 = darkest, 3 = brightest
  const set = [];
  for (let p = 0; p < 4; p++) {
    if (p === 2 && palette2Black) {
      set.push([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
      continue;
    }
    const f = factors[p];
    const c = [
      blackBg ? [0, 0, 0] : (base[0] ? scaleColor(base[0], f) : [0, 0, 0]),
      base[1] ? scaleColor(base[1], f) : [0, 0, 0],
      base[2] ? scaleColor(base[2], f) : [0, 0, 0],
      base[3] ? scaleColor(base[3], f) : [0, 0, 0],
    ];
    set.push(c);
  }
  return set;
}

function getCropTop() {
  return Math.max(0, Number(document.getElementById('crop-top')?.value) || 0);
}
function getClearTop() {
  return Math.max(0, Math.min(224, Number(document.getElementById('clear-top')?.value) || 0));
}
function getClearLeft() {
  return Math.max(0, Math.min(384, Number(document.getElementById('clear-left')?.value) || 0));
}
function getClearRight() {
  return Math.max(0, Math.min(384, Number(document.getElementById('clear-right')?.value) || 0));
}

function getScaleX() {
  return Math.max(0.5, Math.min(2, Number(document.getElementById('scale-x')?.value) || 1));
}
function getScaleY() {
  return Math.max(0.5, Math.min(2, Number(document.getElementById('scale-y')?.value) || 1));
}
function getOriginX() {
  return Number(document.getElementById('origin-x')?.value) || 192;
}
function getOriginY() {
  return Number(document.getElementById('origin-y')?.value) || 112;
}

/** Transform draw list (x,y) to display position and scaled tile size. */
function transformDraw(call) {
  const ox = getOriginX();
  const oy = getOriginY();
  const sx = getScaleX();
  const sy = getScaleY();
  const displayX = ox + (call.x - ox) * sx + offsetX;
  const displayY = oy + (call.y - oy) * sy + offsetY;
  const destW = 8 * sx;
  const destH = 8 * sy;
  return { displayX, displayY, destW, destH };
}

function showEmpty(message = 'No frame loaded. Load a vbstate.json file to view.') {
  currentState = null;
  if (placeholder) {
    placeholder.textContent = message;
    placeholder.classList.remove('hidden');
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (statusEl) statusEl.textContent = '';
}

function renderFrame() {
  if (!currentState || !currentState.drawList || currentState.drawList.length === 0) {
    showEmpty('This frame has no draw list. No tiles to display.');
    return;
  }
  const list = getDrawListForEye();
  if (list.length === 0) {
    // Show message and clear canvas but keep currentState so switching back to the other eye works.
    const leftCount = currentState.drawList.filter((d) => drawEye(d) === 0).length;
    const rightCount = currentState.drawList.filter((d) => drawEye(d) === 1).length;
    if (placeholder) {
      placeholder.textContent = `No draws for ${getSelectedEye() === 1 ? 'right' : 'left'} eye. Try the other eye.`;
      placeholder.classList.remove('hidden');
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (statusEl) {
      statusEl.textContent = `No draws for ${getSelectedEye() === 1 ? 'Right' : 'Left'} eye. This vbstate has Left: ${leftCount}, Right: ${rightCount} draws — ${rightCount === 0 ? 're-save from the app with the current core to get both eyes.' : 'switch to the other eye.'}`;
    }
    return;
  }
  if (placeholder) placeholder.classList.add('hidden');
  const paletteSet = getCurrentPaletteSet();
  imageData.data.fill(0);
  const patternTable = currentState.patternTable;
  if (!patternTable || patternTable.length < 16) {
    showEmpty('Invalid pattern table.');
    return;
  }
  const cropTop = getCropTop();
  const scaleX = getScaleX();
  const scaleY = getScaleY();
  const transparent0 = document.getElementById('transparent-0')?.checked ?? false;
  for (const call of list) {
    if (call.y < cropTop) continue;
    const palIdx = (call.paletteSelector != null ? call.paletteSelector : 0) & 3;
    const colors4 = paletteSet[palIdx];
    const { displayX, displayY, destW, destH } = transformDraw(call);
    const tileBytes = getTileBytes(patternTable, call.tileIndex);
    drawTileIntoImageData(imageData, displayX, displayY, tileBytes, colors4, {
      flipH: call.flipH ?? false,
      flipV: call.flipV ?? false,
      destW,
      destH,
      skipPalette0: transparent0,
    });
  }
  ctx.putImageData(imageData, 0, 0);
  const clearTop = getClearTop();
  const clearLeft = getClearLeft();
  const clearRight = getClearRight();
  if (clearTop > 0 || clearLeft > 0 || clearRight > 0) {
    ctx.fillStyle = '#000';
    if (clearTop > 0) ctx.fillRect(0, 0, W, clearTop);
    if (clearLeft > 0) ctx.fillRect(0, 0, clearLeft, H);
    if (clearRight > 0) ctx.fillRect(W - clearRight, 0, clearRight, H);
  }
  const eyeVal = getSelectedEye();
  if (lastClickedDrawIndex != null && currentState.drawList[lastClickedDrawIndex]) {
    const d = currentState.drawList[lastClickedDrawIndex];
    if (drawEye(d) === eyeVal) {
      const { displayX, displayY, destW, destH } = transformDraw(d);
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(displayX), Math.round(displayY), Math.round(destW), Math.round(destH));
    }
  }
  updateViewMode();
  const eyeLabel = eyeVal === 1 ? 'Right' : 'Left';
  const layerVal = getSelectedLayer();
  const layerLabel = layerVal === 'all' ? '' : `, ${layerVal === 0 ? 'BG' : layerVal === 1 ? 'Affine' : 'OBJ'} only`;
  const blackBg = document.getElementById('black-bg')?.checked ?? false;
  const hasCapturedPalettes = currentState?.gplt?.length >= 4 && currentState?.masterColors?.length >= 4;
  const useRealPalettes = hasCapturedPalettes && (document.getElementById('use-captured-palettes')?.checked !== false);
  const capturedMode = document.getElementById('captured-palette-mode')?.value || 'shaded';
  const paletteLabel = useRealPalettes
    ? (capturedMode === 'shaded' ? `captured shaded (${presetSelect?.value || 'original'})` : 'captured (exact)')
    : (presetSelect?.value || 'original');
  let status = `Frame: ${list.length} draws (${eyeLabel} eye${layerLabel}), palette: ${paletteLabel}`;
  if (offsetX || offsetY) status += `, offset (${offsetX}, ${offsetY})`;
  if (scaleX !== 1 || scaleY !== 1) status += `, scale (${scaleX}, ${scaleY})`;
  if (cropTop) status += `, crop top ${cropTop}`;
  if (clearTop) status += `, clear top ${clearTop}`;
  if (clearLeft) status += `, clear left ${clearLeft}`;
  if (clearRight) status += `, clear right ${clearRight}`;
  if (blackBg) status += ', black BG';
  if (document.getElementById('palette-2-black')?.checked) status += ', pal2=black (debug)';
  if (lastClickPixel != null) {
    if (lastClickHits.length > 0) {
      const layerNames = lastClickHits.map((h) => getLayerName({ layer: h.layer }));
      status += ` • At (${Math.floor(lastClickPixel.px)},${Math.floor(lastClickPixel.py)}): ${lastClickHits.length} draw(s) [${layerNames.join(' → ')}]`;
      const top = currentState?.drawList?.[lastClickedDrawIndex];
      if (top && drawEye(top) === eyeVal) {
        status += ` — top: #${lastClickedDrawIndex} tile ${top.tileIndex}`;
        if (top.paletteSelector != null) status += ` pal${top.paletteSelector}`;
      }
    } else {
      status += ` • At (${Math.floor(lastClickPixel.px)},${Math.floor(lastClickPixel.py)}): 0 draws (background only)`;
    }
  } else if (lastClickedDrawIndex != null && currentState?.drawList?.[lastClickedDrawIndex]) {
    const d = currentState.drawList[lastClickedDrawIndex];
    if (drawEye(d) === eyeVal) {
      status += ` • selected: #${lastClickedDrawIndex} tile ${d.tileIndex} ${getLayerName(d)}`;
      if (d.paletteSelector != null) status += ` pal${d.paletteSelector}`;
    }
  }
  if (statusEl) statusEl.textContent = status;
}

function loadFromObject(obj) {
  const validation = validateVIPState(obj);
  if (!validation.valid) {
    showEmpty(`Invalid vbstate: ${validation.errors.join('; ')}`);
    return;
  }
  const state = deserializeVIPState(obj);
  if (!state.drawList || state.drawList.length === 0) {
    showEmpty('This frame has no draw list. No tiles to display.');
    return;
  }
  currentState = { ...state, screenshotDataURL: obj.screenshotDataURL || null };
  lastClickedDrawIndex = null;
  lastClickHits = [];
  lastClickPixel = null;
  const hasPalette = currentState.drawList.some((d) => d.paletteSelector !== undefined && d.paletteSelector !== null);
  const hasRealPalettes = currentState.gplt?.length >= 4 && currentState.masterColors?.length >= 4;
  console.log('[VB viewer] Loaded', currentState.drawList.length, 'draws; per-draw palette (paletteSelector):', hasPalette ? 'yes' : 'no (old core or legacy capture)', hasRealPalettes ? '; GPLT + master colors: yes' : '');
  const screenshotImg = document.getElementById('screenshot-img');
  if (screenshotImg) {
    if (currentState.screenshotDataURL) {
      screenshotImg.src = currentState.screenshotDataURL;
      screenshotImg.classList.add('has-screenshot');
    } else {
      screenshotImg.removeAttribute('src');
      screenshotImg.classList.remove('has-screenshot');
    }
  }
  const viewMode = document.getElementById('view-mode');
  const hasScreen = !!currentState.screenshotDataURL;
  viewMode?.querySelectorAll('option[value="screenshot"], option[value="overlay"]').forEach((o) => { o.disabled = !hasScreen; });
  if (viewMode && !hasScreen && (viewMode.value === 'screenshot' || viewMode.value === 'overlay')) viewMode.value = 'render';
  renderFrame();
}

/**
 * Build a canvas containing the current view (Render, Screenshot, or Overlay composite).
 * @returns {HTMLCanvasElement | null}
 */
function getCurrentViewCanvas() {
  if (!currentState) return null;
  const mode = document.getElementById('view-mode')?.value || 'render';
  const opacity = Number(document.getElementById('overlay-opacity')?.value) || 0.6;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const screenshotImg = document.getElementById('screenshot-img');
  if (mode === 'screenshot' && currentState.screenshotDataURL && screenshotImg?.complete) {
    octx.drawImage(screenshotImg, 0, 0);
    return out;
  }
  if (mode === 'render') {
    octx.drawImage(canvas, 0, 0);
    return out;
  }
  if (mode === 'overlay' && currentState.screenshotDataURL && screenshotImg?.complete) {
    octx.drawImage(screenshotImg, 0, 0);
    octx.globalAlpha = opacity;
    octx.drawImage(canvas, 0, 0);
    octx.globalAlpha = 1;
    return out;
  }
  octx.drawImage(canvas, 0, 0);
  return out;
}

function updateViewMode() {
  const mode = document.getElementById('view-mode')?.value || 'render';
  const opacity = Number(document.getElementById('overlay-opacity')?.value) || 0.6;
  const screenshotImg = document.getElementById('screenshot-img');
  if (screenshotImg) {
    if (mode === 'screenshot' && currentState?.screenshotDataURL) {
      screenshotImg.style.display = 'block';
      screenshotImg.style.opacity = '1';
      screenshotImg.classList.add('copyable');
    } else if (mode === 'overlay' && currentState?.screenshotDataURL) {
      screenshotImg.style.display = 'block';
      screenshotImg.style.opacity = '1';
      screenshotImg.classList.remove('copyable');
    } else {
      screenshotImg.style.display = 'none';
      screenshotImg.classList.remove('copyable');
    }
  }
  if (canvas) {
    if (mode === 'screenshot') {
      canvas.style.opacity = '0';
      canvas.style.pointerEvents = 'none';
    } else {
      canvas.style.opacity = mode === 'overlay' ? String(opacity) : '1';
      canvas.style.pointerEvents = 'auto';
    }
  }
}

async function loadFromFile(file) {
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    loadFromObject(obj);
  } catch (err) {
    showEmpty(`Could not load file: ${err.message || String(err)}`);
  }
}

// Preset dropdown
const presetKeys = Object.keys(PALETTE_PRESETS);
for (const key of presetKeys) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = key;
  if (key === 'original') opt.selected = true;
  presetSelect?.appendChild(opt);
}
presetSelect?.addEventListener('change', () => {
  if (currentState) renderFrame();
});
document.getElementById('eye-select')?.addEventListener('change', () => {
  if (currentState) renderFrame();
});
document.getElementById('layer-select')?.addEventListener('change', () => {
  if (currentState) renderFrame();
});
document.getElementById('view-mode')?.addEventListener('change', () => { if (currentState) updateViewMode(); });
document.getElementById('overlay-opacity')?.addEventListener('input', () => { if (currentState) updateViewMode(); });
document.getElementById('offset-x')?.addEventListener('input', (e) => { offsetX = Number(e.target.value) || 0; if (currentState) renderFrame(); });
document.getElementById('offset-y')?.addEventListener('input', (e) => { offsetY = Number(e.target.value) || 0; if (currentState) renderFrame(); });
document.getElementById('scale-x')?.addEventListener('input', () => { if (currentState) renderFrame(); });
document.getElementById('scale-y')?.addEventListener('input', () => { if (currentState) renderFrame(); });
document.getElementById('origin-x')?.addEventListener('input', () => { if (currentState) renderFrame(); });
document.getElementById('origin-y')?.addEventListener('input', () => { if (currentState) renderFrame(); });
document.getElementById('crop-top')?.addEventListener('input', () => { if (currentState) renderFrame(); });
document.getElementById('clear-top')?.addEventListener('input', () => { if (currentState) renderFrame(); });
document.getElementById('clear-left')?.addEventListener('input', () => { if (currentState) renderFrame(); });
document.getElementById('clear-right')?.addEventListener('input', () => { if (currentState) renderFrame(); });
document.getElementById('black-bg')?.addEventListener('change', () => { if (currentState) renderFrame(); });
document.getElementById('transparent-0')?.addEventListener('change', () => { if (currentState) renderFrame(); });
document.getElementById('palette-2-black')?.addEventListener('change', () => { if (currentState) renderFrame(); });
document.getElementById('use-captured-palettes')?.addEventListener('change', () => { if (currentState) renderFrame(); });
document.getElementById('captured-palette-mode')?.addEventListener('change', () => { if (currentState) renderFrame(); });

document.getElementById('btn-export-png')?.addEventListener('click', () => {
  const c = getCurrentViewCanvas();
  if (!c) return;
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vbviewer-export.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});

document.getElementById('btn-copy-image')?.addEventListener('click', async () => {
  const c = getCurrentViewCanvas();
  if (!c) return;
  try {
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (e) {
    console.warn('[VB viewer] Copy failed:', e?.message || e);
  }
});

// File input
fileInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadFromFile(file);
});

// Drag and drop
const frameWrap = document.getElementById('frame-wrap');
frameWrap?.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  frameWrap.style.outline = '2px dashed #666';
});
frameWrap?.addEventListener('dragleave', () => {
  frameWrap.style.outline = '';
});
frameWrap?.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  frameWrap.style.outline = '';
  const file = e.dataTransfer?.files?.[0];
  if (file && file.name.endsWith('.json')) loadFromFile(file);
  else showEmpty('Drop a vbstate.json file.');
});

// Debug: show 384×224 display border
const displayBorder = document.getElementById('display-border');
const btnBorder = document.getElementById('btn-toggle-border');
btnBorder?.addEventListener('click', () => {
  if (!displayBorder) return;
  const show = displayBorder.style.display !== 'block';
  displayBorder.style.display = show ? 'block' : 'none';
  if (btnBorder) btnBorder.textContent = show ? 'Hide display border' : 'Show display border';
});

// Debug: log alignment sample — bands with representative Y and distance from center for data gathering
const ALIGNMENT_BANDS = [
  { name: 'Top bar', yMin: 0, yMax: 39 },
  { name: 'Title', yMin: 40, yMax: 79 },
  { name: 'PUSH START', yMin: 80, yMax: 119 },
  { name: 'Middle', yMin: 120, yMax: 159 },
  { name: 'Copyright', yMin: 160, yMax: 224 },
];
const CENTER_Y = 112;

document.getElementById('btn-log-alignment-sample')?.addEventListener('click', () => {
  if (!currentState?.drawList?.length) {
    console.log('[VB viewer] No frame loaded. Load a vbstate first.');
    return;
  }
  const list = getDrawListForEye();
  if (list.length === 0) {
    console.log('[VB viewer] No draws for selected eye.');
    return;
  }
  const rows = ALIGNMENT_BANDS.map((band) => {
    const inBand = list.filter((d) => d.y >= band.yMin && d.y <= band.yMax);
    const ys = inBand.length ? inBand.map((d) => d.y) : [];
    const representativeY = ys.length ? ys.sort((a, b) => a - b)[Math.floor(ys.length / 2)] : null;
    const distanceFromCenter = representativeY != null ? representativeY - CENTER_Y : null;
    return {
      Band: band.name,
      'Y range': `${band.yMin}–${band.yMax}`,
      'Representative Y': representativeY ?? '—',
      'Distance from center': distanceFromCenter != null ? distanceFromCenter : '—',
      'Offset Y (manual)': '(fill after testing)',
    };
  });
  console.log('[VB viewer] Alignment sample (screen center Y = ' + CENTER_Y + '). Fill "Offset Y (manual)" per band, then check if offset is linear in distance from center.');
  console.table(rows);
  const markdown = [
    '| Band | Representative Y | Distance from center (Y−112) | Best offset Y (manual) | Notes |',
    '|------|------------------|------------------------------|------------------------|-------|',
    ...rows.map((r) => `| ${r.Band} | ${r['Representative Y']} | ${r['Distance from center']} | | |`),
  ].join('\n');
  console.log('[VB viewer] Markdown table for doc:\n' + markdown);
});

// Debug: log draw list summary to console
document.getElementById('btn-log-summary')?.addEventListener('click', () => {
  if (!currentState?.drawList?.length) {
    console.log('[VB viewer] No frame loaded. Load a vbstate first.');
    return;
  }
  const list = currentState.drawList;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of list) {
    const r = d.x + 8, b = d.y + 8;
    if (d.x < minX) minX = d.x;
    if (d.y < minY) minY = d.y;
    if (r > maxX) maxX = r;
    if (b > maxY) maxY = b;
  }
  const leftCount = list.filter((d) => drawEye(d) === 0).length;
  const rightCount = list.filter((d) => drawEye(d) === 1).length;
  const layerCounts = { BG: list.filter((d) => d.layer === 0).length, Affine: list.filter((d) => d.layer === 1).length, OBJ: list.filter((d) => d.layer === 2).length, unknown: list.filter((d) => d.layer === undefined || d.layer === null).length };
  const head = list.slice(0, 20).map((d, i) => ({ i, tileIndex: d.tileIndex, x: d.x, y: d.y, eye: drawEye(d), layer: getLayerName(d), flipH: d.flipH, flipV: d.flipV }));
  const tail = list.slice(-5).map((d, j) => ({ i: list.length - 5 + j, tileIndex: d.tileIndex, x: d.x, y: d.y, eye: drawEye(d), layer: getLayerName(d), flipH: d.flipH, flipV: d.flipV }));
  // Per-band stats: 8 rows per band (same as VIP strips). Shows if X offset or density varies by Y.
  const BAND_H = 8;
  const bands = [];
  for (let by = 0; by < 224; by += BAND_H) {
    const inBand = list.filter((d) => d.y >= by && d.y < by + BAND_H);
    if (inBand.length === 0) continue;
    let bMinX = Infinity, bMaxX = -Infinity;
    for (const d of inBand) {
      if (d.x < bMinX) bMinX = d.x;
      if (d.x + 8 > bMaxX) bMaxX = d.x + 8;
    }
    bands.push({ y0: by, count: inBand.length, minX: bMinX, maxX: bMaxX });
  }
  console.log('[VB viewer] Draw list summary:', {
    frameNumber: currentState.frameNumber,
    drawCount: list.length,
    eyeCounts: { left: leftCount, right: rightCount },
    layerCounts,
    bounds: { minX, minY, maxX, maxY },
    bandsByY: bands.slice(0, 35),
    first20: head,
    last5: tail,
  });
});

// Debug: click canvas to log draw(s) under that pixel (back-to-front, current eye only) and highlight topmost
canvas.addEventListener('click', (e) => {
  if (!currentState?.drawList?.length) return;
  const eyeVal = getSelectedEye();
  const rect = canvas.getBoundingClientRect();
  const canvasScaleX = canvas.width / rect.width;
  const canvasScaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * canvasScaleX;
  const py = (e.clientY - rect.top) * canvasScaleY;
  const hits = [];
  for (let i = currentState.drawList.length - 1; i >= 0; i--) {
    const d = currentState.drawList[i];
    if (drawEye(d) !== eyeVal) continue;
    const { displayX, displayY, destW, destH } = transformDraw(d);
    if (px >= displayX && px < displayX + destW && py >= displayY && py < displayY + destH) {
      hits.push({ index: i, tileIndex: d.tileIndex, x: d.x, y: d.y, eye: drawEye(d), layer: d.layer, flipH: d.flipH, flipV: d.flipV, paletteSelector: d.paletteSelector });
    }
  }
  if (hits.length) lastClickedDrawIndex = hits[0].index;
  else lastClickedDrawIndex = null;
  lastClickHits = hits;
  lastClickPixel = { px, py }; // always set so status can show "0 draws (background)" when nothing is there
  renderFrame();
  const CENTER_Y = 112; // 224 / 2
  const hitsWithCenter = hits.map(({ index, tileIndex, x, y, eye, layer, flipH, flipV, paletteSelector }) => ({
    index, tileIndex, x, y, eye, layer, layerName: getLayerName({ layer }), flipH, flipV, paletteSelector,
    distanceFromCenterY: y - CENTER_Y,
  }));
  const drawLabel = hits.length ? `${hits.length} draw(s) (back-to-front)` : '0 draws (background only)';
  console.log('[VB viewer] Click at pixel', Math.floor(px), Math.floor(py), '—', drawLabel + ':', hits.length ? hitsWithCenter : '—');
});

// Initial state
showEmpty();
