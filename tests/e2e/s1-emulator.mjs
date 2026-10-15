import { readFile } from 'node:fs/promises';
import { parseArtPack } from '../../src/art-pack.js';
import {
  OUT, launch, instrument, suite, expect, bootEmulator, framesAdvanced, statusText, captureDownload,
} from './harness.mjs';

const s = suite('1. Emulator');
const { browser, context } = await launch();
const page = await context.newPage();
const { errors, answers, dialogs } = instrument(page);
const packLabel = async () => (await page.textContent('#loaded-pack-name')) || '';
const frameCount = async () => Number(((await packLabel()).match(/\((\d+) frames?\)/) || [])[1] || 0);
const gameShot = () => page.locator('#game-container').screenshot();

await s.test('ROM boots and runs', async () => {
  await bootEmulator(page);
  const n = await framesAdvanced(page);
  expect(n > 30, `only ${n} frames in 1.5s`);
  expect(!(await page.evaluate(() => window.EJS_emulator?.paused)), 'emulator paused');
  return `${n} frames/1.5s`;
});

await s.test('Controller input reaches the game (Start changes the screen)', async () => {
  await page.click('#game');
  const a = await gameShot();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.up('Enter');
    await page.waitForTimeout(1200);
  }
  expect(Buffer.compare(a, await gameShot()) !== 0, 'screen unchanged after pressing Start');
});

await s.test('Display: Palette shows presets and changes colors', async () => {
  await page.click('#btn-palette');
  await page.waitForTimeout(400);
  expect(await page.isVisible('#palette-preset-wrap'), 'preset picker hidden');
  expect(await page.$eval('#btn-palette', (b) => b.classList.contains('active')), 'Palette not active');
  await page.selectOption('#palette-preset', 'original');
  await page.waitForTimeout(400);
  const a = await gameShot();
  await page.selectOption('#palette-preset', 'green');
  await page.waitForTimeout(400);
  expect(Buffer.compare(a, await gameShot()) !== 0, 'green preset looks identical to original');
});

await s.test('Display: Color and Monochrome toggles', async () => {
  await page.click('#btn-color');
  await page.waitForTimeout(300);
  expect(await page.$eval('#btn-color', (b) => b.classList.contains('active')), 'Color not active');
  expect(!(await page.$eval('#btn-palette', (b) => b.classList.contains('active'))), 'Palette still active');
  await page.click('#btn-mono');
  await page.waitForTimeout(300);
  const classes = await page.$$eval('#display-toggle button', (bs) => bs.map((b) => `${b.id}:${b.classList.contains('active')}`).join(' '));
  return classes;
});

await s.test('Color with Monochrome off hides the mono picture, not the emulator controls', async () => {
  const monoOn = () => page.$eval('#btn-mono', (b) => b.classList.contains('active'));
  const wasOn = await monoOn();
  if (wasOn) await page.click('#btn-mono');
  await page.waitForTimeout(300);
  const seen = await page.evaluate(() => {
    const game = document.getElementById('game');
    const canvas = game?.querySelector('.ejs_canvas');
    const bar = game?.querySelector('.ejs_menu_bar');
    // Opacity of everything between the control bar and the page: any 0 hides it for good.
    let hiddenBy = null;
    for (let n = bar?.parentElement; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).opacity === '0') hiddenBy = n.id || n.className;
    }
    return {
      canvasOpacity: canvas ? getComputedStyle(canvas).opacity : null,
      hasBar: !!bar,
      hiddenBy,
    };
  });
  if (wasOn) await page.click('#btn-mono');
  await page.waitForTimeout(200);
  expect(seen.hasBar, 'no EmulatorJS control bar found in #game');
  expect(seen.canvasOpacity === '0', `mono picture still showing (opacity ${seen.canvasOpacity})`);
  expect(seen.hiddenBy === null, `the controls are hidden by "${seen.hiddenBy}"`);
  return `mono picture hidden, controls visible (mono was ${wasOn ? 'on' : 'off'})`;
});

