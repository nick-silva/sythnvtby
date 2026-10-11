/**
 * sythnvtby Player (player.html): play a game coloured with the sythnvtby tools. Not a development
 * tool — no capture, painting or debug panels. Load the game's ROM and its play pack (.vbcplay,
 * src/play-pack.js); the player checks the ROM is the one the pack was made for, then runs the
 * patched Beetle VB core and draws the colour over it, in 2D or 3D.
 *
 * See docs/design/vb-color-player.md §3.
 */

import { pushVIPState, setVIPStateConsumer } from './vip-state.js';
import { createColorCanvas, wireColorLayer, DEFAULT_FADE_RESPONSE } from './color-layer.js';
import { buildVBColorPack } from './vbcolor-pack.js';
import { parsePlayPack } from './play-pack.js';
import { projectFromParsed } from './project.js';
import { romIdentity } from './rom-identity.js';
import { coreStereoOptions } from './stereo-view.js';
import { installLayerArtDecoder } from './layer-art-png.js';
import { onLayerArtDecoded } from './layer-art.js';
import { playerReadiness } from './player-flow.js';
import { savePlayerFile, loadPlayerFile } from './player-storage.js';

/** Start the game right away after a reload (another ROM or pack chosen mid-game). */
const AUTOSTART_KEY = 'vbcp-autostart';
const VIEW_KEY = 'vbcp-view';
const LOADER_ID = 'ejs-loader-script';

const el = (id) => document.getElementById(id);
const stage = el('stage');
const splash = el('splash');
const statusEl = el('player-status');

/** @type {{ name: string, buffer: ArrayBuffer, id: { sha1: string, crc32: string, size: number } } | null} */
let rom = null;
/** @type {(Awaited<ReturnType<typeof parsePlayPack>> & { name: string }) | null} */
let pack = null;
let mismatchAccepted = false;
let started = false;
let paused = false;
let colourOn = true;
/** @type {'2d' | 'sidebyside' | 'anaglyph'} */
let viewMode = '2d';
let lastState = null;
let appliedCoreView = { emulator: null, key: '' };

const setStatus = (text) => {
  statusEl.textContent = text || '';
};

// ---------------------------------------------------------------- colour layer

const { canvas: colorCanvas } = createColorCanvas();
colorCanvas.className = 'color-output';
colorCanvas.style.display = 'none';
stage.appendChild(colorCanvas);

const colourShown = () => colourOn && !!pack && playerReadiness({ rom, pack, mismatchAccepted }).colour;
const colorLayer = wireColorLayer(
  colorCanvas,
  () => (colourShown() ? 'color' : 'mono'),
  () => viewMode,
  // The emulator's default fade response: paint at full strength at the game's normal brightness.
  () => DEFAULT_FADE_RESPONSE,
  () => false,
  () => 0,
  () => false,
  () => 0,
  () => false,
  () => 'transparent',
  undefined,
  () => true,
);

installLayerArtDecoder();
onLayerArtDecoded(() => {
  if (lastState && colourShown()) colorLayer.onState(lastState);
});

/** Give the colour layer the play pack's contents. */
function applyPackToColourLayer() {
  if (!pack) return;
  // The colour layer draws only with a tile-colour table; a pack painted only per group has none.
  colorLayer.setPackFromBuffer(pack.vbcolor || buildVBColorPack(pack.info.title || 'play', new Map()));
  // The colour project, read the way every app reads it (src/project.js): groups through the
  // group schema, screens, game states.
  const project = projectFromParsed(pack, { label: pack.name });
  colorLayer.setPainterV2FromVbpack(project.painterV2Rules, pack.painterV2VipOverlays || undefined);
  colorLayer.setOverrides(pack.overrides);
  colorLayer.setGroups(project.groups, project.gameStatePools, project.gameStates);
  colorLayer.setDrawTransparentPaint(!!pack.info.paintOnTransparent);
}

