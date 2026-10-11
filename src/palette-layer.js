/**
 * Palette-based color: remap the 4 VB shades (by intensity) to 4 RGB colors.
 * Runs as a post-process on the emulator canvas; no core changes. Isolated for easy rollback.
 *
 * Rollback: set ENABLE_PALETTE to false in main.js and remove Palette UI (see docs/reference/rollback-palette.md).
 */

/** Presets: 4 colors each [R,G,B] — black, dark, mid, bright */
export const PALETTE_PRESETS = {
  original: [
    [0, 0, 0],
    [0x55, 0, 0],
    [0xaa, 0, 0],
    [0xff, 0, 0],
  ],
  green: [
    [0, 0, 0],
    [0, 0x55, 0],
    [0, 0xaa, 0],
    [0, 0xff, 0],
  ],
  blue: [
    [0, 0, 0],
    [0, 0, 0x55],
    [0, 0, 0xaa],
    [0, 0, 0xff],
  ],
  gameboy: [
    [0x0f, 0x38, 0x0f],
    [0x30, 0x62, 0x30],
    [0x8b, 0xac, 0x0f],
    [0x9b, 0xbc, 0x0f],
  ],
  warm: [
    [0x1a, 0x0a, 0x00],
    [0x66, 0x33, 0x00],
    [0xcc, 0x66, 0x00],
    [0xff, 0xcc, 0x66],
  ],
};

let rafId = null;

/**
 * Map intensity (0–255) to bucket index 0–3.
 */
function bucket(r) {
  if (r <= 0) return 0;
  if (r < 85) return 1;
  if (r < 170) return 2;
  return 3;
}

/**
 * Remap source ImageData using 4 colors; write into dest (same size).
 * Uses red channel as intensity (VB is red-only).
 *
 * @param {ImageData} src
 * @param {ImageData} dest
 * @param {number[][]} colors - 4x [R,G,B]
 */
export function remapFrame(src, dest, colors) {
  const s = src.data;
  const d = dest.data;
  if (s.length !== d.length) return;
  for (let i = 0; i < s.length; i += 4) {
    const idx = bucket(s[i]);
    const c = colors[idx];
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  }
}

/**
 * Create overlay canvas for palette output (sized like container).
 */
export function createPaletteCanvas() {
  const canvas = document.createElement('canvas');
  canvas.id = 'palette-canvas';
  canvas.className = 'palette-output';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;display:none;z-index:10;';
  return canvas;
}

/**
 * Find the emulator's video canvas. EmulatorJS may nest it, use an iframe, or shadow DOM; avoid our own overlay canvases.
 * Prefer canvases inside #game (iframe first, then shadow, then direct) so we don't pick a UI canvas from the rest of the page.
 */
export function getEmulatorCanvas() {
  const game = document.getElementById('game');
  const ourIds = new Set(['color-canvas', 'palette-canvas']);
  const fromRoot = (root) => {
    const cand = Array.from((root || document).querySelectorAll?.('canvas') || []).filter(
      (c) => !ourIds.has(c.id)
    );
    return cand.find((c) => c.width >= 320 && c.height >= 200) || cand[0] || null;
  };
  const walkShadow = (el, out = []) => {
    if (!el) return out;
    const canvases = el.querySelectorAll?.('canvas') || [];
    canvases.forEach((c) => { if (!ourIds.has(c.id)) out.push(c); });
    const roots = el.querySelectorAll?.('*') || [];
    roots.forEach((child) => {
      if (child.shadowRoot) walkShadow(child.shadowRoot, out);
    });
    return out;
  };

  // Prefer #game container so we don't pick a different canvas (e.g. local build may add more DOM)
  if (game) {
    const iframe = game.querySelector('iframe');
    if (iframe) {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const c = fromRoot(doc);
          if (c) return c;
        }
      } catch (_) {
        /* cross-origin */
      }
    }
    const shadowCanvases = walkShadow(game);
    let c = shadowCanvases.find((x) => x.width >= 320 && x.height >= 200) || shadowCanvases[0] || null;
    if (c) return c;
    c = fromRoot(game);
    if (c) return c;
  }

  let c = fromRoot(document);
  if (c) return c;
  const shadowCanvases = walkShadow(game || document.body);
  c = shadowCanvases.find((x) => x.width >= 320 && x.height >= 200) || shadowCanvases[0] || null;
  if (c) return c;
  const iframe = game?.querySelector('iframe');
  if (iframe) {
    try {
      const doc = iframe.contentDocument;
      if (doc) c = fromRoot(doc);
    } catch (_) {
      /* cross-origin */
    }
  }
  return c;
}

