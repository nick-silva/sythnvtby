/**
 * Shared helpers for the browser regression suite (headless Chrome via playwright-core).
 * Run with `npm run test:e2e` (starts the dev server if needed); report in tests/e2e/.out/report.md.
 * Local files: VB_ROM, VB_PACK_ANNOTATED, VB_PACK_PLAIN (default to the parent folder); E2E_BASE_URL; E2E_HEADED=1.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const repoModule = (rel) => pathToFileURL(resolve(REPO_ROOT, rel)).href;

const workspace = resolve(REPO_ROOT, '..');
export const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
export const OUT = resolve(REPO_ROOT, 'tests', 'e2e', '.out').replace(/\\/g, '/');
const ROM_NAME = 'Mario Clash (Japan, USA).vb';
export const ROM = process.env.VB_ROM
  || [resolve(workspace, 'ROMS', ROM_NAME), resolve(workspace, ROM_NAME)].find((p) => existsSync(p))
  || resolve(workspace, 'ROMS', ROM_NAME);
export const PACK_ANNOTATED = process.env.VB_PACK_ANNOTATED || resolve(workspace, 'marioclash-annotated.vbpack');
export const PACK_PLAIN = process.env.VB_PACK_PLAIN || resolve(workspace, 'marioclash.vbpack');
/** Optional: a pack with captures of an affine (zooming) scene. Tests that need it skip without it. */
export const PACK_AFFINE = process.env.VB_PACK_AFFINE || resolve(workspace, 'MarioClash', 'Mario Clash (Japan, USA).vbpack');

mkdirSync(OUT, { recursive: true });

/** Frame/tile coordinates picked from PACK_ANNOTATED by targets.mjs (run-all.mjs runs it first); null before that. */
export const targets = existsSync(`${OUT}/targets.json`) ? JSON.parse(readFileSync(`${OUT}/targets.json`, 'utf8')) : null;