function syncDisplay() {
  const colour = colourShown();
  const btn = el('btn-colour');
  btn.disabled = !pack;
  btn.setAttribute('aria-pressed', colour ? 'true' : 'false');
  btn.textContent = colour ? 'Colour' : 'Monochrome';
  colorCanvas.style.display = colour && started ? 'block' : 'none';
  if (colour && lastState) colorLayer.onState(lastState);
  else colorCanvas.getContext('2d')?.clearRect(0, 0, colorCanvas.width, colorCanvas.height);
}

// ---------------------------------------------------------------- core

// Frames from the patched core: every frame, both eyes (src/vip-state.js).
window.__VB_PUSH_VIP_STATE__ = pushVIPState;
globalThis.__VB_PUSH_VIP_STATE__ = pushVIPState;
window.addEventListener('message', (ev) => {
  const d = ev?.data;
  if (d?.__vb === 'vip') pushVIPState({ frameNumber: d.frameNumber ?? 0, eye: d.eye ?? 0 });
});

setVIPStateConsumer((state) => {
  if (!state?.patternTable?.length || !Array.isArray(state.drawList)) return;
  // Fades are measured against the game's normal brightness, recorded in the play pack.
  const ref = Number(pack?.info?.brightnessReference);
  if (Number.isFinite(ref) && ref > 0) state.brightnessReference = ref;
  lastState = state;
  colorLayer.onState(state);
  if (el('btn-pause').disabled) el('btn-pause').disabled = false;
  applyCoreViewMode();
});

/** The View menu, for the core's own monochrome picture (src/stereo-view.js). */
function applyCoreViewMode() {
  const emulator = window.EJS_emulator;
  const gm = emulator?.gameManager;
  if (!gm || typeof gm.setVariable !== 'function') return;
  const opts = coreStereoOptions(viewMode);
  const key = JSON.stringify(opts);
  if (appliedCoreView.emulator === emulator && appliedCoreView.key === key) return;
  try {
    for (const [name, value] of Object.entries(opts)) gm.setVariable(name, value);
    appliedCoreView = { emulator, key };
  } catch (err) {
    console.warn('[Player] Could not set the 3D mode:', err);
  }
}

function startGame() {
  if (!rom || started) return;
  started = true;
  applyPackToColourLayer();
  splash.classList.add('hidden');
  window.EJS_player = '#game';
  window.EJS_core = 'vb';
  window.EJS_gameUrl = URL.createObjectURL(new Blob([rom.buffer]));
  // Battery saves and save states are kept by game name: the pack's title, else the ROM's name.
  window.EJS_gameName = (pack?.info?.title || rom.name.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]/g, '_');
  window.EJS_pathtodata = '/data/';
  window.EJS_DEBUG_XX = true; // the local core ships unminified
  window.EJS_disableDatabases = true; // caches core files only; saves still persist
  window.EJS_threads = false;
  window.EJS_startOnLoaded = true;
  const script = document.createElement('script');
  script.id = LOADER_ID;
  script.src = '/data/loader.js';
  document.body.appendChild(script);
  syncDisplay();
  setStatus(colourShown() ? `Playing ${pack.info.title} in colour.` : `Playing ${rom.name} in monochrome.`);
}

/** A new ROM or pack once a game runs: the emulator cannot swap games, so start over. */
function restartWithNewFiles() {
  try {
    sessionStorage.setItem(AUTOSTART_KEY, '1');
  } catch (_) {
    /* the page still reloads; the player then waits for Play */
  }
  location.reload();
}

// ---------------------------------------------------------------- start screen

function renderSplash() {
  const r = playerReadiness({ rom, pack, mismatchAccepted });
  el('splash-msg').textContent = r.message;
  const actions = el('splash-actions');
  actions.replaceChildren();
  const button = (label, onClick, primary = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', onClick);
    actions.appendChild(b);
  };
  if (r.kind === 'ready') button(`Play ${pack.info.title}`, startGame, true);
  if (r.kind === 'need-pack') button('Play in monochrome', startGame, true);
  if (r.kind === 'mismatch') {
    button('Play anyway', () => {
      mismatchAccepted = true;
      startGame();
    }, true);
  }
  if (pack?.cover?.length) {
    el('splash-art').src = URL.createObjectURL(new Blob([pack.cover], { type: 'image/png' }));
  }
}