/** Offscreen 2D canvas used only to read from the emulator (drawImage(emulator) → getImageData). Never written to with putImageData. */
let _readbackCanvas = null;
/** Separate canvas for remap output (putImageData then drawImage to palette). Keeps readback clean so WebGL→2D read is reliable. */
let _remapOutputCanvas = null;
/** Reusable ImageData for remap output to avoid ~60 allocations/sec (reduces GC and audio glitches). */
let _cachedDest = null;
let _cachedDestW = 0;
let _cachedDestH = 0;

function getReadbackCanvas(w, h) {
  if (!_readbackCanvas || _readbackCanvas.width < w || _readbackCanvas.height < h) {
    _readbackCanvas = document.createElement('canvas');
    _readbackCanvas.width = w;
    _readbackCanvas.height = h;
  } else if (_readbackCanvas.width !== w || _readbackCanvas.height !== h) {
    _readbackCanvas.width = w;
    _readbackCanvas.height = h;
  }
  return _readbackCanvas;
}

function getRemapOutputCanvas(w, h) {
  if (!_remapOutputCanvas || _remapOutputCanvas.width !== w || _remapOutputCanvas.height !== h) {
    _remapOutputCanvas = document.createElement('canvas');
    _remapOutputCanvas.width = w;
    _remapOutputCanvas.height = h;
  }
  return _remapOutputCanvas;
}

function getCachedDestData(ctx, w, h) {
  if (_cachedDest && _cachedDestW === w && _cachedDestH === h) return _cachedDest;
  _cachedDest = ctx.createImageData(w, h);
  _cachedDestW = w;
  _cachedDestH = h;
  return _cachedDest;
}

/**
 * Read pixels from a WebGL canvas via readPixels. Saves/restores framebuffer binding.
 * Returns ImageData or null. Not used by default for WebGL (drawImage is more reliable across browsers).
 */
function readPixelsFromWebGLCanvas(canvas, w, h) {
  const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
  if (!gl) return null;
  const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const pixels = new Uint8ClampedArray(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
  const imageData = new ImageData(w, h);
  for (let y = h - 1; y >= 0; y--) {
    const srcRow = (h - 1 - y) * w * 4;
    const dstRow = y * w * 4;
    for (let x = 0; x < w * 4; x++) imageData.data[dstRow + x] = pixels[srcRow + x];
  }
  return imageData;
}

/** Aspect-fit: fit (srcW, srcH) inside (dstW, dstH), centered. Exported for tests and diagnostics. */
export function aspectFitRect(srcW, srcH, dstW, dstH) {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const x = Math.round((dstW - w) / 2);
  const y = Math.round((dstH - h) / 2);
  return { x, y, w, h };
}

/** Emulator canvas display rect in container coordinates so we draw the overlay in the same place as mono. */
function getCanvasRectInContainer(srcCanvas, container) {
  const cr = srcCanvas.getBoundingClientRect();
  const kr = container.getBoundingClientRect();
  return {
    x: cr.left - kr.left,
    y: cr.top - kr.top,
    w: cr.width,
    h: cr.height,
  };
}

function isAllZero(data) {
  for (let i = 0; i < data.length; i++) if (data[i] !== 0) return false;
  return true;
}

/**
 * Read one frame from the emulator canvas.
 * - 2D: getImageData.
 * - WebGL: readPixels first (if context has preserveDrawingBuffer we may get fresh frames); if zeros, fall back to drawImage.
 * Returns ImageData or null.
 */
export function readOneFrame(canvas) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  const w = canvas.width;
  const h = canvas.height;
  const ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    try {
      return ctx2d.getImageData(0, 0, w, h);
    } catch (_) {
      return null;
    }
  }
  const fromGL = readPixelsFromWebGLCanvas(canvas, w, h);
  if (fromGL && !isAllZero(fromGL.data)) return fromGL;
  const readback = getReadbackCanvas(w, h);
  const rbc = readback.getContext('2d', { willReadFrequently: true });
  if (!rbc) return null;
  try {
    rbc.drawImage(canvas, 0, 0);
    return rbc.getImageData(0, 0, w, h);
  } catch (_) {
    return null;
  }
}

/**
 * Start the palette remap loop. Call stopPaletteLoop() to cancel.
 * Supports both 2D and WebGL source canvases (WebGL: we draw source to a 2D readback canvas, then getImageData).
 *
 * @param {HTMLCanvasElement} paletteCanvas - our overlay
 * @param {() => HTMLCanvasElement | null} getSourceCanvas - e.g. () => document.querySelector('#game canvas')
 * @param {() => number[][]} getColors - current 4 colors [R,G,B][]
 */