export async function launch() {
  const browser = await chromium.launch({
    channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
    headless: process.env.E2E_HEADED !== '1',
    args: ['--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  // Native pickers can't be automated; the app falls back to downloads / file inputs without them.
  await context.addInitScript(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
    delete window.showDirectoryPicker;
  });
  return { browser, context };
}

/** Collect page errors and answer prompt/confirm dialogs from a queue (default: accept). */
// SpriteStudio's offer to restore unsaved work (its journal, kept in the browser profile all the
// tests share) is declined — so one test's unsaved paint never leaks into the next — unless the
// test asks for it with `restoreJournal: true`. It never takes an answer from the queue.
export function instrument(page, { answers = [], errors = [], dialogs = [], restoreJournal = false } = {}) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('dialog', async (d) => {
    // Every dialog's text, so a test can check what the user was asked.
    dialogs.push({ type: d.type(), message: d.message() });
    if (/has unsaved work for .* — the page closed before it was saved/.test(d.message())) {
      await (restoreJournal ? d.accept() : d.dismiss());
      return;
    }
    const a = answers.shift();
    if (a === false) await d.dismiss();
    else await d.accept(typeof a === 'string' ? a : undefined);
  });
  return { answers, errors, dialogs };
}

/** Prints `PASS name — detail` / `FAIL name — reason` lines that run-all.mjs parses. */
export function suite(title) {
  const results = [];
  console.log(`=== ${title} ===`);
  return {
    results,
    async test(name, fn) {
      try {
        const detail = await fn();
        if (detail === false) throw new Error('assertion returned false');
        results.push({ name, ok: true });
        console.log(`PASS ${name}${typeof detail === 'string' ? ` — ${detail}` : ''}`);
      } catch (e) {
        results.push({ name, ok: false });
        console.log(`FAIL ${name} — ${String(e?.message || e).split('\n')[0].slice(0, 240)}`);
      }
    },
    summary() {
      const passed = results.filter((r) => r.ok).length;
      console.log(`--- ${title}: ${passed}/${results.length} passed`);
    },
  };
}

export function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * Wait for a condition in the page instead of a fixed time: `fn(arg)` runs in the page until it
 * returns something truthy. Fails with `what` in the message after `timeout` ms.
 * @param {import('playwright-core').Page} page
 * @param {(arg: any) => any} fn @param {any} [arg]
 * @param {{ timeout?: number, what?: string }} [opts]
 */
export async function waitUntil(page, fn, arg, { timeout = 10000, what = 'condition' } = {}) {
  try {
    return await page.waitForFunction(fn, arg, { timeout, polling: 50 });
  } catch (err) {
    throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
  }
}

export async function waitForEmulatorReady(page) {
  await page.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
}

export async function bootEmulator(page, romPath = ROM) {
  await page.goto(`${BASE}/`);
  await page.setInputFiles('#rom-input', romPath);
  await waitForEmulatorReady(page);
  await page.waitForTimeout(2500);
}

/**
 * VIP frames pushed by the core over `ms` (0 when paused). A negative delta means the emulator
 * restarted mid-sample and reset the counter, so sample again before believing it.
 */
export async function framesAdvanced(page, ms = 1500) {
  const count = () => page.evaluate(() => window.__vbFrameCount ?? 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await count();
    await page.waitForTimeout(ms);
    const delta = (await count()) - a;
    if (delta >= 0) return delta;
  }
  const a = await count();
  await page.waitForTimeout(ms);
  return Math.max(0, (await count()) - a);
}

export async function statusText(page) {
  return (await page.textContent('#color-pack-status')) || '';
}

export async function openPainter(page, packPath = PACK_ANNOTATED) {
  await page.goto(`${BASE}/tools/project.html`);
  await page.setInputFiles('#file-vbpack', packPath);
  await page.waitForFunction(() => document.querySelectorAll('#frame-select option').length > 0, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
}

export async function selectFrame(page, stem) {
  const v = await page.$$eval('#frame-select option', (os, s) => os.find((o) => o.textContent.includes(s))?.value, stem);
  if (v == null) throw new Error(`frame ${stem} not in dropdown`);
  await page.selectOption('#frame-select', v);
  await page.waitForTimeout(1200);
}

/**
 * Expand only the pool/variant sections containing the group row, then select it by exact name.
 * Waits for the row (the tree redraws after many actions) and then for it to be selected.
 */
export async function selectGroup(page, name) {
  const found = await page
    .waitForFunction(
      (n) => {
        const row = [...document.querySelectorAll('#groups-tree .group-row')].find((r) => r.lastElementChild?.textContent === n);
        for (let d = row?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
        return !!row;
      },
      name,
      { timeout: 5000, polling: 50 },
    )
    .then(() => true, () => false);
  if (!found) throw new Error(`group "${name}" not in tree`);
  await page.locator('.group-row').filter({ hasText: name }).first().click();
  await waitUntil(
    page,
    (n) => [...document.querySelectorAll('#groups-tree .group-row')].find((r) => r.lastElementChild?.textContent === n)?.classList.contains('group-selected'),
    name,
    { timeout: 5000, what: `group "${name}" to be selected` },
  );
}

/** Canvas box in viewport coords; scrolls it into view first (the page grows when the rails get long). */
export async function canvasBox(page) {
  const canvas = page.locator('#main-canvas');
  await canvas.scrollIntoViewIfNeeded();
  return canvas.boundingBox();
}

/** Unzoomed VIP pixel → client coords. */
export async function fullClient(page, vx, vy) {
  const b = await canvasBox(page);
  return [b.x + ((vx + 0.5) * b.width) / 384, b.y + ((vy + 0.5) * b.height) / 224];
}

/**
 * Viewport coords go stale as soon as anything scrolls — clicking a toolbar button
 * scrolls the center column back to the top, moving the canvas out from under the
 * saved point. Anchor the point to the canvas box and resolve it again at use time.
 */
export async function canvasAnchor(page, cx, cy) {
  const b = await canvasBox(page);
  return { fx: (cx - b.x) / b.width, fy: (cy - b.y) / b.height };
}

export async function anchorClient(page, a) {
  const b = await canvasBox(page);
  return [b.x + a.fx * b.width, b.y + a.fy * b.height];
}

export async function marquee(page, x0 = 0, y0 = 0, x1 = 383, y1 = 223) {
  const [ax, ay] = await fullClient(page, x0, y0);
  const [bx, by] = await fullClient(page, x1, y1);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 4 });
  await page.mouse.move(bx, by, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

export async function clickVip(page, vx, vy, opts) {
  const [cx, cy] = await fullClient(page, vx, vy);
  await page.mouse.click(cx, cy, opts);
  await page.waitForTimeout(250);
}

export async function selectedCount(page) {
  const m = (((await page.textContent('#tile-selection-hint')) || '').match(/(\d+)\s+tiles?/)) || [];
  return m[1] ? Number(m[1]) : 0;
}

export async function colorAtClient(page, cx, cy) {
  return page.evaluate(([x, y]) => {
    const c = document.getElementById('main-canvas');
    const r = c.getBoundingClientRect();
    const px = Math.floor(((x - r.left) * c.width) / r.width);
    const py = Math.floor(((y - r.top) * c.height) / r.height);
    return Array.from(c.getContext('2d').getImageData(px, py, 1, 1).data);
  }, [cx, cy]);
}

/** Map VIP pixels → client coords in any zoom state by scanning the cursor readout. */
export async function buildZoomMap(page) {
  const b = await canvasBox(page);
  const xs = new Map();
  const ys = new Map();
  const readout = async (cx, cy) => {
    await page.mouse.move(cx, cy);
    const m = ((await page.textContent('#cursor-pos')) || '').match(/X:\s*(\d+)\s+Y:\s*(\d+)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  const add = (map, key, v) => (map.get(key) || map.set(key, []).get(key)).push(v);
  for (let i = 1; i < 160; i++) {
    const cx = b.x + (b.width * i) / 160;
    const r = await readout(cx, b.y + b.height / 2);
    if (r) add(xs, r.x, cx);
    const cy = b.y + (b.height * i) / 160;
    const r2 = await readout(b.x + b.width / 2, cy);
    if (r2) add(ys, r2.y, cy);
  }
  const mid = (a) => a[Math.floor(a.length / 2)];
  return (vx, vy) => {
    if (!xs.has(vx) || !ys.has(vy)) throw new Error(`VIP ${vx},${vy} not visible in current view`);
    return [mid(xs.get(vx)), mid(ys.get(vy))];
  };
}

export async function setPaintColor(page, hex) {
  await page.$eval('#zoom-paint-color', (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
}

export async function createGroup(page, name, kind) {
  await page.click('#btn-new-group-from-selection');
  await page.waitForSelector('#new-group-dialog[open]');
  await page.check(kind === 'bg' ? '#new-group-kind-bg' : '#new-group-kind-obj');
  await page.fill('#new-group-name', name);
  await page.click('#new-group-submit');
  await waitUntil(
    page,
    (n) => !document.querySelector('#new-group-dialog[open]') && [...document.querySelectorAll('#groups-tree .group-row')].some((r) => r.lastElementChild?.textContent === n),
    name,
    { what: `group "${name}" to appear` },
  );
}

export async function captureDownload(page, trigger, savePath) {
  const p = page.waitForEvent('download', { timeout: 90000 });
  await trigger();
  const d = await p;
  await d.saveAs(savePath);
  return d.suggestedFilename();
}

export async function painterSave(page, savePath) {
  return captureDownload(
    page,
    async () => {
      await page.click('#file-menu > summary');
      await page.click('#file-menu-save');
    },
    savePath,
  );
}

export const sameColor = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
