/**
 * SpriteStudio: sprite list, pose filmstrip, playback, and the sprite-over-background stage.
 * Uses the pack s3 saves (it is the one with poses).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { encodePng, decodePng } from '../../scripts/png.mjs';
import { parseArtPack } from '../../src/art-pack.js';
import { parseVBColorPack } from '../../src/vbcolor-pack.js';
import { OUT, BASE, launch, instrument, suite, expect, selectGroup, captureDownload, openPainter, painterSave } from './harness.mjs';

const PACK_WITH_POSES = `${OUT}/s3-poses.vbpack`;

const s = suite('6. SpriteStudio');
const { browser, context } = await launch();
const page = await context.newPage();
const { errors, answers } = instrument(page);
const status = async () => (await page.textContent('#status')) || '';

/** Pixels brighter than the #111 stage backdrop. */
const litPixels = () =>
  page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit;
  });

await s.test('Opens a pack and lists sprite groups', async () => {
  await page.goto(`${BASE}/tools/sprite-studio.html`);
  await page.setInputFiles('#file-input', PACK_WITH_POSES);
  await page.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  // The stage background is configurable and ships loud (hot pink) so sprite edges show.
  // Pin it dark here: the pixel counting below assumes anything bright is the sprite.
  await page.fill('#stage-bg-color', '#111111');
  await page.dispatchEvent('#stage-bg-color', 'input');
  await page.waitForTimeout(300);
  const sprites = await page.$$eval('#sprite-list .sprite-row', (rs) => rs.length);
  const others = await page.$$eval('#other-list .sprite-row', (rs) => rs.length);
  expect(sprites >= 1, `no OBJ groups listed (others: ${others})`);
  return `${sprites} sprite group(s), ${others} other · ${(await status()).slice(0, 70)}`;
});

await s.test('Header links go to the emulator, the Project tool, and the tools hub', async () => {
  const links = await page.$$eval('.app-nav a', (as) =>
    as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })),
  );
  const want = { Emulator: '/', 'Project tool': '/tools/project.html', 'All tools': '/tools/' };
  for (const [text, href] of Object.entries(want)) {
    const hit = links.find((l) => l.text === text);
    expect(hit?.href === href, `${text} → ${hit?.href ?? '(missing)'}, expected ${href}`);
    const res = await page.request.get(`${BASE}${href}`);
    expect(res.ok(), `${href} returned ${res.status()}`);
  }
  return links.map((l) => `${l.text} → ${l.href}`).join(' · ');
});

await s.test('The first sprite is selected and its poses fill the filmstrip', async () => {
  const cards = await page.$$eval('.pose-card', (cs) => cs.map((c) => c.querySelector('.label').textContent));
  expect(cards.length >= 1, 'no pose cards');
  const thumbInk = await page.$eval('.pose-card canvas', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit;
  });
  expect(thumbInk > 0, 'pose thumbnail is blank');
  return `${cards.length} pose(s): ${cards.join(', ').slice(0, 60)} · ${thumbInk} thumb px`;
});

await s.test('Pose detail reports the source frame and how much of the pose matched', async () => {
  const text = ((await page.textContent('#pose-detail')) || '').replace(/\s+/g, ' ');
  // The label and value are adjacent elements, so textContent has no space between them.
  const matched = text.match(/Matched here\s*(\d+)\s*\/\s*(\d+)/);
  expect(!!matched, `no match line: ${text.slice(0, 120)}`);
  expect(matched[1] === matched[2], `only ${matched[1]}/${matched[2]} tiles found in the frame`);
  expect(/Frame/.test(text) && !/not found/.test(text), 'source frame not resolved');
  return matched[0];
});

await s.test('Background is off by default, on the stage and in the thumbnails', async () => {
  // The scene behind a sprite is noise while painting it, so neither the canvas nor the strip
  // starts with it.
  const checked = await page.isChecked('#toggle-background');
  const thumbHasBg = await page.evaluate(() => {
    const c = document.querySelector('.pose-card canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    // The stage colour fills the thumbnail wherever the pose does not cover it.
    const bg = document.getElementById('stage-bg-color').value;
    const want = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
    let off = 0;
    for (let i = 0; i < 3; i++) off += Math.abs(d[i] - want[i]);
    return off > 30; // far from the stage colour means real scenery
  });
  expect(!checked, 'Background starts on');
  expect(thumbHasBg === false || thumbHasBg === null, 'a thumbnail is showing scenery by default');
  return `toggle ${checked ? 'on' : 'off'} · thumbnail scenery: ${thumbHasBg}`;
});

await s.test('The sprite draws over the background even when other worlds cover it', async () => {
  // Compare the stage pixel for pixel: the scene behind the sprite has to change what is shown.
  // (Counting "lit" pixels used to pass only because overlay paint from another screen was drawn
  // on every frame; overlays now appear only on frames showing their group, like the emulator.)
  const stagePixels = () =>
    page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
      return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    });
  await page.check('#toggle-background');
  await page.waitForTimeout(300);
  const withBg = await stagePixels();
  await page.uncheck('#toggle-background');
  await page.waitForTimeout(300);
  const spriteOnly = await litPixels();
  const without = await stagePixels();
  let changed = 0;
  for (let i = 0; i < without.length; i += 4) {
    if (withBg[i] !== without[i] || withBg[i + 1] !== without[i + 1] || withBg[i + 2] !== without[i + 2]) changed++;
  }
  expect(spriteOnly > 0, 'sprite alone renders nothing — the pose layer is empty');
  expect(changed > 0, 'turning the background on changed nothing on the stage');
  return `background changes ${changed} px; sprite-only view has ${spriteOnly} lit px`;
});

await s.test('Zoom to sprite crops the stage; turning it off shows the whole frame', async () => {
  const zoomed = await page.$eval('#stage-canvas', (c) => [c.width, c.height]);
  await page.uncheck('#toggle-zoom');
  await page.waitForTimeout(300);
  const full = await page.$eval('#stage-canvas', (c) => c.width / c.height);
  await page.check('#toggle-zoom');
  await page.waitForTimeout(300);
  expect(Math.abs(full - 384 / 224) < 0.01, `unzoomed aspect ${full.toFixed(3)}, expected ${(384 / 224).toFixed(3)}`);
  expect(zoomed[0] / zoomed[1] !== full, 'zoom made no difference');
  return `zoomed ${zoomed[0]}×${zoomed[1]} · ${(await page.textContent('#stage-note')).slice(0, 50)}`;
});

await s.test('Selecting another group swaps the filmstrip', async () => {
  const labels = () => page.$$eval('.pose-card .label', (ls) => ls.map((l) => l.textContent).join(' | '));
  const before = await labels();
  await page.click('#other-list .sprite-row');
  await page.waitForTimeout(500);
  const after = await labels();
  await page.click('#sprite-list .sprite-row');
  await page.waitForTimeout(500);
  const back = await labels();
  expect(after !== before, `filmstrip unchanged (${before} → ${after})`);
  expect(back === before, `returning to the sprite gave "${back}", expected "${before}"`);
  return `${before} → ${after} → ${back}`;
});

await s.test('Arrow keys move through poses', async () => {
  const count = await page.$$eval('.pose-card', (cs) => cs.length);
  const counter = () => page.textContent('#pose-counter');
  const first = await counter();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const second = await counter();
  expect(count === 1 ? second === first : second !== first, `counter stuck at ${first} with ${count} pose(s)`);
  return `${first} → ${second}`;
});

/**
 * A client point over a lit sprite pixel. `fromBottom` scans upward, which lands
 * in this sprite's lower tile row — where the pose repeats one tile pattern.
 */
async function spritePixelPoint(page, { fromBottom = false } = {}) {
  const hit = await page.evaluate((bottomUp) => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const rows = [...Array(c.height).keys()];
    for (const y of bottomUp ? rows.reverse() : rows) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] < 255 || d[i] + d[i + 1] + d[i + 2] <= 60) continue;
        return { x, y, w: c.width, h: c.height };
      }
    }
    return null;
  }, fromBottom);
  if (!hit) throw new Error('no lit sprite pixel on the stage');
  const box = await page.locator('#stage-canvas').boundingBox();
  return {
    x: box.x + ((hit.x + 0.5) * box.width) / hit.w,
    y: box.y + ((hit.y + 0.5) * box.height) / hit.h,
  };
}

/**
 * Remember the stage, then report what changed. Painted colors come back dimmed
 * by the frame's brightness, so compare against the previous frame rather than an
 * exact hex.
 */
const snapshotStage = (page) =>
  page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    window.__stageSnap = c.getContext('2d').getImageData(0, 0, c.width, c.height).data.slice();
  });

const stageDiff = (page) =>
  page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const prev = window.__stageSnap;
    if (!prev || prev.length !== d.length) return { changed: -1, runs: 0 };
    const xs = new Set();
    let changed = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] === prev[i] && d[i + 1] === prev[i + 1] && d[i + 2] === prev[i + 2]) continue;
        changed++;
        xs.add(x);
      }
    }
    // Two painted copies of one tile pattern show up as two runs of columns.
    const uniq = [...xs].sort((a, b) => a - b);
    let runs = uniq.length ? 1 : 0;
    for (let i = 1; i < uniq.length; i++) if (uniq[i] - uniq[i - 1] > 2) runs++;
    return { changed, runs };
  });

await s.test('A BG group renders: its region, on the frame that holds its anchor', async () => {
  await page.click('#other-list .sprite-row');
  await page.waitForTimeout(600);
  await page.uncheck('#toggle-background');
  await page.uncheck('#toggle-outline');
  await page.waitForTimeout(300);
  const lit = await litPixels();
  const note = (await page.textContent('#stage-note')) || '';
  const st = await status();
  const cards = await page.$$eval('.pose-card', (cs) => cs.length);

  // BG groups paint here per tile pattern. A group with Project-tool overlay paint asks first
  // (the overlay would hide it); cancel that here so later tests see the pack unchanged.
  await page.click('#btn-tool-brush');
  const p = await spritePixelPoint(page);
  answers.push(false);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const painted = await status();
  const askedAboutOverlay = /overlay paint alone/.test(painted);
  if (!askedAboutOverlay) {
    answers.length = 0; // no dialog came up, so the queued answer is unused
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
  }
  await page.click('#btn-tool-none');
  await page.check('#toggle-background');
  await page.check('#toggle-outline');
  await page.click('#sprite-list .sprite-row');
  await page.waitForTimeout(400);

  expect(lit > 0, `BG group drew nothing · ${st.slice(0, 100)}`);
  expect(!/No pose to show/.test(note), `stage says: ${note}`);
  expect(cards === 1, `expected one region card, got ${cards}`);
  expect(
    askedAboutOverlay || /cop(y|ies) on this screen changed/.test(painted),
    `BG click neither painted nor asked about overlay paint: ${painted.slice(0, 100)}`,
  );
  return `${lit} lit px · ${askedAboutOverlay ? 'asked about overlay paint' : painted.slice(0, 70)}`;
});

await s.test('Animation tracks are OBJ-only: hidden for a BG group, shown for a sprite', async () => {
  await page.click('#other-list .sprite-row');
  await page.waitForTimeout(400);
  const hiddenForBg = await page.isHidden('#tracks-panel');
  await page.click('#sprite-list .sprite-row');
  await page.waitForTimeout(400);
  const shownForObj = await page.isVisible('#tracks-panel');
  expect(hiddenForBg, 'tracks panel showed for a BG group');
  expect(shownForObj, 'tracks panel hidden for an OBJ group');
  return 'hidden for BG, shown for OBJ';
});

await s.test('A named track holds each pose for a number of frames, drawn to scale', async () => {
  answers.push('Walk');
  await page.click('#btn-track-new');
  await page.waitForTimeout(300);

  await page.fill('#track-hold', '4');
  await page.click('#btn-track-add-pose');
  await page.waitForTimeout(250);
  await page.fill('#track-hold', '12');
  await page.click('#btn-track-add-pose');
  await page.waitForTimeout(250);

  const steps = await page.$$eval('.timeline-step', (cs) =>
    cs.map((c) => ({
      hold: /** @type {HTMLInputElement} */ (c.querySelector('.step-hold'))?.value,
      w: c.getBoundingClientRect().width,
    })),
  );
  const length = await page.textContent('#track-length');
  const name = await page.$eval('#track-select', (sel) => sel.selectedOptions[0].textContent);
  expect(steps.length === 2, `expected 2 steps, got ${steps.length}`);
  expect(steps[0].hold === '4' && steps[1].hold === '12', `step holds: ${steps.map((st) => st.hold)}`);
  expect(
    steps[1].w > steps[0].w * 1.5,
    `12-frame step (${steps[1].w}px) is not visibly longer than the 4-frame one (${steps[0].w}px)`,
  );
  expect(/16 frame\(s\)/.test(length || ''), `track length: ${length}`);
  return `${name} · ${steps[0].w.toFixed(0)}px vs ${steps[1].w.toFixed(0)}px · ${length}`;
});

