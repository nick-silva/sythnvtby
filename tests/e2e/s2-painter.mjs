import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArtPack, artPackPartsFromParsed, buildArtPack } from '../../src/art-pack.js';
import {
  OUT, targets, launch, instrument, suite, expect, openPainter, selectFrame, marquee, clickVip, selectedCount,
  colorAtClient, buildZoomMap, setPaintColor, createGroup, painterSave, sameColor, fullClient,
  selectGroup, canvasBox, captureDownload, canvasAnchor, anchorClient, PACK_AFFINE, PACK_ANNOTATED, BASE,
} from './harness.mjs';

const s = suite('2. Painter core');
const { browser, context } = await launch();
await context.addInitScript(() => {
  delete window.EyeDropper;
});
const page = await context.newPage();
const { errors, answers, dialogs } = instrument(page);
const status = async () => (await page.textContent('#status')) || '';
// Distinct groups: a group shared by several screens is also listed in the "Shared" section.
const groupRows = () => page.$$eval('.group-row', (rs) => new Set(rs.map((r) => r.dataset.groupId)).size);
const worldDebug = async () => (await page.textContent('#world-filter-debug')) || '';
const drawsInView = async () => Number(((await worldDebug()).match(/(\d+)\s+draws/) || [])[1] || -1);
const canvasShot = () => page.locator('#main-canvas').screenshot();
const isZoomed = () => page.$eval('.canvas-wrap', (w) => w.classList.contains('zoomed'));
async function unzoom() {
  if (await isZoomed()) {
    await page.click('#btn-zoom-selection');
    await page.waitForTimeout(300);
  }
}

/** Nth ink pixel (screen coords) of a target tile, honoring flipH. */
function inkPixel(t, skip = 0) {
  let seen = 0;
  for (let ly = 0; ly < 8; ly++) {
    for (let lx = 0; lx < 8; lx++) {
      if (!t.ink[ly * 8 + lx]) continue;
      if (seen++ < skip) continue;
      return { x: t.flip ? t.x + (7 - lx) : t.x + lx, y: t.y + ly };
    }
  }
  throw new Error('tile has no ink');
}

await s.test('Open pack lists all frames', async () => {
  await openPainter(page);
  const n = await page.$$eval('#frame-select option', (os) => os.length);
  expect(n === targets.frameCount + 1, `${n} frames in dropdown, expected ${targets.frameCount + 1}`);
  return `${n} frames · ${(await status()).slice(0, 90)}`;
});

await s.test('The Colorize! frame is matched to a screen by its memory (read from its save state)', async () => {
  // The annotated pack has memory pools, and its Current frame has only the pack's save state.
  const first = (await page.$eval('#frame-select option', (o) => o.textContent)) || '';
  expect(/^Current\b.* · looks like \S/.test(first), `first frame reads: ${first}`);
  return first;
});

await s.test('File menu and dialogs have solid backgrounds (nothing shows through)', async () => {
  await page.click('#file-menu > summary');
  await page.waitForTimeout(200);
  const alpha = (sel) =>
    page.$eval(sel, (el) => {
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      const parts = m ? m[1].split(',').map((v) => Number(v.trim())) : [];
      return parts.length === 4 ? parts[3] : 1;
    });
  const menu = await alpha('.file-menu-panel');
  await page.click('#file-menu > summary');
  const dialogs = await Promise.all(['#new-group-dialog', '#new-pose-dialog', '#duplicate-group-dialog'].map(alpha));
  expect(menu === 1, `File menu background alpha ${menu}`);
  expect(dialogs.every((a) => a === 1), `dialog background alphas ${dialogs}`);
});

await s.test('< and > step through frames', async () => {
  const value = () => page.inputValue('#frame-select');
  const pos = () => page.textContent('#frame-position');
  await page.selectOption('#frame-select', '0');
  await page.waitForTimeout(500);
  const prevDisabledAtStart = await page.isDisabled('#btn-frame-prev');
  const a = await value();
  const shotA = await canvasShot();
  await page.click('#btn-frame-next');
  await page.waitForTimeout(700);
  const b = await value();
  const posB = await pos();
  const shotB = await canvasShot();
  await page.click('#btn-frame-prev');
  await page.waitForTimeout(700);
  const c = await value();
  expect(prevDisabledAtStart, '< is enabled on the first frame');
  expect(b === String(Number(a) + 1) && c === a, `frame ${a} → ${b} → ${c}`);
  expect(/^2 \/ \d+$/.test((posB || '').trim()), `position readout: ${posB}`);
  expect(Buffer.compare(shotA, shotB) !== 0, 'canvas did not change when stepping frames');
  return `${a} → ${b} → ${c} · ${posB}`;
});

await s.test('Switching frames reloads the canvas', async () => {
  const a = await canvasShot();
  await selectFrame(page, targets.flippedObj.frame);
  expect(Buffer.compare(a, await canvasShot()) !== 0, 'canvas unchanged after frame switch');
});

await s.test('Eye Left/Right shows the other eye', async () => {
  const left = await canvasShot();
  await page.selectOption('#eye-select', '1');
  await page.waitForTimeout(500);
  const right = await canvasShot();
  await page.selectOption('#eye-select', '0');
  await page.waitForTimeout(500);
  expect(Buffer.compare(left, right) !== 0, 'right eye identical to left');
});

await s.test('Layer filter OBJ reduces draws', async () => {
  const all = await drawsInView();
  await page.selectOption('#layer-select', '2');
  await page.waitForTimeout(400);
  const obj = await drawsInView();
  expect(obj > 0 && obj < all, `all=${all} obj=${obj}`);
  return `all ${all} → OBJ ${obj}`;
});

await s.test('World grid filter and Clear view filters', async () => {
  await page.selectOption('#layer-select', 'all');
  await page.waitForTimeout(300);
  const all = await drawsInView();
  await page.click(`#world-grid button:text-is("${String(targets.flippedObj.world).padStart(2, '0')}")`);
  await page.waitForTimeout(400);
  const one = await drawsInView();
  const filtered = await worldDebug();
  await page.click('#btn-clear-group-filter').catch(() => {});
  await page.waitForTimeout(400);
  const after = await drawsInView();
  expect(/Filter/.test(filtered), `no filter text: ${filtered.slice(0, 80)}`);
  expect(after === all, `after clear ${after} vs all ${all}`);
  return `world ${targets.flippedObj.world}: ${one} draws`;
});

await s.test('World buttons with nothing on this frame are disabled, and come back on a frame that draws them', async () => {
  const disabled = () => page.$$eval('#world-grid button[data-world]:disabled', (bs) => bs.map((b) => b.dataset.world));
  const frames = await page.$$eval('#frame-select option', (os) => os.map((o) => o.value));
  const start = await page.$eval('#frame-select', (s) => s.value);
  const first = await disabled();
  // Clicking an empty world does nothing: the filter stays on All worlds.
  if (first.length) await page.click(`#world-grid button[data-world="${first[0]}"]`, { force: true });
  await page.waitForTimeout(200);
  const stillAll = await page.$eval('#world-grid button.all', (b) => b.classList.contains('on'));
  let revived = null;
  for (const f of frames) {
    if (f === start) continue;
    await page.selectOption('#frame-select', f);
    await page.waitForTimeout(350);
    const now = new Set(await disabled());
    const back = first.find((w) => !now.has(w));
    if (back !== undefined) {
      revived = { frame: f, world: back };
      break;
    }
  }
  await page.selectOption('#frame-select', start);
  await page.waitForTimeout(350);
  expect(first.length > 0 && first.length < 32, `${first.length} world button(s) disabled on the first frame`);
  expect(stillAll, 'clicking an empty world changed the filter');
  expect(revived, 'no world empty on one frame was enabled on another frame');
  return `${first.length} empty on the first frame · world ${revived?.world} back on another frame`;
});

await s.test('Box select selects the tiles in the box', async () => {
  await page.selectOption('#layer-select', '2');
  await page.waitForTimeout(300);
  await marquee(page);
  const n = await selectedCount(page);
  expect(n > 1, `selected ${n}`);
  return `${n} OBJ tiles`;
});

await s.test('Side panels scroll on their own; the page and canvas stay put', async () => {
  await page.$$eval('#groups-tree details', (ds) => ds.forEach((d) => { d.open = true; }));
  const rails = await page.evaluate(() => ['.rail-left', '.rail-right'].map((sel) => {
    const el = document.querySelector(sel);
    return { sel, scrollable: el.scrollHeight > el.clientHeight };
  }));
  await page.locator('.rail-right .group-detail').scrollIntoViewIfNeeded();
  const after = await page.evaluate(() => ({
    pageScroll: window.scrollY,
    pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
    canvasTop: document.getElementById('main-canvas').getBoundingClientRect().top,
  }));
  expect(after.pageScroll === 0 && after.pageOverflow <= 1, `page scrolled ${after.pageScroll}px (overflow ${after.pageOverflow}px)`);
  expect(after.canvasTop > 0 && after.canvasTop < 400, `canvas moved to top=${after.canvasTop}`);
  return rails.map((r) => `${r.sel} scrollable=${r.scrollable}`).join(', ');
});

await s.test('Blank tiles are unselectable by default, selectable with the toggle', async () => {
  const b = targets.blankDraw;
  await selectFrame(page, b.frame);
  await page.selectOption('#layer-select', 'all');
  await page.waitForTimeout(300);

  await clickVip(page, b.x + 4, b.y + 4);
  const clickedOff = await selectedCount(page);
  await marquee(page);
  const boxedOff = await selectedCount(page);

  await page.check('#toggle-blank-tiles');
  await page.waitForTimeout(200);
  await clickVip(page, b.x + 4, b.y + 4);
  const clickedOn = await selectedCount(page);
  await marquee(page);
  const boxedOn = await selectedCount(page);
  await page.uncheck('#toggle-blank-tiles');
  await page.waitForTimeout(200);

  expect(clickedOff === 0, `clicked a blank tile with the toggle off and selected ${clickedOff}`);
  expect(clickedOn === 1, `toggle on: clicking the blank tile selected ${clickedOn}`);
  expect(boxedOn > boxedOff, `box select: ${boxedOff} without blanks vs ${boxedOn} with`);
  return `${b.blanks}/${b.total} draws blank · box select ${boxedOff} → ${boxedOn}`;
});

await s.test('The inspector’s Details report how often a pattern appears in the frame', async () => {
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  const text = ((await page.textContent('#inspector')) || '').replace(/\s+/g, ' ');
  expect(/Appears \d+× in this frame/.test(text), `inspector: ${text.slice(0, 120)}`);
  return text.match(/Appears \d+× in this frame/)?.[0] || '';
});

await s.test('Zoom to selection and back', async () => {
  await page.click('#btn-zoom-selection');
  await page.waitForTimeout(400);
  const zoomed = await isZoomed();
  await page.click('#btn-zoom-selection');
  await page.waitForTimeout(400);
  expect(zoomed && !(await isZoomed()), 'zoom toggle failed');
});

async function paintCheck(target, label) {
  await clickVip(page, target.x + 4, target.y + 4);
  await createGroup(page, label, target.layer === 0 ? 'bg' : 'obj');
  await page.click('#btn-zoom-to-group');
  await page.waitForTimeout(500);
  await page.click('#btn-paint-brush');
  await setPaintColor(page, '#00ff00');
  const map = await buildZoomMap(page);
  const p = inkPixel(target, 3);
  const [cx, cy] = map(p.x, p.y);
  const before = await colorAtClient(page, cx, cy);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await colorAtClient(page, cx, cy);
  expect(after[1] > after[0] && after[1] > after[2], `pixel not green: ${after}`);
  return { map, p, cx, cy, anchor: await canvasAnchor(page, cx, cy), before, after };
}

let bgPaint;
await s.test('Brush on a BG tile paints the clicked pixel', async () => {
  await page.selectOption('#layer-select', 'all');
  await selectFrame(page, targets.bgTile.frame);
  bgPaint = await paintCheck({ ...targets.bgTile, layer: 0, flip: false }, 'Reg BG');
  return `${bgPaint.before} → ${bgPaint.after}`;
});

await s.test('Ctrl+Z undoes the brush stroke', async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const [cx, cy] = await anchorClient(page, bgPaint.anchor);
  const undone = await colorAtClient(page, cx, cy);
  expect(sameColor(undone, bgPaint.before), `after undo ${undone}, before ${bgPaint.before}`);
});

await s.test('Ctrl+Shift+Z redoes the stroke, Ctrl+Y too, and a new stroke ends what can be redone', async () => {
  const [cx, cy] = await anchorClient(page, bgPaint.anchor);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(400);
  const redone = await colorAtClient(page, cx, cy);
  const redoStatus = await status();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(400);
  const again = await colorAtClient(page, cx, cy);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const back = await colorAtClient(page, cx, cy);
  expect(sameColor(redone, bgPaint.after), `after Ctrl+Shift+Z ${redone}, painted ${bgPaint.after} · ${redoStatus}`);
  expect(/^Redo:/.test(redoStatus), `status: ${redoStatus}`);
  expect(sameColor(again, bgPaint.after), `after Ctrl+Y ${again}`);
  expect(sameColor(back, bgPaint.before), `undone again ${back}, before ${bgPaint.before}`);
  return `${bgPaint.before} → ${redone} → ${back}`;
});

await s.test('The Eraser takes paint off a pixel, and Ctrl+Z puts it back', async () => {
  await page.click('#btn-paint-brush');
  await setPaintColor(page, '#00ff00');
  await page.waitForTimeout(300);
  // Where the tile is now: choosing the brush and the colour can move the view.
  let [cx, cy] = await anchorClient(page, bgPaint.anchor);
  const beforeStroke = await colorAtClient(page, cx, cy);
  const zoomedNow = await isZoomed();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const painted = await colorAtClient(page, cx, cy);
  await page.click('#btn-paint-erase');
  await page.waitForTimeout(300);
  const eraserOn = await page.$eval('#btn-paint-erase', (b) => b.classList.contains('active'));
  // The status line can change height and move the canvas: find the tile again.
  [cx, cy] = await anchorClient(page, bgPaint.anchor);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const erased = await colorAtClient(page, cx, cy);
  const erasedStatus = await status();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const restored = await colorAtClient(page, cx, cy);
  const undoStatus = await status();
  await page.keyboard.press('Control+z'); // and the green stroke, so later steps see the tile as before
  await page.waitForTimeout(300);
  await page.click('#btn-paint-brush');
  const green = (c) => c[1] > 150 && c[0] < 100 && c[2] < 100;
  expect(green(painted), `brush did not paint green: ${painted} (before ${beforeStroke}, zoomed ${zoomedNow}) · ${await status()}`);
  expect(eraserOn, 'the Eraser button is not shown as on');
  expect(!green(erased), `still green after erasing: ${erased}`);
  expect(sameColor(restored, painted), `Ctrl+Z after erasing gave ${restored}, painted ${painted} · after erase: ${erasedStatus} · after undo: ${undoStatus}`);
  return `${painted} → erased ${erased} → ${restored}`;
});