await s.test('F9 swaps Monochrome ⇄ Color and F10 turns Monochrome on/off', async () => {
  const on = () => page.$$eval('#display-toggle button', (bs) => Object.fromEntries(bs.map((b) => [b.id, b.classList.contains('active')])));
  const start = await on();
  await page.click('#game');
  await page.keyboard.press('F9');
  await page.waitForTimeout(200);
  const a = await on();
  await page.keyboard.press('F9');
  await page.waitForTimeout(200);
  const b = await on();
  await page.keyboard.press('F10');
  await page.waitForTimeout(200);
  const c = await on();
  await page.keyboard.press('F10');
  await page.waitForTimeout(200);
  const d = await on();
  const st = await statusText(page);
  // Leave the display as the tests before left it (Color first: turning it on turns Monochrome off).
  if ((await on())['btn-color'] !== start['btn-color']) await page.click('#btn-color');
  if ((await on())['btn-mono'] !== start['btn-mono']) await page.click('#btn-mono');
  await page.waitForTimeout(200);
  expect(a['btn-color'] && !a['btn-mono'], `F9 from start: ${JSON.stringify(a)}`);
  expect(b['btn-mono'] && !b['btn-color'], `F9 again: ${JSON.stringify(b)}`);
  expect(!c['btn-mono'] && !c['btn-color'], `F10 turns Monochrome off: ${JSON.stringify(c)}`);
  expect(d['btn-mono'] && !d['btn-color'], `F10 again: ${JSON.stringify(d)}`);
  expect(/Monochrome/.test(st), `status: ${st.slice(0, 80)}`);
  return 'color → mono → nothing → mono';
});

await s.test('View: Side-by-side puts the monochrome picture in 3D too (the core draws both eyes); 2D puts it back', async () => {
  const coreMode = () => page.evaluate(() =>
    (String(window.EJS_emulator?.gameManager?.getCoreOptions?.() || '').split('\n').find((l) => l.startsWith('vb_3dmode|')) || '').split(';')[0]);
  const before = await gameShot();
  await page.selectOption('#view-select', 'sidebyside');
  await page.waitForTimeout(800);
  const sbs = await coreMode();
  expect(/side-by-side/.test(sbs), `core 3D mode: ${sbs}`);
  expect(Buffer.compare(before, await gameShot()) !== 0, 'picture unchanged in Side-by-side');
  await page.selectOption('#view-select', '2d');
  await page.waitForTimeout(800);
  const flat = await coreMode();
  expect(/\|anaglyph$/.test(flat), `core 3D mode after 2D: ${flat}`);
  return `${sbs.split('|')[1]} → ${flat.split('|')[1]}`;
});

await s.test('Capture Frame dialog (OK) adds a frame', async () => {
  const before = await frameCount();
  await page.click('#btn-dump-vip');
  await page.waitForSelector('#capture-frame-dialog[open]');
  await page.fill('#capture-state-name', 'Regression A');
  await page.fill('#capture-substate-name', 'Sub');
  await page.click('#capture-dialog-ok');
  await page.waitForTimeout(1500);
  expect((await frameCount()) === before + 1, `frames ${before} → ${await frameCount()}`);
  return await packLabel();
});

await s.test('Capture Frame dialog remembers last label; Skip also adds a frame', async () => {
  const before = await frameCount();
  await page.click('#btn-dump-vip');
  await page.waitForSelector('#capture-frame-dialog[open]');
  const remembered = await page.inputValue('#capture-state-name');
  await page.click('#capture-dialog-skip');
  await page.waitForTimeout(1500);
  expect(remembered === 'Regression A', `remembered "${remembered}"`);
  expect((await frameCount()) === before + 1, `frames ${before} → ${await frameCount()}`);
});

await s.test('Game resumes after the Capture Frame dialog closes', async () => {
  const n = await framesAdvanced(page);
  expect(n > 30, `only ${n} frames`);
});

await s.test('F8 quick capture adds a frame with confirmation', async () => {
  await page.click('#game');
  const before = await frameCount();
  await page.keyboard.press('F8');
  await page.waitForTimeout(1200);
  const st = await statusText(page);
  expect((await frameCount()) === before + 1, `frames ${before} → ${await frameCount()}`);
  expect(/Captured “State \d+” \(F8\)/.test(st), `status: ${st.slice(0, 80)}`);
});

