/**
 * Pack editor: load tile manifest, assign color per tile, export .vbcolor.
 */

import { hashTile } from '../src/vip-state.js';
import { buildVBColorPack } from '../src/vbcolor-pack.js';

const BYTES_PER_TILE = 16;
const TILE_SIZE = 8;

/** @type {Map<number, Uint8Array>} hash -> 16-byte tile data */
let tilesByHash = new Map();
/** @type {Map<number, Uint8Array>} hash -> 256-byte RGBA */
let colorByHash = new Map();
let selectedHash = null;

const gridEl = document.getElementById('grid-container');
const sidebarEl = document.getElementById('sidebar');
const colorInput = document.getElementById('tile-color');
const btnApply = document.getElementById('btn-apply');
const btnExport = document.getElementById('btn-export');
const gameIdInput = document.getElementById('game-id');

/**
 * Decode 2bpp VB tile (16 bytes) to 8×8 indices 0–3.
 */
function decodeTile(u8) {
  const out = new Uint8Array(64);
  for (let row = 0; row < 8; row++) {
    const a = u8[row * 2];
    const b = u8[row * 2 + 1];
    for (let col = 0; col < 8; col++) {
      const bit = 7 - col;
      out[row * 8 + col] = ((a >> bit) & 1) | (((b >> bit) & 1) << 1);
    }
  }
  return out;
}

/**
 * Render 16-byte tile to canvas (mono red shades for preview).
 */
function drawTilePreview(canvas, tileBytes) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const decoded = decodeTile(tileBytes);
  const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  const shades = [[0,0,0,0], [80,0,0,255], [160,0,0,255], [255,0,0,255]];
  for (let i = 0; i < 64; i++) {
    const s = shades[decoded[i]];
    img.data[i*4] = s[0];
    img.data[i*4+1] = s[1];
    img.data[i*4+2] = s[2];
    img.data[i*4+3] = s[3];
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Convert hex color to RGB.
 */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Build 256-byte RGBA for a tile: use decoded 2bpp (0=transparent, 1–3=color at 33%, 66%, 100%).
 */
function tileToRgba(tileBytes, hexColor) {
  const [r, g, b] = hexToRgb(hexColor);
  const decoded = decodeTile(tileBytes);
  const rgba = new Uint8Array(256);
  const levels = [
    [0, 0, 0, 0],
    [Math.round(r * 0.33), Math.round(g * 0.33), Math.round(b * 0.33), 255],
    [Math.round(r * 0.66), Math.round(g * 0.66), Math.round(b * 0.66), 255],
    [r, g, b, 255],
  ];
  for (let i = 0; i < 64; i++) {
    const L = levels[decoded[i]];
    rgba[i*4] = L[0];
    rgba[i*4+1] = L[1];
    rgba[i*4+2] = L[2];
    rgba[i*4+3] = L[3];
  }
  return rgba;
}

document.getElementById('manifest-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const manifest = JSON.parse(await file.text());
    tilesByHash = new Map();
    colorByHash = new Map();
    selectedHash = null;
    const list = manifest.tiles || [];
    for (const t of list) {
      const data = base64ToU8(t.dataBase64);
      if (data.length >= BYTES_PER_TILE) {
        const hash = t.hash ?? hashTile(data);
        tilesByHash.set(hash, data.slice(0, BYTES_PER_TILE));
      }
    }
    renderGrid();
    sidebarEl.style.display = 'none';
    btnExport.disabled = tilesByHash.size === 0;
  } catch (err) {
    alert('Failed to load manifest: ' + (err.message || String(err)));
  }
});

function base64ToU8(base64) {
  const bin = atob(base64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function renderGrid() {
  if (!gridEl) return;
  gridEl.innerHTML = '';
  gridEl.className = 'tile-grid';
  for (const [hash, tileBytes] of tilesByHash) {
    const cell = document.createElement('div');
    cell.className = 'tile-cell' + (selectedHash === hash ? ' selected' : '');
    cell.dataset.hash = String(hash);
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const rgba = colorByHash.get(hash);
    if (rgba) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
        img.data.set(rgba);
        ctx.putImageData(img, 0, 0);
      }
    } else {
      drawTilePreview(canvas, tileBytes);
    }
    cell.appendChild(canvas);
    cell.addEventListener('click', () => selectTile(hash));
    gridEl.appendChild(cell);
  }
}

function selectTile(hash) {
  selectedHash = hash;
  sidebarEl.style.display = 'block';
  const rgba = colorByHash.get(hash);
  if (rgba) {
    const r = rgba[0], g = rgba[1], b = rgba[2];
    colorInput.value = '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
  }
  renderGrid();
}

btnApply?.addEventListener('click', () => {
  if (selectedHash == null) return;
  const tileBytes = tilesByHash.get(selectedHash);
  if (!tileBytes) return;
  const rgba = tileToRgba(tileBytes, colorInput.value);
  colorByHash.set(selectedHash, rgba);
  renderGrid();
});

btnExport?.addEventListener('click', () => {
  const gameId = (gameIdInput?.value || '').trim() || 'game';
  const entries = new Map();
  for (const hash of tilesByHash.keys()) {
    const rgba = colorByHash.get(hash);
    if (rgba) entries.set(hash, rgba);
  }
  if (entries.size === 0) {
    alert('Color at least one tile (select tile, pick color, Apply) before exporting.');
    return;
  }
  const buffer = buildVBColorPack(gameId, entries);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = gameId + '.vbcolor';
  a.click();
  URL.revokeObjectURL(a.href);
});