await s.test('Deleting a group can be undone (Ctrl+Z) and redone (Ctrl+Shift+Z)', async () => {
  const selected = async () => page.$eval('#groups-tree', (t) => t.querySelector('.group-row.group-selected')?.dataset.groupId || '');
  const inTree = (id) => page.$eval('#groups-tree', (t, gid) => !!t.querySelector(`.group-row[data-group-id="${CSS.escape(gid)}"]`), id);
  const id = await selected();
  expect(!!id, 'no group selected');
  const countBefore = await page.$$eval('#groups-tree .group-row', (rs) => rs.length);
  await page.click('#btn-delete-selected-group');
  await page.waitForTimeout(400);
  const goneAfterDelete = !(await inTree(id));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const backAfterUndo = await inTree(id);
  const reselected = (await selected()) === id;
  const undoStatus = await status();
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(500);
  const goneAfterRedo = !(await inTree(id));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const countAfter = await page.$$eval('#groups-tree .group-row', (rs) => rs.length);
  expect(goneAfterDelete, 'the group is still in the tree after Delete');
  expect(backAfterUndo && reselected, `after Ctrl+Z: in tree ${backAfterUndo}, selected ${reselected} · ${undoStatus}`);
  expect(goneAfterRedo, 'Ctrl+Shift+Z did not delete it again');
  expect(countAfter === countBefore && (await inTree(id)), `groups ${countBefore} → ${countAfter}`);
  return undoStatus.slice(0, 70);
});

await s.test('Fill tool fills the tile', async () => {
  await page.click('#btn-paint-fill');
  await setPaintColor(page, '#0040ff');
  const [cx, cy] = await anchorClient(page, bgPaint.anchor);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(600);
  const c = await colorAtClient(page, cx, cy);
  expect(c[2] > c[0] && c[2] > c[1], `pixel not blue after fill: ${c} · ${await status()}`);
  return (await status()).slice(0, 70);
});

await s.test('Fill with Across tiles enabled', async () => {
  await page.check('#fill-across-tiles');
  await setPaintColor(page, '#ff00ff');
  const errBefore = errors.length;
  const [cx, cy] = await anchorClient(page, bgPaint.anchor);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(800);
  await page.uncheck('#fill-across-tiles');
  const [rx, ry] = await anchorClient(page, bgPaint.anchor);
  const c = await colorAtClient(page, rx, ry);
  expect(errors.length === errBefore, errors.slice(errBefore).join(' | '));
  expect(c[0] > c[1] && c[2] > c[1], `pixel not magenta: ${c}`);
  return (await status()).slice(0, 70);
});

await s.test('Color picker (preview sampling fallback) sets the paint color', async () => {
  await page.click('#btn-paint-color-pick');
  const [cx, cy] = await anchorClient(page, bgPaint.anchor);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);
  const v = await page.inputValue('#zoom-paint-color');
  const shown = await colorAtClient(page, cx, cy);
  const hex = `#${shown.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  expect(v.toLowerCase() === hex, `picker ${v} vs pixel ${hex}`);
  return `picked ${v} for a pixel painted #ff00ff`;
});

await s.test('Brush on a mirrored sprite tile paints the clicked pixel (not the mirror)', async () => {
  await unzoom();
  await selectFrame(page, targets.flippedObj.frame);
  await page.selectOption('#layer-select', '2');
  const t = { ...targets.flippedObj, layer: 2, flip: true };
  const r = await paintCheck(t, 'Reg mirrored OBJ');
  const mirror = { x: t.x + 7 - (r.p.x - t.x), y: r.p.y };
  if (mirror.x !== r.p.x) {
    const [mx, my] = r.map(mirror.x, mirror.y);
    const m = await colorAtClient(page, mx, my);
    expect(!(m[1] > m[0] && m[1] > m[2]), `mirror pixel also green: ${m}`);
  }
  return `clicked (${r.p.x},${r.p.y}) green, mirror untouched`;
});

await s.test('Rename group from inspector', async () => {
  await page.fill('#group-display-name-input', 'Reg renamed');
  await page.click('#btn-group-apply-name');
  await page.waitForTimeout(300);
  const names = await page.$$eval('.group-row', (rs) => rs.map((r) => r.textContent));
  expect(names.some((n) => n.includes('Reg renamed')), `tree: ${names.join(', ')}`);
});

await s.test('Unsaved edits: Open pack asks first (Cancel keeps the project) and closing the tab is guarded', async () => {
  // The rename above left unsaved changes.
  const groupsBefore = await groupRows();
  const asked = dialogs.length;
  answers.push(false);
  await page.click('#file-menu summary');
  await page.click('#file-menu-open');
  await page.waitForTimeout(400);
  const d = dialogs[asked];
  expect(d?.type === 'confirm' && /^This project has unsaved changes\. Open pack will throw them away\./.test(d.message), `Open pack asked: ${d?.message?.slice(0, 90) || 'nothing'}`);
  expect((await groupRows()) === groupsBefore, `groups ${groupsBefore} → ${await groupRows()} after Cancel`);
  const guarded = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(guarded, 'closing the tab with unsaved edits is not guarded');
  if (await page.isVisible('#file-menu[open]')) await page.click('#file-menu summary');
});

await s.test('Duplicate group to another pool variant', async () => {
  const before = await groupRows();
  await page.click('#btn-duplicate-group');
  await page.waitForSelector('#duplicate-group-dialog[open]');
  const opts = await page.$$eval('#dup-group-pool-variant option', (os) => os.map((o) => o.value).filter(Boolean));
  const current = await page.inputValue('#dup-group-pool-variant');
  const other = opts.find((o) => o !== current);
  if (other) await page.selectOption('#dup-group-pool-variant', other);
  await page.click('#dup-group-confirm');
  await page.waitForTimeout(400);
  const err = (await page.textContent('#dup-group-error')) || '';
  if (await page.isVisible('#duplicate-group-dialog[open]')) await page.click('#dup-group-cancel');
  expect((await groupRows()) === before + 1, `groups ${before} → ${await groupRows()} ${err}`);
});

await s.test('Delete group (with confirm)', async () => {
  const before = await groupRows();
  answers.push(true);
  await page.click('#btn-delete-selected-group');
  await page.waitForTimeout(400);
  expect((await groupRows()) === before - 1, `groups ${before} → ${await groupRows()}`);
});