await s.test('F8 ignored while typing in an input', async () => {
  const before = await frameCount();
  await page.focus('#color-bg-x-offset');
  await page.keyboard.press('F8');
  await page.waitForTimeout(1000);
  expect((await frameCount()) === before, 'captured while typing');
});

await s.test('F8 ignored while the Capture dialog is open', async () => {
  const before = await frameCount();
  await page.click('#btn-dump-vip');
  await page.waitForSelector('#capture-frame-dialog[open]');
  await page.keyboard.press('F8');
  await page.waitForTimeout(800);
  const during = await frameCount();
  await page.click('#capture-dialog-skip');
  await page.waitForTimeout(1500);
  expect(during === before, 'F8 captured while dialog open');
});

await s.test('Pause and step: P pauses, period/comma step one frame (Shift: 10), back is exact, F8 captures the paused frame, Pause resumes', async () => {
  await page.click('#game');
  await page.waitForTimeout(1500); // let the step-back history fill
  const readout = async () => ((await page.isVisible('#step-status')) ? (await page.textContent('#step-status')) || '' : '');
  const frameNo = async () => Number((await readout()).match(/frame (\d+)/)?.[1] ?? -1);
  // What the core hands over each frame — the data a capture saves — fingerprinted by frame
  // number. (The monochrome canvas can flicker between two pictures, so screenshots are no test.)
  await page.evaluate(() => {
    window.__stepFp = new Map();
    const push = globalThis.__VB_PUSH_VIP_STATE__;
    const wrapped = function (st, ...rest) {
      try {
        let h = 2166136261;
        const mix = (v) => { h = Math.imul(h ^ (v & 0xffff), 16777619) >>> 0; };
        for (const d of st.drawList || []) { mix(d.tileIndex); mix(d.x); mix(d.y); mix(d.world || 0); }
        const pt = st.patternTable;
        if (pt) for (let i = 0; i < pt.length; i += 5) mix(pt[i]);
        window.__stepFp.set(window.__vbStepHistory.frame + 1, h);
      } catch (_) {}
      return push.call(this, st, ...rest);
    };
    window.__VB_PUSH_VIP_STATE__ = wrapped;
    globalThis.__VB_PUSH_VIP_STATE__ = wrapped;
  });
  const fpAt = (f) => page.evaluate((f) => window.__stepFp.get(f) ?? null, f);
  await page.keyboard.press('p');
  await page.waitForTimeout(400);
  const pausedRun = await framesAdvanced(page, 600);
  const f0 = await frameNo();
  await page.keyboard.press('Period');
  await page.waitForTimeout(400);
  const f1 = await frameNo();
  const fp1 = await fpAt(f1);
  await page.keyboard.press('Shift+Period');
  await page.waitForTimeout(700);
  const f11 = await frameNo();
  await page.keyboard.press('Shift+Comma');
  await page.waitForTimeout(700);
  const fBack = await frameNo();
  const fpBack = await fpAt(fBack);
  const stillPausedAfterSteps = await framesAdvanced(page, 500);

  const before = await frameCount();
  await page.keyboard.press('F8');
  await page.waitForTimeout(1200);
  const after = await frameCount();
  const pausedAfterCapture = await framesAdvanced(page, 600);
  const readoutAfterCapture = await readout();

  await page.click('#btn-pause');
  await page.waitForTimeout(300);
  const running = await framesAdvanced(page, 1000);
  const readoutAfterResume = await readout();

  expect(pausedRun === 0 && f0 > 0, `P did not pause (frames ${pausedRun}, readout frame ${f0})`);
  expect(f1 === f0 + 1, `one step: frame ${f0} → ${f1}`);
  expect(f11 === f1 + 10, `Shift step: frame ${f1} → ${f11}`);
  expect(fBack === f1 && fp1 !== null && fpBack === fp1, `Shift back: frame ${f11} → ${fBack}, frame data ${fpBack === fp1 ? 'the same' : 'different'} (${fp1} vs ${fpBack})`);
  expect(stillPausedAfterSteps === 0, `game ran on after stepping (${stillPausedAfterSteps} frames)`);
  expect(after === before + 1, `F8 while paused: frames ${before} → ${after}`);
  expect(pausedAfterCapture === 0 && /Paused/.test(readoutAfterCapture), `capturing resumed the game (${pausedAfterCapture} frames, readout "${readoutAfterCapture}")`);
  expect(running > 30 && !readoutAfterResume, `Pause button did not resume (${running} frames, readout "${readoutAfterResume}")`);
  return `frame ${f0} → ${f1} → ${f11} → ${fBack} · same frame data · captured while paused · resumed`;
});

