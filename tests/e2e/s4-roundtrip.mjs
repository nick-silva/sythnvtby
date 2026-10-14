import { readFile } from 'node:fs/promises';
import { parseArtPack } from '../../src/art-pack.js';
import {
  OUT, BASE, ROM, launch, instrument, suite, expect, framesAdvanced, statusText, setPaintColor, createGroup,
  selectGroup, painterSave,
} from './harness.mjs';

const s = suite('4. Colorize! → Painter → Save and Play');
const { browser, context } = await launch();
const page = await context.newPage();
const { errors } = instrument(page);
const POSES_PACK = `${OUT}/s3-poses.vbpack`;

async function colorize() {
  await page.click('#btn-colorize');
  await page.waitForURL(/\/tools\/project\.html/, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('btn-save-and-play')?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
}
async function saveAndPlay() {
  await page.click('#btn-save-and-play');
  await page.waitForURL((u) => !u.pathname.includes('painter'), { timeout: 90000 });
  await page.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
}
async function firstInkPixelOnCanvas() {
  return page.evaluate(() => {
    const c = document.getElementById('main-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let y = 60; y < c.height - 20; y++) {
      for (let x = 60; x < c.width - 60; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 90 && d[i + 1] < 40) return { x, y, w: c.width, h: c.height };
      }
    }
    return null;
  });
}
async function greenOnColorCanvas() {
  return page.evaluate(() => {
    const c = document.getElementById('color-canvas');
    if (!c || c.style.display === 'none') return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i + 1] > 150 && d[i] < 100 && d[i + 2] < 100) n++;
    return n;
  });
}

await s.test('Load a pack with poses in the emulator and capture with F8', async () => {
  await page.goto(`${BASE}/`);
  await page.setInputFiles('#pack-file-input', POSES_PACK);
  await page.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  expect((await framesAdvanced(page)) > 30, 'game not running');
  await page.click('#game');
  await page.keyboard.press('F8');
  await page.waitForTimeout(1200);
  expect(/Captured/.test(await statusText(page)), 'F8 did not capture');
});

await s.test('Colorize! opens the painter with the F8 frame and the pose group', async () => {
  await colorize();
  const frames = await page.$$eval('#frame-select option', (os) => os.map((o) => o.textContent));
  expect(frames.some((f) => /State \d+/.test(f)), `no F8 frame in dropdown (${frames.length} frames)`);
  const groups = await page.$$eval('.group-row', (rs) => rs.map((r) => r.textContent.trim()));
  expect(groups.some((g) => g.includes('Reg Mario')), `groups: ${groups.join(', ')}`);
  await selectGroup(page, 'Reg Mario');
  await page.waitForTimeout(300);
  const poses = await page.$$eval('.pose-row .pose-name', (ns) => ns.map((n) => n.textContent));
  expect(poses.includes('Walk A renamed'), `poses: ${poses}`);
  return `${frames.length} frames; poses ${poses}`;
});

await s.test('Paint in the painter (fill a tile green)', async () => {
  await page.selectOption('#frame-select', '0');
  await page.waitForTimeout(1500);
  const p = await firstInkPixelOnCanvas();
  expect(p, 'no ink pixel found on current frame');
  const box = await page.locator('#main-canvas').boundingBox();
  const vx = Math.floor((p.x * 384) / p.w);
  const vy = Math.floor((p.y * 224) / p.h);
  const cx = box.x + ((vx + 0.5) * box.width) / 384;
  const cy = box.y + ((vy + 0.5) * box.height) / 224;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);
  await createGroup(page, 'RT group', 'bg');
  await page.click('#btn-paint-fill');
  await setPaintColor(page, '#00ff00');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(700);
  const c = await page.evaluate(([x, y]) => Array.from(document.getElementById('main-canvas').getContext('2d').getImageData(x, y, 1, 1).data), [p.x, p.y]);
  expect(c[1] > c[0] && c[1] > c[2], `not green: ${c} · ${await page.textContent('#status')}`);
  return `(${vx},${vy})`;
});

await s.test('Save and Play returns running, focused, with the paint visible in Color mode', async () => {
  await saveAndPlay();
  const n = await framesAdvanced(page);
  const focused = await page.evaluate(() => !!document.activeElement?.closest?.('#game'));
  const flash = await statusText(page);
  if (!(await page.$eval('#btn-color', (b) => b.classList.contains('active')))) {
    await page.click('#btn-color');
    await page.waitForTimeout(800);
  }
  const green = await greenOnColorCanvas();
  expect(n > 30, `not running (${n})`);
  expect(focused, 'keyboard focus not on game');
  expect(green > 0, `no green pixels on color layer (${green})`);
  return `${n} frames/1.5s, ${green} green px · ${flash.slice(0, 40)}`;
});