/** Palette loop runs at ~30fps to reduce CPU/GC load and avoid audio glitches on low-end devices. */
const PALETTE_TARGET_FPS = 30;

/** Same as main.js isPaletteDebug: verbose logs when ?palette-debug=1 or localStorage vb-palette-debug=1 */
function isPaletteDebug() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('vb-palette-debug') === '1') return true;
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('palette-debug') === '1') return true;
  } catch (_) {}
  return false;
}

export function startPaletteLoop(paletteCanvas, getSourceCanvas, getColors) {
  let noSourceWarned = false;
  let noSourceFrames = 0;
  let lastDrawTime = 0;
  let diagnosticLogged = false;
  function tick(now = 0) {
    rafId = requestAnimationFrame(tick);
    const srcCanvas = getSourceCanvas();
    const container = paletteCanvas.parentElement;
    if (!srcCanvas || !container) {
      noSourceFrames++;
      if (!noSourceWarned && container) {
        noSourceWarned = true;
        console.warn('[Palette] Could not find emulator video canvas. If the emulator runs in a cross-origin iframe, palette remap cannot read it. Try serving EmulatorJS from your own origin (e.g. public/data/).');
      }
      if (noSourceFrames > 60) drawNoSourceHint();
      return;
    }
    noSourceFrames = 0;
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    if (w === 0 || h === 0) return;
    const displayW = container.clientWidth;
    const displayH = container.clientHeight;
    if (displayW === 0 || displayH === 0) return;
    const elapsed = now - lastDrawTime;
    if (elapsed > 0 && elapsed < 1000 / PALETTE_TARGET_FPS) return;
    lastDrawTime = now;
    if (paletteCanvas.width !== displayW || paletteCanvas.height !== displayH) {
      paletteCanvas.width = displayW;
      paletteCanvas.height = displayH;
    }
    const ctx = paletteCanvas.getContext('2d');
    if (!ctx) return;
    try {
      let srcData;
      const srcCtx2d = srcCanvas.getContext('2d');
      const isWebGL = !srcCtx2d;
      if (srcCtx2d) {
        srcData = srcCtx2d.getImageData(0, 0, w, h);
      } else {
        const readback = getReadbackCanvas(w, h);
        const rbc = readback.getContext('2d', { willReadFrequently: true });
        if (!rbc) return;
        rbc.drawImage(srcCanvas, 0, 0);
        srcData = rbc.getImageData(0, 0, w, h);
      }
      if (!diagnosticLogged && isPaletteDebug()) {
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        const i = (cy * w + cx) * 4;
        const R = srcData.data[i];
        const G = srcData.data[i + 1];
        const B = srcData.data[i + 2];
        const rectFromContainer = getCanvasRectInContainer(srcCanvas, container);
        console.log('[Palette] One-time diagnostic: isWebGL=', isWebGL, 'centerPixel R,G,B=', R, G, B, 'drawRect(container)=', rectFromContainer, 'aspectFit=', aspectFitRect(w, h, displayW, displayH));
        diagnosticLogged = true;
      } else if (!diagnosticLogged) {
        diagnosticLogged = true;
      }
      const destData = getCachedDestData(ctx, w, h);
      remapFrame(srcData, destData, getColors());
      const remapOut = getRemapOutputCanvas(w, h);
      const roc = remapOut.getContext('2d');
      if (!roc) return;
      roc.putImageData(destData, 0, 0);
      // With WebGL source, use aspect-fit so overlay matches emulator's letterboxed region (avoids rect mismatch).
      const rect = isWebGL
        ? aspectFitRect(w, h, displayW, displayH)
        : (() => {
            const r = getCanvasRectInContainer(srcCanvas, container);
            return r.w > 0 && r.h > 0 ? r : aspectFitRect(w, h, displayW, displayH);
          })();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, displayW, displayH);
      ctx.drawImage(remapOut, 0, 0, w, h, rect.x, rect.y, rect.w, rect.h);
    } catch (_) {
      if (!noSourceWarned) {
        noSourceWarned = true;
        console.warn('[Palette] Canvas read failed (possibly cross-origin).');
      }
      drawNoSourceHint();
    }
  }
  function drawNoSourceHint() {
    const ctx = paletteCanvas.getContext('2d');
    if (!ctx || paletteCanvas.width === 0) return;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, paletteCanvas.width, paletteCanvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Palette: cannot read video (emulator may be in iframe)', paletteCanvas.width / 2, paletteCanvas.height / 2);
  }
  rafId = requestAnimationFrame((t) => tick(t));
}

export function stopPaletteLoop() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  _cachedDest = null;
  _cachedDestW = 0;
  _cachedDestH = 0;
  _remapOutputCanvas = null;
}
