/**
 * sythnvtby Player (player.html): a play pack exported from a project, the ROM check, playing in
 * colour, F9 to monochrome, Side-by-side, and the warning for a ROM the pack was not made for.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { BASE, OUT, ROM, PACK_ANNOTATED, launch, instrument, suite, expect, repoModule } from './harness.mjs';

const { parseArtPack, artPackPartsFromParsed } = await import(repoModule('src/art-pack.js'));
const { buildPlayPack } = await import(repoModule('src/play-pack.js'));

const s = suite('8. Player');
const { browser, context } = await launch();
const page = await context.newPage();
const { errors } = instrument(page);
const PLAY = `${OUT}/s8-game.vbcplay`;
const WRONG = `${OUT}/s8-wrong-rom.vbcplay`;
const msg = () => page.textContent('#splash-msg');

await s.test('A project exports to a small play pack without the ROM or captures', async () => {
  const projectBytes = await readFile(PACK_ANNOTATED);
  const parts = artPackPartsFromParsed(await parseArtPack(projectBytes.buffer));
  const { bytes, info } = await buildPlayPack(parts, { title: 'Test game' });
  await writeFile(PLAY, bytes);
  // The same colours, claimed for another ROM.
  const { rom: _rom, ...noRom } = parts;
  const wrong = await buildPlayPack({ ...noRom, manifest: { ...parts.manifest, romSha1: '0'.repeat(40), romFileName: 'Another game.vb' } }, { title: 'Wrong' });
  await writeFile(WRONG, wrong.bytes);
  expect(bytes.length < projectBytes.length / 5, `play pack ${bytes.length} B vs project ${projectBytes.length} B`);
  expect(/^[0-9a-f]{40}$/.test(info.rom.sha1), 'no ROM SHA-1');
  return `${Math.round(bytes.length / 1024)} KB from ${Math.round(projectBytes.length / 1024)} KB · ${info.features.join(', ')}`;
});

await s.test('The player asks for the ROM and pack, checks they belong together, and offers Play', async () => {
  await page.goto(`${BASE}/player.html`);
  await page.waitForTimeout(600);
  expect(/ROM and its play pack/.test(await msg()), `start: ${await msg()}`);
  await page.setInputFiles('#pack-input', PLAY);
  await page.waitForTimeout(600);
  expect(/Now choose the ROM for Test game/.test(await msg()), `after pack: ${await msg()}`);
  await page.setInputFiles('#rom-input', ROM);
  await page.waitForFunction(() => /Ready/.test(document.getElementById('splash-msg').textContent), null, { timeout: 10000 });
  const play = await page.$$eval('#splash-actions button', (b) => b.map((x) => x.textContent));
  expect(play.includes('Play Test game'), `buttons: ${play}`);
  return play.join(', ');
});

await s.test('Play runs the game in colour; F9 switches to monochrome; Side-by-side asks the core for both eyes', async () => {
  await page.click('#splash-actions button.primary');
  await page.waitForFunction(() => !document.getElementById('btn-pause').disabled, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  expect(await page.$eval('#splash', (e) => e.classList.contains('hidden')), 'splash still shown');
  expect(await page.$eval('.color-output', (c) => c.style.display === 'block'), 'colour canvas hidden');
  await page.keyboard.press('F9');
  await page.waitForTimeout(300);
  expect((await page.textContent('#btn-colour')) === 'Monochrome', 'F9 did not switch to monochrome');
  expect(await page.$eval('.color-output', (c) => c.style.display === 'none'), 'colour still shown in monochrome');
  await page.keyboard.press('F9');
  await page.selectOption('#view-select', 'sidebyside');
  await page.waitForTimeout(800);
  const mode = await page.evaluate(() => (String(window.EJS_emulator.gameManager.getCoreOptions()).split('\n').find((l) => l.startsWith('vb_3dmode|')) || '').split(';')[0]);
  expect(/side-by-side/.test(mode), `core: ${mode}`);
  const size = await page.$eval('.color-output', (c) => [c.width, c.height]);
  expect(size[0] === 768 && size[1] === 224, `colour canvas ${size}`);
  return `${mode} · colour ${size.join('×')}`;
});

await s.test('A ROM the pack was not made for gets a warning and Play anyway; the last game is remembered', async () => {
  const p2 = await context.newPage();
  instrument(p2, { errors });
  await p2.goto(`${BASE}/player.html`);
  await p2.waitForTimeout(1500);
  // Remembered from the run above (same browser profile).
  const remembered = await p2.textContent('#splash-msg');
  expect(/Ready: Test game/.test(remembered), `not remembered: ${remembered}`);
  await p2.setInputFiles('#pack-input', WRONG);
  await p2.waitForTimeout(800);
  const warn = await p2.textContent('#splash-msg');
  expect(/not the ROM Wrong was made for, made for Another game\.vb/.test(warn), `warning: ${warn}`);
  const buttons = await p2.$$eval('#splash-actions button', (b) => b.map((x) => x.textContent));
  expect(buttons.includes('Play anyway'), `buttons: ${buttons}`);
  await p2.close();
  return warn;
});

await s.test('No page errors during the player run', async () => {
  expect(errors.length === 0, errors.join(' | '));
});

s.summary();
await browser.close();
