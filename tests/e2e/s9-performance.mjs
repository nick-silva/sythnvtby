/**
 * Performance budgets on a large project (docs/planning/tool-performance.md): opening, frame
 * switches and brush strokes in the Project tool and SpriteStudio. Uses VB_PACK_LARGE (default:
 * the Mario's Tennis pack beside the repo), opened through the file inputs and never saved; the
 * section passes with a note when there is no such pack. Budgets are generous (headless Chrome on
 * a busy machine) — they catch a return of the multi-second waits, not small drift.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE, OUT, REPO_ROOT, launch, instrument, suite, expect, captureDownload, painterSave } from './harness.mjs';
import { parseArtPack } from '../../src/art-pack.js';

const PACK_LARGE = process.env.VB_PACK_LARGE || resolve(REPO_ROOT, '..', 'MarioTennis', "Mario's Tennis (Japan, USA).vbpack");
const BUDGET = { openMs: 8000, frameSwitchMs: 400, strokeMs: 500, longTaskMs: 1000, saveMs: 2500 };

/** A saved copy opens and keeps every frame; the copy is deleted after. */
async function checkSaved(path, frames) {
  const b = readFileSync(path);
  const parsed = await parseArtPack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  rmSync(path, { force: true });
  expect(parsed.vipStatesFolder.length === frames, `saved ${parsed.vipStatesFolder.length} frames, expected ${frames}`);
  return (b.length / 1e6).toFixed(1);
}
let frameCount = 0;

const s = suite('9. Performance (large project)');
const twoFrames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const now = (p) => p.evaluate(() => performance.now());
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Brush strokes across the middle of a canvas, each timed to the second frame after it. */
async function strokes(p, selector, n = 4) {
  const box = await p.$eval(selector, (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = await now(p);
    await p.mouse.move(box.x + box.w * (0.4 + k * 0.03), box.y + box.h * 0.45);
    await p.mouse.down();
    await p.mouse.move(box.x + box.w * (0.45 + k * 0.03), box.y + box.h * 0.55, { steps: 8 });
    await p.mouse.up();
    await twoFrames(p);
    out.push(Math.round((await now(p)) - t));
  }
  return out;
}

if (!existsSync(PACK_LARGE)) {
  await s.test('Large-project budgets', async () => `skipped — no pack at ${PACK_LARGE} (set VB_PACK_LARGE)`);
  s.summary();
  process.exit(0);
}

const { browser, context } = await launch();
await context.addInitScript(() => {
  window.__lt = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  } catch {}
});
const longest = (p) => p.evaluate(() => Math.round(Math.max(0, ...window.__lt.splice(0))));

const pt = await context.newPage();
const { errors } = instrument(pt);
await s.test(`Project tool opens the large pack within ${BUDGET.openMs / 1000} s`, async () => {
  await pt.goto(`${BASE}/tools/project.html`);
  const t = Date.now();
  await pt.setInputFiles('#file-vbpack', PACK_LARGE);
  await pt.waitForFunction(() => document.querySelectorAll('#frame-select option').length > 0, null, { timeout: 120000 });
  const ms = Date.now() - t;
  expect(ms < BUDGET.openMs, `frames listed after ${ms} ms`);
  await pt.waitForTimeout(8000); // let the screen index and Check project finish
  await longest(pt);
  return `${ms} ms · ${await pt.$$eval('#frame-select option', (o) => o.length)} frames`;
});

await s.test(`Project tool: switching frames takes under ${BUDGET.frameSwitchMs} ms`, async () => {
  const values = await pt.$$eval('#frame-select option', (os) => os.map((o) => o.value));
  const times = [];
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const t = await now(pt);
    await pt.selectOption('#frame-select', values[Math.floor(values.length * f)]);
    await twoFrames(pt);
    times.push(Math.round((await now(pt)) - t));
    await pt.waitForTimeout(600);
  }
  const lt = await longest(pt);
  expect(median(times) < BUDGET.frameSwitchMs, `frame switches ${times.join(', ')} ms`);
  expect(lt < BUDGET.longTaskMs, `a ${lt} ms freeze while switching`);
  return `${times.join(', ')} ms · longest task ${lt} ms`;
});