await s.test('Unsaved captures: the status line counts them, Load ROM and Load pack ask first, Cancel keeps them', async () => {
  const frames = await frameCount();
  const st = await statusText(page);
  expect(new RegExp(`${frames} captures? not saved — Colorize! or Export \\.vbpack`).test(st), `status: ${st.slice(-120)}`);

  for (const [selector, action] of [['#rom-picker-label', 'Load ROM'], ['#pack-picker-label', 'Load pack']]) {
    const asked = dialogs.length;
    answers.push(false);
    await page.click(selector);
    await page.waitForTimeout(400);
    const d = dialogs[asked];
    expect(d?.type === 'confirm', `${action}: no confirm (${dialogs.slice(asked).map((x) => x.type).join(', ') || 'none'})`);
    expect(new RegExp(`^${frames} captured frames? (is|are) not saved yet\\. ${action} will throw`).test(d.message), `${action} asked: ${d.message.slice(0, 100)}`);
    expect((await frameCount()) === frames, `${action} cancelled but frames ${frames} → ${await frameCount()}`);
  }
  return `${frames} unsaved capture(s) kept through two cancelled prompts`;
});

let exported = null;
await s.test('Export .vbpack contains ROM, captured frames, and frame registry', async () => {
  const frames = await frameCount();
  const path = `${OUT}/s1-export.vbpack`;
  await captureDownload(page, () => page.click('#btn-export-pack'), path);
  exported = path;
  const p = await parseArtPack((await readFile(path)).buffer);
  expect(p.rom?.byteLength > 0, 'no ROM');
  expect((p.vipStatesFolder || []).length === frames, `vipstates ${p.vipStatesFolder?.length} vs ${frames}`);
  expect((p.manifest?.frameRegistry || []).length === frames, 'frameRegistry length mismatch');
  const named = p.manifest.frameRegistry.find((r) => r.stateName === 'Regression A');
  expect(named?.subStateName === 'Sub', 'labels not stored');
  const st = await statusText(page);
  expect(!/not saved/.test(st), `still says unsaved after Export: ${st.slice(-100)}`);
  return `${frames} frames, ${(p.saveStatesFolder || []).length} save states`;
});