await s.test('BG anchor: clear with ✕, pick with A', async () => {
  await unzoom();
  await selectFrame(page, targets.bgTile.frame);
  await page.selectOption('#layer-select', 'all');
  await selectGroup(page, 'Reg BG');
  await page.waitForTimeout(300);
  const clear = await page.$('#btn-group-anchor-clear');
  if (clear) {
    await clear.click();
    await page.waitForTimeout(300);
  }
  const cleared = ((await page.textContent('#group-detail')) || '').replace(/\s+/g, ' ');
  await page.click('#btn-group-anchor-pick');
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  await page.waitForTimeout(300);
  const picked = await status();
  expect(/Anchor hash —/.test(cleared), 'anchor not cleared');
  expect(/anchorHash #/.test(picked) && !!(await page.$('#btn-group-anchor-clear')), `pick status: ${picked.slice(0, 90)}`);
  return picked.slice(0, 90);
});

await s.test('BG anchor: A still picks while the Fill tool is selected', async () => {
  await unzoom();
  await selectFrame(page, targets.bgTile.frame);
  await page.selectOption('#layer-select', 'all');
  await selectGroup(page, 'Reg BG');
  await page.waitForTimeout(300);
  const clear = await page.$('#btn-group-anchor-clear');
  if (clear) {
    await clear.click();
    await page.waitForTimeout(300);
  }
  // Fill used to claim the pointer on pointerdown, so the pick click never resolved.
  await page.click('#btn-paint-fill');
  await page.waitForTimeout(200);
  await page.click('#btn-group-anchor-pick');
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  await page.waitForTimeout(300);
  const picked = await status();
  expect(/anchorHash #/.test(picked) && !!(await page.$('#btn-group-anchor-clear')), `pick status: ${picked.slice(0, 90)}`);
  await page.click('#btn-canvas-select');
  return picked.slice(0, 90);
});

await s.test('Screenshot overlay toggle and alpha change the preview', async () => {
  const a = await canvasShot();
  await page.check('#toggle-shot-overlay');
  await page.waitForTimeout(600);
  const b = await canvasShot();
  await page.$eval('#shot-overlay-alpha', (el) => {
    el.value = '1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const c = await canvasShot();
  await page.uncheck('#toggle-shot-overlay');
  await page.waitForTimeout(300);
  expect(Buffer.compare(a, b) !== 0, 'overlay toggle had no effect');
  expect(Buffer.compare(b, c) !== 0, 'alpha change had no effect');
});

await s.test('Brightness slider: default 125%, changes preview, persists, double-click resets', async () => {
  const label = await page.textContent('#preview-brightness-value');
  const a = await canvasShot();
  await page.$eval('#preview-brightness', (el) => {
    // Down, not up: unpainted pixels already at full brightness cannot get brighter, and now that
    // fades are measured against the game's normal level (src/fade.js) many are.
    el.value = '0.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const b = await canvasShot();
  const stored = await page.evaluate(() => localStorage.getItem('painter.previewBrightness'));
  await page.dblclick('#preview-brightness');
  await page.waitForTimeout(300);
  const reset = await page.textContent('#preview-brightness-value');
  expect(label === '125%', `default ${label}`);
  expect(Buffer.compare(a, b) !== 0, 'preview unchanged at 50%');
  expect(stored === '0.5', `stored ${stored}`);
  expect(reset === '125%', `after double-click ${reset}`);
});

await s.test('Save, then reopen: paint, groups, pools, and overlays survive', async () => {
  const [cx, cy] = await fullClient(page, bgPaint.p.x, bgPaint.p.y);
  const paintedBefore = await colorAtClient(page, cx, cy);
  const groupsBefore = await groupRows();
  const savedPath = `${OUT}/s2-painter-saved.vbpack`;
  await painterSave(page, savedPath);
  const orig = await parseArtPack((await readFile(PACK_ANNOTATED)).buffer);
  const saved = await parseArtPack((await readFile(savedPath)).buffer);
  expect(saved.vbcolor?.byteLength > (orig.vbcolor?.byteLength || 0), 'no painted tiles in saved vbcolor');
  expect(saved.gameStatePools.length === orig.gameStatePools.length, 'pools changed');
  // Old screen-pinned overlays convert to touch-ups on open; Save writes them as group PNGs.
  const hadOverlays = typeof orig.painterV2VipOverlays === 'string' && orig.painterV2VipOverlays.length > 0;
  const touchUps = (saved.groups || []).filter((g) => g?.touchUp && typeof g.touchUp.png === 'string' && g.touchUp.png.length > 0);
  expect(!hadOverlays || touchUps.length > 0 || typeof saved.painterV2VipOverlays === 'string', 'overlays neither kept nor saved as touch-ups');

  await openPainter(page, savedPath);
  await selectFrame(page, targets.bgTile.frame);
  const [cx2, cy2] = await fullClient(page, bgPaint.p.x, bgPaint.p.y);
  const paintedAfter = await colorAtClient(page, cx2, cy2);
  const groupsAfter = await groupRows();
  expect(sameColor(paintedBefore, paintedAfter), `painted pixel ${paintedBefore} → ${paintedAfter}`);
  expect(groupsAfter === groupsBefore, `groups ${groupsBefore} → ${groupsAfter}`);
  return `groups ${groupsAfter}; ${(await status()).slice(0, 100)}`;
});

await s.test('Select matching picks every draw sharing the tile pattern', async () => {
  await selectFrame(page, targets.bgTile.frame);
  await page.selectOption('#layer-select', 'all');
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  expect((await selectedCount(page)) === 1, 'expected one tile selected to start');
  await page.click('#btn-select-matching');
  await page.waitForTimeout(300);
  const n = await selectedCount(page);
  const status = (await page.textContent('#status')) || '';
  expect(n >= 1 && /sharing pattern #/.test(status), `selected ${n} · ${status.slice(0, 80)}`);
  return status.slice(0, 80);
});

await s.test('Selection modes: Add grows the selection, Subtract shrinks it', async () => {
  await page.click('#btn-select-mode-replace');
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  const one = await selectedCount(page);

  await page.click('#btn-select-mode-add');
  await marquee(page);
  const added = await selectedCount(page);

  await page.click('#btn-select-mode-remove');
  await marquee(page, targets.bgTile.x - 4, targets.bgTile.y - 4, targets.bgTile.x + 12, targets.bgTile.y + 12);
  const afterSubtract = await selectedCount(page);

  await page.click('#btn-select-mode-replace');
  await page.waitForTimeout(150);
  expect(one === 1, `expected 1 selected, got ${one}`);
  expect(added > one, `add mode: ${one} → ${added}`);
  expect(afterSubtract < added, `subtract mode: ${added} → ${afterSubtract}`);
  return `${one} → ${added} → ${afterSubtract}`;
});

await s.test('Shift-drag adds without switching modes', async () => {
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  const one = await selectedCount(page);
  const box = await canvasBox(page);
  const at = (vx, vy) => [box.x + ((vx + 0.5) * box.width) / 384, box.y + ((vy + 0.5) * box.height) / 224];
  await page.keyboard.down('Shift');
  await page.mouse.move(...at(0, 0));
  await page.mouse.down();
  await page.mouse.move(...at(383, 223), { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
  const added = await selectedCount(page);
  expect(one === 1 && added > one, `${one} → ${added}`);
  return `${one} → ${added}`;
});

await s.test('This pixel: one sentence on what colours it (or why nothing does), the tile data and draw stack behind Details', async () => {
  // A lit pixel of the target tile, so the answer is about paint, not an empty spot.
  const lit = await page.evaluate(({ x, y }) => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('main-canvas'));
    const k = c.width / 384;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let py = y; py < y + 8; py++) {
      for (let px = x; px < x + 8; px++) {
        const i = ((Math.floor((py + 0.5) * k) * c.width) + Math.floor((px + 0.5) * k)) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 30) return { x: px, y: py };
      }
    }
    return { x: x + 4, y: y + 4 };
  }, { x: targets.bgTile.x, y: targets.bgTile.y });
  await clickVip(page, lit.x, lit.y);
  await page.waitForTimeout(300);
  const answer = ((await page.textContent('#inspector-answer')) || '').replace(/\s+/g, ' ').trim();
  const fix = (await page.$('#btn-inspector-fix')) ? (await page.textContent('#btn-inspector-fix')) || '' : '';
  const closed = !(await page.$eval('#inspector-details', (d) => d.open));
  const tileHidden = !(await page.isVisible('#inspector'));
  await page.click('#inspector-details > summary');
  const rows = await page.$$eval('#draw-stack-panel .stack-row', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  const tileShown = await page.isVisible('#inspector');
  await page.click('#inspector-details > summary');
  expect(/^(Coloured by|Not coloured:|Nothing is drawn)/.test(answer), `answer: ${answer.slice(0, 160)}`);
  expect(!/^Not coloured/.test(answer) || fix.length > 0, `an uncoloured pixel offers a fix: ${answer.slice(0, 100)}`);
  expect(closed && tileHidden && tileShown, `details closed ${closed}, tile data hidden ${tileHidden} then shown ${tileShown}`);
  expect(rows.length >= 1 && /front/.test(rows[0]), `stack rows: ${rows.slice(0, 2).join(' | ')}`);
  return `${answer.slice(0, 90)}${fix ? ` [${fix}]` : ''} · ${rows.length} draw(s) under it`;
});

await s.test('Developer details are off until File ▸ Developer details turns them on (remembered)', async () => {
  const hiddenBefore = !(await page.isVisible('#canvas-hint')) && !(await page.isVisible('#world-filter-debug'));
  await page.click('#project-menu > summary');
  await page.check('#toggle-dev-details');
  await page.click('#file-menu > summary');
  const shown = await page.isVisible('#canvas-hint');
  const stored = await page.evaluate(() => localStorage.getItem('vbc.devDetails'));
  await page.click('#project-menu > summary');
  await page.uncheck('#toggle-dev-details');
  await page.click('#file-menu > summary');
  const hiddenAfter = !(await page.isVisible('#canvas-hint'));
  expect(hiddenBefore && shown && hiddenAfter && stored === '1', `before hidden ${hiddenBefore}, on shown ${shown}, stored ${stored}, off hidden ${hiddenAfter}`);
  return 'hidden → shown → hidden';
});

await s.test('Export frame PNG downloads an image of the composite', async () => {
  await page.click('#frame-menu > summary');
  const path = `${OUT}/s2-frame-export.png`;
  const name = await captureDownload(page, () => page.click('#file-menu-export-png'), path);
  const bytes = await readFile(path);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  expect(isPng, `not a PNG (first bytes ${[...bytes.slice(0, 4)]})`);
  expect(bytes.length > 1000, `suspiciously small PNG (${bytes.length} bytes)`);
  return `${name}, ${(bytes.length / 1024).toFixed(0)} KB`;
});

await s.test('Zoom to group frames the group, not the whole screen', async () => {
  await selectFrame(page, targets.bgTile.frame);
  await page.selectOption('#layer-select', 'all');
  await page.waitForTimeout(300);
  await selectGroup(page, 'Reg BG');
  await unzoom();
  await page.click('#btn-zoom-to-group');
  await page.waitForTimeout(600);
  const st = await status();
  const shown = Number((st.match(/Zoomed to (\d+) tile/) || [])[1] || -1);
  const across = Number((st.match(/(\d+) draw\(s\) match across the frame/) || [])[1] || shown);
  const size = await page.$eval('#main-canvas', (c) => [c.width, c.height]);
  await unzoom();
  expect(shown > 0, `zoom reported no tiles: ${st.slice(0, 120)}`);
  expect(shown <= across, `showed ${shown} of ${across} matching draws`);
  // The zoom canvas takes the viewport's shape, so a full-frame 384:224 aspect
  // means it fell back to showing everything.
  expect(Math.abs(size[0] / size[1] - 384 / 224) > 0.01, `canvas ${size[0]}×${size[1]} is the whole frame`);
  return `${shown} tile(s) framed of ${across} matching · canvas ${size[0]}×${size[1]}`;
});

await s.test('Filter to group toggles off on a second click', async () => {
  await selectGroup(page, 'Reg BG');
  const drawsAll = await drawsInView();
  await page.click('#btn-filter-to-group');
  await page.waitForTimeout(400);
  const drawsFiltered = await drawsInView();
  const pressedOn = await page.getAttribute('#btn-filter-to-group', 'aria-pressed');
  await page.click('#btn-filter-to-group');
  await page.waitForTimeout(400);
  const drawsBack = await drawsInView();
  const pressedOff = await page.getAttribute('#btn-filter-to-group', 'aria-pressed');
  expect(drawsFiltered < drawsAll, `filter did not reduce draws: ${drawsAll} → ${drawsFiltered}`);
  expect(drawsBack === drawsAll, `second click did not restore the view: ${drawsBack} vs ${drawsAll}`);
  expect(pressedOn === 'true' && pressedOff === 'false', `aria-pressed ${pressedOn} → ${pressedOff}`);
  return `${drawsAll} → ${drawsFiltered} → ${drawsBack} draws`;
});

await s.test('A new BG group takes a unique anchor when the selection has one', async () => {
  await selectFrame(page, targets.bgTile.frame);
  await page.selectOption('#layer-select', 'all');
  await page.waitForTimeout(300);
  // Box select drags in a whole screen of BG, most of it repeated patterns — the
  // frontmost draw is unlikely to be the unique one.
  await marquee(page);
  const selected = await selectedCount(page);
  await createGroup(page, 'Anchor pick check', 'bg');
  const st = await status();
  await page.click('#btn-delete-group').catch(() => {});
  await page.waitForTimeout(300);
  expect(selected > 1, `expected a multi-tile selection, got ${selected}`);
  expect(/Anchor #[0-9A-F]+ is unique here/.test(st), `anchor was not unique: ${st.slice(0, 160)}`);
  return `${selected} tiles · ${(st.match(/Anchor #[0-9A-F]+ is unique here/) || [])[0]}`;
});

await s.test('New group suggests the memory pool whose RAM fingerprint matches the frame', async () => {
  await selectFrame(page, targets.bgTile.frame);
  await page.selectOption('#layer-select', 'all');
  await page.waitForTimeout(300);
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  await page.click('#btn-new-group-from-selection');
  await page.waitForSelector('#new-group-dialog[open]');
  const hint = ((await page.textContent('#new-group-pool-hint')) || '').replace(/\s+/g, ' ');
  const picked = await page.inputValue('#new-group-pool-variant');
  const options = await page.$$eval('#new-group-pool-variant option', (os) => os.length);
  await page.click('#new-group-cancel').catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(250);
  expect(/memory fingerprint/i.test(hint), `hint did not use the fingerprint: ${hint.slice(0, 140)}`);
  expect(options > 1 && /::/.test(picked), `expected a real pool row among ${options} options, got "${picked}"`);
  return `${picked} · ${hint.slice(0, 80)}`;
});

await s.test('Frame widgets live in the left rail, not the header', async () => {
  const inRail = await page.$$eval('.rail-left #frame-select, .rail-left #eye-select, .rail-left #layer-select, .rail-left #toggle-shot-overlay, .rail-left #toggle-reference-overlay, .rail-left #shot-overlay-alpha, .rail-left #preview-brightness', (els) => els.length);
  const inHeader = await page.$$eval('.header-actions #frame-select, .header-actions #eye-select, .header-actions #layer-select', (els) => els.length);
  expect(inRail === 7, `${inRail} of 7 frame widgets in the rail`);
  expect(inHeader === 0, `${inHeader} frame widgets still in the header`);
  return `${inRail} in rail · ${inHeader} in header`;
});

await s.test('Frame ▸ Export screenshot downloads the capture for that frame', async () => {
  await selectFrame(page, targets.bgTile.frame);
  await page.waitForTimeout(300);
  const name = await captureDownload(
    page,
    async () => {
      await page.$eval('#frame-menu', (el) => { el.open = true; el.dispatchEvent(new Event('toggle')); });
      await page.click('#frame-menu-export-shot');
    },
    `${OUT}/frame-export.png`
  );
  const png = await readFile(`${OUT}/frame-export.png`);
  const big = png.readUInt32BE(16) >= 384 && png.readUInt32BE(20) >= 224;
  expect(/\.png$/i.test(name), `unexpected download name: ${name}`);
  expect(big, `exported image is only ${png.readUInt32BE(16)}×${png.readUInt32BE(20)}`);
  return `${name} · ${png.readUInt32BE(16)}×${png.readUInt32BE(20)}`;
});

await s.test('A colorized reference overlays the frame, and the alpha slider drives it', async () => {
  const before = await canvasShot();
  await page.$eval('#frame-menu', (el) => { el.open = true; el.dispatchEvent(new Event('toggle')); });
  // Any image will do: a reference is whatever came back from an external tool.
  await page.setInputFiles('#reference-input', `${OUT}/frame-export.png`);
  await page.waitForTimeout(700);
  await page.$eval('#frame-menu', (el) => { el.open = false; }); // the open panel would cover the rail
  const statusText = await status();
  const on = await page.$eval('#toggle-reference-overlay', (el) => el.checked && !el.disabled);
  await page.fill('#shot-overlay-alpha', '1');
  await page.dispatchEvent('#shot-overlay-alpha', 'input');
  await page.waitForTimeout(250);
  const shown = await canvasShot();
  await page.uncheck('#toggle-reference-overlay');
  await page.waitForTimeout(250);
  const hidden = await canvasShot();
  expect(/Reference added/i.test(statusText), `status was "${statusText.slice(0, 80)}"`);
  expect(on, 'reference overlay did not switch on after import');
  expect(!shown.equals(before), 'canvas did not change with the reference shown');
  expect(hidden.equals(before), 'canvas did not go back when the reference was hidden');
  await page.check('#toggle-reference-overlay');
  return `${(await page.textContent('#reference-status')).slice(0, 70)}`;
});

await s.test('Move & scale drags the reference, and Revert puts it back', async () => {
  const revertEnabled = () => page.$eval('#btn-reference-revert', (el) => !el.disabled);
  expect(!(await revertEnabled()), 'Revert was enabled before anything moved');
  await page.click('#btn-reference-transform');
  await page.waitForTimeout(200);
  const outlined = await canvasShot();
  const b = await canvasBox(page);
  // Frame pixels → client pixels, so a drag can grab a specific edge of the reference.
  const at = (fx, fy) => [b.x + (fx / 384) * b.width, b.y + (fy / 224) * b.height];
  const drag = async (from, to) => {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const placement = async () => {
    const m = (await status()).match(/Reference at (-?\d+),(-?\d+) · (\d+)×(\d+)/);
    expect(!!m, `no placement in status: ${(await status()).slice(0, 90)}`);
    return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
  };

  // Freshly imported it is fitted inside the frame, centred — work out where its right edge is.
  const src = (await page.textContent('#reference-status')).match(/from (\d+)×(\d+)/);
  expect(!!src, 'reference status does not say what size the image was');
  const fit = Math.min(384 / Number(src[1]), 224 / Number(src[2]));
  const start = { w: Number(src[1]) * fit, h: Number(src[2]) * fit };
  start.x = (384 - start.w) / 2;
  start.y = (224 - start.h) / 2;
  const shot0 = await canvasShot();
  await drag(at(start.x + start.w, start.y + start.h / 2), [b.x + b.width + 160, b.y + b.height / 2]);
  const scaled = await placement();
  expect(scaled.w > start.w, `reference did not grow past the frame: ${scaled.w}×${scaled.h}`);
  expect(await revertEnabled(), 'Revert stayed disabled after scaling');
  expect(!(await canvasShot()).equals(shot0), 'canvas did not change after scaling');

  // Then move it: same size, new position.
  const [mx, my] = at(Math.min(370, scaled.x + scaled.w / 2), Math.min(200, scaled.y + scaled.h / 2));
  await drag([mx, my], [mx - 60, my - 30]);
  const moved = await placement();
  expect(Math.abs(moved.w - scaled.w) <= 2, `moving changed the size: ${scaled.w} → ${moved.w}`);
  expect(moved.x !== scaled.x || moved.y !== scaled.y, `moving did not move it: ${moved.x},${moved.y}`);
  expect(!outlined.equals(await canvasShot()), 'canvas unchanged after move');

  // While the mode is on it owns the canvas, so dragging never selects tiles.
  const selectedBefore = await selectedCount(page);
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  await page.waitForTimeout(200);
  const selectedDuring = await selectedCount(page);
  expect(selectedDuring === selectedBefore, `clicking the canvas changed the selection (${selectedBefore} → ${selectedDuring}) while Move & scale was on`);

  // Any other canvas tool takes the canvas back; the paint tools need a group first.
  let toolTookOver = 'paint tool disabled — toggled off instead';
  if (await page.$eval('#btn-paint-fill', (el) => !el.disabled)) {
    await page.click('#btn-paint-fill');
    await page.waitForTimeout(200);
    toolTookOver = 'fill tool took over';
  } else {
    await page.click('#btn-reference-transform');
    await page.waitForTimeout(200);
  }
  const stillOn = await page.$eval('#btn-reference-transform', (el) => el.classList.contains('active'));
  expect(!stillOn, `Move & scale stayed on (${toolTookOver})`);

  const beforeRevert = await canvasShot();
  await page.click('#btn-reference-revert');
  await page.waitForTimeout(250);
  const reverted = await canvasShot();
  expect(!(await revertEnabled()), 'Revert stayed enabled after reverting');
  expect(!reverted.equals(beforeRevert), 'canvas did not change after Revert');
  return `scaled to ${Math.round(scaled.w)}×${Math.round(scaled.h)} px, moved, reverted · ${toolTookOver}`;
});

await s.test('Fill selection from reference paints the selected tiles', async () => {
  const button = '#btn-reference-fill-selection';
  await page.$eval('#frame-menu', (el) => { el.open = false; });
  await page.click('#btn-clear-group-filter').catch(() => {});
  await unzoom();
  await page.selectOption('#layer-select', 'all');
  await page.waitForTimeout(300);
  expect(await page.isDisabled(button), 'fill was offered with nothing selected');

  await marquee(page, targets.bgTile.x - 8, targets.bgTile.y - 8, targets.bgTile.x + 24, targets.bgTile.y + 24);
  const selected = await selectedCount(page);
  expect(selected > 0, 'nothing selected to fill');
  expect(!(await page.isDisabled(button)), 'fill stayed disabled with a selection and a reference');

  // With the overlay on, the reference blends over tiles that now hold those very colours,
  // so the change is invisible. Compare the painted frame itself.
  await page.uncheck('#toggle-reference-overlay');
  await page.waitForTimeout(300);
  const before = await canvasShot();
  await page.click(button);
  const statusText = await page.textContent('#status');
  await page.waitForTimeout(600);
  const after = await canvasShot();
  const m = statusText.match(/Filled (\d+) tile pattern\(s\) from (\d+) selected tile\(s\)/);
  expect(!!m, `fill said: ${statusText.slice(0, 120)}`);
  expect(Number(m[2]) === selected, `filled from ${m[2]} tiles but ${selected} were selected`);
  expect(!before.equals(after), 'the canvas did not change after filling from the reference');

  // Undo it: later sections open the pack this run saves, and a pack whose tiles are already
  // filled would make their own fill a no-op.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  expect(before.equals(await canvasShot()), 'Ctrl+Z did not put the filled tiles back');
  return `${m[0]}, then undone`;
});

await s.test('A frame can be renamed and tagged, and the name shows in the picker', async () => {
  await page.$eval('#frame-menu', (el) => { el.open = true; el.dispatchEvent(new Event('toggle')); });
  await page.click('#frame-menu-rename');
  await page.waitForSelector('#frame-details-dialog[open]');
  await page.fill('#frame-details-name', 'Named by test');
  await page.fill('#frame-details-tags', 'alpha, Alpha, beta');
  await page.click('#frame-details-submit');
  await page.waitForTimeout(300);
  const label = await page.$eval('#frame-select', (el) => el.options[el.selectedIndex].textContent || '');
  await page.$eval('#frame-menu', (el) => { el.open = true; el.dispatchEvent(new Event('toggle')); });
  await page.click('#frame-menu-tags');
  await page.waitForSelector('#frame-details-dialog[open]');
  const tags = await page.inputValue('#frame-details-tags');
  await page.click('#frame-details-cancel');
  expect(label.includes('Named by test'), `picker shows "${label}"`);
  expect(tags === 'alpha, beta', `tags came back as "${tags}" (duplicates should collapse)`);
  return `${label} · tags ${tags}`;
});

await s.test('Saving writes the reference and the frame details into the pack', async () => {
  const savedPath = `${OUT}/s2-references.vbpack`;
  await painterSave(page, savedPath);
  const parsed = await parseArtPack((await readFile(savedPath)).buffer);
  const refs = parsed.manifest?.references;
  const named = (parsed.manifest?.frameRegistry || []).find((e) => e?.name === 'Named by test');
  expect(Array.isArray(parsed.referencesFolder) && parsed.referencesFolder.length === 1, `${parsed.referencesFolder?.length ?? 0} reference image(s) in the pack`);
  expect(refs?.items?.length === 1, `${refs?.items?.length ?? 0} reference entries in the manifest`);
  expect(parsed.referencesFolder[0].name === `${refs.items[0].refId}.png`, `image ${parsed.referencesFolder[0].name} does not match ${refs.items[0].refId}`);
  expect(!!named && named.tags?.join(',') === 'alpha,beta', `frame details saved as ${JSON.stringify(named?.tags)}`);
  return `${refs.items[0].scope}-scoped reference · ${named.name} [${named.tags.join(', ')}]`;
});

await s.test('Leaving for the emulator warns while there is unsaved work', async () => {
  // Saving leaves the File menu open, and its panel would swallow the click.
  await page.$eval('#file-menu', (el) => { el.open = false; });
  const header = await page.$eval('.header-actions #btn-goto-emulator', (el) => el.textContent?.trim() || '');
  const inMenu = await page.$$eval('.menu-row a', (as) => as.map((a) => a.textContent?.trim()).join(','));
  // Make an unsaved edit the cheap way: name the frame again.
  await page.$eval('#frame-menu', (el) => { el.open = true; el.dispatchEvent(new Event('toggle')); });
  await page.click('#frame-menu-rename');
  await page.waitForSelector('#frame-details-dialog[open]');
  await page.fill('#frame-details-name', 'Unsaved rename');
  await page.click('#frame-details-submit');
  await page.waitForTimeout(250);
  await page.$eval('#frame-menu', (el) => { el.open = false; });
  const hit = await page.evaluate(() => {
    const b = document.getElementById('btn-goto-emulator');
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { at: el ? `${el.tagName}#${el.id}.${el.className}` : 'none', dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id).join(',') };
  });
  expect(hit.at.includes('btn-goto-emulator'), `the Emulator button is covered by ${hit.at} (open dialogs: ${hit.dialogs || 'none'})`);
  answers.push(false); // decline the "leave and lose unsaved work" confirm
  // dispatchEvent, not click: the handler opens a confirm, and a blocked page stalls click's
  // post-action checks.
  await page.dispatchEvent('#btn-goto-emulator', 'click');
  await page.waitForTimeout(400);
  expect(header === 'Emulator', `header button reads "${header}"`);
  expect(!/Emulator/.test(inMenu), `the menu row still has an Emulator link: ${inMenu}`);
  expect(page.url().includes('/tools/project.html'), `declining the warning still left the page: ${page.url()}`);
  return `header button · menu row: ${inMenu || '(none)'}`;
});

await s.test('A selected group can be let go: Deselect button, or Escape', async () => {
  const detail = () => page.$eval('#group-detail', (el) => (el.textContent || '').trim());
  await selectGroup(page, 'Reg BG');
  expect(!/Select a group/.test(await detail()), 'group did not become selected');
  await page.click('#btn-deselect-group');
  await page.waitForTimeout(400);
  const afterButton = await detail();

  await selectGroup(page, 'Reg BG');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const afterEsc = await detail();
  expect(/Select a group/.test(afterButton), `Deselect kept the group: ${afterButton.slice(0, 50)}`);
  expect(/Select a group/.test(afterEsc), `Escape kept the group selected: ${afterEsc.slice(0, 50)}`);
  return 'Deselect button and Esc both let go';
});

/** Close the inventory and wait for the modal backdrop to go, so the next click lands. */
const closePaintInventory = async () => {
  await page.click('#paint-inventory-close');
  await page.waitForFunction(() => document.getElementById('paint-inventory-dialog')?.open === false);
};

await s.test('Saving shows a progress window with what it is doing, then closes it', async () => {
  // A save on a real project is several seconds of zipping. The status line only spoke at the
  // end, so there was no way to tell "working" from "stuck".
  const seen = [];
  const poll = setInterval(async () => {
    try {
      const t = await page.evaluate(() => {
        const d = document.getElementById('save-progress-dialog');
        if (!d?.open) return null;
        return {
          pct: Number(document.getElementById('save-progress-bar')?.getAttribute('aria-valuenow') || -1),
          now: document.getElementById('save-progress-now')?.textContent?.trim() || '',
          steps: [...document.querySelectorAll('#save-progress-steps li')].map((li) => li.className),
        };
      });
      if (t) seen.push(t);
    } catch { /* the page is busy */ }
  }, 40);

  const path = `${OUT}/s2-save-progress.vbpack`;
  await painterSave(page, path);
  clearInterval(poll);
  await page.waitForTimeout(400);

  const stillOpen = await page.$eval('#save-progress-dialog', (d) => d.open);
  const saved = await status();
  expect(seen.length > 0, 'the progress window never appeared during the save');
  expect(seen.some((t) => /Packing the .vbpack/.test(t.now)), `never reported packing: ${seen.map((t) => t.now).slice(0, 3)}`);
  expect(seen.some((t) => t.steps.some((c) => /is-running/.test(c))), 'no step was ever marked running');
  expect(seen.some((t) => t.steps.some((c) => /is-done/.test(c))), 'no step was ever marked done');
  expect(Math.max(...seen.map((t) => t.pct)) > 0, 'the bar never moved');
  expect(!stillOpen, 'the progress window stayed open after the save finished');
  expect(/^Saved /.test(saved), `status said: ${saved.slice(0, 60)}`);
  return `${seen.length} tick(s), peak ${Math.max(...seen.map((t) => t.pct))}%`;
});

await s.test('Painted tiles lists what is painted and where it lives', async () => {
  await selectGroup(page, 'Reg BG');
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  await page.click('#btn-reference-fill-selection');
  await page.waitForTimeout(600);

  await page.click('#btn-paint-inventory');
  await page.waitForFunction(() => document.getElementById('paint-inventory-dialog')?.open === true);
  const open = await page.$eval('#paint-inventory-dialog', (d) => d.open);
  const defaultFilter = await page.inputValue('#paint-inventory-filter');
  await page.selectOption('#paint-inventory-filter', 'all');
  await page.waitForTimeout(300);
  const summary = ((await page.textContent('#paint-inventory-summary')) || '').replace(/\s+/g, ' ');
  const rows = await page.$$eval('#paint-inventory-list .paint-row', (rs) => rs.length);
  const swatches = await page.$$eval('#paint-inventory-list .paint-swatch', (im) => im.filter((i) => i.src.startsWith('data:image')).length);
  // Close before asserting, so a failure does not leave a modal over the next test.
  await closePaintInventory();

  expect(open, 'the dialog did not open');
  expect(defaultFilter === 'frame', `default filter was ${defaultFilter}, expected this frame`);
  expect(/painted item/.test(summary), `summary said: ${summary.slice(0, 80)}`);
  expect(rows > 0, 'no painted patterns listed');
  expect(swatches === rows, `${swatches} swatches for ${rows} rows`);
  return `${rows} row(s) · ${summary.slice(0, 60)}`;
});

await s.test('Old overlays open as touch-ups: a pill on the group row and a details line', async () => {
  // Screen-pinned overlays (painter-v2-vip-overlays.json) become touch-ups anchored where they
  // were painted, so they follow their tiles instead of the screen.
  const rows = await page.$$eval('.group-row', (rs) =>
    rs.filter((r) => r.querySelector('.touch-up-pill')).map((r) => r.querySelector('.group-name')?.textContent || ''));
  expect(rows.length > 0, 'no group shows a touch-up pill');
  await selectGroup(page, rows[0]);
  await page.waitForTimeout(300);
  const detail = ((await page.textContent('#group-detail')) || '').replace(/\s+/g, ' ');
  expect(/Touch-up: a \d+×\d+ patch/.test(detail), `details: ${detail.slice(0, 160)}`);
  return `${rows.length} group(s) with touch-ups · e.g. “${rows[0]}”`;
});

await s.test('A shared-pack colour can be moved into the selected group, and undo puts it back', async () => {
  // The fix for "one pattern, a different colour per layer" on art that is already painted:
  // take the colour out of the shared pack, where it colours every copy everywhere, and give
  // it to the group that should own it.
  const openWith = async (filter) => {
    await page.click('#btn-paint-inventory');
    await page.waitForFunction(() => document.getElementById('paint-inventory-dialog')?.open === true);
    await page.selectOption('#paint-inventory-filter', filter);
    await page.waitForTimeout(300);
  };
  const summary = async () => ((await page.textContent('#paint-inventory-summary')) || '').replace(/\s+/g, ' ');
  const counts = (t) => {
    const m = t.match(/(\d+) owned by a group[\s\S]*?(\d+) in the shared pack/);
    return m ? { group: Number(m[1]), pack: Number(m[2]) } : null;
  };

  await page.keyboard.press('Escape'); // no group selected
  await page.waitForTimeout(300);
  await openWith('pack');
  const disabled = await page.$eval('#paint-inventory-list [data-move-hash]', (b) => b.disabled);
  const why = await page.$eval('#paint-inventory-list [data-move-hash]', (b) => b.title);
  await closePaintInventory();

  await selectGroup(page, 'Reg BG');
  await page.waitForTimeout(300);
  await openWith('pack');
  const label = await page.$eval('#paint-inventory-list [data-move-hash]', (b) => b.textContent.trim());
  const before = counts(await summary());
  await page.click('#paint-inventory-list [data-move-hash]');
  await page.waitForTimeout(500);
  const moved = await status();
  const after = counts(await summary());
  await closePaintInventory();

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  await openWith('pack');
  const undone = counts(await summary());
  await closePaintInventory();

  expect(disabled, 'move was offered with no group selected');
  expect(/Select a BG group first/.test(why), `disabled reason: ${why}`);
  expect(/^→ Reg BG$/.test(label), `button read: ${label}`);
  expect(/Moved #[0-9A-F]+ into “Reg BG”/.test(moved), `move said: ${moved.slice(0, 90)}`);
  expect(after.pack === before.pack - 1, `pack ${before.pack} → ${after.pack}`);
  expect(after.group === before.group + 1, `group ${before.group} → ${after.group}`);
  expect(undone.pack === before.pack && undone.group === before.group, `undo left ${JSON.stringify(undone)}`);
  return `${label} · pack ${before.pack}→${after.pack}, group ${before.group}→${after.group}, undone`;
});

await s.test('A shared-pack colour can be cleared from the inventory, and undo restores it', async () => {
  // This is the only route to a colour the group panel cannot reach: Clear paint there works
  // through a group's hash list, so a pattern no group names is invisible to it.
  const rowCount = () => page.$$eval('#paint-inventory-list .paint-row', (rs) => rs.length);
  const openWith = async (filter) => {
    await page.click('#btn-paint-inventory');
    await page.waitForFunction(() => document.getElementById('paint-inventory-dialog')?.open === true);
    await page.selectOption('#paint-inventory-filter', filter);
    await page.waitForTimeout(300);
  };

  await openWith('pack');
  const before = await rowCount();
  await page.click('#paint-inventory-list .paint-row [data-clear-hash]');
  await page.waitForTimeout(500);
  const cleared = await status();
  const after = await rowCount();

  await closePaintInventory();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  await openWith('pack');
  const restored = await rowCount();

  // Orphans are a view over the same list; assert the filter never widens the set.
  await page.selectOption('#paint-inventory-filter', 'orphan');
  await page.waitForTimeout(300);
  const orphans = await rowCount();
  const allOrphan = await page.$$eval('#paint-inventory-list .paint-row', (rs) => rs.every((r) => r.classList.contains('is-orphan')));
  await page.selectOption('#paint-inventory-filter', 'all');
  await closePaintInventory();

  expect(before > 0, 'nothing in the shared pack to clear');
  expect(/Cleared #[0-9A-F]+ from the shared pack/.test(cleared), `clear said: ${cleared.slice(0, 90)}`);
  expect(after === before - 1, `rows ${before} → ${after}`);
  expect(restored === before, `undo left ${restored} of ${before}`);
  expect(orphans <= restored, `orphan filter showed ${orphans} of ${restored}`);
  expect(allOrphan, 'the orphan filter showed a colour a group can reach');
  return `cleared 1 of ${before} shared colour(s), undo restored it · ${orphans} unreachable`;
});

await s.test('Clear paint on a group asks first, and undo brings it back', async () => {
  await selectGroup(page, 'Reg BG');
  await clickVip(page, targets.bgTile.x + 4, targets.bgTile.y + 4);
  await page.click('#btn-reference-fill-selection'); // any paint will do
  await page.waitForTimeout(600);
  const painted = await canvasShot();

  answers.push(false); // decline the confirmation first
  await page.click('#btn-clear-group-paint');
  await page.waitForTimeout(500);
  expect(painted.equals(await canvasShot()), 'declining the confirmation still cleared the paint');

  answers.push(true);
  await page.click('#btn-clear-group-paint');
  await page.waitForTimeout(600);
  const statusText = await status();
  expect(/Cleared paint on .*\d+ group colour\(s\), \d+ overlay\(s\)/.test(statusText), `clear said: ${statusText.slice(0, 90)}`);
  expect(!painted.equals(await canvasShot()), 'the canvas did not change after clearing');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  expect(painted.equals(await canvasShot()), 'Ctrl+Z did not bring the cleared paint back');
  return statusText.slice(0, 70);
});

await s.test('Clicking a group selects its tiles and turns on a world the filter hid', async () => {
  await selectGroup(page, 'Reg BG');
  const crit = JSON.parse((await page.textContent('#group-detail pre')) || '{}');
  const own = (crit.windowIds || []).map(String);
  expect(own.length > 0, `group has no worlds: ${JSON.stringify(crit)}`);
  // Show only a world the group is not in, so its tiles are hidden. Empty worlds are disabled, so
  // turn that filter on where the world draws something, then come back to this frame (a selected
  // filter stays on, and clickable, on frames where its world is empty).
  const home = await page.$eval('#frame-select', (s) => s.value);
  const enabledNow = () => page.$$eval('#world-grid button[data-world]:not(:disabled)', (bs) => bs.map((b) => b.dataset.world));
  let other = (await enabledNow()).find((w) => !own.includes(w));
  if (other === undefined) {
    for (const f of await page.$$eval('#frame-select option', (os) => os.map((o) => o.value))) {
      await page.selectOption('#frame-select', f);
      await page.waitForTimeout(300);
      other = (await enabledNow()).find((w) => !own.includes(w));
      if (other !== undefined) break;
    }
  }
  expect(other !== undefined, 'no frame draws a world outside the group');
  await page.click('#world-grid button.all');
  await page.click(`#world-grid button[data-world="${other}"]`);
  await page.selectOption('#frame-select', home);
  await page.waitForTimeout(300);
  await selectGroup(page, 'Reg BG');
  const on = await page.$$eval('#world-grid button[data-world].on', (bs) => bs.map((b) => b.dataset.world));
  const statusText = (await page.textContent('#status')) || '';
  expect(on.includes(other), `the world that was already on got turned off: ${on}`);
  expect(own.some((w) => on.includes(w)), `none of the group's worlds (${own}) turned on: ${on}`);
  expect((await selectedCount(page)) > 0, 'no tiles selected after clicking the group');
  expect(/turned on world/.test(statusText), `status: ${statusText.slice(0, 120)}`);
  await page.click('#world-grid button.all');
  await page.waitForTimeout(200);
  return `worlds on: ${on.join(', ')} · ${await selectedCount(page)} tile(s) selected`;
});

await s.test('A group says which captured screens show it', async () => {
  await selectGroup(page, 'Reg BG');
  const ready = await page
    .waitForFunction(() => {
      const t = document.getElementById('group-detail')?.textContent || '';
      return /Tiles appear on/.test(t) && !/checking captured frames/.test(t);
    }, null, { timeout: 30000 })
    .then(() => true, () => false);
  const detail = (await page.textContent('#group-detail')) || '';
  const selected = (await page.$$eval('.group-row.group-selected', (rs) => rs.map((r) => r.textContent))).join(' | ');
  expect(ready, `details never showed "Tiles appear on": "${detail.slice(0, 160)}" · selected rows: "${selected}" · status: ${((await page.textContent('#status')) || '').slice(0, 120)}`);
  const line = (detail.match(/Tiles appear on:[^\n]*/) || [''])[0];
  expect(/Tiles appear on: (.+\(\d+ frames?\)|no captured frame)/.test(line), `details line: ${line.slice(0, 160) || detail.trim().slice(0, 160)}`);
  const pills = await page.$$eval('.screens-pill', (ps) => ps.map((p) => `${p.textContent}: ${p.title.slice(0, 60)}`));
  return `${line.trim().slice(0, 90)} · ${pills.length} pill(s)`;
});

await s.test('Paint shows on: limiting a group to other screens hides its paint on this one, and back', async () => {
  // src/screen-gate.js: screens are recognised by the memory captured with each frame.
  await page.click('#btn-deselect-group').catch(() => {});
  await page.waitForTimeout(300);
  const before = await canvasShot();
  await selectGroup(page, 'Reg BG');
  await page.selectOption('#group-screens-mode', 'except');
  await page.waitForTimeout(200);
  const boxes = await page.$$eval('[data-screen-pool]', (bs) => bs.map((b) => ({ id: b.dataset.screenPool, label: b.parentElement.textContent.trim() })));
  expect(boxes.length > 0, 'no screens offered (the annotated pack has memory pools)');
  const detailText = async () => ((await page.textContent('#group-detail')) || '').replace(/\s+/g, ' ');
  // Tick any screen first: the details then say which screen this frame looks like.
  await page.check(`[data-screen-pool="${boxes[0].id}"]`);
  await page.waitForTimeout(400);
  const screen = ((await detailText()).match(/it looks like ([^.,]+)/) || [])[1]?.trim();
  expect(screen, `the details do not say which screen this frame is: ${(await detailText()).slice(0, 200)}`);
  const mine = boxes.find((b) => b.label.startsWith(`${screen} `));
  expect(mine, `no screen box for "${screen}": ${boxes.map((b) => b.label).join(' | ')}`);
  if (mine.id !== boxes[0].id) {
    await page.check(`[data-screen-pool="${mine.id}"]`);
    await page.waitForTimeout(300);
    await page.uncheck(`[data-screen-pool="${boxes[0].id}"]`);
    await page.waitForTimeout(400);
  }
  const detail = await detailText();
  const here = (detail.match(/This frame:[^.]*\./) || [''])[0];
  expect(/This frame: hidden/.test(here), `details: ${here || detail.slice(0, 200)}`);
  const pill = await page.$$eval('.screen-limit-pill', (ps) => ps.map((p) => p.textContent));
  expect(pill.some((t) => t.startsWith('not ')), `row pill: ${pill}`);
  await page.click('#btn-deselect-group');
  await page.waitForTimeout(300);
  const hidden = await canvasShot();
  expect(!hidden.equals(before), 'the canvas did not change when the group was hidden on this screen');
  await selectGroup(page, 'Reg BG');
  await page.selectOption('#group-screens-mode', '');
  await page.waitForTimeout(300);
  expect((await page.$$eval('.screen-limit-pill', (ps) => ps.length)) === 0, 'the row pill stayed after Every screen');
  await page.click('#btn-deselect-group');
  await page.waitForTimeout(300);
  expect((await canvasShot()).equals(before), 'the paint did not come back with Every screen');
  return `${here} · pill "${pill[0]}" · ${boxes.length} screens offered`;
});

await s.test('Follow the game palette: a BG group option, on and off from its details', async () => {
  await page.click('#btn-deselect-group').catch(() => {});
  await selectGroup(page, 'Reg BG');
  expect(await page.isVisible('#toggle-follow-palette'), 'no Follow the game palette box on a BG group');
  await page.check('#toggle-follow-palette');
  await page.waitForTimeout(300);
  const on = (await page.textContent('#status')) || '';
  expect(/Follow the game's palette on for 1 group/.test(on), `status: ${on.slice(0, 120)}`);
  expect(await page.isChecked('#toggle-follow-palette'), 'the box did not stay ticked after the details redrew');
  await page.uncheck('#toggle-follow-palette');
  await page.waitForTimeout(300);
  expect(!(await page.isChecked('#toggle-follow-palette')), 'the box did not untick');
  return on.slice(0, 80);
});

let affinePackForStudio = '';
await s.test('Affine (zooming) frame: click selects the scaled tile, groups find it, the brush paints it scaled', async () => {
  if (!existsSync(PACK_AFFINE)) return `skipped — no pack with affine captures at ${PACK_AFFINE} (set VB_PACK_AFFINE)`;
  // A copy without its groups and paint: the pack is someone's real project, and their own group's
  // colours would (rightly) hide the test group's dab.
  const parts = artPackPartsFromParsed(await parseArtPack((await readFile(PACK_AFFINE)).buffer));
  const bare = `${OUT}/s2-affine-unpainted.vbpack`;
  await writeFile(bare, Buffer.from(await (await buildArtPack({ ...parts, groups: [], vbcolor: undefined, painterV2VipOverlays: undefined })).arrayBuffer()));
  await openPainter(page, bare);
  // The last capture whose frame draws an affine world (the Clash Tower zoom, in Mario Clash).
  const frames = await page.$$eval('#frame-select option', (os) => os.map((o) => ({ v: o.value, t: o.textContent || '' })));
  let found = null;
  for (const f of frames.reverse()) {
    await page.selectOption('#frame-select', f.v);
    await page.waitForTimeout(400);
    await page.selectOption('#layer-select', 'all');
    for (const [vx, vy] of [[40, 40], [60, 60], [100, 40], [300, 60], [192, 30]]) {
      await clickVip(page, vx, vy);
      if (/Layer Affine/.test((await page.textContent('#inspector')) || '')) {
        found = { frame: f.t, vx, vy };
        break;
      }
    }
    if (found) break;
  }
  if (!found) return 'skipped — no affine tile found on any frame of that pack';
  expect((await selectedCount(page)) === 1, `selected ${await selectedCount(page)} tiles on an affine frame`);

  await createGroup(page, 'Reg affine', 'bg');
  await page.click('#btn-zoom-to-group');
  await page.waitForTimeout(600);
  const zoomed = (await page.textContent('#status')) || '';
  expect(/^Zoomed to \d+ tile/.test(zoomed), `zoom to group: ${zoomed.slice(0, 90)}`);

  // One brush dab at the centre of the zoomed copy: that texel, scaled, in every copy.
  const green = () => page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('main-canvas'));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 50 && d[i + 1] > 2 * d[i] && d[i + 1] > 2 * d[i + 2]) n++;
    return n;
  });
  await page.click('#btn-paint-brush');
  await setPaintColor(page, '#00ff00');
  const box = await canvasBox(page);
  const before = await green();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  const after = await green();
  // Zoomed in on a layer the game itself scales, one texel is many screen pixels, not one.
  expect(after - before > 4, `green pixels ${before} → ${after} after one dab on a scaled tile`);
  affinePackForStudio = `${OUT}/s2-affine-group.vbpack`;
  await painterSave(page, affinePackForStudio);
  return `${found.frame.slice(0, 40)} · ${after - before} px green from one dab`;
});

await s.test('SpriteStudio base tiles: a scaled group opens on its tiles unscaled, and paint there lands', async () => {
  if (!affinePackForStudio) return 'skipped — the affine test above did not make a group';
  const studio = await context.newPage();
  const { errors: studioErrors } = instrument(studio);
  await studio.goto(`${BASE}/tools/sprite-studio.html`);
  await studio.setInputFiles('#file-input', affinePackForStudio);
  await studio.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await studio.click('.sprite-row:has-text("Reg affine")');
  await studio.waitForTimeout(600);
  const offered = await studio.isVisible('#toggle-show-scaled');
  const opensOnBase = !(await studio.isChecked('#toggle-show-scaled'));
  const poseActions = () => studio.evaluate(() => !!document.getElementById('btn-pose-rename') && !!document.getElementById('pose-move-select'));
  const actionsBefore = await poseActions();
  await studio.uncheck('#toggle-outline');
  const note = (await studio.textContent('#stage-note')) || '';
  const label = (await studio.textContent('.pose-card.active .label')) || '';
  // A base-tiles card stands in for its stored pose: Rename and Move still act on that pose.
  expect(!actionsBefore || (await poseActions()), `“${label}” lost Rename/Move on its base tiles`);
  const stagePixels = (want) => studio.evaluate((want) => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (want === 'blue' ? b > 200 && r < 60 && g < 60 : !(r === 255 && g === 0 && b === 170) && r + g + b > 60) n++;
    }
    return n;
  }, want);
  const tilePixels = await stagePixels('tile');
  // Fill the clicked colour blue, then count blue on the stage.
  await studio.click('#btn-tool-fill');
  await studio.$eval('#paint-color', (i) => { i.value = '#0000ff'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const blueBefore = await stagePixels('blue');
  const box = await studio.$eval('#stage-canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  // Click a pixel of the base tile: anything that is neither the pink backdrop nor the dark surround
  // (the Project tool test above painted this tile red, with a green dab).
  const hit = await studio.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (!(d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 170) && d[i] + d[i + 1] + d[i + 2] > 60) return { u: ((i / 4) % c.width) / c.width, v: Math.floor(i / 4 / c.width) / c.height };
    }
    return null;
  });
  if (hit) await studio.mouse.click(box.x + hit.u * box.w + 2, box.y + hit.v * box.h + 2);
  await studio.waitForTimeout(400);
  const blueAfter = await stagePixels('blue');
  // Overpaint on a scaled card is painted through the scaling — Show scaled on — and the same
  // stroke shows on the base tiles, where it lies in the layer's map.
  await studio.check('#toggle-show-scaled');
  await studio.waitForTimeout(400);
  await studio.click('#btn-paint-touchup');
  await studio.waitForTimeout(600);
  const overpaintMode = await studio.$eval('#btn-paint-touchup', (b) => b.classList.contains('active'));
  const scaledStayedOn = await studio.isChecked('#toggle-show-scaled');
  const ORANGE = [255, 128, 0];
  const countOrange = () => studio.evaluate((c) => {
    const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      if (r < 60) continue;
      if (Math.abs(d[i + 1] / r - c[1] / c[0]) < 0.06 && d[i + 2] / r < 0.08) n++;
    }
    return n;
  }, ORANGE);
  // Background off, so the pixel found below is one of the group's own tiles (base tiles show only those).
  await studio.uncheck('#toggle-background');
  await studio.waitForTimeout(300);
  await studio.click('#btn-tool-brush');
  await studio.$eval('#paint-color', (i) => { i.value = '#ff8000'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await studio.selectOption('#brush-size', '4');
  const lit = await studio.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = (c.width * Math.floor(c.height / 2)) * 4; i < d.length; i += 4) {
      if (!(d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 170) && d[i] + d[i + 1] + d[i + 2] > 60) return { u: ((i / 4) % c.width) / c.width, v: Math.floor(i / 4 / c.width) / c.height };
    }
    return null;
  });
  const sbox = await studio.$eval('#stage-canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  if (lit) await studio.mouse.click(sbox.x + lit.u * sbox.w + 2, sbox.y + lit.v * sbox.h + 2);
  await studio.waitForTimeout(400);
  const orangeScaled = await countOrange();
  const strokeNote = (await studio.textContent('#status')) || '';
  await studio.uncheck('#toggle-show-scaled');
  await studio.waitForTimeout(700);
  const orangeOnBase = await countOrange();
  expect(overpaintMode && scaledStayedOn, `Overpaint on a scaled card: mode ${overpaintMode}, Show scaled left on ${scaledStayedOn}`);
  expect(orangeScaled > 0 && /Painted the overpaint/.test(strokeNote), `the stroke did not land through the scaling (${orangeScaled} px) · ${strokeNote.slice(0, 100)}`);
  expect(orangeOnBase > 0, 'the overpaint stroke does not show on the base tiles');
  expect(offered && opensOnBase, `scaled group: Show scaled offered ${offered}, opens on base tiles ${opensOnBase}`);
  expect(/base tiles/.test(note) && /base tiles/.test(label), `stage note "${note}", card "${label}"`);
  expect(tilePixels > 0 && hit, 'the base tile drew nothing to click');
  expect(blueAfter > blueBefore, `Fill on a base tile painted nothing (${blueBefore} → ${blueAfter} blue px)`);
  expect(studioErrors.length === 0, studioErrors.slice(0, 3).join(' | '));
  await studio.close();
  return `${note.slice(0, 60)} · ${blueAfter - blueBefore} px blue · overpaint ${orangeScaled} px scaled, ${orangeOnBase} px on base tiles`;
});

await s.test('File ▸ Import from another pack shows what it would add, Cancel changes nothing, Import merges it unsaved', async () => {
  const { encodeGroupTileColors } = await import('../../src/group-tile-colors.js');
  const { PACK_PLAIN } = await import('./harness.mjs');
  // The other pack: this project plus one new group with a painted tile.
  const base = artPackPartsFromParsed(await parseArtPack((await readFile(PACK_PLAIN)).buffer));
  const NAME = 'E2E Imported Group';
  const extra = {
    id: 'group-e2e-import',
    name: NAME,
    authoringKind: 'bg',
    visible: true,
    criteria: { hashes: [0x1234abcd], windowIds: [], layers: [0] },
    tileColors: encodeGroupTileColors(new Map([[0x1234abcd, new Uint8Array(256).fill(200)]])),
  };
  const otherPath = `${OUT}/s2-import-other.vbpack`;
  const blob = await buildArtPack({ ...base, groups: [...(base.groups || []), extra] });
  await writeFile(otherPath, Buffer.from(await blob.arrayBuffer()));

  const imp = await context.newPage();
  const { errors: impErrors } = instrument(imp);
  await openPainter(imp, PACK_PLAIN);
  const groupsBefore = (base.groups || []).length;
  await imp.click('#file-menu > summary');
  expect(!(await imp.isDisabled('#file-menu-import-pack')), 'Import from another pack is disabled with a pack open');
  await imp.click('#file-menu > summary'); // close it again

  await imp.setInputFiles('#file-import-vbpack', otherPath);
  await imp.waitForSelector('#import-pack-dialog[open]', { timeout: 60000 });
  const summary = (await imp.textContent('#import-pack-summary')) || '';
  expect(summary.includes(NAME) && /1 painted tile/.test(summary), `summary: ${summary.slice(0, 160)}`);
  await imp.click('#import-pack-cancel');
  await imp.waitForTimeout(300);
  expect(/Import cancelled/.test((await imp.textContent('#status')) || ''), 'no cancel status');

  await imp.setInputFiles('#file-import-vbpack', otherPath);
  await imp.waitForSelector('#import-pack-dialog[open]', { timeout: 60000 });
  await imp.click('#import-pack-confirm');
  await imp.waitForFunction(() => /Imported from/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 90000 });
  const note = (await imp.textContent('#status')) || '';
  expect(/Not saved yet/.test(note) && note.includes(NAME), `status: ${note.slice(0, 160)}`);

  const savedPath = `${OUT}/s2-imported.vbpack`;
  await painterSave(imp, savedPath);
  const saved = await parseArtPack((await readFile(savedPath)).buffer);
  const g = (saved.groups || []).find((x) => x.name === NAME);
  expect(!!g && (saved.groups || []).length === groupsBefore + 1, `saved ${saved.groups?.length} group(s), expected ${groupsBefore + 1} with “${NAME}”`);
  expect(Object.keys(g?.tileColors || {}).length === 1, 'the imported group lost its paint');
  expect(impErrors.length === 0, impErrors.slice(0, 3).join(' | '));
  await imp.close();
  return `${groupsBefore} → ${saved.groups.length} groups · ${note.slice(0, 70)}`;
});

await s.test('File ▸ Clean up frames lists frames, keeps pose sources, and Archive takes frames out into a separate pack', async () => {
  const { PACK_PLAIN } = await import('./harness.mjs');
  const before = await parseArtPack((await readFile(PACK_PLAIN)).buffer);
  const framesBefore = (before.vipStatesFolder || []).length;
  if (framesBefore < 2) return `skipped — the pack has ${framesBefore} frame(s)`;
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await openPainter(pg, PACK_PLAIN);
  await pg.click('#project-menu > summary');
  expect(!(await pg.isDisabled('#file-menu-cleanup-frames')), 'Clean up frames is disabled with a pack open');
  await pg.click('#file-menu-cleanup-frames');
  await pg.waitForSelector('#frame-cleanup-dialog[open]', { timeout: 60000 });
  const rows = await pg.$$eval('.frame-cleanup-row', (rs) => rs.map((r) => ({ id: r.dataset.frameId, kept: r.classList.contains('kept') })));
  expect(rows.length === framesBefore, `the window lists ${rows.length} of ${framesBefore} frames`);
  // Pose source frames cannot be picked.
  const keptBoxes = await pg.$$eval('.frame-cleanup-row.kept input', (bs) => bs.every((b) => b.disabled));
  expect(keptBoxes, 'a kept frame can be selected');
  const free = rows.filter((r) => !r.kept);
  if (!free.length) {
    await pg.click('#frame-cleanup-cancel');
    await pg.close();
    return `skipped — all ${rows.length} frames are pose sources`;
  }
  // Cancel changes nothing.
  await pg.click('#frame-cleanup-cancel');
  await pg.waitForTimeout(300);
  expect(/no frames were removed/.test((await pg.textContent('#status')) || ''), 'no cancel status');

  await pg.click('#project-menu > summary');
  await pg.click('#file-menu-cleanup-frames');
  await pg.waitForSelector('#frame-cleanup-dialog[open]', { timeout: 60000 });
  await pg.click('#frame-cleanup-none');
  const pick = free[0].id;
  await pg.check(`.frame-cleanup-row[data-frame-id="${pick}"] input`);
  const archivePath = `${OUT}/s2-frames-archive.vbpack`;
  await captureDownload(pg, () => pg.click('#frame-cleanup-archive'), archivePath);
  await pg.waitForFunction(() => /Took 1 frame/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 90000 });
  const note = (await pg.textContent('#status')) || '';
  expect(/archived to/.test(note) && /Not saved yet/.test(note), `status: ${note.slice(0, 160)}`);

  const savedPath = `${OUT}/s2-frames-cleaned.vbpack`;
  await painterSave(pg, savedPath);
  const saved = await parseArtPack((await readFile(savedPath)).buffer);
  const archive = await parseArtPack((await readFile(archivePath)).buffer);
  const stem = (n) => String(n).replace(/\.json$/i, '').toLowerCase();
  expect((saved.vipStatesFolder || []).length === framesBefore - 1, `saved ${(saved.vipStatesFolder || []).length} frames, expected ${framesBefore - 1}`);
  expect(!(saved.vipStatesFolder || []).some((f) => stem(f.name) === pick.toLowerCase()), 'the archived frame is still in the project');
  expect(!(saved.manifest?.frameRegistry || []).some((e) => e.frameId === pick), 'the archived frame is still in the frame registry');
  expect((archive.vipStatesFolder || []).map((f) => stem(f.name)).join() === pick.toLowerCase(), `archive holds ${(archive.vipStatesFolder || []).map((f) => f.name)}`);
  const cov = saved.manifest?.archivedCoverage;
  expect(cov && ['bg', 'obj', 'affine'].some((k) => (cov[k] || []).length > 0), 'archivedCoverage is missing or empty');
  expect((saved.groups || []).length === (before.groups || []).length, 'groups changed');
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${framesBefore} → ${saved.vipStatesFolder.length} frames · ${rows.filter((r) => r.kept).length} kept as pose sources · archive has 1`;
});

await s.test('Frame list Show filter narrows the list to frames with uncoloured tiles or pixels; < > follow it', async () => {
  const { PACK_PLAIN } = await import('./harness.mjs');
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await pg.goto(`${BASE}/tools/project.html`);
  await pg.evaluate(() => localStorage.removeItem('painter.frameFilter'));
  await openPainter(pg, PACK_PLAIN);
  const listed = () => pg.$$eval('#frame-select option', (os) => os.filter((o) => !o.hidden).map((o) => ({ v: o.value, t: o.textContent || '' })));
  const all = await listed();
  await pg.selectOption('#frame-filter', 'pixels');
  await pg.waitForTimeout(300);
  const px = await listed();
  await pg.selectOption('#frame-filter', 'tiles');
  await pg.waitForTimeout(300);
  const tiles = await listed();
  // Every shown frame but the current one says what is left; tiles ⊆ pixels.
  const cur = await pg.inputValue('#frame-select');
  const noted = (rows) => rows.filter((r) => r.v !== cur).every((r) => /uncoloured/.test(r.t));
  expect(px.length <= all.length && tiles.length <= px.length + 1, `all ${all.length} · pixels ${px.length} · tiles ${tiles.length}`);
  expect(noted(px) && noted(tiles), 'a filtered frame does not show its uncoloured counts');
  const pos = (await pg.textContent('#frame-position')) || '';
  if (tiles.length < all.length) expect(/\(of \d+\)/.test(pos), `position does not say it is filtered: "${pos}"`);
  // Next goes to the next shown frame, never a hidden one.
  if (tiles.length > 1 && !(await pg.isDisabled('#btn-frame-next'))) {
    await pg.click('#btn-frame-next');
    await pg.waitForTimeout(600);
    const now = await pg.inputValue('#frame-select');
    expect(tiles.some((r) => r.v === now), `> went to hidden frame ${now}`);
  }
  // Remembered, and All brings everything back without the notes.
  await pg.reload();
  await pg.waitForSelector('#frame-filter');
  expect((await pg.inputValue('#frame-filter')) === 'tiles', 'the filter was not remembered');
  await pg.selectOption('#frame-filter', 'all');
  await openPainter(pg, PACK_PLAIN);
  const back = await listed();
  expect(back.length === all.length && back.every((r) => !/uncoloured|fully coloured/.test(r.t)), 'All does not show every frame plainly');
  // The Clean up window shows the same counts and its own Show filter.
  await pg.click('#project-menu > summary');
  await pg.click('#file-menu-cleanup-frames');
  await pg.waitForSelector('#frame-cleanup-dialog[open]', { timeout: 60000 });
  const why = await pg.$$eval('.frame-cleanup-row .why', (ws) => ws.map((w) => w.textContent || ''));
  expect(why.every((w) => /uncoloured|fully coloured/.test(w)), 'Clean up rows do not show uncoloured counts');
  await pg.selectOption('#frame-cleanup-filter', 'done');
  const shownDone = await pg.$$eval('.frame-cleanup-row', (rs) => rs.filter((r) => !r.hidden).map((r) => r.querySelector('.why')?.textContent || ''));
  expect(shownDone.every((w) => /fully coloured/.test(w)), 'Fully coloured shows a frame with uncoloured pixels');
  await pg.click('#frame-cleanup-cancel');
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${all.length} frames · ${px.length} with uncoloured pixels · ${tiles.length} with uncoloured tiles · ${shownDone.length} fully coloured`;
});

await s.test('Highlight (with a Show filter on) marks what is uncoloured on the frame, and H toggles it', async () => {
  const { PACK_PLAIN } = await import('./harness.mjs');
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await pg.goto(`${BASE}/tools/project.html`);
  await pg.evaluate(() => { localStorage.removeItem('painter.frameFilter'); localStorage.removeItem('painter.frameHighlight'); });
  await openPainter(pg, PACK_PLAIN);
  expect(await pg.$eval('#frame-highlight-wrap', (w) => w.hidden), 'Highlight shows with the filter on All');
  await pg.selectOption('#frame-filter', 'pixels');
  await pg.waitForTimeout(400);
  expect(!(await pg.$eval('#frame-highlight-wrap', (w) => w.hidden)), 'Highlight stays hidden with a filter on');
  const cyan = () => pg.evaluate(() => {
    const d = document.getElementById('main-canvas').getContext('2d').getImageData(0, 0, 384, 224).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 0 && d[i + 1] > 120 && Math.abs(d[i + 1] - d[i + 2]) < 3) n++;
    return n;
  });
  const before = await cyan();
  await pg.check('#frame-highlight');
  await pg.waitForTimeout(400);
  const note = (await pg.textContent('#frame-highlight-note')) || '';
  const m = note.match(/^(\d+) uncoloured px here/);
  expect(m || /nothing uncoloured here/.test(note), `note: "${note}"`);
  const marked = await cyan();
  if (m) expect(marked - before >= Number(m[1]) * 0.9, `${marked - before} cyan px for "${note}"`);
  await pg.selectOption('#frame-filter', 'tiles');
  await pg.waitForTimeout(400);
  const tilesNote = (await pg.textContent('#frame-highlight-note')) || '';
  expect(/unpainted tiles? here|no unpainted tiles here/.test(tilesNote), `tiles note: "${tilesNote}"`);
  await pg.evaluate(() => document.activeElement?.blur());
  await pg.keyboard.press('h');
  await pg.waitForTimeout(300);
  expect(!(await pg.isChecked('#frame-highlight')) && !(await pg.textContent('#frame-highlight-note')), 'H did not turn Highlight off');
  await pg.selectOption('#frame-filter', 'all');
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${note} · ${tilesNote}`;
});

await s.test('Shared tiles: the losing group is marked, Check project finds it, Show me opens it, and Let … win changes the order', async () => {
  const { encodeGroupTileColors } = await import('../../src/group-tile-colors.js');
  const { deserializeVIPState } = await import('../../src/vip-dump.js');
  const { getTileBytes, hashTile, isBlankTile } = await import('../../src/vip-state.js');
  const { PACK_PLAIN } = await import('./harness.mjs');
  const base = artPackPartsFromParsed(await parseArtPack((await readFile(PACK_PLAIN)).buffer));
  const t = targets.bgTile;
  const file = (base.vipStatesFolder || []).find((f) => f.name.includes(t.frame));
  if (!file) return `skipped — frame ${t.frame} is not in the plain pack`;
  const st = deserializeVIPState(JSON.parse(file.json));
  const hashOf = (d) => {
    const b = getTileBytes(st.patternTable, d.tileIndex);
    return isBlankTile(b) ? null : hashTile(b) >>> 0;
  };
  const bg = st.drawList.filter((d) => (d.eye ?? 0) === 0 && (d.layer ?? 0) === 0 && d.world === t.world);
  const shared = hashOf(bg.find((d) => d.x === t.x && d.y === t.y));
  const own = bg.map(hashOf).find((h) => h !== null && h !== shared);
  expect(shared !== null && own != null, 'two distinct lit tiles on the target world');
  // The winner has only the shared tile; the loser has it and one of its own, so it is on screen
  // without the winner and its shared tile takes the winner's colour.
  const paint = (rgb) => new Uint8Array(256).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4]));
  const mk = (id, name, hashes, rgb) => ({
    id, name, authoringKind: 'bg', visible: true,
    criteria: { hashes, windowIds: [t.world], layers: [0] },
    tileColors: encodeGroupTileColors(new Map(hashes.map((h) => [h, paint(rgb)]))),
  });
  const packPath = `${OUT}/s2-shared-tiles.vbpack`;
  const groupsBefore = [mk('e2e-winner', 'E2E Winner', [shared], [230, 20, 20]), mk('e2e-loser', 'E2E Loser', [shared, own], [20, 20, 230]), ...(base.groups || [])];
  await writeFile(packPath, Buffer.from(await (await buildArtPack({ ...base, groups: groupsBefore })).arrayBuffer()));

  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await openPainter(pg, packPath);
  await selectFrame(pg, t.frame);
  const loserRow = '.group-row[data-group-id="e2e-loser"]';
  const pill = ((await pg.textContent(`${loserRow} .behind-pill`).catch(() => '')) || '').trim();
  const winnerPill = await pg.$('.group-row[data-group-id="e2e-winner"] .behind-pill');
  await selectGroup(pg, 'E2E Loser');
  const detail = ((await pg.textContent('#group-shared-tiles').catch(() => '')) || '').replace(/\s+/g, ' ');
  // The count next to File appears once the check has been through every frame.
  await pg.waitForSelector('#btn-health-count:not([hidden])', { timeout: 60000 });
  const count = (await pg.textContent('#btn-health-count')) || '';
  await pg.click('#btn-health-count');
  await pg.waitForSelector('#health-dialog[open]');
  const row = pg.locator('.health-issue[data-kind="order"]').filter({ hasText: 'E2E Loser: on' }).first();
  const rowText = ((await row.textContent()) || '').replace(/\s+/g, ' ');
  await row.locator('.health-show').click();
  await pg.waitForTimeout(800);
  const dialogClosed = !(await pg.$('#health-dialog[open]'));
  const answer = ((await pg.textContent('#inspector-answer')) || '').replace(/\s+/g, ' ');
  const reorderLabel = ((await pg.textContent('#btn-inspector-reorder').catch(() => '')) || '').trim();
  await pg.click('#btn-inspector-reorder');
  await pg.waitForTimeout(600);
  const statusAfter = (await pg.textContent('#status')) || '';
  const answerAfter = ((await pg.textContent('#inspector-answer')) || '').replace(/\s+/g, ' ');
  const pillAfter = await pg.$(`${loserRow} .behind-pill`);
  await pg.click('#project-menu > summary');
  await pg.click('#file-menu-check-project');
  await pg.waitForFunction(() => /across/.test(document.querySelector('#health-list .health-status')?.textContent || '') && !/again/.test(document.querySelector('#health-list .health-status')?.textContent || ''), null, { timeout: 60000 });
  const stillListed = await pg.locator('.health-issue').filter({ hasText: 'E2E Loser: on' }).count();
  await pg.click('#health-close');
  expect(pill === 'behind E2E Winner' && !winnerPill, `loser pill "${pill}", winner pill ${!!winnerPill}`);
  expect(/Behind E2E Winner on 1 tile/.test(detail) && /Put this group first/.test(detail), `details: ${detail.slice(0, 160)}`);
  expect(/\d+ to check/.test(count), `count: ${count}`);
  expect(/takes E2E Winner’s colours/.test(rowText) && /Let E2E Loser win/.test(rowText), `row: ${rowText.slice(0, 200)}`);
  expect(dialogClosed && /Coloured by E2E Winner’s paint/.test(answer) && reorderLabel === 'Let E2E Loser win', `after Show me: closed ${dialogClosed}, answer ${answer.slice(0, 120)}, button "${reorderLabel}"`);
  expect(/“E2E Loser” now comes before “E2E Winner”/.test(statusAfter) && /Coloured by E2E Loser’s paint/.test(answerAfter) && !pillAfter, `after reorder: ${statusAfter.slice(0, 100)} · ${answerAfter.slice(0, 100)} · pill ${!!pillAfter}`);
  expect(stillListed === 0, `the order issue is still listed ${stillListed} time(s) after the fix`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${count} · ${rowText.slice(0, 80)}…`;
});

