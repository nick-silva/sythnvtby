/**
 * Auto-capture: turning it on asks what to watch for (background, sprite, scaled); the emulator
 * then stops on frames showing tiles of those kinds no captured frame has, outlines them, and asks
 * for a label; dismissing turns the mode off.
 */
import { BASE, PACK_ANNOTATED, launch, instrument, suite, expect, bootEmulator, framesAdvanced } from './harness.mjs';

const s = suite('7. Auto-capture');
const { browser, context } = await launch();
const page = await context.newPage();
const { errors } = instrument(page);

const packLabel = async () => (await page.textContent('#loaded-pack-name')) || '';
const frameCount = async () => Number(((await packLabel()).match(/\((\d+) frames?\)/) || [])[1] || 0);
const autoOn = async () => (await page.getAttribute('#btn-auto-capture', 'aria-pressed')) === 'true';
const autoStatus = async () => (await page.textContent('#auto-capture-status')) || '';
const knownTiles = (status) => Number((status.match(/(\d+) tile\(s\) captured/) || [])[1] || 0);

/** Click Auto-capture and answer the chooser with these kinds (bg, obj, affine). */
async function turnOn(p, kinds = ['obj']) {
  await p.click('#btn-auto-capture');
  await p.waitForSelector('#auto-capture-kinds-dialog[open]', { timeout: 5000 });
  for (const k of ['bg', 'obj', 'affine']) await p.setChecked(`#auto-kind-${k}`, kinds.includes(k));
  await p.click('#auto-kinds-start');
}

/** Press Start until auto-capture stops the game (menus have no sprites; gameplay does). */
async function playUntilAutoStop(p, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await p.$('#capture-frame-dialog.auto[open]')) return true;
    await p.click('#game').catch(() => {});
    await p.keyboard.down('Enter');
    await p.waitForTimeout(90);
    await p.keyboard.up('Enter');
    try {
      await p.waitForSelector('#capture-frame-dialog.auto[open]', { timeout: 1800 });
      return true;
    } catch {
      /* keep playing */
    }
  }
  return false;
}

/** Magenta outline pixels on the highlight overlay. */
const highlightPixels = () =>
  page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement|null} */ (document.getElementById('auto-capture-overlay'));
    if (!c || c.style.display === 'none') return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] > 200 && d[i + 2] > 150 && d[i + 1] < 80) n++;
    return n;
  });

await s.test('Turning auto-capture on asks what to watch for; Cancel leaves it off', async () => {
  await bootEmulator(page);
  expect(!(await page.isDisabled('#btn-auto-capture')), 'Auto-capture button still disabled');
  await page.click('#btn-auto-capture');
  await page.waitForSelector('#auto-capture-kinds-dialog[open]', { timeout: 5000 });
  const labels = (await page.textContent('#auto-capture-kinds-dialog')) || '';
  // "All of the above" ticks all three; unticking everything disables Start.
  await page.setChecked('#auto-kind-all', true);
  const allTicked = await page.evaluate(() => ['bg', 'obj', 'affine'].every((k) => document.getElementById(`auto-kind-${k}`).checked));
  await page.setChecked('#auto-kind-all', false);
  const startDisabled = await page.isDisabled('#auto-kinds-start');
  await page.click('#auto-kinds-cancel');
  await page.waitForTimeout(300);
  expect(/Background \(BG\)/.test(labels) && /Sprite \(OBJ\)/.test(labels) && /Scaled \(Affine\)/.test(labels) && /All of the above/.test(labels), `chooser text: ${labels.slice(0, 160)}`);
  expect(allTicked, '"All of the above" did not tick every kind');
  expect(startDisabled, 'Start is enabled with nothing chosen');
  expect(!(await autoOn()), 'Cancel turned auto-capture on');
  expect(!(await page.$('#auto-capture-kinds-dialog[open]')), 'chooser still open after Cancel');
  return 'chooser offers BG / OBJ / Affine / All';
});

await s.test('Auto-capture watching sprites turns on with a readout', async () => {
  await turnOn(page, ['obj']);
  await page.waitForTimeout(400);
  const status = await autoStatus();
  expect(await autoOn(), 'toggle did not turn on');
  expect(/Auto-capture · sprite · screen:/.test(status), `readout: ${status}`);
  // No pack loaded: nothing captured yet and no memory pools to name the screen.
  expect(/ 0 tile\(s\) captured/.test(status), `readout: ${status}`);
  return status;
});