async function useRom(name, buffer, remember = true) {
  rom = { name, buffer, id: await romIdentity(buffer) };
  mismatchAccepted = false;
  if (remember) savePlayerFile('rom', name, buffer).catch((err) => console.warn('[Player] Could not remember the ROM:', err));
}

async function usePack(name, buffer, remember = true) {
  pack = { ...(await parsePlayPack(buffer)), name };
  mismatchAccepted = false;
  if (remember) savePlayerFile('pack', name, buffer).catch((err) => console.warn('[Player] Could not remember the play pack:', err));
}

async function onFileChosen(kind, file) {
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    if (kind === 'rom') await useRom(file.name, buffer);
    else await usePack(file.name, buffer);
    if (started) {
      restartWithNewFiles();
      return;
    }
    setStatus('');
    renderSplash();
    syncDisplay();
  } catch (err) {
    setStatus(err?.message || String(err));
  }
}

el('rom-input').addEventListener('change', (e) => {
  void onFileChosen('rom', e.target.files?.[0]);
  e.target.value = '';
});
el('pack-input').addEventListener('change', (e) => {
  void onFileChosen('pack', e.target.files?.[0]);
  e.target.value = '';
});

// ---------------------------------------------------------------- controls

function toggleColour() {
  if (!pack) return;
  colourOn = !colourOn;
  syncDisplay();
}

function togglePause() {
  const gm = window.EJS_emulator?.gameManager;
  if (!gm?.toggleMainLoop) return;
  paused = !paused;
  gm.toggleMainLoop(paused ? 0 : 1);
  el('btn-pause').textContent = paused ? 'Resume' : 'Pause';
  el('btn-pause').setAttribute('aria-pressed', paused ? 'true' : 'false');
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else stage.requestFullscreen?.().catch((err) => setStatus(`Full screen is not available: ${err?.message || err}`));
}

el('btn-colour').addEventListener('click', toggleColour);
el('btn-pause').addEventListener('click', togglePause);
el('btn-fullscreen').addEventListener('click', toggleFullscreen);
el('view-select').addEventListener('change', (e) => {
  viewMode = /** @type {'2d'|'sidebyside'|'anaglyph'} */ (e.target.value);
  try {
    localStorage.setItem(VIEW_KEY, viewMode);
  } catch (_) {
    /* not remembered this time */
  }
  applyCoreViewMode();
  if (lastState && colourShown()) colorLayer.onState(lastState);
});
document.addEventListener('keydown', (e) => {
  const tag = /** @type {HTMLElement} */ (e.target)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === 'F9') {
    e.preventDefault();
    toggleColour();
  } else if ((e.key === 'p' || e.key === 'P') && started) {
    e.preventDefault();
    togglePause();
  }
});

// ---------------------------------------------------------------- boot

(async function boot() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === '2d' || v === 'sidebyside' || v === 'anaglyph') {
      viewMode = v;
      el('view-select').value = v;
    }
  } catch (_) {
    /* default view */
  }
  // The last ROM and pack, so Play needs no file picking.
  try {
    const [lastRom, lastPack] = await Promise.all([loadPlayerFile('rom'), loadPlayerFile('pack')]);
    if (lastRom) await useRom(lastRom.name, lastRom.buffer, false);
    if (lastPack) await usePack(lastPack.name, lastPack.buffer, false);
  } catch (err) {
    console.warn('[Player] Could not reopen the last game:', err);
  }
  renderSplash();
  syncDisplay();
  let autostart = false;
  try {
    autostart = sessionStorage.getItem(AUTOSTART_KEY) === '1';
    sessionStorage.removeItem(AUTOSTART_KEY);
  } catch (_) {
    /* no autostart */
  }
  const r = playerReadiness({ rom, pack, mismatchAccepted });
  if (autostart && (r.kind === 'ready' || r.kind === 'need-pack')) startGame();
  else if (r.kind === 'ready') setStatus(`Last played: ${pack.info.title}. Press Play, or choose other files.`);
})();