await s.test('Paint shows when: “Only while it’s on screen” learns a game state, the condition gates the paint (is / is not), saves, and comes off; a game state can be typed in', async () => {
  const { encodeGroupTileColors } = await import('../../src/group-tile-colors.js');
  const { deserializeVIPState } = await import('../../src/vip-dump.js');
  const { getTileBytes, hashTile, isBlankTile } = await import('../../src/vip-state.js');
  const { matchedScreens } = await import('../../src/screen-gate.js');
  const { seedGameStatePoolsFromMemoryAnalysis } = await import('../../src/seed-game-state-pools-from-memory-analysis.js');
  const { PACK_ANNOTATED } = await import('./harness.mjs');
  const base = artPackPartsFromParsed(await parseArtPack((await readFile(PACK_ANNOTATED)).buffer));
  const pools = base.gameStatePools?.length ? base.gameStatePools : seedGameStatePoolsFromMemoryAnalysis(base.manifest?.memoryAnalysis);
  const stem = (n) => n.split('/').pop().replace(/\.(json|wram\.bin)$/, '');
  const dumps = new Map((base.ramdumpsFolder || []).map((f) => [stem(f.name), f]));
  // A tile some frames of one screen draw and others of that screen do not.
  const frames = (base.vipStatesFolder || []).map((f) => {
    const st = deserializeVIPState(JSON.parse(f.json));
    const dump = dumps.get(stem(f.name));
    const hashes = new Set(st.drawList.filter((d) => (d.eye ?? 0) === 0).map((d) => {
      const b = getTileBytes(st.patternTable, d.tileIndex);
      return isBlankTile(b) ? null : hashTile(b) >>> 0;
    }).filter((x) => x !== null));
    return { stem: stem(f.name), dump, hashes, matched: dump ? matchedScreens(pools, new Uint8Array(dump.buffer)) : null };
  });
  let pick = null;
  for (const pool of pools) {
    const on = frames.filter((f) => f.matched?.has(pool.id));
    if (on.length < 3) continue;
    const counts = new Map();
    for (const f of on) for (const x of f.hashes) counts.set(x, (counts.get(x) || 0) + 1);
    const hash = [...counts].find(([, n]) => n >= 2 && n < on.length)?.[0];
    if (hash != null) {
      pick = { pool, hash, inside: on.filter((f) => f.hashes.has(hash)), outside: on.filter((f) => !f.hashes.has(hash)) };
      break;
    }
  }
  if (!pick) return 'skipped — no screen with a tile only some of its frames draw';
  // The frames showing it get a memory byte of their own, as a "who is playing" byte would.
  const MARK = 0xfff0;
  const ramdumpsFolder = (base.ramdumpsFolder || []).map((f) => {
    const w = new Uint8Array(f.buffer).slice();
    w[MARK] = pick.inside.some((x) => x.stem === stem(f.name)) ? 0x5a : 0x00;
    return { ...f, buffer: w.buffer };
  });
  const paint = new Uint8Array(256).map((_, i) => (i % 4 === 3 ? 255 : [40, 200, 90][i % 4]));
  const sub = { id: 'e2e-sub', name: 'E2E Sub', authoringKind: 'bg', visible: true, criteria: { hashes: [pick.hash] }, tileColors: encodeGroupTileColors(new Map([[pick.hash, paint]])) };
  const packPath = `${OUT}/s2-game-state.vbpack`;
  await writeFile(packPath, Buffer.from(await (await buildArtPack({ ...base, ramdumpsFolder, gameStatePools: pools, groups: [...(base.groups || []), sub] })).arrayBuffer()));

  const pg = await context.newPage();
  const { errors: pgErrors, answers: pgAnswers } = instrument(pg);
  await openPainter(pg, packPath);
  await selectFrame(pg, pick.inside[0].stem);
  await selectGroup(pg, 'E2E Sub');
  await pg.click('#btn-learn-on-screen');
  await pg.waitForTimeout(500);
  const text = async (sel) => (((await pg.textContent(sel).catch(() => '')) || '').replace(/\s+/g, ' ')).trim();
  const note = await text('#group-learn-note');
  const condRow = await text('.group-condition');
  const pill = await text('.group-row[data-group-id="e2e-sub"] .condition-pill');
  const hereShown = /^This frame: shown/.test(await text('#group-paint-effect'));
  await selectFrame(pg, pick.outside[0].stem);
  await selectGroup(pg, 'E2E Sub');
  const thereHidden = /^This frame: hidden — E2E Sub on screen does not hold/.test(await text('#group-paint-effect'));
  // "is not" turns it round.
  await pg.selectOption('[data-cond-is="e2e-sub-on-screen"]', 'not');
  await pg.waitForTimeout(400);
  const flipped = /^This frame: shown/.test(await text('#group-paint-effect'));
  const pillNot = await text('.group-row[data-group-id="e2e-sub"] .condition-pill');
  const saved = `${OUT}/s2-game-state-saved.vbpack`;
  await painterSave(pg, saved);
  const back = await parseArtPack((await readFile(saved)).buffer);
  const savedState = (back.gameStates || []).find((x) => x.id === 'e2e-sub-on-screen');
  const savedGroup = (back.groups || []).find((g) => g.id === 'e2e-sub');
  // × takes the condition off the group; the game state stays in the project.
  await pg.click('[data-cond-remove="e2e-sub-on-screen"]');
  await pg.waitForTimeout(400);
  const pillAfter = await pg.$('.group-row[data-group-id="e2e-sub"] .condition-pill');
  const offered = await pg.$$eval('#group-add-condition option', (os) => os.map((o) => o.value));
  // Typed in by hand: a name, then offset = value.
  pgAnswers.push('Typed state', '0xFFF0 = 90');
  await pg.selectOption('#group-add-condition', '__new__');
  await pg.waitForTimeout(500);
  const typedRow = await text('.group-condition');
  // A group every frame of its screen shows: nothing to tell apart, said plainly.
  const other = (base.groups || [])[0];
  let failNote = 'no other group';
  if (other) {
    await selectGroup(pg, other.name || other.id);
    await pg.click('#btn-learn-on-screen');
    await pg.waitForTimeout(400);
    failNote = await text('#group-learn-note');
  }
  expect(/^Learned “E2E Sub on screen”: memory byte 0x[0-9A-F]+ is \d+ on all \d+ .+ frames showing it/.test(note), `note: ${note.slice(0, 200)}`);
  expect(/^E2E Sub on screen/.test(condRow) && /this frame: holds/.test(condRow), `condition row: ${condRow.slice(0, 160)}`);
  expect(pill === 'while E2E Sub on screen' && pillNot === 'not while E2E Sub on screen', `pills: "${pill}" then "${pillNot}"`);
  expect(hereShown && thereHidden && flipped, `shown where it holds ${hereShown}, hidden where not ${thereHidden}, shown there once "is not" ${flipped}`);
  expect(savedState?.conditions?.length > 0 && JSON.stringify(savedGroup?.conditions) === JSON.stringify([{ state: 'e2e-sub-on-screen', is: false }]), `saved: ${JSON.stringify(savedState)} · ${JSON.stringify(savedGroup?.conditions)}`);
  expect(!pillAfter && offered.includes('e2e-sub-on-screen'), `pill after × ${!!pillAfter}; still offered ${offered.join(',')}`);
  expect(/^Typed state/.test(typedRow) && /this frame: does not hold/.test(typedRow), `typed row: ${typedRow.slice(0, 160)}`);
  expect(!other || /^Could not learn it: /.test(failNote), `failure note: ${failNote.slice(0, 160)}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${note.slice(0, 100)}… · fail: ${failNote.slice(0, 70)}…`;
});

await s.test('File ▸ Game states: a question answered from frames added to its sides; a near miss points at a wrong one; Save as game states; groups can use them; it all saves', async () => {
  const { matchedScreens } = await import('../../src/screen-gate.js');
  const { seedGameStatePoolsFromMemoryAnalysis } = await import('../../src/seed-game-state-pools-from-memory-analysis.js');
  const { PACK_ANNOTATED } = await import('./harness.mjs');
  const base = artPackPartsFromParsed(await parseArtPack((await readFile(PACK_ANNOTATED)).buffer));
  const pools = base.gameStatePools?.length ? base.gameStatePools : seedGameStatePoolsFromMemoryAnalysis(base.manifest?.memoryAnalysis);
  const stem = (n) => n.split('/').pop().replace(/\.(json|wram\.bin)$/, '');
  const byStem = (base.ramdumpsFolder || []).map((f) => ({ stem: stem(f.name), matched: matchedScreens(pools, new Uint8Array(f.buffer)) }));
  const menu = byStem.filter((f) => f.matched?.has('pool-gamemenu')).map((f) => f.stem);
  const other = byStem.filter((f) => f.matched && !f.matched.has('pool-gamemenu') && f.matched.size).map((f) => f.stem);
  if (menu.length < 3 || other.length < 2) return `skipped — ${menu.length} menu frames, ${other.length} others`;

  const pg = await context.newPage();
  const { errors: pgErrors, answers: pgAnswers } = instrument(pg);
  await openPainter(pg, PACK_ANNOTATED);
  const openGs = async () => {
    await pg.click('#project-menu > summary');
    await pg.click('#file-menu-game-states');
    await pg.waitForSelector('#game-states-dialog[open]');
  };
  await openGs();
  pgAnswers.push('Is it the menu?', 'Menu, Not menu');
  await pg.click('#game-states-body button:has-text("New question…")');
  await pg.waitForSelector('[data-question-id="q-is-it-the-menu"]');
  const add = async (frame, side) => {
    await pg.click('#game-states-close');
    await selectFrame(pg, frame);
    await openGs();
    await pg.click(`[data-question-id="q-is-it-the-menu"] tr[data-side-id="${side}"] button`);
    await pg.waitForTimeout(250);
  };
  await add(menu[0], 'menu');
  await add(menu[1], 'menu');
  await add(other[0], 'not-menu');
  await add(other[1], 'not-menu');
  await add(menu[2], 'not-menu'); // the wrong side
  const card = () => pg.locator('[data-question-id="q-is-it-the-menu"]');
  const nearRows = await card().locator('.gs-near-row').count();
  const wrongPointedAt = await card().locator('.gs-near-row').first().getAttribute('data-recording-id');
  await card().locator('.gs-near > summary').click(); // folded away to start with
  await card().locator('.gs-near-row').first().locator('button:has-text("Move to Menu")').click();
  await pg.waitForTimeout(300);
  const fitsAfter = await card().locator('.gs-candidate').count();
  const sides = ((await card().locator('.gs-sides').textContent()) || '').replace(/\s+/g, ' ');
  await card().locator('.gs-save').click();
  await pg.waitForTimeout(300);
  const states = await pg.$$eval('.gs-state strong', (es) => es.map((e) => e.textContent));
  await pg.click('#game-states-close');
  // A group can now use them.
  const group = (base.groups || [])[0];
  let offered = [];
  if (group) {
    await selectGroup(pg, group.name || group.id);
    offered = await pg.$$eval('#group-add-condition option', (os) => os.map((o) => o.value));
  }
  const saved = `${OUT}/s2-questions-saved.vbpack`;
  await painterSave(pg, saved);
  const back = await parseArtPack((await readFile(saved)).buffer);
  const qs = back.manifest?.memoryQuestions || [];
  const recs = back.manifest?.memoryRecordings || [];
  const wrong = recs.find((r) => r.id === wrongPointedAt);
  expect(nearRows >= 1 && wrong?.frameId === menu[2], `near misses ${nearRows}; it points at ${wrong?.frameId}, the wrong one was ${menu[2]}`);
  expect(fitsAfter >= 1, `no byte fits after moving the wrong frame: ${sides}`);
  expect(/Menu\s*3 recordings · 3 samples/.test(sides) && /Not menu\s*2 recordings/.test(sides), `sides: ${sides}`);
  expect(states.join(',') === 'Menu,Not menu', `game states: ${states.join(', ')}`);
  expect(!group || (offered.includes('menu') && offered.includes('not-menu')), `offered: ${offered.join(', ')}`);
  expect(qs.length === 1 && qs[0].status === 'saved' && recs.length === 5 && recs.every((r) => r.source === 'frame' && r.frameId), `saved questions ${JSON.stringify(qs).slice(0, 120)} · ${recs.length} recordings`);
  expect((back.gameStates || []).filter((x) => x.question === 'q-is-it-the-menu').length === 2, `saved game states: ${JSON.stringify(back.gameStates).slice(0, 200)}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${fitsAfter} byte(s) fit · ${sides.slice(0, 120)}`;
});

await s.test('File ▸ Project storage lists what the pack holds, with sizes, and its Clean up frames opens that window', async () => {
  const { PACK_ANNOTATED } = await import('./harness.mjs');
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await openPainter(pg, PACK_ANNOTATED);
  await pg.click('#project-menu > summary');
  await pg.click('#file-menu-storage');
  await pg.waitForSelector('#storage-dialog[open]');
  const total = ((await pg.textContent('#storage-body .storage-total')) || '').trim();
  const kinds = await pg.$$eval('#storage-body tr[data-kind]', (rs) => rs.map((r) => r.dataset.kind));
  const frames = ((await pg.textContent('#storage-body tr[data-kind="frames"]')) || '').replace(/\s+/g, ' ');
  await pg.click('#storage-body tr[data-kind="frames"] button:has-text("Clean up frames…")');
  await pg.waitForSelector('#frame-cleanup-dialog[open]', { timeout: 60000 });
  const cleanupOpen = !!(await pg.$('#frame-cleanup-dialog[open]'));
  expect(/^The \.vbpack is [\d.]+ (MB|KB) on disk; [\d.]+ (MB|KB) before compression\.$/.test(total), `total: ${total}`);
  expect(['frames', 'screenshots', 'ramdumps', 'groups'].every((k) => kinds.includes(k)), `kinds: ${kinds.join(', ')}`);
  expect(/Frames: picture data\s*\d+\s*[\d.]+ (MB|KB)/.test(frames) && cleanupOpen, `frames row: ${frames.slice(0, 120)} · clean up opened ${cleanupOpen}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${total} · ${kinds.join(', ')}`;
});

await s.test('Group search: typing narrows the list (opening its pools), Enter selects the first match, Esc brings every group back, Ctrl+K jumps to it', async () => {
  const visible = () => page.$$eval('#groups-tree .group-row', (rs) => [...new Set(rs.filter((r) => r.offsetParent !== null).map((r) => r.lastElementChild?.textContent))]);
  await page.click('#btn-deselect-group').catch(() => {});
  const all = await page.$$eval('#groups-tree .group-row', (rs) => new Set(rs.map((r) => r.dataset.groupId)).size);
  // Search for the start of a group that is there (earlier tests change which ones are).
  const target = await page.$eval('#groups-tree .group-row', (r) => r.lastElementChild?.textContent || '');
  const query = target.slice(0, 4).toLowerCase();
  await page.click('#main-canvas', { position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Control+k');
  const focused = await page.evaluate(() => document.activeElement?.id);
  await page.keyboard.type(query);
  await page.waitForTimeout(200);
  const shown = await visible();
  const count = ((await page.textContent('#group-search-count')) || '').trim();
  const debug = await page.evaluate(() => ({
    value: /** @type {HTMLInputElement} */ (document.getElementById('group-search')).value,
    rows: [...document.querySelectorAll('#groups-tree .group-row')].map((r) => `${r.lastElementChild?.textContent}:${r.hidden ? 'h' : 'v'}${r.offsetParent ? '' : '/off'}`).join(','),
  }));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const selected = await page.$eval('#group-display-name-input', (i) => i.value).catch(() => '');
  await page.fill('#group-search', 'zzzz nothing');
  await page.waitForTimeout(200);
  const none = ((await page.textContent('#groups-tree .group-search-empty').catch(() => '')) || '').trim();
  await page.focus('#group-search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const back = await page.$$eval('#groups-tree .group-row', (rs) => new Set(rs.filter((r) => !r.hidden).map((r) => r.dataset.groupId)).size);
  const countAfter = ((await page.textContent('#group-search-count')) || '').trim();
  expect(focused === 'group-search', `Ctrl+K focused ${focused}`);
  expect(shown.includes(target) && shown.every((n) => n.toLowerCase().includes(query)), `searched "${query}": shown ${shown.join(', ')} · box "${debug.value}" · rows ${debug.rows.slice(0, 300)}`);
  expect(new RegExp(`^${shown.length} of ${all}$`).test(count), `count "${count}" for ${shown.length} of ${all}`);
  expect(selected.toLowerCase().includes(query), `Enter selected "${selected}"`);
  expect(none === 'No groups match “zzzz nothing”.', `nothing matches: "${none}"`);
  expect(back === all && countAfter === '', `after Esc ${back} of ${all} groups, count "${countAfter}"`);
  await page.click('#btn-deselect-group').catch(() => {});
  return `${count} · selected ${selected}`;
});

await s.test('Frames have short numbers; Frame ▸ Copy reference and Go to frame (by number, or an id with a typo)', async () => {
  const pg = await context.newPage();
  const { errors: pgErrors, answers: pgAnswers, dialogs: pgDialogs } = instrument(pg);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  const { PACK_ANNOTATED } = await import('./harness.mjs');
  await openPainter(pg, PACK_ANNOTATED);
  const labels = await pg.$$eval('#frame-select option', (os) => os.map((o) => o.textContent || ''));
  const saved = labels.filter((t) => !/^Current\b/.test(t));
  const numbered = saved.filter((t) => /^#\d+ · /.test(t));
  // Copy reference on the third saved frame.
  const third = saved[2];
  const num = (third.match(/^#(\d+)/) || [])[1];
  const id = (third.match(/(f-[a-z0-9]+-[a-z0-9]+)/) || [])[1];
  await selectFrame(pg, id);
  await pg.click('#frame-menu > summary');
  await pg.click('#frame-menu-copy-ref');
  await pg.waitForTimeout(300);
  const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  const copied = clip || (pgDialogs.at(-1)?.message === 'Copy this reference:' ? 'prompted' : '');
  // Go to frame by number, from another frame.
  await selectFrame(pg, (saved[0].match(/(f-[a-z0-9]+-[a-z0-9]+)/) || [])[1]);
  pgAnswers.push(`#${num}`);
  await pg.click('#frame-menu > summary');
  await pg.click('#frame-menu-go-to');
  await pg.waitForTimeout(800);
  const byNumber = await pg.$eval('#frame-select', (sel) => sel.options[sel.selectedIndex]?.textContent || '');
  // An id with one letter dropped.
  await selectFrame(pg, (saved[0].match(/(f-[a-z0-9]+-[a-z0-9]+)/) || [])[1]);
  pgAnswers.push(id.slice(0, 4) + id.slice(5));
  await pg.click('#frame-menu > summary');
  await pg.click('#frame-menu-go-to');
  await pg.waitForTimeout(800);
  const byTypo = await pg.$eval('#frame-select', (sel) => sel.options[sel.selectedIndex]?.textContent || '');
  const typoStatus = (await pg.textContent('#status')) || '';
  expect(saved.length > 2 && numbered.length === saved.length, `${numbered.length} of ${saved.length} saved frames numbered: ${saved.slice(0, 3).join(' | ')}`);
  expect(copied === 'prompted' || (clip.startsWith(`#${num} · `) && clip.endsWith(id)), `copied: "${clip}"`);
  expect(byNumber.includes(id) && byTypo.includes(id), `by number → ${byNumber}; by a typo → ${byTypo}`);
  expect(/the closest is #\d+ · /.test(typoStatus), `status after a typo: ${typoStatus}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${numbered.length} frames numbered · copied "${clip || copied}" · ${typoStatus.slice(0, 80)}`;
});

await s.test('Recovery: unsaved work survives the tab closing; reopening the pack offers it back', async () => {
  const { PACK_ANNOTATED } = await import('./harness.mjs');
  const p1 = await context.newPage();
  const { errors: e1 } = instrument(p1);
  await openPainter(p1, PACK_ANNOTATED);
  const firstSaved = await p1.$$eval('#frame-select option', (os) => os.map((o) => o.textContent || '').find((t) => /f-[a-z0-9]+-[a-z0-9]+/.test(t)) || '');
  await selectFrame(p1, firstSaved.match(/(f-[a-z0-9]+-[a-z0-9]+)/)?.[1] || 'none');
  await p1.$eval('#frame-menu', (el) => { el.open = true; el.dispatchEvent(new Event('toggle')); });
  await p1.click('#frame-menu-rename');
  await p1.waitForSelector('#frame-details-dialog[open]');
  await p1.fill('#frame-details-name', 'Kept by the journal');
  await p1.click('#frame-details-submit');
  await p1.waitForTimeout(4500); // the journal writes 3 s after the last change
  await p1.close({ runBeforeUnload: false }); // as a crash or a closed tab would
  const p2 = await context.newPage();
  const { errors: e2, dialogs } = instrument(p2, { restoreJournal: true });
  await openPainter(p2, PACK_ANNOTATED);
  await p2.waitForFunction(() => /Restored your unsaved work/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  const status = (await p2.textContent('#status')) || '';
  const labels = await p2.$$eval('#frame-select option', (os) => os.map((o) => o.textContent || ''));
  const asked = dialogs.find((d) => /The Project tool has unsaved work for/.test(d.message));
  await p2.close({ runBeforeUnload: false });
  // Declining forgets it: the next open is clean.
  const p3 = await context.newPage();
  const { dialogs: d3 } = instrument(p3);
  await openPainter(p3, PACK_ANNOTATED);
  await p3.waitForTimeout(800);
  const declined = d3.some((d) => /The Project tool has unsaved work for/.test(d.message));
  const p4 = await context.newPage();
  const { dialogs: d4 } = instrument(p4);
  await openPainter(p4, PACK_ANNOTATED);
  await p4.waitForTimeout(800);
  const askedAgain = d4.some((d) => /The Project tool has unsaved work for/.test(d.message));
  await p3.close({ runBeforeUnload: false });
  await p4.close({ runBeforeUnload: false });
  expect(!!asked, `no restore offer on reopening: ${dialogs.map((d) => d.message.slice(0, 50)).join(' | ')}`);
  expect(/Restored your unsaved work .*Save to keep it/.test(status), `status: ${status}`);
  expect(labels.some((t) => t.includes('Kept by the journal')), `the frame name did not come back: ${labels.slice(0, 4).join(' | ')}`);
  expect(declined && !askedAgain, `declining should forget it (offered ${declined}, again ${askedAgain})`);
  expect(e1.length + e2.length === 0, [...e1, ...e2].slice(0, 3).join(' | '));
  return status.slice(0, 90);
});

await s.test('Groups: “On this frame” shows only the groups with tiles on the frame on screen', async () => {
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  const { PACK_ANNOTATED } = await import('./harness.mjs');
  await openPainter(pg, PACK_ANNOTATED);
  const labels = await pg.$$eval('#frame-select option', (os) => os.map((o) => o.textContent || ''));
  const idOf = (t) => (t.match(/(f-[a-z0-9]+-[a-z0-9]+)/) || [])[1];
  const title = labels.find((t) => / Title – /.test(t));
  const other = labels.find((t) => / Safety – /.test(t)) || labels.find((t) => idOf(t) && !/ Title – /.test(t));
  if (!title || !other) return `skipped — frames: ${labels.slice(0, 4).join(' | ')}`;
  const visible = () => pg.$$eval('#groups-tree .group-row', (rs) => rs.filter((r) => r.offsetParent !== null).length);
  await pg.check('#group-on-frame');
  await selectFrame(pg, idOf(title));
  const onTitle = await visible();
  await selectFrame(pg, idOf(other));
  const onOther = await visible();
  const empty = ((await pg.textContent('#groups-tree .group-search-empty').catch(() => '')) || '').trim();
  await pg.uncheck('#group-on-frame');
  await pg.waitForTimeout(300);
  const allBack = await pg.$$eval('#groups-tree .group-row', (rs) => rs.filter((r) => !r.hidden).length);
  expect(onTitle >= 1, `no group shown on a Title frame (${title})`);
  expect(onOther === 0 && empty === 'No groups have tiles on this frame.', `on ${other}: ${onOther} shown, "${empty}"`);
  expect(allBack >= 1, 'groups did not come back after unticking');
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `Title ${onTitle} · other ${onOther} · "${empty}"`;
});

await s.test('No page errors during the painter run', async () => {
  expect(errors.length === 0, errors.slice(0, 4).join(' | '));
});

s.summary();
await browser.close();