await s.test(`Project tool: a brush stroke takes under ${BUDGET.strokeMs} ms`, async () => {
  await pt.evaluate(() => {
    const row = document.querySelector('#groups-tree .group-row');
    for (let d = row?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    row?.click();
  });
  await pt.waitForTimeout(500);
  await pt.click('#btn-zoom-to-group').catch(() => {});
  await pt.waitForTimeout(500);
  await pt.click('#btn-paint-brush').catch(() => {});
  const times = await strokes(pt, '#main-canvas');
  expect(median(times) < BUDGET.strokeMs, `strokes ${times.join(', ')} ms`);
  return `${times.join(', ')} ms`;
});

await s.test(`Project tool: Save takes under ${BUDGET.saveMs / 1000} s, and the saved pack keeps every frame`, async () => {
  const src = readFileSync(PACK_LARGE);
  frameCount = (await parseArtPack(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength))).vipStatesFolder.length;
  const path = `${OUT}/s9-project-save.vbpack`;
  const t = Date.now();
  await painterSave(pt, path);
  const ms = Date.now() - t;
  const mb = await checkSaved(path, frameCount);
  expect(ms < BUDGET.saveMs, `Save took ${ms} ms`);
  return `${ms} ms · ${mb} MB · ${frameCount} frames`;
});
await pt.close({ runBeforeUnload: false });

const st = await context.newPage();
instrument(st, { errors });
await s.test(`SpriteStudio opens the large pack within ${BUDGET.openMs / 1000} s`, async () => {
  await st.goto(`${BASE}/tools/sprite-studio.html`);
  const t = Date.now();
  await st.setInputFiles('#file-input', PACK_LARGE);
  await st.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 120000 });
  const ms = Date.now() - t;
  expect(ms < BUDGET.openMs, `groups listed after ${ms} ms`);
  await st.waitForTimeout(3000);
  return `${ms} ms`;
});

await s.test(`SpriteStudio: strokes take under ${BUDGET.strokeMs} ms, on the first sprite group and the group with the most poses`, async () => {
  // The group with the most poses is the worst case (every stroke used to redraw all its thumbnails).
  const picks = await st.$$eval('.sprite-row', (rs) => {
    const poses = (r) => Number(((r.querySelector('.meta')?.textContent || r.lastElementChild?.textContent || '').match(/^(\d+) pose/) || [])[1] || 0);
    const all = rs.map((r, i) => ({ i, n: poses(r), sprite: !!r.closest('#sprite-list') }));
    const first = all.find((r) => r.sprite) || all[0];
    const most = all.reduce((a, b) => (b.n > a.n ? b : a), all[0]);
    return [...new Set([first.i, most.i])];
  });
  const notes = [];
  for (const i of picks) {
    const name = await st.evaluate((n) => {
      const row = document.querySelectorAll('.sprite-row')[n];
      for (let d = row?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
      row?.click();
      return (row?.textContent || '').trim().slice(0, 30);
    }, i);
    await st.waitForTimeout(2000);
    await st.click('#btn-tool-brush');
    const times = await strokes(st, '#stage-canvas');
    await st.click('#btn-tool-none');
    expect(median(times) < BUDGET.strokeMs, `${name}: strokes ${times.join(', ')} ms`);
    notes.push(`${name}: ${times.join(', ')} ms`);
  }
  return notes.join(' · ');
});

await s.test(`SpriteStudio: Save takes under ${BUDGET.saveMs / 1000} s, and the saved pack keeps every frame`, async () => {
  const path = `${OUT}/s9-studio-save.vbpack`;
  const t = Date.now();
  await captureDownload(st, () => st.click('#btn-save'), path);
  const ms = Date.now() - t;
  const mb = await checkSaved(path, frameCount);
  expect(ms < BUDGET.saveMs, `Save took ${ms} ms`);
  return `${ms} ms · ${mb} MB`;
});

await s.test('No page errors on the large pack', async () => {
  expect(errors.length === 0, errors.slice(0, 3).join(' | '));
});
await st.close({ runBeforeUnload: false });

s.summary();
await browser.close();