await s.test('It stops on the first frame with a sprite tile nobody has captured, and outlines it', async () => {
  const stopped = await playUntilAutoStop(page);
  expect(stopped, 'never stopped — no uncaptured sprite tile appeared while playing');
  const hint = (await page.textContent('#capture-frame-hint')) || '';
  const stopVisible = await page.isVisible('#capture-dialog-stop');
  const outline = await highlightPixels();
  const running = await framesAdvanced(page, 800);
  expect(/new sprite tile\(s\) no captured frame shows yet/.test(hint), `dialog hint: ${hint.slice(0, 120)}`);
  expect(stopVisible, '"Stop auto-capture" is not offered');
  expect(outline > 0, 'no outline drawn around the new tiles');
  expect(running === 0, `game kept running while stopped (${running} frames)`);
  return `${outline} outline px · ${hint.slice(0, 70)}`;
});

let dismissedTiles = 0;
await s.test('Stopping from the dialog turns auto-capture off and captures nothing', async () => {
  dismissedTiles = Number(((await page.textContent('#capture-frame-hint')) || '').match(/(\d+) new sprite tile/)?.[1] || 0);
  const before = await frameCount();
  await page.click('#capture-dialog-stop');
  await page.waitForTimeout(700);
  const after = await frameCount();
  const running = await framesAdvanced(page, 1000);
  const outline = await highlightPixels();
  expect(!(await autoOn()), 'auto-capture still on after Stop');
  expect(after === before, `a frame was captured anyway (${before} → ${after})`);
  expect(running > 0, 'game did not resume');
  expect(outline === 0, 'outline left on screen');
  return `frames ${before} → ${after} · game running`;
});

await s.test('Capturing from an auto stop adds that frame and keeps the mode on', async () => {
  await turnOn(page, ['obj']);
  await page.waitForTimeout(300);
  const knownBefore = knownTiles(await autoStatus());
  // The tiles you declined are remembered, so the mode does not stop on them again.
  expect(knownBefore === dismissedTiles && dismissedTiles > 0, `re-enabled knowing ${knownBefore} tile(s); ${dismissedTiles} were declined`);
  const stopped = await playUntilAutoStop(page);
  expect(stopped, 'no second stop while playing');
  const before = await frameCount();
  await page.fill('#capture-state-name', 'Auto test');
  await page.click('#capture-dialog-ok');
  await page.waitForTimeout(1500);
  const after = await frameCount();
  const stillOn = await autoOn();
  const knownAfter = knownTiles(await autoStatus());
  // Once resumed, the game may reach another new tile within a second and stop
  // again — that is correct, and it also proves play resumed.
  const stoppedAgain = async () => !!(await page.$('#capture-frame-dialog.auto[open]'));
  const running = (await stoppedAgain()) ? 0 : await framesAdvanced(page, 1000);
  const resumed = running > 0 || (await stoppedAgain());
  // Turn it off so later steps are not interrupted (via the dialog if it is up).
  if (await stoppedAgain()) await page.click('#capture-dialog-stop');
  else if (await autoOn()) await page.click('#btn-auto-capture');
  expect(after >= before + 1, `frames ${before} → ${after}`);
  expect(stillOn, 'auto-capture turned itself off after a capture');
  expect(knownAfter > knownBefore, `captured-tile count did not grow (${knownBefore} → ${knownAfter})`);
  expect(resumed, 'game did not resume after capturing');
  return `frames ${before} → ${after} · sprite tiles known ${knownBefore} → ${knownAfter}`;
});

await s.test('With memory pools loaded, the readout names the screen', async () => {
  const p2 = await context.newPage();
  instrument(p2, { errors });
  await p2.goto(`${BASE}/`);
  await p2.setInputFiles('#pack-file-input', PACK_ANNOTATED);
  await p2.waitForFunction(() => !document.getElementById('btn-auto-capture')?.disabled, null, { timeout: 90000 });
  await p2.waitForTimeout(2500);
  await turnOn(p2, ['obj']);
  let status = '';
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    status = (await p2.textContent('#auto-capture-status')) || '';
    if (/screen: (?!unknown|no memory)/.test(status)) break;
    await p2.waitForTimeout(500);
  }
  const known = knownTiles(status);
  await p2.close();
  expect(/screen: (?!unknown|no memory)/.test(status), `readout never named a screen: ${status}`);
  expect(known > 0, `a pack with captured frames should start with sprite tiles known: ${status}`);
  return status;
});