await s.test('Hold can be edited in place on the timeline', async () => {
  const input = page.locator('.timeline-step .step-hold').first();
  await input.fill('8');
  await input.press('Enter');
  await input.blur();
  await page.waitForTimeout(300);
  const length = await page.textContent('#track-length');
  const firstHold = await page.locator('.timeline-step .step-hold').first().inputValue();
  expect(firstHold === '8', `first step hold is ${firstHold}`);
  expect(/20 frame\(s\)/.test(length || ''), `track length after edit: ${length}`);
  return `4 → 8 frames · ${length}`;
});

await s.test('A step can be mirrored, and the stage shows it flipped', async () => {
  const noteBefore = (await page.textContent('#stage-note')) || '';
  await page.locator('.timeline-step .step-mirror').nth(1).click();
  await page.waitForTimeout(350);
  const pressed = await page.locator('.timeline-step .step-mirror').nth(1).getAttribute('aria-pressed');
  const label = (await page.locator('.timeline-step .step-name').nth(1).textContent()) || '';
  const noteAfter = (await page.textContent('#stage-note')) || '';

  // Clicking a step (its name, as a person would) moves the playhead there.
  await page.locator('.timeline-step .step-name').nth(1).click();
  await page.waitForTimeout(300);
  const activeIndex = await page.$$eval('.timeline-step', (cs) => cs.findIndex((c) => c.classList.contains('active')));
  await page.click('#btn-tool-none');
  expect(activeIndex === 1, `clicked step 2 but step ${activeIndex + 1} is highlighted`);
  expect(pressed === 'true', `mirror button aria-pressed=${pressed}`);
  expect(label.startsWith('⇋'), `step label: ${label}`);
  expect(!/mirrored/.test(noteBefore) && /mirrored/.test(noteAfter), `stage note: "${noteBefore}" → "${noteAfter}"`);
  return `${label.trim()} · ${noteAfter.slice(-30)}`;
});