await s.test('Debug panel controls respond', async () => {
  const before = await page.textContent('#color-fade-value');
  await page.$eval('#color-fade-slider', (el) => {
    el.value = String(Number(el.min || 0) + (Number(el.max || 2) - Number(el.min || 0)) * 0.25);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  expect((await page.textContent('#color-fade-value')) !== before, 'fade value label unchanged');
  await page.check('#perf-overlay-frame-interval');
  await page.waitForTimeout(1200);
  const overlay = (await page.textContent('#perf-metrics-overlay')) || '';
  expect(overlay.trim().length > 0 && (await page.isVisible('#perf-metrics-overlay')), 'perf overlay empty/hidden');
  await page.uncheck('#perf-overlay-frame-interval');
  await page.click('#btn-pixel-inspector-toggle');
  await page.waitForTimeout(200);
  expect(await page.$eval('#btn-pixel-inspector-toggle', (b) => b.classList.contains('active')), 'pixel inspector not active');
  await page.click('#btn-pixel-inspector-toggle');
  const errBefore = errors.length;
  for (const id of ['#btn-pack-coverage', '#btn-color-layer-debug', '#btn-duplicate-draws']) {
    await page.click(id);
    await page.waitForTimeout(300);
  }
  expect(errors.length === errBefore, `errors: ${errors.slice(errBefore).join(' | ')}`);
});

await s.test('Load pack (exported file) starts the game with its frames', async () => {
  const p2 = await context.newPage();
  instrument(p2, { errors });
  await p2.goto('http://localhost:5173/');
  await p2.setInputFiles('#pack-file-input', exported);
  await p2.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  await p2.waitForTimeout(2000);
  const label = (await p2.textContent('#loaded-pack-name')) || '';
  const opts = await p2.$$eval('#frame-savestate-select option', (os) => os.length);
  const n = await framesAdvanced(p2);
  await p2.close();
  expect(opts > 1, `frame dropdown has ${opts} options`);
  expect(n > 30, `game not running (${n})`);
  expect(/frames?\)/.test(label), `pack loaded (${opts} frames, game running) but header label says "${label}"`);
  return `${label} · ${opts} dropdown entries`;
});

await s.test('Last pack button reloads the pack after a page refresh', async () => {
  const p3 = await context.newPage();
  instrument(p3, { errors });
  await p3.goto('http://localhost:5173/');
  await p3.waitForTimeout(1500);
  expect(await p3.isVisible('#last-vbpack-btn'), 'Last pack button hidden');
  await p3.click('#last-vbpack-btn');
  await p3.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  await p3.waitForTimeout(1500);
  const label = (await p3.textContent('#loaded-pack-name')) || '';
  const n = await framesAdvanced(p3);
  await p3.close();
  expect(n > 30, `game not running (${n})`);
  expect(/^Loaded: .+\(\d+ frames?\)$/.test(label), `header label says "${label}"`);
  return label;
});

await s.test('Frame dropdown jumps to a saved frame (paused by design), Play resumes', async () => {
  const p4 = await context.newPage();
  instrument(p4, { errors });
  await p4.goto('http://localhost:5173/');
  await p4.setInputFiles('#pack-file-input', exported);
  await p4.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  await p4.waitForTimeout(2000);
  const values = await p4.$$eval('#frame-savestate-select option', (os) => os.map((o) => o.value));
  await p4.selectOption('#frame-savestate-select', values[values.length - 1]);
  await p4.waitForTimeout(2500);
  const paused = await p4.evaluate(() => window.EJS_emulator?.paused);
  const nPaused = await framesAdvanced(p4);
  await p4.evaluate(() => window.EJS_emulator?.play());
  const nPlay = await framesAdvanced(p4);
  await p4.close();
  expect(paused === true && nPaused === 0, `expected paused after jump (paused=${paused}, frames=${nPaused})`);
  expect(nPlay > 30, `Play did not resume (${nPlay})`);
});

// The emulator can't be torn down in place: before Oct 14 a second game started beside the first,
// both cores fed the colour layer, and the picture flickered between two games.
await s.test('Opening a second game while one runs starts it on a fresh page, one core only', async () => {
  const p5 = await context.newPage();
  instrument(p5, { errors });
  await p5.goto('http://localhost:5173/');
  await p5.setInputFiles('#pack-file-input', exported);
  await p5.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  const nFirst = await framesAdvanced(p5);
  const reloaded = p5.waitForEvent('load', { timeout: 60000 }).then(() => true, () => false);
  await p5.setInputFiles('#pack-file-input', exported);
  const didReload = await reloaded;
  await p5.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  await p5.waitForTimeout(1500);
  const nSecond = await framesAdvanced(p5);
  await p5.close();
  expect(didReload, 'the page did not reload for the second game');
  expect(nSecond > 30, `second game not running (${nSecond})`);
  expect(nSecond < nFirst * 1.5, `two cores running: ${nFirst} → ${nSecond} frames in 1.5 s`);
  return `${nFirst} → ${nSecond} frames in 1.5 s`;
});

await s.test('No page errors during the emulator run', async () => {
  expect(errors.length === 0, errors.slice(0, 4).join(' | '));
});

s.summary();
await browser.close();
