/**
 * The authoring tools on the synthetic fixture pack (tests/fixtures/fixture-pack.mjs): needs no ROM
 * and no local project, so it runs anywhere — CI included (`npm run test:e2e -- s0`). The Project
 * tool opens the pack, draws the frames with their screen limit and game state, selects a group
 * and saves; SpriteStudio opens the same pack and shows the sprite's pose.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { BASE, OUT, launch, instrument, suite, expect, repoModule, openPainter, selectGroup, fullClient, colorAtClient, painterSave, waitUntil } from './harness.mjs';

const { buildFixturePack, FIXTURE } = await import(repoModule('tests/fixtures/fixture-pack.mjs'));
const { parseArtPack } = await import(repoModule('src/art-pack.js'));

const s = suite('0. Fixture pack (no ROM)');
const PACK = `${OUT}/s0-fixture.vbpack`;
await writeFile(PACK, await buildFixturePack());
const { browser, context } = await launch();
const page = await context.newPage();
const { errors } = instrument(page);

/** Show the frame with this registry number (#1, #2, #3) in the Project tool's frame list. */
async function showFrame(number) {
  const id = FIXTURE.frames[number - 1].id;
  const value = await page.$$eval('#frame-select option', (os, [n, fid]) => os.find((o) => o.textContent.includes(fid) || o.textContent.startsWith(`#${n} `) || o.textContent.includes(`#${n} ·`))?.value, [number, id]);
  if (value == null) throw new Error(`frame #${number} not in the list`);
  await page.selectOption('#frame-select', value);
  await waitUntil(page, (v) => document.getElementById('frame-select').value === v, value, { what: `frame #${number}` });
  await page.waitForTimeout(400); // the canvas redraws after the frame loads
}

/** The Project tool's canvas colour at a frame pixel. */
async function colourAt(vx, vy) {
  const [cx, cy] = await fullClient(page, vx, vy);
  return colorAtClient(page, cx, cy);
}
const signPixel = [FIXTURE.sign.x + 4, FIXTURE.sign.y + 4];
/** The hero's right tile: yellow when painted; unpainted tiles preview in shades of red. */
const heroRightPixel = (frame) => [FIXTURE.hero[frame - 1].x + 12, FIXTURE.hero[frame - 1].y + 4];

await s.test('The Project tool opens the fixture pack: three numbered frames', async () => {
  await openPainter(page, PACK);
  const options = await page.$$eval('#frame-select option', (os) => os.map((o) => o.textContent));
  expect(options.length >= 3, `frames: ${options.join(' | ')}`);
  return options.slice(0, 3).join(' | ');
});

await s.test('The sign is green on the Title screen and left out on the Play screen (screen limit)', async () => {
  await showFrame(1);
  const title = await colourAt(...signPixel);
  expect(title[1] > title[0] && title[1] > title[2], `Title: ${title}`);
  await showFrame(3);
  const play = await colourAt(...signPixel);
  expect(!(play[1] > play[0]), `Play: ${play}`);
  return `Title ${title.slice(0, 3)} · Play ${play.slice(0, 3)}`;
});

await s.test('The hero takes its colour only while its game state holds', async () => {
  await showFrame(1);
  const on = await colourAt(...heroRightPixel(1));
  await showFrame(2);
  const off = await colourAt(...heroRightPixel(2));
  expect(on[0] > 100 && on[1] > 100, `state on: ${on}`);
  expect(off[1] < 40, `state off: ${off}`);
  return `on ${on.slice(0, 3)} · off ${off.slice(0, 3)}`;
});

await s.test('Selecting the Sign group selects its 32 tiles', async () => {
  await showFrame(1);
  await selectGroup(page, 'Sign');
  const status = (await page.textContent('#status')) || '';
  expect(/32 tile/.test(status), `status: ${status.slice(0, 160)}`);
  return status.slice(0, 80);
});

await s.test('Save writes a pack that keeps every frame, group, screen limit and condition', async () => {
  const saved = `${OUT}/s0-saved.vbpack`;
  await painterSave(page, saved);
  const parsed = await parseArtPack((await readFile(saved)).buffer);
  const frames = parsed.vipStatesFolder?.length ?? 0;
  const byName = Object.fromEntries((parsed.groups || []).map((g) => [g.name, g]));
  expect(frames === 3, `frames: ${frames}`);
  expect(byName.Sign?.screens?.pools?.includes('pool-title'), `Sign screens: ${JSON.stringify(byName.Sign?.screens)}`);
  expect(byName.Hero?.conditions?.[0]?.state === 'hero-red', `Hero conditions: ${JSON.stringify(byName.Hero?.conditions)}`);
  expect(byName.Hero?.poses?.[0]?.name === 'Stand', 'Hero lost its pose');
  return `${frames} frames · ${Object.keys(byName).join(', ')}`;
});

await s.test('SpriteStudio opens the pack and shows the Hero sprite with its Stand pose', async () => {
  await page.goto(`${BASE}/tools/sprite-studio.html`);
  await page.setInputFiles('#file-input', PACK);
  await waitUntil(page, () => [...document.querySelectorAll('.sprite-row')].some((r) => r.textContent.includes('Hero')), null, { timeout: 30000, what: 'the Hero row' });
  await page.locator('.sprite-row').filter({ hasText: 'Hero' }).first().click();
  await waitUntil(page, () => document.querySelectorAll('.pose-card').length > 0, null, { what: 'pose cards' });
  const labels = await page.$$eval('.pose-card', (cs) => cs.map((c) => c.textContent.trim()));
  expect(labels.some((l) => l.includes('Stand')), `cards: ${labels.join(' | ')}`);
  return labels.join(' | ');
});

await s.test('No page errors on the fixture pack', async () => {
  expect(errors.length === 0, errors.join(' | '));
});

s.summary();
await browser.close();