await s.test('Painting a tile colors every copy of that pattern', async () => {
  await page.uncheck('#toggle-background');
  // The cyan outline is 'lit' too; hide it so the scan lands on sprite pixels.
  await page.uncheck('#toggle-outline');
  await page.waitForTimeout(300);
  await page.click('#btn-tool-brush');
  await page.$eval('#paint-color', (elm) => {
    elm.value = '#ff00d0';
    elm.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await snapshotStage(page);
  // Paint in the sprite's lower tile row, where the pose repeats a tile pattern.
  const p = await spritePixelPoint(page, { fromBottom: true });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(500);
  const after = await stageDiff(page);
  const st = await status();
  expect(after.changed > 0, `nothing painted · ${st.slice(0, 120)}`);
  expect(after.runs >= 2, `paint appeared in ${after.runs} place(s); expected the repeated tile to update too`);
  return `${after.changed}px across ${after.runs} copies · ${st.slice(0, 80)}`;
});

await s.test('The palette collects painted colors and sets the brush', async () => {
  const swatches = await page.$$eval('.swatch', (bs) => bs.map((b) => b.dataset.hex));
  expect(swatches.includes('#ff00d0'), `painted color missing from the palette: ${swatches.join(', ') || '(empty)'}`);
  await page.$eval('#paint-color', (elm) => {
    elm.value = '#123456';
    elm.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('.swatch[data-hex="#ff00d0"]');
  await page.waitForTimeout(200);
  const picked = await page.inputValue('#paint-color');
  expect(picked === '#ff00d0', `clicking a swatch set ${picked}`);
  return `${swatches.length} swatch(es)`;
});

await s.test('Undo puts the painted tile back', async () => {
  // Snapshot the painted stage, undo, and expect it to differ; then undo is
  // checked against the pre-paint look by repainting and diffing again.
  await snapshotStage(page);
  await page.click('#btn-undo');
  await page.waitForTimeout(450);
  const undone = await stageDiff(page);
  expect(undone.changed > 0, 'undo changed nothing on the stage');

  await snapshotStage(page);
  await page.click('#btn-tool-brush');
  const p = await spritePixelPoint(page, { fromBottom: true });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(450);
  const redone = await stageDiff(page);
  expect(redone.changed > 0, 'could not repaint after undo');
  await page.check('#toggle-background');
  await page.check('#toggle-outline');
  await page.waitForTimeout(250);
  return `undo moved ${undone.changed}px, repaint moved ${redone.changed}px`;
});

await s.test('The Eraser (E) takes paint off; Ctrl+Z puts it back and Ctrl+Shift+Z / Redo erases it again', async () => {
  await page.uncheck('#toggle-background');
  await page.uncheck('#toggle-outline');
  await page.waitForTimeout(300);
  await page.click('#btn-tool-brush');
  await page.$eval('#paint-color', (elm) => {
    elm.value = '#00ffaa';
    elm.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const p = await spritePixelPoint(page, { fromBottom: true });
  await snapshotStage(page);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(450);
  const painted = await stageDiff(page);
  await snapshotStage(page); // the painted look
  await page.keyboard.press('e');
  const eraserOn = await page.$eval('#btn-tool-erase', (b) => b.classList.contains('active'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(450);
  const erased = await stageDiff(page);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(450);
  const afterUndo = await stageDiff(page);
  const redoEnabled = !(await page.isDisabled('#btn-redo'));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(450);
  const afterRedo = await stageDiff(page);
  const redoEmpty = await page.isDisabled('#btn-redo');
  await page.click('#btn-undo'); // the erase
  await page.waitForTimeout(300);
  await page.click('#btn-undo'); // the green stroke
  await page.waitForTimeout(300);
  await page.click('#btn-tool-brush');
  await page.check('#toggle-background');
  await page.check('#toggle-outline');
  await page.waitForTimeout(250);
  expect(painted.changed > 0, 'the brush painted nothing');
  expect(eraserOn, 'E did not choose the Eraser');
  expect(erased.changed > 0, 'erasing changed nothing on the stage');
  expect(afterUndo.changed === 0, `Ctrl+Z after erasing left ${afterUndo.changed}px different from the painted look`);
  expect(redoEnabled, 'Redo is not enabled after an undo');
  expect(afterRedo.changed > 0, 'Ctrl+Shift+Z did not erase it again');
  expect(redoEmpty, 'Redo is still enabled with nothing left to redo');
  return `painted ${painted.changed}px · erased ${erased.changed}px · undo back · redo ${afterRedo.changed}px`;
});

await s.test('“Only this group’s paint” is on by default, redraws the stage when switched, and is remembered', async () => {
  const onByDefault = await page.isChecked('#toggle-own-paint');
  await page.uncheck('#toggle-own-paint');
  await page.waitForTimeout(300);
  const offStatus = await status();
  const remembered = await page.evaluate(() => localStorage.getItem('studio.ownPaintOnly'));
  await page.check('#toggle-own-paint');
  await page.waitForTimeout(300);
  const onStatus = await status();
  expect(onByDefault, 'the toggle is not on by default');
  expect(/what the game shows/.test(offStatus), `status when off: ${offStatus}`);
  expect(remembered === '0', `choice not remembered: ${remembered}`);
  expect(/only this group/i.test(onStatus), `status when on: ${onStatus}`);
  return `${offStatus.slice(0, 50)} · ${onStatus.slice(0, 50)}`;
});

await s.test('Pure red is a colour like any other: painted with it, it joins the palette (it is not taken for a starter shade)', async () => {
  await page.uncheck('#toggle-background');
  await page.uncheck('#toggle-outline');
  await page.waitForTimeout(250);
  await page.click('#btn-tool-brush');
  await page.$eval('#paint-color', (elm) => {
    elm.value = '#ff0000';
    elm.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const p = await spritePixelPoint(page, { fromBottom: true });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(450);
  const swatches = await page.$$eval('.swatch', (bs) => bs.map((b) => b.dataset.hex));
  await page.click('#btn-undo'); // leave the pose as the next tests expect it
  await page.waitForTimeout(300);
  await page.check('#toggle-background');
  await page.check('#toggle-outline');
  await page.waitForTimeout(250);
  expect(swatches.includes('#ff0000'), `pure red missing from the palette: ${swatches.join(', ')}`);
  return `${swatches.length} swatch(es), #ff0000 among them`;
});

await s.test('Onion skin can ghost a chosen pose on top, at an opacity you set (remembered)', async () => {
  const shot = () => page.locator('#stage-canvas').screenshot();
  const options = await page.$$eval('#onion-pose option', (os) => os.map((o) => ({ value: o.value, text: o.textContent })));
  const cards = await page.$$eval('.pose-card', (cs) => cs.length);
  expect(options[0]?.value === '' && options.length === cards + 1, `onion menu: ${JSON.stringify(options)} for ${cards} card(s)`);
  if (cards < 2) return 'single pose: menu lists it, nothing to ghost';
  const active = await page.$eval('.pose-card.active .label', (l) => l.textContent);
  const other = options.find((o) => o.value && o.text !== active);
  const base = await shot();
  await page.selectOption('#onion-pose', other.value);
  await page.waitForTimeout(350);
  const turnedOn = await page.isChecked('#toggle-onion');
  const ghosted = await shot();
  await page.$eval('#onion-alpha', (r) => { r.value = '1'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(350);
  const opaque = await shot();
  const remembered = await page.evaluate(() => localStorage.getItem('spriteStudio.onionAlpha'));
  await page.$eval('#onion-alpha', (r) => { r.value = '0.35'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.selectOption('#onion-pose', '');
  await page.uncheck('#toggle-onion');
  await page.waitForTimeout(250);
  expect(turnedOn, 'choosing a pose did not turn the onion skin on');
  expect(Buffer.compare(base, ghosted) !== 0, 'the chosen pose did not show over this one');
  expect(Buffer.compare(ghosted, opaque) !== 0, 'opacity made no difference');
  expect(remembered === '1', `opacity not remembered: ${remembered}`);
  return `ghosted “${other.text}” over “${active}”`;
});

await s.test('Onion skin changes the stage; with no reference in the pack the panel says so', async () => {
  const shot = () => page.locator('#stage-canvas').screenshot();
  const base = await shot();
  await page.check('#toggle-onion');
  await page.waitForTimeout(350);
  const onion = await shot();
  await page.uncheck('#toggle-onion');
  await page.waitForTimeout(250);

  const onionChanged = Buffer.compare(base, onion) !== 0;
  // This pack carries no reference, so the panel should say so rather than offer the tools.
  const refName = (await page.textContent('#reference-name')) || '';
  const toggleOff = await page.isDisabled('#toggle-reference');
  const fillOff = await page.isDisabled('#btn-reference-fill');
  expect(/no reference/i.test(refName), `reference panel says: ${refName.slice(0, 60)}`);
  expect(toggleOff && fillOff, 'reference controls are live without a reference in the pack');
  return `${onionChanged ? 'onion drew ghosts' : 'onion: single pose, no ghosts'} · ${refName.slice(0, 50)}`;
});

await s.test('Save writes painted tiles and the track back into the pack', async () => {
  const path = `${OUT}/s6-sprite-studio-saved.vbpack`;
  // Saving here is as slow as in the Project tool, so it shows the same progress window.
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
  const name = await captureDownload(page, () => page.click('#btn-save'), path);
  clearInterval(poll);
  await page.waitForTimeout(400);
  const stillOpen = await page.$eval('#save-progress-dialog', (d) => d.open);
  expect(seen.length > 0, 'the progress window never appeared during the save');
  expect(seen.some((t) => /Packing the .vbpack/.test(t.now)), `never reported packing: ${seen.map((t) => t.now).slice(0, 3)}`);
  expect(seen.some((t) => t.steps.some((c) => /is-done/.test(c))), 'no step was ever marked done');
  expect(!stillOpen, 'the progress window stayed open after the save finished');
  const saved = await parseArtPack((await readFile(path)).buffer);
  const obj = (saved.groups || []).find((g) => g.authoringKind === 'obj');
  const vb = saved.vbcolor ? parseVBColorPack(saved.vbcolor) : null;
  const painted = vb?.entries ? (vb.entries.size ?? vb.entries.length ?? 0) : 0;
  expect(!!obj?.tracks?.length, `saved group has no tracks: ${JSON.stringify(obj?.tracks)}`);
  expect(obj.tracks[0].steps.length === 2, `track steps: ${JSON.stringify(obj.tracks[0].steps)}`);
  expect(obj.tracks[0].steps[0].holdFrames === 8, `edited hold not kept: ${JSON.stringify(obj.tracks[0].steps)}`);
  expect(obj.tracks[0].steps[1].holdFrames === 12, `hold not kept: ${JSON.stringify(obj.tracks[0].steps)}`);
  expect(obj.tracks[0].steps[1].flipH === true, `mirror not kept: ${JSON.stringify(obj.tracks[0].steps)}`);
  expect(!('flipH' in obj.tracks[0].steps[0]), `unmirrored step gained flipH: ${JSON.stringify(obj.tracks[0].steps[0])}`);
  expect(painted > 0, 'no painted tiles in the saved .vbcolor');
  return `${name} · ${obj.tracks[0].name}: ${obj.tracks[0].steps.length} step(s) · ${painted} painted tile(s) · ${seen.length} progress tick(s)`;
});

await s.test('"SpriteStudio →" in the Project tool carries the pack and the selected sprite over', async () => {
  const painter = await context.newPage();
  instrument(painter, { errors });
  await painter.goto(`${BASE}/tools/project.html`);
  await painter.setInputFiles('#file-vbpack', PACK_WITH_POSES);
  await painter.waitForFunction(() => document.querySelectorAll('#frame-select option').length > 0, null, { timeout: 90000 });
  await painter.waitForTimeout(1200);
  const title = await painter.title();
  await selectGroup(painter, 'Reg Mario');
  await painter.click('#btn-open-sprite-studio');
  await painter.waitForURL(/sprite-studio\.html/, { timeout: 90000 });
  await painter.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await painter.waitForTimeout(600);
  const pack = await painter.textContent('#pack-name');
  const active = await painter.textContent('.sprite-row.active');
  const poses = await painter.$$eval('.pose-card', (cs) => cs.length);
  // Used once: no ?from=painter left to reload, and a later visit does not reopen it.
  await painter.waitForTimeout(500);
  const urlAfter = painter.url();
  const later = await context.newPage();
  await later.goto(`${BASE}/tools/sprite-studio.html`);
  await later.waitForTimeout(1500);
  const laterPack = ((await later.textContent('#pack-name')) || '').trim();
  await later.close();
  await painter.close();
  expect(!/from=painter/.test(urlAfter), `SpriteStudio kept the hand-over URL: ${urlAfter}`);
  expect(laterPack === 'no pack', `a later visit reopened the old hand-over: "${laterPack}"`);
  expect(/Project tool/.test(title), `painter title is "${title}"`);
  expect(/\.vbpack$/.test((pack || '').trim()), `pack name did not carry over: "${pack}"`);
  expect(/Reg Mario/.test(active || ''), `selected sprite did not carry over: "${active}"`);
  expect(poses >= 1, 'no poses after handoff');
  return `${(pack || '').trim()} · ${(active || '').split('\n')[0].trim()} · ${poses} pose(s)`;
});

await s.test('"← Project tool" goes back with SpriteStudio’s changes, on the same frame and group', async () => {
  const round = await context.newPage();
  const { errors: roundErrors } = instrument(round);
  await round.goto(`${BASE}/tools/project.html`);
  await round.setInputFiles('#file-vbpack', PACK_WITH_POSES);
  await round.waitForFunction(() => document.querySelectorAll('#frame-select option').length > 0, null, { timeout: 90000 });
  await round.waitForTimeout(1200);
  // A frame other than the one the pack opens on, so coming back to it proves something.
  const frames = await round.$$eval('#frame-select option', (os) => os.map((o) => o.value));
  const opened = await round.inputValue('#frame-select');
  const chosen = frames.find((v) => v !== opened) ?? opened;
  await round.selectOption('#frame-select', chosen);
  await round.waitForTimeout(1200);
  await selectGroup(round, 'Reg Mario');
  await round.waitForTimeout(300);

  await round.click('#btn-open-sprite-studio');
  await round.waitForURL(/sprite-studio\.html/, { timeout: 90000 });
  await round.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await round.waitForTimeout(800);
  const link = ((await round.textContent('#nav-project')) || '').trim();
  expect(link === '← Project tool', `header link reads "${link}"`);

  // Paint one pixel so there is something to carry back.
  await round.fill('#stage-bg-color', '#111111');
  await round.dispatchEvent('#stage-bg-color', 'input');
  await round.uncheck('#toggle-background');
  await round.uncheck('#toggle-outline');
  await round.click('#btn-tool-brush');
  await round.fill('#paint-color', '#00ff88');
  await round.dispatchEvent('#paint-color', 'input');
  await round.waitForTimeout(300);
  const p = await spritePixelPoint(round);
  await round.mouse.click(p.x, p.y);
  await round.waitForTimeout(300);
  expect(!(await round.$eval('#btn-save', (b) => b.disabled)), 'the stroke did not register as a change');

  await round.click('#nav-project');
  await round.waitForURL(/project\.html/, { timeout: 90000 });
  await round.waitForFunction(() => /Back from SpriteStudio/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 90000 });
  await round.waitForTimeout(800);
  const back = (await round.textContent('#status')) || '';
  const frame = await round.inputValue('#frame-select');
  const selected = ((await round.textContent('.group-row.group-selected').catch(() => '')) || '').trim();
  expect(frame === chosen, `came back on frame ${frame}, left on ${chosen}`);
  expect(/Reg Mario/.test(selected), `selected group after return: "${selected}"`);
  expect(/with its changes/.test(back) && /Not saved yet/.test(back), `status: ${back.slice(0, 120)}`);
  expect(!/\?from=/.test(round.url()), `the URL still says it came from somewhere: ${round.url()}`);

  // Save proves the painted pixel made it across.
  const path = `${OUT}/s6-round-trip.vbpack`;
  await captureDownload(round, async () => {
    await round.click('#file-menu > summary');
    await round.click('#file-menu-save');
  }, path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const vb = parseVBColorPack(saved.vbcolor);
  const green = [...(vb?.entries?.values() || [])].some((rgba) => {
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i] === 0 && rgba[i + 1] === 255 && rgba[i + 2] === 136) return true;
    return false;
  });
  expect(green, 'the colour painted in SpriteStudio is not in the pack the Project tool saved');
  expect(roundErrors.length === 0, roundErrors.slice(0, 3).join(' | '));
  await round.close();
  return `frame ${chosen} · ${selected.split('\n')[0]} · ${back.slice(0, 60)}`;
});

await s.test('A pack reference reaches SpriteStudio and fills a group from it', async () => {
  // s2 saves a pack holding a reference, placed and scoped there; this page must reuse that
  // placement rather than ask for it again.
  const packWithReference = `${OUT}/s2-references.vbpack`;
  const ref = await parseArtPack((await readFile(packWithReference)).buffer);
  expect(ref.referencesFolder?.length === 1, 'the s2 pack has no reference image to test with');

  const page2 = await context.newPage();
  const { errors: errors2 } = instrument(page2);
  await page2.goto(`${BASE}/tools/sprite-studio.html`);
  await page2.setInputFiles('#file-input', packWithReference);
  await page2.waitForTimeout(2500);

  // Pick the group whose frame the reference belongs to; others correctly show nothing.
  const rows = await page2.$$eval('.sprite-row', (rs) => rs.map((r) => r.textContent?.trim().replace(/\s+/g, ' ') || ''));
  let picked = -1;
  for (let i = 0; i < rows.length; i++) {
    await page2.$$eval('.sprite-row', (rs, idx) => rs[idx].click(), i);
    await page2.waitForTimeout(700);
    if (!(await page2.isDisabled('#btn-reference-fill'))) { picked = i; break; }
  }
  expect(picked >= 0, `no group resolved the pack's reference (groups: ${rows.join(' | ')})`);

  const shot2 = () => page2.locator('#stage-canvas').screenshot();
  const off = await shot2();
  await page2.check('#toggle-reference');
  await page2.waitForTimeout(400);
  const on = await shot2();
  expect(Buffer.compare(off, on) !== 0, 'the reference overlay did not draw');

  await page2.uncheck('#toggle-reference');
  await page2.waitForTimeout(300);
  const beforeFill = await shot2();
  await page2.click('#btn-reference-fill');
  await page2.waitForTimeout(900);
  const fillStatus = (await page2.textContent('#status')) || '';
  const afterFill = await shot2();
  const filled = fillStatus.match(/Filled (\d+) tile pattern\(s\) from (\d+) tile\(s\)/);
  expect(!!filled, `fill said: ${fillStatus.slice(0, 120)}`);
  expect(Number(filled[1]) > 0 && Number(filled[2]) >= Number(filled[1]), `odd fill counts: ${filled[0]}`);
  expect(Buffer.compare(beforeFill, afterFill) !== 0, 'the stage did not change after filling');

  await page2.click('#btn-undo');
  await page2.waitForTimeout(500);
  expect(Buffer.compare(beforeFill, await shot2()) === 0, 'undo did not put the fill back');

  await page2.click('#btn-reference-palette');
  await page2.waitForTimeout(600);
  const swatches = await page2.$$eval('.swatch', (s) => s.length);
  expect(swatches > 0, 'no colours came out of the reference');

  const coverage = (await page2.textContent('#reference-coverage')) || '';
  expect(/covers \d+%/.test(coverage), `coverage readout says: ${coverage.slice(0, 60)}`);

  // Side by side: two panes, a ghost box on both, nudged independently, then pasted.
  const width = () => page2.$eval('#stage-canvas', (c) => c.width);
  const onePane = await width();
  await page2.check('#toggle-side-by-side');
  await page2.waitForTimeout(600);
  const twoPanes = await width();
  expect(twoPanes > onePane * 1.9, `side by side did not widen the stage: ${onePane} → ${twoPanes}`);

  const rect = await page2.$eval('#stage-canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const paneW = rect.w / 2;
  await page2.mouse.move(rect.x + paneW * 0.25, rect.y + rect.h * 0.3);
  await page2.mouse.down();
  await page2.mouse.move(rect.x + paneW * 0.6, rect.y + rect.h * 0.7, { steps: 6 });
  await page2.mouse.up();
  await page2.waitForTimeout(350);
  const drawnBox = (await page2.textContent('#reference-box-note')) || '';

  await page2.click('#stage-note');
  for (let i = 0; i < 3; i++) await page2.keyboard.press('ArrowRight');
  await page2.waitForTimeout(300);
  const nudged = (await page2.textContent('#reference-box-note')) || '';
  expect(/taking from \+3,/.test(nudged), `nudging did not aim the box: ${nudged.slice(0, 60)}`);

  await page2.click('#btn-reference-paste');
  await page2.waitForTimeout(700);
  const pasteStatus = (await page2.textContent('#status')) || '';
  expect(/Pasted \d+ tile pattern\(s\) into the box/.test(pasteStatus), `paste said: ${pasteStatus.slice(0, 110)}`);

  await page2.click('#btn-reference-box-reset');
  await page2.waitForTimeout(300);
  expect(/taking from \+0,\+0/.test((await page2.textContent('#reference-box-note')) || ''), 'reset did not aim the box straight');

  // The clone brush needs a reference, and paints from it.
  await page2.click('#btn-tool-clone');
  await page2.waitForTimeout(200);
  const cloneOn = await page2.$eval('#btn-tool-clone', (el) => el.classList.contains('active'));
  expect(cloneOn, 'clone tool did not switch on with a reference loaded');

  expect(errors2.length === 0, errors2.slice(0, 3).join(' | '));
  await page2.close();
  return `${filled[0]} · ${swatches} swatch(es) · ${drawnBox.slice(0, 26)} · ${coverage.slice(0, 28)}`;
});

await s.test('A pose can be deleted here: cancel keeps it, OK removes it and its track steps, Save keeps that', async () => {
  const page3 = await context.newPage();
  const { errors: errors3, answers: answers3 } = instrument(page3);
  await page3.goto(`${BASE}/tools/sprite-studio.html`);
  await page3.setInputFiles('#file-input', `${OUT}/s6-sprite-studio-saved.vbpack`);
  await page3.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await page3.click('#sprite-list .sprite-row:has-text("Reg Mario")');
  await page3.waitForTimeout(500);
  const labels = () => page3.$$eval('.pose-card .label', (ls) => ls.map((l) => l.textContent));
  const before = await labels();
  const tracksBefore = await page3.$$eval('#track-select option', (os) => os.length);
  expect(before.length >= 1 && tracksBefore >= 1, `need a pose and a track to start: ${before} / ${tracksBefore} track(s)`);

  answers3.push(false);
  await page3.click('#btn-pose-delete');
  await page3.waitForTimeout(300);
  expect((await labels()).length === before.length, 'cancelling the confirm still deleted the pose');

  // The card's × does the same thing as the detail-panel button.
  answers3.push(true);
  await page3.hover('.pose-card.active');
  await page3.click('.pose-card.active .pose-delete');
  await page3.waitForTimeout(400);
  const after = await labels();
  const note = (await page3.textContent('#status')) || '';
  const gone = before[0];
  // Deleting a sprite's last pose leaves the stand-in built from its tile list (named after the
  // group), which is not a stored pose and has no delete control.
  expect(!after.includes(gone), `“${gone}” still in the strip: ${after}`);
  expect(!(await page3.$('.pose-card .pose-delete')) || after.length > 1, 'the stand-in pose offers a delete button');
  expect(/Deleted pose/.test(note), `status: ${note.slice(0, 80)}`);

  const path = `${OUT}/s6-pose-deleted.vbpack`;
  await captureDownload(page3, () => page3.click('#btn-save'), path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const g = saved.groups.find((x) => x.name === 'Reg Mario');
  const deleted = gone;
  expect(!(g?.poses || []).some((p) => p.name === deleted), `saved pack still has “${deleted}”`);
  const dangling = (g?.tracks || []).flatMap((t) => t.steps).filter((st) => !(g.poses || []).some((p) => p.poseId === st.poseId));
  expect(dangling.length === 0, `saved tracks point at deleted poses: ${JSON.stringify(dangling)}`);
  expect(errors3.length === 0, errors3.slice(0, 3).join(' | '));
  await page3.close();
  return `deleted “${deleted}” · ${after.length} pose(s), ${(g?.tracks || []).length} track(s) left`;
});

await s.test('A BG group gets a card per frame that shows something new; Keep as pose keeps one, it saves, and deleting it brings the frames back', async () => {
  const page4 = await context.newPage();
  const { errors: errors4, answers: answers4 } = instrument(page4);
  await page4.goto(`${BASE}/tools/sprite-studio.html`);
  await page4.setInputFiles('#file-input', `${OUT}/s6-sprite-studio-saved.vbpack`);
  await page4.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  const labels = () => page4.$$eval('.pose-card .label', (ls) => ls.map((l) => l.textContent || ''));
  // The BG group with the most frame cards (a static screen gives one).
  const rows = await page4.$$eval('#other-list .sprite-row', (rs) => rs.map((r) => r.dataset.groupId));
  let pick = null;
  for (const id of rows) {
    await page4.click(`#other-list .sprite-row[data-group-id="${id}"]`);
    await page4.waitForTimeout(250);
    const n = (await labels()).length;
    if (!pick || n > pick.n) pick = { id, n };
  }
  expect(pick && pick.n >= 1, 'no BG group showed any card');
  await page4.click(`#other-list .sprite-row[data-group-id="${pick.id}"]`);
  await page4.waitForTimeout(400);
  const frameCards = await labels();
  expect(new Set(frameCards).size === frameCards.length, `frame cards repeat a name: ${frameCards}`);
  expect(!(await page4.$('.pose-card .pose-delete')), 'a frame card offers delete before it is kept');
  expect(!!(await page4.$('#btn-pose-keep')), 'no Keep as pose button on a frame card');

  await page4.click('#btn-pose-keep');
  await page4.waitForTimeout(400);
  const kept = await labels();
  const note = (await page4.textContent('#status')) || '';
  expect(kept.length === 1 && kept[0] === frameCards[0], `after keeping: ${kept} (was ${frameCards})`);
  expect(/Kept “/.test(note), `status: ${note.slice(0, 100)}`);
  expect(!(await page4.$('#btn-pose-keep')) && !!(await page4.$('#btn-pose-delete')), 'a kept pose should offer Delete, not Keep');

  const path = `${OUT}/s6-bg-pose.vbpack`;
  await captureDownload(page4, () => page4.click('#btn-save'), path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const g = saved.groups.find((x) => x.id === pick.id);
  expect((g?.poses || []).length === 1 && g.poses[0].name === frameCards[0], `saved poses: ${JSON.stringify(g?.poses?.map((p) => p.name))}`);
  expect(!!g?.poses?.[0]?.sourceFrameId, 'the kept pose does not record its frame');

  answers4.push(true);
  await page4.click('#btn-pose-delete');
  await page4.waitForTimeout(400);
  const back = await labels();
  expect(back.length === frameCards.length, `deleting the kept pose left ${back.length} card(s), expected the ${frameCards.length} frame card(s)`);
  expect(errors4.length === 0, errors4.slice(0, 3).join(' | '));
  await page4.close();
  return `${frameCards.length} frame card(s) · kept “${kept[0]}” · saved · deleted`;
});

await s.test('The wheel zooms the stage in whole pixels, Fit puts it back, and One set is there for BG groups', async () => {
  await page.click('#other-list .sprite-row');
  await page.waitForTimeout(600);
  const scaleOf = async () => Number(((await page.textContent('#stage-note')) || '').match(/ (\d+)×/)?.[1] || 0);
  const fitted = await scaleOf();
  const box = await page.locator('#stage-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(250);
  const zoomed = await scaleOf();
  expect(zoomed > fitted, `wheel in did not zoom: ${fitted}× → ${zoomed}×`);
  expect(/wheel zoom/.test((await page.textContent('#stage-note')) || ''), 'stage note does not say the view is free');
  await page.click('#btn-fit');
  await page.waitForTimeout(250);
  expect((await scaleOf()) === fitted, `Fit did not restore ${fitted}×`);
  expect(await page.isVisible('#toggle-one-set'), 'no One set toggle');
  const note = (await page.textContent('#stage-note')) || '';
  return `${fitted}× → ${zoomed}× → Fit ${fitted}×${/one set/.test(note) ? ` · ${note.split(' · ').pop()}` : ' · this group does not repeat'}`;
});

await s.test('Paint tools live in the right-hand rail; G picks Fill, which fills a region and undoes in one step', async () => {
  const inRail = await page.$$eval('.tool-rail button[id^="btn-tool-"]', (bs) => bs.map((b) => b.id));
  const inTop = await page.$$eval('.stage-toolbar button[id^="btn-tool-"]', (bs) => bs.length);
  expect(inRail.includes('btn-tool-fill') && inRail.includes('btn-tool-swap') && inRail.includes('btn-tool-erase') && inRail.length === 7, `rail tools: ${inRail}`);
  expect(inTop === 0, `${inTop} tool button(s) still in the top toolbar`);
  expect(await page.$('.tool-rail #paint-color') && await page.$('.tool-rail #palette'), 'colour or palette not in the rail');

  await page.click('#sprite-list .sprite-row');
  await page.waitForTimeout(500);
  await page.click('#stage-note'); // focus off any input so the shortcut is not typed
  await page.keyboard.press('g');
  expect(await page.$eval('#btn-tool-fill', (b) => b.classList.contains('active')), 'G did not pick Fill');
  expect(!(await page.$eval('#fill-options', (l) => l.hidden)), 'Across tiles option hidden while Fill is on');

  await page.fill('#paint-color', '#20c040');
  await page.dispatchEvent('#paint-color', 'input');
  // The first bright pixel must be the sprite, not the scene or the outline.
  await page.uncheck('#toggle-background');
  await page.uncheck('#toggle-outline');
  await page.waitForTimeout(300);
  const p = await spritePixelPoint(page);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const filled = await status();
  expect(/Filled \d+ px across \d+ tile pattern/.test(filled), `fill said: ${filled.slice(0, 90)}`);
  const across = Number(filled.match(/Filled (\d+) px/)[1]);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.uncheck('#toggle-fill-across');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const oneTile = await status();
  const inTile = Number(oneTile.match(/Filled (\d+) px/)?.[1] || 0);
  expect(inTile > 0 && inTile <= 64, `one-tile fill covered ${inTile} px: ${oneTile.slice(0, 90)}`);
  await page.keyboard.press('Control+z');
  await page.check('#toggle-fill-across');
  await page.check('#toggle-background');
  await page.check('#toggle-outline');
  await page.keyboard.press('v');
  return `across tiles ${across} px · one tile ${inTile} px`;
});

await s.test('S picks Swap: one click recolours every pixel of that colour in the group, and undoes in one step', async () => {
  await page.click('#sprite-list .sprite-row');
  await page.waitForTimeout(500);
  await page.click('#stage-note');
  await page.keyboard.press('s');
  expect(await page.$eval('#btn-tool-swap', (b) => b.classList.contains('active')), 'S did not pick Swap');
  await page.fill('#paint-color', '#3060f0');
  await page.dispatchEvent('#paint-color', 'input');
  await page.uncheck('#toggle-background');
  await page.uncheck('#toggle-outline');
  await page.waitForTimeout(300);
  const p = await spritePixelPoint(page);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const first = await status();
  const m = first.match(/Swapped (\d+) px in (\d+) of (\d+) tile pattern/);
  expect(!!m, `swap said: ${first.slice(0, 100)}`);
  // The clicked colour is gone from the group now: clicking it again finds the brush colour.
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  expect(/already the brush colour/.test(await status()), `second click: ${(await status()).slice(0, 90)}`);
  // Undo brings the old colour back in one step, so the same swap finds the same pixels.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const again = (await status()).match(/Swapped (\d+) px/)?.[1];
  expect(again === m[1], `after undo swapped ${again} px, first time ${m[1]}`);
  await page.keyboard.press('Control+z');
  await page.check('#toggle-background');
  await page.check('#toggle-outline');
  await page.keyboard.press('v');
  return `${m[1]} px in ${m[2]} of ${m[3]} patterns`;
});

await s.test('Folders: make one, file a sprite into it, rename it nested; it saves, and the Project tool keeps it', async () => {
  const first = await page.$eval('#sprite-list .sprite-row', (b) => b.dataset.groupId);
  await page.click(`#sprite-list .sprite-row[data-group-id="${first}"]`);
  await page.waitForTimeout(300);

  answers.push('Heroes');
  await page.click('#sprite-list .folder-new');
  await page.waitForSelector('#sprite-list details.folder[data-folder-path="Heroes"]');
  await page.selectOption('#group-folder-select', 'Heroes');
  await page.waitForTimeout(300);
  const inFolder = await page.$$eval('#sprite-list details.folder[data-folder-path="Heroes"] .sprite-row', (rs) => rs.map((r) => r.dataset.groupId));
  expect(inFolder.includes(first), `sprite not inside the folder: ${inFolder}`);

  answers.push('Stars/Heroes');
  await page.click('#sprite-list details.folder[data-folder-path="Heroes"] > summary .folder-action'); // ✎ rename
  await page.waitForSelector('#sprite-list details.folder[data-folder-path="Stars/Heroes"]');
  const nested = await page.$eval('#sprite-list details.folder[data-folder-path="Stars"]', (d) => !!d.querySelector('details.folder[data-folder-path="Stars/Heroes"] .sprite-row'));
  expect(nested, 'renaming to Stars/Heroes did not nest the folder');

  // Keys typed into a field stay there: an arrow key in the fps box must not change the pose.
  const counter = await page.textContent('#pose-counter');
  await page.focus('#fps');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  expect((await page.textContent('#pose-counter')) === counter, 'an arrow key in the fps field changed the pose');

  const path = `${OUT}/s6-folders.vbpack`;
  await captureDownload(page, () => page.click('#btn-save'), path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const g = (saved.groups || []).find((x) => x.id === first);
  expect(g?.folder === 'Stars/Heroes', `saved folder: ${JSON.stringify(g?.folder)}`);

  // The Project tool rebuilds groups on load; saving there must not drop the folder.
  const painter = await context.newPage();
  instrument(painter);
  await openPainter(painter, path);
  const path2 = `${OUT}/s6-folders-project.vbpack`;
  await painterSave(painter, path2);
  await painter.close();
  const again = await parseArtPack((await readFile(path2)).buffer);
  const g2 = (again.groups || []).find((x) => x.id === first);
  expect(g2?.folder === 'Stars/Heroes', `folder after a Project tool save: ${JSON.stringify(g2?.folder)}`);
  return `“${g.name}” in Stars/Heroes, kept through a Project tool save`;
});

await s.test('A folder dragged onto another folder goes inside it, with its groups', async () => {
  answers.push('Villains');
  await page.click('#sprite-list .folder-new');
  await page.waitForSelector('#sprite-list details.folder[data-folder-path="Villains"]');
  await page.dragAndDrop('#sprite-list details.folder[data-folder-path="Stars"] > summary', '#sprite-list details.folder[data-folder-path="Villains"] > summary');
  await page.waitForSelector('#sprite-list details.folder[data-folder-path="Villains/Stars/Heroes"]', { timeout: 5000 });
  const inside = await page.$$eval('#sprite-list details.folder[data-folder-path="Villains/Stars/Heroes"] .sprite-row', (rs) => rs.length);
  expect(inside >= 1, 'the sprite did not move with its folder');
  // A folder cannot go into its own sub-folder.
  await page.dragAndDrop('#sprite-list details.folder[data-folder-path="Villains"] > summary', '#sprite-list details.folder[data-folder-path="Villains/Stars"] > summary');
  await page.waitForTimeout(300);
  expect(!!(await page.$('#sprite-list details.folder[data-folder-path="Villains/Stars/Heroes"]')), 'dropping a folder into its own sub-folder moved it');
  // Back to the top level by dropping on the list.
  await page.dragAndDrop('#sprite-list details.folder[data-folder-path="Villains/Stars"] > summary', '#sprite-list > .folder-new');
  await page.waitForSelector('#sprite-list details.folder[data-folder-path="Stars/Heroes"]', { timeout: 5000 });
  return `Stars → Villains/Stars → Stars (${inside} sprite(s) along)`;
});

await s.test('Quick search filters the group lists on every keystroke, opening folders to show matches; Enter opens the first, Esc clears', async () => {
  const rowNames = () => page.$$eval('.rail-left .sprite-row .name', (ns) => ns.map((n) => n.textContent || ''));
  const starsOpen = () => page.$eval('#sprite-list details.folder[data-folder-path="Stars"]', (d) => d.open);
  const toggleStars = () => page.click('#sprite-list details.folder[data-folder-path="Stars"] > summary .folder-name');
  const before = await rowNames();
  // Collapse the folder Reg Mario sits in: a search still shows it, without changing that.
  if (await starsOpen()) await toggleStars();
  await page.click('#group-search');
  await page.keyboard.type('reg ma');
  await page.waitForTimeout(150);
  const shown = await rowNames();
  const count = (await page.textContent('#group-search-count')) || '';
  const visible = await page.isVisible('.rail-left .sprite-row:has-text("Reg Mario")');
  const marked = await page.$$eval('.rail-left .sprite-row .name mark', (ms) => ms.length);
  expect(shown.length >= 1 && shown.length < before.length && shown.every((n) => /reg/i.test(n) && /ma/i.test(n)) && visible, `“reg ma”: ${shown.join(' | ')} of ${before.length}`);
  expect(count === `${shown.length} of ${before.length}` && marked >= 2, `count “${count}”, ${marked} highlight(s)`);
  await page.keyboard.type('zzz');
  await page.waitForTimeout(150);
  const empty = ((await page.textContent('.rail-left')) || '').replace(/\s+/g, ' ');
  expect((await rowNames()).length === 0 && /No groups match “reg mazzz”/.test(empty), `no match: ${empty.slice(0, 160)}`);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const active = await page.$eval('.sprite-row.active .name', (n) => n.textContent).catch(() => null);
  expect(active === shown[0], `Enter selected “${active}”, first match “${shown[0]}”`);
  await page.focus('#group-search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const after = await rowNames();
  const collapsed = !(await starsOpen());
  expect(after.length === before.length && (await page.inputValue('#group-search')) === '' && collapsed, `Esc: ${after.length} of ${before.length} rows, folder still collapsed ${collapsed}`);
  if (collapsed) await toggleStars(); // as the later tests expect it
  await page.click('#stage-note');
  await page.keyboard.press('Control+k');
  const focused = await page.evaluate(() => document.activeElement?.id);
  await page.keyboard.press('Escape');
  expect(focused === 'group-search', `Ctrl+K focused ${focused}`);
  return `“reg ma” → ${shown.length} of ${before.length} (${shown.join(', ')})`;
});

await s.test('A pose can be renamed (F2) and moved to another group with its tiles; Save keeps both', async () => {
  const pg = await context.newPage();
  const { errors: pgErrors, answers: pgAnswers } = instrument(pg);
  // The pack plus an empty sprite group for the pose to move to.
  const { artPackPartsFromParsed, buildArtPack } = await import('../../src/art-pack.js');
  const parts = artPackPartsFromParsed(await parseArtPack((await readFile(`${OUT}/s6-sprite-studio-saved.vbpack`)).buffer));
  const target = { id: 'group-e2e-move-target', name: 'E2E Move Target', authoringKind: 'obj', visible: true, criteria: { hashes: [], layers: [2] } };
  const movePack = `${OUT}/s6-pose-move-start.vbpack`;
  await writeFile(movePack, Buffer.from(await (await buildArtPack({ ...parts, groups: [...parts.groups, target] })).arrayBuffer()));
  await pg.goto(`${BASE}/tools/sprite-studio.html`);
  await pg.setInputFiles('#file-input', movePack);
  await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  // A sprite with a stored pose and somewhere to move it.
  const rows = await pg.$$eval('#sprite-list .sprite-row', (rs) => rs.map((r) => r.dataset.groupId));
  let from = null;
  for (const id of rows) {
    await pg.click(`#sprite-list .sprite-row[data-group-id="${id}"]`);
    await pg.waitForTimeout(250);
    if ((await pg.$('#btn-pose-rename')) && (await pg.$$eval('#pose-move-select option', (os) => os.filter((o) => o.value).length)) > 0) {
      from = id;
      break;
    }
  }
  expect(!!from, 'no sprite with a pose that can move');

  pgAnswers.push('E2E renamed pose');
  await pg.click('#stage-canvas').catch(() => {});
  await pg.keyboard.press('F2');
  await pg.waitForTimeout(300);
  const labels = () => pg.$$eval('.pose-card .label', (ls) => ls.map((l) => l.textContent || ''));
  expect((await labels()).includes('E2E renamed pose'), `rename did not show: ${await labels()}`);

  const to = await pg.$eval('#pose-move-select', (s) => [...s.options].find((o) => o.value)?.value);
  pgAnswers.push(false);
  await pg.selectOption('#pose-move-select', to);
  await pg.waitForTimeout(300);
  expect((await labels()).includes('E2E renamed pose'), 'cancelling the move still moved the pose');
  pgAnswers.push(true);
  await pg.selectOption('#pose-move-select', to);
  await pg.waitForTimeout(500);
  const note = (await pg.textContent('#status')) || '';
  expect(/Moved “E2E renamed pose”/.test(note), `status: ${note.slice(0, 100)}`);
  const activeRow = await pg.$eval('.sprite-row.active', (r) => r.dataset.groupId).catch(() => null);
  expect(activeRow === to, `the target group is not selected after the move (${activeRow})`);

  const path = `${OUT}/s6-pose-moved.vbpack`;
  await captureDownload(pg, () => pg.click('#btn-save'), path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const gFrom = saved.groups.find((g) => g.id === from);
  const gTo = saved.groups.find((g) => g.id === to);
  const moved = (gTo?.poses || []).find((p) => p.name === 'E2E renamed pose');
  expect(!!moved && !(gFrom?.poses || []).some((p) => p.name === 'E2E renamed pose'), 'saved pack does not have the pose in its new group only');
  const hashes = new Set((gTo?.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  expect(moved.tiles.every((t) => hashes.has(t.hash >>> 0)), 'the target group does not list the moved pose’s tiles');
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `“E2E renamed pose” ${gFrom?.name} → ${gTo?.name}`;
});

await s.test('Overpaint: T switches to it, a stroke lands past the tiles, Fill stops at what you see, Show overpaint hides it, it saves cropped and the Project tool keeps it', async () => {
  const GREEN = [32, 255, 96];
  // The scene dims pictures with the frame's brightness, like tile paint: match proportions.
  const stageCount = (rgb) =>
    page.evaluate((c) => {
      const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i + 1];
        if (g < 60) continue;
        if (Math.abs(d[i] / g - c[0] / c[1]) < 0.05 && Math.abs(d[i + 2] / g - c[2] / c[1]) < 0.06) n++;
      }
      return n;
    }, rgb);

  // The pack's BG group: its old touch-up was turned into overpaint when the pack opened. Remove
  // it (Remove asks first; the harness says OK), so this test starts a picture from nothing.
  const row = page.locator('#other-list .sprite-row').first();
  const groupId = await row.getAttribute('data-group-id');
  await row.click();
  await page.waitForTimeout(400);
  const before = ((await page.textContent('#pose-detail')) || '').replace(/\s+/g, ' ');
  const converted = /px painted on world/.test(before) ? 1 : 0;
  if (await page.$('#btn-art-remove')) {
    await page.click('#btn-art-remove');
    await page.waitForTimeout(400);
  }
  expect(!!(await page.$('#btn-overpaint-create')) && (await page.isVisible('#paint-on')), `no Add overpaint after Remove · ${before.slice(0, 160)}`);
  expect(await page.isHidden('#touch-up-badge'), 'the overpaint badge shows in tile mode');

  await page.click('#stage-note');
  await page.keyboard.press('t');
  await page.waitForTimeout(500);
  expect(await page.isVisible('#touch-up-badge'), `T did not switch to Overpaint (no badge) · ${await page.textContent('#status')}`);
  expect(await page.$eval('#canvas-wrap', (e) => e.classList.contains('touch-up-mode')), 'the stage is not marked as overpaint mode');
  const detail = ((await page.textContent('#pose-detail')) || '').replace(/\s+/g, ' ');
  expect(/Overpaint\s*nothing painted yet on world \d+.* over the tiles · shows wherever this layer is on screen/.test(detail), `overpaint panel: ${detail.slice(0, 200)}`);

  // Paint near the stage's corner: past the group's tiles, where tile paint cannot go.
  await page.$eval('#paint-color', (el) => { el.value = '#20ff60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.selectOption('#brush-size', '4');
  await page.keyboard.press('b');
  const rect = await page.locator('#stage-canvas').boundingBox();
  await page.mouse.click(rect.x + rect.width * 0.08, rect.y + rect.height * 0.1);
  await page.waitForTimeout(400);
  const painted = await stageCount(GREEN);
  expect(painted > 0, `the stroke did not reach the overpaint · ${await page.textContent('#status')}`);
  expect(/Painted the overpaint/.test((await page.textContent('#status')) || ''), 'status does not say the overpaint was painted');

  // Pick on the overpaint gives its own colour exactly; anywhere else it picks what the stage shows.
  await page.$eval('#paint-color', (el) => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#btn-tool-pick');
  await page.mouse.click(rect.x + rect.width * 0.08, rect.y + rect.height * 0.1);
  await page.waitForTimeout(300);
  const pickedOwn = await page.inputValue('#paint-color');
  const ownNote = (await page.textContent('#status')) || '';
  expect(pickedOwn.toLowerCase() === '#20ff60' && /from the overpaint/.test(ownNote), `pick on the stroke: ${pickedOwn} · ${ownNote.slice(0, 80)}`);
  await page.mouse.click(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
  await page.waitForTimeout(300);
  expect(/Picked #[0-9a-f]{6} from the (stage|scene)|Nothing is drawn there/.test((await page.textContent('#status')) || ''), `pick off the overpaint: ${await page.textContent('#status')}`);

  // Fill on overpaint stops where the picture you see changes, instead of flooding the clear layer.
  await page.keyboard.press('g');
  await page.fill('#paint-color', '#e0c020');
  await page.dispatchEvent('#paint-color', 'input');
  await page.mouse.click(rect.x + rect.width * 0.92, rect.y + rect.height * 0.9);
  await page.waitForTimeout(500);
  const filledMsg = (await page.textContent('#status')) || '';
  const filled = Number(filledMsg.match(/Filled (\d+) px of overpaint/)?.[1] || 0);
  expect(filled > 0 && filled < 384 * 224, `overpaint fill: ${filledMsg.slice(0, 120)}`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  await page.keyboard.press('b');

  // Show overpaint off: back to tile paint, and the stroke is hidden; on again brings it back.
  await page.uncheck('#toggle-zoom');
  await page.uncheck('#toggle-touchup');
  await page.waitForTimeout(400);
  const hidden = await stageCount(GREEN);
  expect(await page.isHidden('#touch-up-badge'), 'hiding the overpaint left Overpaint mode on');
  await page.check('#toggle-touchup');
  await page.waitForTimeout(400);
  const shown = await stageCount(GREEN);
  await page.check('#toggle-zoom');
  expect(hidden === 0 && shown > 0, `Show overpaint: ${painted} px painted, ${hidden} hidden, ${shown} shown again`);

  const path = `${OUT}/s6-overpaint.vbpack`;
  await captureDownload(page, () => page.click('#btn-save'), path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const g = (saved.groups || []).find((x) => x.id === groupId);
  expect(g?.overpaint?.png && g.overpaint.hideTiles === false && !g.touchUp && !g.layerArt, `no overpaint saved: ${JSON.stringify(g?.overpaint)?.slice(0, 160)}`);
  const img = decodePng(Buffer.from(g.overpaint.png, 'base64'));
  expect(img.width === g.overpaint.width && img.height === g.overpaint.height, `PNG ${img.width}×${img.height} vs overpaint ${g.overpaint.width}×${g.overpaint.height}`);
  // Stored cropped to what was painted: one 4 px dab, not the whole layer.
  expect(g.overpaint.width <= 16 && g.overpaint.height <= 16, `saved overpaint is not cropped: ${g.overpaint.width}×${g.overpaint.height}`);
  let greenInPng = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] && img.data[i + 1] > 200 && img.data[i] < 80) greenInPng++;
  expect(greenInPng > 0, 'the saved overpaint PNG has no green');
  const oldTouchUps = (saved.groups || []).filter((x) => x.touchUp).length;

  // The Project tool shows the pill and keeps the overpaint untouched when it saves.
  const painter = await context.newPage();
  instrument(painter);
  await openPainter(painter, path);
  const pills = await painter.$$eval('.overpaint-pill', (ps) => ps.length);
  const path2 = `${OUT}/s6-overpaint-project.vbpack`;
  await painterSave(painter, path2);
  await painter.close();
  const again = await parseArtPack((await readFile(path2)).buffer);
  const g2 = (again.groups || []).find((x) => x.id === groupId);
  expect(pills > 0, 'the Project tool shows no overpaint pill');
  expect(g2?.overpaint?.png === g.overpaint.png, 'the Project tool changed or dropped the overpaint when saving');
  return `${g.overpaint.width}×${g.overpaint.height} saved at map ${g.overpaint.mapX},${g.overpaint.mapY} on world ${g.overpaint.world} · ${converted} old picture(s) shown as overpaint · ${oldTouchUps} touch-up(s) left`;
});

await s.test('Overpaint per pose: Move this overpaint to this pose keeps it in the group for that pose; it saves in place, the card shows it, and the Project tool keeps it', async () => {
  const row = page.locator('#other-list .sprite-row').first();
  const parentId = await row.getAttribute('data-group-id');
  await row.click();
  await page.waitForTimeout(400);
  const rowsBefore = await page.$$eval('.sprite-row', (rs) => rs.length);
  expect(!!(await page.$('#btn-overpaint-move-pose')) && !!(await page.$('#btn-overpaint-pose')), `no per-pose buttons · ${((await page.textContent('#pose-detail')) || '').replace(/\s+/g, ' ').slice(0, 200)}`);
  await page.click('#btn-overpaint-move-pose'); // asks first; the harness says OK
  await page.waitForTimeout(600);
  const active = await page.$eval('.sprite-row.active', (r) => r.dataset.groupId).catch(() => null);
  const detail = ((await page.textContent('#pose-detail')) || '').replace(/\s+/g, ' ');
  expect(active === parentId && (await page.$$eval('.sprite-row', (rs) => rs.length)) === rowsBefore, `the group should stay selected with no new group (${active})`);
  expect(/Overpaint · this pose/.test(detail) && /shows only on this pose/.test(detail) && /This pose’s own picture: it shows only when all \d+ of its tiles are on screen/.test(detail), `pose panel: ${detail.slice(0, 260)}`);
  expect(await page.isVisible('#touch-up-badge'), 'not painting the pose’s overpaint after the move');
  // A stroke widens the picture to its layer again; saving still in Overpaint mode must store the
  // cropped PNG under its own size and place (it once stored the wide ones: the paint moved).
  await page.keyboard.press('b');
  await page.$eval('#paint-color', (el) => { el.value = '#ff00ff'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const box = await page.locator('#stage-canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(300);
  // The card's thumbnail shows the stroke, and follows Show overpaint.
  const thumbMagenta = () => page.$eval('.pose-card.active canvas', (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    // Dimmed with the frame's brightness: magenta by proportion.
    for (let i = 0; i < d.length; i += 4) if (d[i] > 40 && Math.abs(d[i] - d[i + 2]) < 12 && d[i + 1] < d[i] * 0.3) n++;
    return n;
  });
  const thumbOn = await thumbMagenta();
  await page.uncheck('#toggle-touchup');
  await page.waitForTimeout(300);
  const thumbOff = await thumbMagenta();
  await page.check('#toggle-touchup');
  await page.waitForTimeout(300);
  await page.click('#btn-paint-touchup');
  await page.waitForTimeout(200);
  const thumbAgain = await thumbMagenta();
  const midPath = `${OUT}/s6-overpaint-pose-mid.vbpack`;
  await captureDownload(page, () => page.click('#btn-save'), midPath);
  const mid = await parseArtPack((await readFile(midPath)).buffer);
  const sizeOf = (png) => { const b = Buffer.from(png, 'base64'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const pictures = mid.groups.flatMap((g) => [g.overpaint && { name: g.name, ...g.overpaint }, ...(g.poseOverpaints || []).map((p) => ({ ...p, name: `${g.name} · ${p.name}` }))]).filter((p) => p?.png);
  const wrong = pictures.filter((p) => { const [w, h] = sizeOf(p.png); return w !== p.width || h !== p.height; });
  expect(!wrong.length, `saved in Overpaint mode, the picture size does not match its PNG: ${wrong.map((p) => `${p.name} ${p.width}×${p.height} vs ${sizeOf(p.png).join('×')}`).join(', ')}`);
  const midParent = mid.groups.find((g) => g.id === parentId);
  const midPose = midParent?.poseOverpaints?.[0];
  expect(!!midPose && !midParent.overpaint && !mid.groups.some((g) => g.wholePose), `saved: the pose picture should be inside the group (${JSON.stringify(midParent?.poseOverpaints?.map((p) => ({ ...p, png: undefined })))})`);
  // The moved picture keeps its place: the earlier test's green dab is still where it was saved
  // (selecting the group's row once brought back its look before that save: the paint moved).
  const first = (await parseArtPack((await readFile(`${OUT}/s6-overpaint.vbpack`)).buffer)).groups.find((g) => g.id === parentId)?.overpaint;
  const img = decodePng(Buffer.from(midPose.png, 'base64'));
  const at = (mx, my) => { const x = mx - midPose.mapX, y = my - midPose.mapY; const i = (y * img.width + x) * 4; return x >= 0 && y >= 0 && x < img.width && y < img.height ? [...img.data.subarray(i, i + 4)] : null; };
  const green = at(first.mapX, first.mapY);
  let magenta = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 255 && img.data[i + 1] === 0 && img.data[i + 2] === 255) magenta++;
  expect(!!green && green[1] === 255 && green[3] === 255 && magenta > 0 && midPose.width < 384, `the moved picture lost its place or the stroke: green at map ${first.mapX},${first.mapY} → ${green}, ${magenta} magenta px, saved ${midPose.mapX},${midPose.mapY} ${midPose.width}×${midPose.height}`);
  const own = new Set((midParent.criteria?.hashes || []).map((h) => Number(h) >>> 0));
  expect(midPose.hashes.length > 0 && midPose.hashes.every((h) => own.has(Number(h) >>> 0)), 'the pose’s patterns are not the group’s');
  expect(thumbOn > 0 && thumbOff === 0 && thumbAgain > 0, `card thumbnail: ${thumbOn} px after the stroke, ${thumbOff} with Show overpaint off, ${thumbAgain} on again`);

  // Undo takes the move back: the picture is the group's again.
  await page.keyboard.press('Control+z'); // the stroke
  await page.keyboard.press('Control+z'); // the move
  await page.waitForTimeout(400);
  const undone = ((await page.textContent('#pose-detail')) || '').replace(/\s+/g, ' ');
  expect(/This overpaint shows on every pose of this group/.test(undone) && !/this pose \(/.test(undone), `after undoing the move: ${undone.slice(0, 200)}`);

  const painter = await context.newPage();
  instrument(painter);
  await openPainter(painter, midPath);
  const path2 = `${OUT}/s6-overpaint-pose-project.vbpack`;
  await painterSave(painter, path2);
  await painter.close();
  const kept = (await parseArtPack((await readFile(path2)).buffer)).groups.find((g) => g.id === parentId);
  expect(JSON.stringify(kept?.poseOverpaints) === JSON.stringify(midParent.poseOverpaints), 'the Project tool changed or dropped the pose pictures when saving');
  return `“${midPose.name}”: ${midPose.hashes.length} of ${own.size} patterns, ${midPose.width}×${midPose.height} at map ${midPose.mapX},${midPose.mapY}`;
});

await s.test('A pose group made by the old Overpaint just this pose opens as a pose picture inside its group', async () => {
  const { artPackPartsFromParsed, buildArtPack } = await import('../../src/art-pack.js');
  const parts = artPackPartsFromParsed(await parseArtPack((await readFile(`${OUT}/s6-overpaint-pose-mid.vbpack`)).buffer));
  const parent = parts.groups.find((g) => g.poseOverpaints?.length);
  const p = parent.poseOverpaints[0];
  const { poseOverpaints: _p, ...bare } = parent;
  const old = { id: `${parent.id}-pose-old`, name: `${parent.name} · ${p.name}`, wholePose: true, poseOf: parent.id, criteria: { windowIds: parent.criteria.windowIds, layers: parent.criteria.layers, hashes: p.hashes }, overpaint: { world: p.world, bgmapBase: p.bgmapBase, mapX: p.mapX, mapY: p.mapY, width: p.width, height: p.height, png: p.png, hideTiles: false } };
  const oldPack = `${OUT}/s6-old-pose-group.vbpack`;
  await writeFile(oldPack, Buffer.from(await (await buildArtPack({ ...parts, groups: parts.groups.flatMap((g) => (g.id === parent.id ? [bare, old] : [g])) })).arrayBuffer()));
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await pg.goto(`${BASE}/tools/sprite-studio.html`);
  await pg.setInputFiles('#file-input', oldPack);
  await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  const status = (await pg.textContent('#status')) || '';
  const rows = await pg.$$eval('.sprite-row', (rs) => rs.map((r) => r.dataset.groupId));
  expect(/1 pose group\(s\) are now pose pictures inside their group/.test(status) && !rows.includes(old.id), `on open: ${status.slice(0, 200)} · rows ${rows.length}`);
  const path = `${OUT}/s6-old-pose-group-saved.vbpack`;
  await captureDownload(pg, () => pg.click('#btn-save'), path);
  const g = (await parseArtPack((await readFile(path)).buffer)).groups.find((x) => x.id === parent.id);
  const folded = g?.poseOverpaints?.[0];
  expect(!!folded && folded.png === p.png && folded.mapX === p.mapX && folded.mapY === p.mapY && folded.name === p.name, `saved fold: ${JSON.stringify(folded && { ...folded, png: undefined })}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `“${old.name}” → “${parent.name}” pose picture “${folded.name}”`;
});

await s.test('Overpaint with Hide the tiles (old layer art): import an image, paint it, save whole; the Project tool shows and keeps it', async () => {
  const ART = [20, 180, 230];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
  // A small solid image: importing scales it to the picture's size.
  const pngPath = `${OUT}/s6-layer-art-import.png`;
  const rgba = new Uint8Array(16 * 8 * 4);
  for (let i = 0; i < 16 * 8; i++) rgba.set([...ART, 255], i * 4);
  await writeFile(pngPath, encodePng(16, 8, rgba));

  const bgRow = page.locator('#other-list .sprite-row').first();
  const groupId = await bgRow.getAttribute('data-group-id');
  await bgRow.click();
  await page.waitForTimeout(500);
  if (await page.$('#btn-overpaint-create')) {
    await page.click('#btn-overpaint-create');
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => !document.getElementById('btn-art-import')?.disabled && !document.getElementById('toggle-hide-tiles')?.disabled, null, { timeout: 10000 });
  await page.check('#toggle-hide-tiles');
  await page.waitForTimeout(500);
  expect(await page.isHidden('#paint-on'), 'with the tiles hidden, strokes should always go to the picture (no Paint on switch)');
  await page.setInputFiles('#art-file-input', pngPath);
  await page.waitForFunction(() => /Imported .* into the overpaint/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 10000 });

  const stageHas = (rgb) =>
    page.evaluate((c) => {
      const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - c[0]) <= 3 && Math.abs(d[i + 1] - c[1]) <= 3 && Math.abs(d[i + 2] - c[2]) <= 3) n++;
      return n;
    }, rgb);
  const importedOnStage = await stageHas(ART);
  expect(importedOnStage > 100, `the imported picture is not on the stage (${importedOnStage} px)`);

  // Paint a dab with an 8 px brush, then undo it.
  await page.selectOption('#brush-size', '8');
  await page.$eval('#paint-color', (el) => { el.value = '#ff2020'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#stage-note');
  await page.keyboard.press('b');
  const box = await page.locator('#stage-canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const painted = await stageHas([255, 32, 32]);
  expect(painted > 0, 'the brush did not paint the picture');
  await page.click('#btn-undo');
  await page.waitForTimeout(300);
  expect((await stageHas([255, 32, 32])) === 0, 'undo did not take the stroke back');

  // Save: the picture is stored whole (its clear pixels show what is behind the layer).
  const path = `${OUT}/s6-layer-art.vbpack`;
  await captureDownload(page, () => page.click('#btn-save'), path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const g = (saved.groups || []).find((x) => x.id === groupId);
  expect(g?.overpaint?.png && g.overpaint.hideTiles === true, `no tile-hiding overpaint saved: ${JSON.stringify(g?.overpaint)?.slice(0, 160)}`);
  const img = decodePng(Buffer.from(g.overpaint.png, 'base64'));
  expect(img.width === g.overpaint.width && img.height === g.overpaint.height, `PNG ${img.width}×${img.height} vs overpaint ${g.overpaint.width}×${g.overpaint.height}`);
  expect(near([...img.data.subarray(0, 3)], ART), `saved picture colour ${[...img.data.subarray(0, 3)]}`);

  // The Project tool decodes the saved PNG for its preview, and keeps the overpaint when it saves.
  const painter = await context.newPage();
  instrument(painter);
  await openPainter(painter, path);
  const nFrames = await painter.$$eval('#frame-select option', (os) => os.length);
  // The preview dims art with the frame's fade, like the emulator: match the colour's proportions.
  let seen = 0;
  for (let f = 0; f < nFrames && !seen; f++) {
    await painter.selectOption('#frame-select', String(f));
    await painter.waitForTimeout(700);
    seen = await painter.evaluate((c) => {
      const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('main-canvas'));
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i + 1];
        if (g < 30) continue;
        if (Math.abs(d[i] / g - c[0] / c[1]) < 0.06 && Math.abs(d[i + 2] / g - c[2] / c[1]) < 0.08) n++;
      }
      return n;
    }, ART);
  }
  expect(seen > 0, 'the Project tool preview never showed the picture');
  const path2 = `${OUT}/s6-layer-art-project.vbpack`;
  await painterSave(painter, path2);
  await painter.close();
  const again = await parseArtPack((await readFile(path2)).buffer);
  const g2 = (again.groups || []).find((x) => x.id === groupId);
  expect(g2?.overpaint?.png === g.overpaint.png, 'the Project tool changed or dropped the overpaint when saving');
  return `${g.overpaint.width}×${g.overpaint.height} picture on world ${g.overpaint.world}, tiles hidden · ${importedOnStage} px on stage · ${seen} px in the Project tool`;
});

await s.test('A character (2+ kept poses) paints this pose only by default: T and the first stroke start each pose’s own picture; the badge says which; Paint all poses switches', async () => {
  const { artPackPartsFromParsed, buildArtPack } = await import('../../src/art-pack.js');
  // The Project tool suite's background group with one kept pose, plus a smaller second pose.
  const parts = artPackPartsFromParsed(await parseArtPack((await readFile(`${OUT}/s3-bg-pose.vbpack`)).buffer));
  const g = parts.groups.find((x) => x.name === 'BG Poses');
  const [a] = g.poses;
  const b = { ...a, poseId: `${a.poseId}-b`, name: 'Screen B', tiles: a.tiles.filter((t, i) => t.hash === a.anchorHash || i % 2 === 0) };
  const packPath = `${OUT}/s6-character.vbpack`;
  await writeFile(packPath, Buffer.from(await (await buildArtPack({ ...parts, groups: parts.groups.map((x) => (x.id === g.id ? { ...x, poses: [a, b] } : x)) })).arrayBuffer()));
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await pg.goto(`${BASE}/tools/sprite-studio.html`);
  await pg.setInputFiles('#file-input', packPath);
  await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await pg.click(`.sprite-row[data-group-id="${g.id}"]`);
  await pg.waitForTimeout(400);
  const detail = async () => ((await pg.textContent('#pose-detail')) || '').replace(/\s+/g, ' ');
  const badge = async () => ({ text: await pg.textContent('#touch-up-badge'), shown: await pg.isVisible('#touch-up-badge'), all: await pg.$eval('#touch-up-badge', (x) => x.classList.contains('all-poses')) });
  const cards = await pg.$$eval('.pose-card', (cs) => cs.length);
  const first = await detail();
  expect(cards === 2 && /Overpaint · this pose/.test(first) && /This pose has no overpaint yet/.test(first) && !!(await pg.$('#btn-overpaint-scope-all')), `character panel (${cards} cards): ${first.slice(0, 220)}`);
  // T starts this pose's own picture.
  await pg.click('#stage-note');
  await pg.keyboard.press('t');
  await pg.waitForTimeout(300);
  const b1 = await badge();
  expect(b1.shown && /THIS POSE ONLY/.test(b1.text) && !b1.all && /Overpaint · this pose \(/.test(await detail()), `after T: ${JSON.stringify(b1)}`);
  await pg.keyboard.press('b');
  await pg.$eval('#paint-color', (el) => { el.value = '#ff00ff'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const box = await pg.locator('#stage-canvas').boundingBox();
  await pg.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await pg.waitForTimeout(250);
  // The other pose has none yet: still painting this pose only, and the first stroke starts its own.
  await pg.click('.pose-card[data-pose-index="1"]');
  await pg.waitForTimeout(300);
  const b2 = await badge();
  const second = await detail();
  expect(b2.shown && /THIS POSE ONLY/.test(b2.text) && /This pose has no overpaint yet/.test(second), `second pose: ${JSON.stringify(b2)} · ${second.slice(0, 160)}`);
  await pg.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await pg.waitForTimeout(250);
  expect(/Overpaint · this pose \(/.test(await detail()), `the stroke did not start the second pose’s picture: ${(await detail()).slice(0, 160)}`);
  // Paint all poses: strokes go to the group's picture, and the badge warns ALL 2 POSES in its own colour.
  await pg.click('#btn-overpaint-scope-all');
  await pg.waitForTimeout(300);
  const scoped = await detail();
  expect(/Back to this pose only/.test(scoped) && /Painting all 2 poses at once/.test(scoped), `all poses panel: ${scoped.slice(0, 200)}`);
  await pg.click('#stage-note');
  await pg.keyboard.press('t');
  await pg.waitForTimeout(300);
  const b3 = await badge();
  expect(b3.shown && b3.text === 'OVERPAINT · ALL 2 POSES' && b3.all, `all poses badge: ${JSON.stringify(b3)}`);
  await pg.keyboard.press('t');
  await pg.click('#btn-overpaint-scope-pose');
  await pg.waitForTimeout(200);
  const saved = `${OUT}/s6-character-saved.vbpack`;
  await captureDownload(pg, () => pg.click('#btn-save'), saved);
  const out = (await parseArtPack((await readFile(saved)).buffer)).groups.find((x) => x.id === g.id);
  // The all-poses picture was started but never painted, so nothing of it is saved.
  expect(out?.poseOverpaints?.length === 2 && !out.overpaint, `saved: ${out?.poseOverpaints?.length} pose picture(s), group picture ${!!out?.overpaint}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${out.poseOverpaints.map((p) => `“${p.name}” ${p.width}×${p.height}`).join(', ')} · badge “${b1.text}”`;
});

await s.test('Undo past a Save puts back only the picture it changed: the other poses keep the size Save gave them, and the next Save works', async () => {
  // Paint pose A, start pose B with a stroke, Save (crops both), undo B's stroke and B's start.
  // Undo once restored the whole group from before the Save: pose A came back 512 wide over
  // pixels Save had cropped, and every later Save refused.
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await pg.goto(`${BASE}/tools/sprite-studio.html`);
  await pg.setInputFiles('#file-input', `${OUT}/s6-character.vbpack`);
  await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await pg.locator('#other-list .sprite-row', { hasText: 'BG Poses' }).first().click();
  await pg.waitForTimeout(400);
  const box = await pg.locator('#stage-canvas').boundingBox();
  const stroke = async () => { await pg.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5); await pg.waitForTimeout(250); };
  await pg.click('#stage-note');
  await pg.keyboard.press('t');
  await pg.keyboard.press('b');
  await stroke();
  await pg.click('.pose-card[data-pose-index="1"]');
  await pg.waitForTimeout(300);
  await stroke();
  await captureDownload(pg, () => pg.click('#btn-save'), `${OUT}/s6-undo-save-1.vbpack`);
  await pg.click('#stage-note');
  await pg.keyboard.press('Control+z');
  await pg.keyboard.press('Control+z');
  await pg.waitForTimeout(400);
  const path = `${OUT}/s6-undo-save-2.vbpack`;
  let saved = true;
  await captureDownload(pg, () => pg.click('#btn-save'), path).catch(() => { saved = false; });
  const status = (await pg.textContent('#status')) || '';
  expect(saved && !/Save failed/.test(status), `the second Save failed: ${status.slice(0, 200)}`);
  const g = (await parseArtPack((await readFile(path)).buffer)).groups.find((x) => x.name === 'BG Poses');
  const sizeOf = (png) => { const b = Buffer.from(png, 'base64'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const pics = g?.poseOverpaints || [];
  expect(pics.length === 1 && pics.every((p) => { const [w, h] = sizeOf(p.png); return w === p.width && h === p.height; }), `after undo: ${JSON.stringify(pics.map((p) => ({ name: p.name, w: p.width, h: p.height, png: sizeOf(p.png) })))}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `${pics.map((p) => `“${p.name}” ${p.width}×${p.height}`).join(', ')} kept; second Save fine`;
});

await s.test('Recovery: a damaged picture is set aside on open, kept in the pack (also through a Project tool save), and Put back / Discard work', async () => {
  const { artPackPartsFromParsed, buildArtPack } = await import('../../src/art-pack.js');
  // The character pack with two pose pictures; one gets settings that don't match its image.
  const parts = artPackPartsFromParsed(await parseArtPack((await readFile(`${OUT}/s6-character-saved.vbpack`)).buffer));
  const g = parts.groups.find((x) => x.name === 'BG Poses');
  const [good, bad] = g.poseOverpaints;
  const damaged = { ...g, poseOverpaints: [good, { ...bad, width: 512, height: 224 }] };
  const packPath = `${OUT}/s6-damaged.vbpack`;
  await writeFile(packPath, Buffer.from(await (await buildArtPack({ ...parts, groups: parts.groups.map((x) => (x.id === g.id ? damaged : x)) })).arrayBuffer()));
  const pg = await context.newPage();
  const { errors: pgErrors, answers: pgAnswers } = instrument(pg);
  await pg.goto(`${BASE}/tools/sprite-studio.html`);
  await pg.setInputFiles('#file-input', packPath);
  await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  const status = (await pg.textContent('#status')) || '';
  const rowMeta = await pg.$eval(`.sprite-row[data-group-id="${g.id}"] .meta`, (m) => m.textContent);
  expect(/set aside 1 damaged picture\(s\) \(BG Poses\)/.test(status) && /1 recovered/.test(rowMeta), `on open: ${status.slice(0, 220)} · row “${rowMeta}”`);
  await pg.click(`.sprite-row[data-group-id="${g.id}"]`);
  await pg.waitForTimeout(400);
  const rows = await pg.$$eval('#recovered-pictures .recovered-row', (rs) => rs.length);
  expect(rows === 1, `recovered rows: ${rows}`);
  // Export downloads its PNG.
  const exported = `${OUT}/s6-recovered-export.png`;
  await captureDownload(pg, () => pg.click('#recovered-pictures button:has-text("Export PNG")'), exported);
  expect((await readFile(exported)).subarray(1, 4).toString() === 'PNG', 'the export is not a PNG');

  // Saved now, it stays in the pack's recovery folder; a Project tool save keeps it there too.
  const kept = `${OUT}/s6-recovery-kept.vbpack`;
  await captureDownload(pg, () => pg.click('#btn-save'), kept);
  const keptParsed = await parseArtPack((await readFile(kept)).buffer);
  const keptGroup = keptParsed.groups.find((x) => x.id === g.id);
  expect(keptParsed.recoveryFolder?.length === 1 && keptGroup.poseOverpaints.length === 1, `saved: ${keptParsed.recoveryFolder?.length} recovered file(s), ${keptGroup.poseOverpaints.length} pose picture(s)`);
  const painter = await context.newPage();
  instrument(painter);
  await openPainter(painter, kept);
  const viaProject = `${OUT}/s6-recovery-project.vbpack`;
  await painterSave(painter, viaProject);
  await painter.close();
  expect((await parseArtPack((await readFile(viaProject)).buffer)).recoveryFolder?.length === 1, 'the Project tool dropped the recovery folder when saving');

  // Put back (asks when unsure; the harness says OK): the picture returns, in step.
  pgAnswers.push(true);
  await pg.click('#recovered-pictures button:has-text("Put back")');
  await pg.waitForTimeout(600);
  const putBack = (await pg.textContent('#status')) || '';
  expect(/Put back at map \d+, \d+/.test(putBack) && !(await pg.$('#recovered-pictures')), `put back: ${putBack.slice(0, 200)}`);
  const back = `${OUT}/s6-recovery-back.vbpack`;
  await captureDownload(pg, () => pg.click('#btn-save'), back);
  const backParsed = await parseArtPack((await readFile(back)).buffer);
  const pics = backParsed.groups.find((x) => x.id === g.id).poseOverpaints;
  const sizeOf = (png) => { const b = Buffer.from(png, 'base64'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  expect(!backParsed.recoveryFolder && pics.length === 2 && pics.every((p) => { const [w, h] = sizeOf(p.png); return w === p.width && h === p.height; }), `after put back: ${JSON.stringify(pics.map((p) => [p.name, p.width, p.height, sizeOf(p.png)]))} · folder ${backParsed.recoveryFolder?.length}`);

  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();

  // Discard, on a fresh open of the damaged pack: gone from the pack after Save.
  const pd = await context.newPage();
  const { errors: pdErrors, answers: pdAnswers } = instrument(pd);
  await pd.goto(`${BASE}/tools/sprite-studio.html`);
  await pd.setInputFiles('#file-input', packPath);
  await pd.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await pd.click(`.sprite-row[data-group-id="${g.id}"]`);
  await pd.waitForTimeout(400);
  pdAnswers.push(true);
  await pd.click('#recovered-pictures button:has-text("Discard")');
  await pd.waitForTimeout(300);
  const discarded = `${OUT}/s6-recovery-discarded.vbpack`;
  await captureDownload(pd, () => pd.click('#btn-save'), discarded);
  expect(!(await parseArtPack((await readFile(discarded)).buffer)).recoveryFolder, 'the discarded picture is still in the pack');
  expect(pdErrors.length === 0, pdErrors.slice(0, 3).join(' | '));
  await pd.close();
  return `set aside on open → kept through both tools' saves → put back in step; discard removes it`;
});

await s.test('Recovery: when writing the file fails, the save window offers Save as… and Download a copy of the same project', async () => {
  const pg = await context.newPage();
  const { errors: pgErrors } = instrument(pg);
  await pg.goto(`${BASE}/tools/sprite-studio.html`);
  await pg.setInputFiles('#file-input', `${OUT}/s6-character.vbpack`);
  await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  // The first write fails (as a full disk or a lost permission would).
  await pg.evaluate(() => {
    const real = URL.createObjectURL;
    let first = true;
    URL.createObjectURL = (b) => {
      if (first) {
        first = false;
        throw new Error('disk full (test)');
      }
      return real.call(URL, b);
    };
  });
  await pg.click('#btn-save');
  await pg.waitForSelector('#btn-save-failed-download', { timeout: 30000 });
  const dialog = ((await pg.textContent('#save-progress-dialog')) || '').replace(/\s+/g, ' ');
  expect(/Could not write the file: disk full \(test\)/.test(dialog) && (await pg.isVisible('#btn-save-failed-save-as')), `failure window: ${dialog.slice(0, 200)}`);
  const copy = `${OUT}/s6-failed-save-copy.vbpack`;
  await captureDownload(pg, () => pg.click('#btn-save-failed-download'), copy);
  const parsed = await parseArtPack((await readFile(copy)).buffer);
  const status = (await pg.textContent('#status')) || '';
  expect(parsed.groups.some((g) => g.name === 'BG Poses') && /Downloaded a copy of the project/.test(status), `copy: ${parsed.groups.length} group(s) · ${status.slice(0, 160)}`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return 'write failed → Download a copy delivered the same project';
});

await s.test('Recovery: unsaved paint survives the page closing — reopening the pack offers it back; Cancel discards it', async () => {
  const pack = `${OUT}/s6-sprite-studio-saved.vbpack`;
  const stageSum = (pg) =>
    pg.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0;
      return h;
    });
  const openOn = async (pg) => {
    await pg.goto(`${BASE}/tools/sprite-studio.html`);
    await pg.setInputFiles('#file-input', pack);
    await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
    await pg.click('#sprite-list .sprite-row:has-text("Reg Mario")');
    // The cyan outline is lit too; off, the scan lands on sprite pixels.
    await pg.uncheck('#toggle-background');
    await pg.uncheck('#toggle-outline');
    await pg.waitForTimeout(500);
  };
  const journalAsked = (dialogs) => dialogs.some((d) => /has unsaved work for/.test(d.message));

  // Paint, give the journal its moment, then close the page without saving.
  const pa = await context.newPage();
  const a = instrument(pa);
  await openOn(pa);
  const before = await stageSum(pa);
  await pa.click('#btn-tool-brush');
  await pa.$eval('#paint-color', (i) => {
    i.value = '#13c7a2';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const p = await spritePixelPoint(pa);
  await pa.mouse.click(p.x, p.y);
  await pa.waitForTimeout(300);
  const painted = await stageSum(pa);
  await pa.waitForTimeout(3500);
  await pa.close();

  const pb = await context.newPage();
  const b = instrument(pb, { restoreJournal: true });
  await openOn(pb);
  const restored = await stageSum(pb);
  const statusB = (await pb.textContent('#status')) || '';
  const saveOn = !(await pb.isDisabled('#btn-save'));
  await pb.close();

  const pc = await context.newPage();
  const c = instrument(pc);
  await openOn(pc);
  const declined = await stageSum(pc);
  await pc.close();

  const pd = await context.newPage();
  const d = instrument(pd);
  await openOn(pd);
  await pd.close();

  expect(painted !== before, 'the stroke changed the stage');
  expect(journalAsked(b.dialogs) && restored === painted && /restored unsaved work/.test(statusB) && saveOn, `restore: asked ${journalAsked(b.dialogs)}, same stage ${restored === painted}, save on ${saveOn} · ${statusB.slice(0, 160)}`);
  expect(journalAsked(c.dialogs) && declined === before, `cancel: asked ${journalAsked(c.dialogs)}, original stage ${declined === before}`);
  expect(!journalAsked(d.dialogs), 'after Cancel the journal is gone');
  const errs = [...a.errors, ...b.errors, ...c.errors, ...d.errors];
  expect(errs.length === 0, errs.slice(0, 3).join(' | '));
  return 'closed unsaved → reopened → restored the stroke; Cancel → original, and not asked again';
});

await s.test('Pick also says what colours the pixel in the game (or why nothing does) in a bubble; the next click or Esc puts it away', async () => {
  const pg = await context.newPage();
  const { errors } = instrument(pg);
  await pg.goto(`${BASE}/tools/sprite-studio.html`);
  await pg.setInputFiles('#file-input', `${OUT}/s6-sprite-studio-saved.vbpack`);
  await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await pg.click('#sprite-list .sprite-row:has-text("Reg Mario")');
  await pg.uncheck('#toggle-background');
  await pg.uncheck('#toggle-outline');
  await pg.waitForTimeout(500);
  const hiddenFirst = !(await pg.isVisible('#explain-bubble'));
  await pg.click('#btn-tool-pick');
  const p = await spritePixelPoint(pg);
  await pg.mouse.click(p.x, p.y);
  await pg.waitForTimeout(300);
  const text = ((await pg.textContent('#explain-bubble')) || '').trim();
  const shown = await pg.isVisible('#explain-bubble');
  await pg.keyboard.press('Escape');
  const goneOnEsc = !(await pg.isVisible('#explain-bubble'));
  await pg.mouse.click(p.x, p.y);
  await pg.waitForTimeout(200);
  const back = await pg.isVisible('#explain-bubble');
  await pg.click('#btn-tool-none');
  const goneOnTool = !(await pg.isVisible('#explain-bubble'));
  await pg.close();
  expect(hiddenFirst && shown && /^(Coloured by|Not coloured:)/.test(text), `bubble ${shown}: ${text.slice(0, 160)}`);
  expect(goneOnEsc && back && goneOnTool, `Esc hid ${goneOnEsc}, came back ${back}, tool change hid ${goneOnTool}`);
  expect(errors.length === 0, errors.slice(0, 3).join(' | '));
  return text.slice(0, 110);
});

await s.test('Clear… asks how much: this pose only (its own tiles) or every tile it shows; Cancel changes nothing', async () => {
  const page5 = await context.newPage();
  const { errors: errors5 } = instrument(page5);
  await page5.goto(`${BASE}/tools/sprite-studio.html`);
  await page5.setInputFiles('#file-input', `${OUT}/s6-sprite-studio-saved.vbpack`);
  await page5.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await page5.click('#sprite-list .sprite-row:has-text("Reg Mario")');
  await page5.waitForTimeout(500);
  // Paint one pixel so the pose has something to clear.
  await page5.click('#btn-tool-brush');
  const p = await spritePixelPoint(page5);
  await page5.mouse.click(p.x, p.y);
  await page5.waitForTimeout(300);
  await page5.click('#btn-clear-paint');
  await page5.waitForSelector('#clear-paint-dialog[open]', { timeout: 3000 });
  const summary = (await page5.textContent('#clear-paint-summary')) || '';
  const ownLabel = (await page5.textContent('#clear-paint-own')) || '';
  await page5.click('#clear-paint-cancel');
  await page5.waitForTimeout(200);
  const afterCancel = (await page5.textContent('#status')) || '';
  await page5.click('#btn-clear-paint');
  await page5.waitForSelector('#clear-paint-dialog[open]', { timeout: 3000 });
  const ownEnabled = !(await page5.isDisabled('#clear-paint-own'));
  await page5.click(ownEnabled ? '#clear-paint-own' : '#clear-paint-all');
  await page5.waitForTimeout(300);
  const done = (await page5.textContent('#status')) || '';
  const closed = !(await page5.$('#clear-paint-dialog[open]'));
  expect(/painted tile pattern/.test(summary), `summary: ${summary}`);
  expect(/^Clear/.test(ownLabel), `own button: ${ownLabel}`);
  expect(!/Cleared/.test(afterCancel), `Cancel cleared anyway: ${afterCancel.slice(0, 80)}`);
  expect(/^Cleared paint on \d+ tile pattern/.test(done) && closed, `after clearing: ${done.slice(0, 100)}`);
  expect(errors5.length === 0, errors5.slice(0, 3).join(' | '));
  await page5.close();
  return `${summary.slice(0, 70)} · ${done.slice(0, 60)}`;
});

await s.test('Show unpainted (on by default): unpainted tiles show red, as in the Project tool; off shows the plain greys; it is remembered', async () => {
  const page6 = await context.newPage();
  const { errors: errors6 } = instrument(page6);
  await page6.goto(`${BASE}/tools/sprite-studio.html`);
  await page6.evaluate(() => localStorage.removeItem('spriteStudio.showUnpainted'));
  await page6.reload();
  await page6.setInputFiles('#file-input', PACK_WITH_POSES);
  await page6.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  await page6.click('#other-list .sprite-row');
  await page6.waitForTimeout(600);
  await page6.uncheck('#toggle-background');
  await page6.uncheck('#toggle-outline');
  const reds = () => page6.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('stage-canvas'));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    // Red monochrome, not the pink backdrop (#ff00aa).
    for (let i = 0; i < d.length; i += 4) if (d[i] > 60 && d[i + 1] < 20 && d[i + 2] < 20) n++;
    return n;
  });
  const onByDefault = await page6.isChecked('#toggle-unpainted');
  await page6.waitForTimeout(300);
  const redOn = await reds();
  const painted = (await page6.textContent('#pose-detail')) || '';
  await page6.uncheck('#toggle-unpainted');
  await page6.waitForTimeout(400);
  const redOff = await reds();
  await page6.reload();
  await page6.setInputFiles('#file-input', PACK_WITH_POSES);
  await page6.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  const remembered = !(await page6.isChecked('#toggle-unpainted'));
  await page6.check('#toggle-unpainted');
  expect(onByDefault, 'Show unpainted is not on by default');
  expect(redOn > 0, 'no red unpainted tiles with Show unpainted on (the group is unpainted in this pack)');
  expect(redOff === 0, `${redOff} red pixels left with Show unpainted off`);
  expect(/Painted\s*\d+ of \d+ tile pattern/.test(painted.replace(/\s+/g, ' ')), 'no Painted row in Pose details');
  expect(remembered, 'turning it off was not remembered');
  expect(errors6.length === 0, errors6.slice(0, 3).join(' | '));
  await page6.close();
  return `${redOn} red px on · ${redOff} off`;
});

await s.test('Save writes over the .vbpack you opened, with no file dialog; Save as… asks', async () => {
  // A real file handle the page can write (the browser's private file system), standing in for a
  // .vbpack picked with Open — the harness otherwise turns the pickers off.
  const pg = await context.newPage();
  const { errors: pgErrors, answers: pgAnswers } = instrument(pg);
  await pg.goto(`${BASE}/tools/sprite-studio.html`);
  const b64 = (await readFile(PACK_WITH_POSES)).toString('base64');
  await pg.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('e2e-open.vbpack', { create: true });
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
    window.__saveDialogs = 0;
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => {
      window.__saveDialogs++;
      return root.getFileHandle('e2e-save-as.vbpack', { create: true });
    };
  }, b64);
  const sizeOf = (name) => pg.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle(n, { create: true })).getFile()).size;
  }, name);
  const before = await sizeOf('e2e-open.vbpack');
  await pg.click('#btn-open');
  await pg.waitForFunction(() => document.querySelectorAll('.sprite-row').length > 0, null, { timeout: 90000 });
  // Change something so the pack differs: rename the first pose.
  pgAnswers.push('E2E saved over');
  await pg.click('#stage-canvas').catch(() => {});
  await pg.keyboard.press('F2');
  await pg.waitForTimeout(400);
  await pg.click('#btn-save');
  await pg.waitForFunction(() => /Saved e2e-open\.vbpack/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 });
  const dialogsAfterSave = await pg.evaluate(() => window.__saveDialogs);
  const after = await sizeOf('e2e-open.vbpack');
  const tip = await pg.getAttribute('#pack-name', 'title');
  // Save as… asks, writes the chosen file, and Save writes that one from then on.
  await pg.click('#btn-save-as');
  await pg.waitForFunction(() => /Saved e2e-save-as\.vbpack/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 });
  const dialogsAfterSaveAs = await pg.evaluate(() => window.__saveDialogs);
  const savedAs = await sizeOf('e2e-save-as.vbpack');
  expect(dialogsAfterSave === 0, `Save showed a file dialog (${dialogsAfterSave})`);
  expect(after > 0 && after !== before, `the opened file was not written (${before} → ${after} bytes)`);
  expect(/Save writes e2e-open\.vbpack/.test(tip || ''), `pack name tip: ${tip}`);
  expect(dialogsAfterSaveAs === 1 && savedAs > 0, `Save as…: ${dialogsAfterSaveAs} dialog(s), ${savedAs} bytes`);
  expect(pgErrors.length === 0, pgErrors.slice(0, 3).join(' | '));
  await pg.close();
  return `Save wrote e2e-open.vbpack (${before} → ${after} bytes, no dialog) · Save as… asked once and wrote ${savedAs} bytes`;
});

await s.test('No page errors during the SpriteStudio run', async () => {
  expect(errors.length === 0, errors.slice(0, 3).join(' | '));
});

s.summary();
await browser.close();