await s.test('View modes reshape the color layer while playing (side-by-side, anaglyph)', async () => {
  const width = () => page.$eval('#color-canvas', (c) => c.width);
  await page.selectOption('#view-select', 'sidebyside');
  await page.waitForTimeout(800);
  const sbs = await width();
  await page.selectOption('#view-select', 'anaglyph');
  await page.waitForTimeout(800);
  const ana = await width();
  const cyanish = await page.evaluate(() => {
    const c = document.getElementById('color-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 40 && (d[i + 1] > 60 || d[i + 2] > 60)) n++;
    return n;
  });
  await page.selectOption('#view-select', '2d');
  await page.waitForTimeout(800);
  const flat = await width();
  expect(sbs === 768, `side-by-side canvas width ${sbs}`);
  expect(ana === 384 && flat === 384, `anaglyph ${ana}, 2D ${flat}`);
  expect(cyanish > 0, 'anaglyph has no right-eye (cyan) pixels');
  return `widths 2D ${flat} · SBS ${sbs} · anaglyph ${ana}`;
});

await s.test('Changing View while paused redraws the color layer immediately', async () => {
  await page.evaluate(() => window.EJS_emulator?.pause());
  await page.waitForTimeout(500);
  await page.selectOption('#view-select', 'sidebyside');
  await page.waitForTimeout(500);
  const paused = await page.$eval('#color-canvas', (c) => c.width);
  await page.selectOption('#view-select', '2d');
  await page.waitForTimeout(500);
  const back = await page.$eval('#color-canvas', (c) => c.width);
  await page.evaluate(() => window.EJS_emulator?.play());
  expect(paused === 768 && back === 384, `while paused: side-by-side ${paused}, 2D ${back}`);
});

await s.test('Second Colorize! keeps paint, groups, poses, and the F8 frame', async () => {
  await colorize();
  const frames = await page.$$eval('#frame-select option', (os) => os.map((o) => o.textContent));
  await selectGroup(page, 'Reg Mario');
  const poses = await page.$$eval('.pose-row .pose-name', (ns) => ns.map((n) => n.textContent));
  const path = `${OUT}/s4-second-colorize.vbpack`;
  await painterSave(page, path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const rt = (saved.groups || []).find((g) => g.name === 'RT group');
  const overlays = JSON.parse(saved.painterV2VipOverlays || '{"entries":[]}').entries || [];
  // Paint on a BG group lives in that group's own tileColors; older packs kept it in an
  // anchored overlay or the shared vbcolor pack.
  const rtPainted =
    Object.keys(rt?.tileColors || {}).length > 0
    || overlays.some((e) => e.groupId === rt?.id)
    || (saved.vbcolor?.byteLength || 0) > 64;
  expect(rt && saved.groups.some((g) => g.name === 'Reg Mario'), `groups ${(saved.groups || []).map((g) => g.name)}`);
  expect(rtPainted, `RT group paint missing (overlay entries: ${overlays.map((e) => e.groupId)})`);
  expect(poses.includes('Walk A renamed'), `poses ${poses}`);
  expect(frames.some((f) => /State \d+/.test(f)), 'F8 frame lost');
  return `${saved.groups.length} groups, ${overlays.length} overlay layer(s)`;
});

await s.test('Round trip with only a ROM loaded (no pack)', async () => {
  await page.goto(`${BASE}/`);
  await page.setInputFiles('#rom-input', ROM);
  await page.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  await colorize();
  await saveAndPlay();
  const n = await framesAdvanced(page);
  expect(n > 30, `not running after Save and Play (${n})`);
  return `${n} frames/1.5s · ${(await statusText(page)).slice(0, 60)}`;
});

await s.test('Memory: record a question’s sides while playing (timed, and until stopped with the side keys), see game states live and mark one checked; it all reaches the Project tool with Colorize!', async () => {
  const { PACK_ANNOTATED } = await import('./harness.mjs');
  const { artPackPartsFromParsed, buildArtPack } = await import('../../src/art-pack.js');
  const { seedGameStatePoolsFromMemoryAnalysis } = await import('../../src/seed-game-state-pools-from-memory-analysis.js');
  const { writeFile } = await import('node:fs/promises');
  // A game state per screen recipe: whichever screen the game is on, one of them holds live.
  const base = artPackPartsFromParsed(await parseArtPack((await readFile(PACK_ANNOTATED)).buffer));
  const pools = base.gameStatePools?.length ? base.gameStatePools : seedGameStatePoolsFromMemoryAnalysis(base.manifest?.memoryAnalysis);
  const gameStates = pools.map((p) => ({ id: `on-${p.id}`, name: `On ${p.label || p.id}`, conditions: (p.variants[0].ramConditions || []).map((c) => ({ offset: c.offset, value: c.expectedValue })) }));
  const packPath = `${OUT}/s4-memory.vbpack`;
  await writeFile(packPath, Buffer.from(await (await buildArtPack({ ...base, gameStatePools: pools, gameStates })).arrayBuffer()));
  const pg = await context.newPage();
  const { errors: pgErrors, answers } = instrument(pg);
  await pg.goto(`${BASE}/`);
  await pg.setInputFiles('#pack-file-input', packPath);
  await pg.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
  await pg.waitForTimeout(3000);
  await pg.click('#btn-memory');
  await pg.waitForSelector('#memory-panel:not([hidden])');
  answers.push('Who is it?', 'Side A, Side B');
  await pg.click('#memory-panel button:has-text("New question…")');
  await pg.waitForSelector('#memory-panel [data-side-id="side-a"]');
  // Timed: 1 second for side A.
  await pg.fill('#memory-seconds', '1');
  await pg.dispatchEvent('#memory-seconds', 'change');
  await pg.click('#memory-record');
  await pg.waitForTimeout(1800);
  const sideA = ((await pg.textContent('#memory-panel [data-side-id="side-a"]')) || '').trim();
  // Until stopped, side picked with its key, stopped with 0.
  await pg.click('#memory-panel h4'); // focus off the inputs, so the keys reach the panel
  await pg.keyboard.press('2');
  await pg.click('#memory-record-open');
  await pg.waitForTimeout(1300);
  const during = ((await pg.textContent('#memory-panel .memory-recording').catch(() => '')) || '').trim();
  await pg.click('#memory-panel h4');
  await pg.keyboard.press('0');
  await pg.waitForTimeout(300);
  const sideB = ((await pg.textContent('#memory-panel [data-side-id="side-b"]')) || '').trim();
  const screen = ((await pg.textContent('#memory-panel .memory-screen').catch(() => '')) || '').trim();
  // Live: the game state that holds now, and "Looks right".
  const holding = await pg.$$eval('#memory-panel .memory-state.holds', (rs) => rs.map((r) => r.dataset.stateId));
  if (holding.length) {
    await pg.click(`#memory-panel .memory-state[data-state-id="${holding[0]}"] button:has-text("Looks right")`);
    await pg.waitForTimeout(400);
  }
  // Colorize!: the question and both recordings arrive in the Project tool.
  await pg.click('#btn-colorize');
  await pg.waitForURL(/\/tools\/project\.html/, { timeout: 60000 });
  await pg.waitForFunction(() => !document.getElementById('btn-save-and-play')?.disabled, null, { timeout: 90000 });
  await pg.waitForTimeout(1500);
  await pg.click('#project-menu > summary');
  await pg.click('#file-menu-game-states');
  await pg.waitForSelector('#game-states-dialog[open]');
  const sides = ((await pg.textContent('[data-question-id="q-who-is-it"] .gs-sides').catch(() => '')) || '').replace(/\s+/g, ' ');
  const checked = holding.length ? ((await pg.textContent(`.gs-state[data-state-id="${holding[0]}"]`).catch(() => '')) || '') : '';
  await pg.click('#game-states-close');
  expect(/^1 Side A · 1 \(1 now\)$/.test(sideA), `side A after a timed recording: "${sideA}"`);
  expect(/^● Recording “Side B”/.test(during), `while recording: "${during}"`);
  expect(/^2 Side B · 1 \(1 now\)$/.test(sideB), `side B after stopping: "${sideB}"`);
  expect(/^Screen: /.test(screen), `live screen line: "${screen}"`);
  expect(holding.length >= 1 && /checked live/.test(checked), `holding live: ${holding.join(', ') || 'none'} · in the Project tool: ${checked.replace(/\s+/g, ' ').slice(0, 120)}`);
  expect(/Side A\s*1 recording · [2-9]\d* samples/.test(sides) && /Side B\s*1 recording · [2-9]\d* samples/.test(sides), `in the Project tool: ${sides}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${sideA} · ${sideB} · ${screen} · holds ${holding[0]} · ${sides.slice(0, 100)}`;
});

await s.test('No page errors during the round trips', async () => {
  expect(errors.length === 0, errors.slice(0, 4).join(' | '));
});

s.summary();
await browser.close();
