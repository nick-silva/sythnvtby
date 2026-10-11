/**
 * Runtime diagnostics for the palette rendering pipeline.
 * Run with a ROM loaded and (optionally) Palette mode; reports pass/fail for each step.
 * See docs/reference/palette-rendering-plan.md.
 */

import { getEmulatorCanvas, readOneFrame, aspectFitRect } from './palette-layer.js';

const MULTI_FRAME_COUNT = 10;
const MULTI_FRAME_DELAY_MS = 100;

function checksum(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s = (s * 31 + data[i]) >>> 0;
  return s;
}

/**
 * Log frame checksums every 100ms for 5s. Confirms whether the captured frame ever changes (cache test).
 * Run from console: runPaletteFrameChecksumTest() or click "Checksums 5s" in Palette debug.
 */
export function runPaletteFrameChecksumTest() {
  const canvas = getEmulatorCanvas();
  if (!canvas) {
    console.warn('[Palette] No canvas. Load a ROM first.');
    return;
  }
  const durationMs = 5000;
  const intervalMs = 100;
  let count = 0;
  const checksums = [];
  const id = setInterval(() => {
    const frame = readOneFrame(canvas);
    if (frame) {
      const cs = checksum(frame.data);
      checksums.push(cs);
      count++;
      console.log(`[Palette checksum #${count}] ${cs}`);
    }
    if (count * intervalMs >= durationMs) {
      clearInterval(id);
      const distinct = new Set(checksums).size;
      console.log(`[Palette checksum] Done. ${count} samples, ${distinct} distinct. ${distinct >= 2 ? 'Frame is changing.' : 'Frame never changed (cached).'}`);
    }
  }, intervalMs);
}

function redStats(data) {
  const reds = [];
  for (let i = 0; i < data.length; i += 4) reds.push(data[i]);
  const uniq = new Set(reds);
  let sum = 0;
  let min = 255;
  let max = 0;
  for (const r of reds) {
    sum += r;
    if (r < min) min = r;
    if (r > max) max = r;
  }
  return { min, max, mean: sum / reds.length, distinct: uniq.size };
}

/**
 * Run all diagnostic steps. Returns a result object and logs to console.
 * @param {{ container: HTMLElement | null, overlayCanvas: HTMLCanvasElement | null }} options - optional container and overlay for Step 3
 * @returns {Promise<{ step0: string, step1a: string, step1b: string, step3: string, summary: string }>}
 */
export function runPaletteDiagnostics(options = {}) {
  const { container = null, overlayCanvas = null } = options;
  const out = { step0: 'skip', step1a: 'skip', step1b: 'skip', step3: 'skip', summary: '' };
  const log = [];

  function report(step, pass, detail) {
    out[step] = pass ? 'pass' : 'fail';
    const line = `  Step ${step} ${step === 'step0' ? 'Locate' : step === 'step1a' ? 'Capture (one)' : step === 'step1b' ? 'Capture (multi)' : 'Overlay'}: ${pass ? 'pass' : 'FAIL'}${detail ? ` (${detail})` : ''}`;
    log.push(line);
  }

  const canvas = getEmulatorCanvas();
  if (!canvas) {
    report('step0', false, 'no canvas found');
    out.summary = log.join('\n') + '\n  → Load a ROM and run again.';
    console.log('[Palette diagnostics]\n' + out.summary);
    return Promise.resolve(out);
  }
  const w = canvas.width;
  const h = canvas.height;
  if (w < 320 || h < 200) {
    report('step0', false, `canvas ${w}×${h} too small`);
  } else {
    report('step0', true, `${w}×${h} canvas`);
  }

  // Step 1a: One-frame read
  let frame = readOneFrame(canvas);
  if (!frame || frame.data.length === 0) {
    report('step1a', false, 'no pixel data');
  } else {
    const allZero = frame.data.every((v) => v === 0);
    const stats = redStats(frame.data);
    if (allZero) {
      report('step1a', false, 'frame all zeros');
    } else if (stats.distinct < 2) {
      report('step1a', false, `red channel constant (${stats.distinct} value)`);
    } else {
      report('step1a', true, `non-zero, red ${stats.distinct} values`);
    }
  }

  if (container && overlayCanvas) {
    const dw = container.clientWidth;
    const dh = container.clientHeight;
    if (dw === 0 || dh === 0) {
      report('step3', false, 'container has no size');
    } else if (overlayCanvas.width !== dw || overlayCanvas.height !== dh) {
      report('step3', false, `overlay ${overlayCanvas.width}×${overlayCanvas.height} != container ${dw}×${dh}`);
    } else {
      const rect = aspectFitRect(w, h, dw, dh);
      if (rect.w <= 0 || rect.h <= 0) {
        report('step3', false, 'draw rect zero size');
      } else {
        report('step3', true, `draw ${rect.w}×${rect.h} at ${rect.x},${rect.y}`);
      }
    }
  } else {
    report('step3', true, 'skipped (no container/overlay)');
  }

  return new Promise((resolve) => {
    const checksums = [];
    function collectFrame(n) {
      const f = readOneFrame(canvas);
      if (f) checksums.push(checksum(f.data));
      if (n < MULTI_FRAME_COUNT - 1) {
        setTimeout(() => collectFrame(n + 1), MULTI_FRAME_DELAY_MS);
      } else {
        const distinct = new Set(checksums).size;
        report('step1b', distinct >= 2, distinct >= 2 ? `${distinct} distinct frames` : `all ${checksums.length} frames identical`);
        out.summary = log.join('\n');
        console.log('[Palette diagnostics]\n' + out.summary);
        resolve(out);
      }
    }
    setTimeout(() => collectFrame(0), MULTI_FRAME_DELAY_MS);
  });
}