await s.test('Watching scaled (affine) tiles as well counts them in the readout', async () => {
  const p3 = await context.newPage();
  instrument(p3, { errors });
  await p3.goto(`${BASE}/`);
  await p3.setInputFiles('#pack-file-input', PACK_ANNOTATED);
  await p3.waitForFunction(() => !document.getElementById('btn-auto-capture')?.disabled, null, { timeout: 90000 });
  await p3.waitForTimeout(1500);
  await turnOn(p3, ['obj']);
  await p3.waitForTimeout(400);
  const spritesOnly = knownTiles((await p3.textContent('#auto-capture-status')) || '');
  await p3.click('#btn-auto-capture'); // off
  await turnOn(p3, ['bg', 'obj', 'affine']);
  await p3.waitForTimeout(400);
  const status = (await p3.textContent('#auto-capture-status')) || '';
  const remembered = await p3.evaluate(() => localStorage.getItem('vb-auto-capture-kinds'));
  if (/true/.test(String(await p3.getAttribute('#btn-auto-capture', 'aria-pressed')))) await p3.click('#btn-auto-capture');
  await p3.close();
  expect(/Auto-capture · background, sprite and scaled · /.test(status), `readout: ${status}`);
  expect(knownTiles(status) > spritesOnly, `all kinds should know more tiles than sprites alone (${spritesOnly} → ${knownTiles(status)})`);
  expect(remembered === '["bg","obj","affine"]', `choice not remembered: ${remembered}`);
  return `${spritesOnly} sprite → ${knownTiles(status)} all kinds`;
});

await s.test('Watching only “Where paint doesn’t cover yet” stops on a frame with a paint gap, once', async () => {
  const p4 = await context.newPage();
  instrument(p4, { errors });
  await p4.goto(`${BASE}/`);
  await p4.setInputFiles('#pack-file-input', PACK_ANNOTATED);
  await p4.waitForFunction(() => !document.getElementById('btn-auto-capture')?.disabled, null, { timeout: 90000 });
  await p4.waitForTimeout(1500);
  await p4.click('#btn-auto-capture');
  await p4.waitForSelector('#auto-capture-kinds-dialog[open]', { timeout: 5000 });
  for (const k of ['bg', 'obj', 'affine']) await p4.setChecked(`#auto-kind-${k}`, false);
  await p4.setChecked('#auto-kind-gaps', false);
  const startOff = await p4.isDisabled('#auto-kinds-start');
  await p4.setChecked('#auto-kind-gaps', true);
  const startOn = !(await p4.isDisabled('#auto-kinds-start'));
  await p4.click('#auto-kinds-start');
  await p4.waitForTimeout(400);
  const status = (await p4.textContent('#auto-capture-status')) || '';
  const stopped = await playUntilAutoStop(p4);
  const gapOf = (text) => text.match(/paint doesn’t cover (.*?) — outlined/)?.[1] || '';
  const hint = stopped ? (await p4.textContent('#capture-frame-hint')) || '' : '';
  if (stopped) {
    await p4.fill('#capture-state-name', 'Gap test');
    await p4.click('#capture-dialog-ok');
  }
  // The same gap does not stop it again: either it runs on, or it stops on a different one.
  await p4.waitForTimeout(1200);
  const again = (await p4.$('#capture-frame-dialog.auto[open]')) ? (await p4.textContent('#capture-frame-hint')) || '' : '';
  if (again) await p4.click('#capture-dialog-stop');
  const remembered = await p4.evaluate(() => localStorage.getItem('vb-auto-capture-gaps'));
  await p4.evaluate(() => localStorage.removeItem('vb-auto-capture-gaps'));
  await p4.close();
  expect(startOff, 'Start enabled with nothing chosen');
  expect(startOn, 'Start stayed disabled with only paint gaps chosen');
  expect(/Auto-capture · paint gaps · /.test(status), `readout: ${status}`);
  expect(stopped, 'never stopped on a paint gap while playing');
  expect(/paint doesn’t cover .*(tile\(s\) with no paint|past its picture)/.test(hint), `dialog hint: ${hint.slice(0, 160)}`);
  expect(!again || gapOf(again) !== gapOf(hint) || /no paint/.test(gapOf(hint)), `stopped twice on the same gap: ${gapOf(hint)}`);
  expect(remembered === '1', `choice not remembered: ${remembered}`);
  return hint.slice(0, 110);
});

await s.test('No page errors during the auto-capture run', async () => {
  expect(errors.length === 0, errors.slice(0, 4).join(' | '));
});

s.summary();
await browser.close();
