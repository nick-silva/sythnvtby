import { readFile } from 'node:fs/promises';
import { parseArtPack } from '../../src/art-pack.js';
import {
  OUT, targets, launch, instrument, suite, expect, openPainter, selectFrame, marquee, clickVip, painterSave,
  selectGroup,
} from './harness.mjs';

const s = suite('3. Sprite poses');
const { browser, context } = await launch();
const page = await context.newPage();
const { errors, answers } = instrument(page);
const status = async () => (await page.textContent('#status')) || '';
const poseNames = () => page.$$eval('.pose-row .pose-name', (ns) => ns.map((n) => n.textContent));
const t = targets.flippedObj;

async function newPose({ target, groupName, poseName }) {
  await page.click('#btn-new-pose-from-selection');
  await page.waitForSelector('#new-pose-dialog[open]');
  const summary = (await page.textContent('#new-pose-summary')) || '';
  const suggested = await page.$eval('#new-pose-target', (s) => s.options[s.selectedIndex]?.textContent || '');
  if (target) await page.selectOption('#new-pose-target', target);
  if (groupName) await page.fill('#new-pose-group-name', groupName);
  if (poseName) await page.fill('#new-pose-name', poseName);
  await page.click('#new-pose-submit');
  await page.waitForTimeout(400);
  return { summary, suggested };
}

await openPainter(page);
await selectFrame(page, t.frame);

await s.test('Capture ignores BG tiles and reports how many it skipped', async () => {
  await page.selectOption('#layer-select', 'all');
  await page.waitForTimeout(300);
  await marquee(page, t.x - 12, t.y - 12, t.x + 12, t.y + 12);
  const r = await newPose({ target: '__new_sprite_group__', groupName: 'Reg Mario', poseName: 'Walk A' });
  expect(/ignored/.test(r.summary), `no skipped note: ${r.summary}`);
  expect((await poseNames()).includes('Walk A'), 'pose not listed');
  return r.summary;
});

await s.test('Second capture suggests the selected sprite group', async () => {
  await page.selectOption('#layer-select', '2');
  await marquee(page, t.x - 12, t.y - 12, t.x + 12, t.y + 12);
  const r = await newPose({ poseName: 'Walk B' });
  expect(r.suggested === 'Reg Mario', `suggested "${r.suggested}"`);
  expect((await poseNames()).join(',') === 'Walk A,Walk B', `poses ${await poseNames()}`);
});

await s.test('New pose’s group list: most recently used first, and typing filters it (no match offers a new group by that name)', async () => {
  await page.selectOption('#layer-select', '2');
  await marquee(page, t.x - 12, t.y - 12, t.x + 12, t.y + 12);
  await page.click('#btn-new-pose-from-selection');
  await page.waitForSelector('#new-pose-dialog[open]');
  const labels = () => page.$$eval('#new-pose-target option', (os) => os.map((o) => o.textContent || ''));
  const all = await labels();
  const focused = await page.evaluate(() => document.activeElement?.id);
  // Reg Mario just took a pose: it heads the list, whatever order the groups were made in.
  expect(all[0] === 'Reg Mario' && focused === 'new-pose-target-filter', `list ${all.slice(0, 4).join(' | ')} · focus ${focused}`);
  const other = all.find((l) => l !== 'Reg Mario' && !l.startsWith('+'));
  let narrowed = '';
  if (other) {
    const word = other.split(/[\s·]+/)[0].slice(0, 4);
    await page.type('#new-pose-target-filter', word);
    const shown = await labels();
    narrowed = `“${word}”: ${shown.length - 1} of ${all.length - 1}`;
    expect(shown.slice(0, -1).every((l) => l.toLowerCase().includes(word.toLowerCase())) && shown.length <= all.length, `filter ${word}: ${shown.join(' | ')}`);
    await page.fill('#new-pose-target-filter', '');
  }
  await page.type('#new-pose-target-filter', 'zzqq nothing');
  const none = await labels();
  const value = await page.inputValue('#new-pose-target');
  const name = await page.inputValue('#new-pose-group-name');
  expect(none.length === 1 && /New group “zzqq nothing”/.test(none[0]) && value === '__new_sprite_group__' && name === 'zzqq nothing' && (await page.isVisible('#new-pose-group-name')), `no match: ${none.join(' | ')} · ${value} · “${name}”`);
  await page.focus('#new-pose-target-filter');
  await page.keyboard.press('Escape');
  const cleared = await page.inputValue('#new-pose-target-filter');
  const stillOpen = await page.isVisible('#new-pose-dialog');
  expect(cleared === '' && stillOpen && (await labels()).length === all.length, `Esc: “${cleared}”, open ${stillOpen}`);
  await page.click('#new-pose-cancel');
  return `${all.length - 1} group(s), Reg Mario first · ${narrowed || 'one group only'}`;
});

await s.test('Edge warning appears for a sprite at the screen edge', async () => {
  const e = targets.edgeObj;
  await selectFrame(page, e.frame);
  await page.selectOption('#layer-select', '2');
  await clickVip(page, Math.min(e.x + 4, 383), Math.min(e.y + 4, 223));
  await page.click('#btn-new-pose-from-selection');
  await page.waitForSelector('#new-pose-dialog[open]');
  const visible = await page.isVisible('#new-pose-warning');
  await page.click('#new-pose-cancel');
  expect(visible, 'edge warning not shown');
});

await s.test('Pose list actions: Rename, Mirror OK, Select, Delete', async () => {
  await selectFrame(page, t.frame);
  await page.selectOption('#layer-select', '2');
  await selectGroup(page, 'Reg Mario');
  await page.waitForTimeout(300);
  answers.push('Walk A renamed');
  await page.click('.pose-row:first-child [data-pose-action="rename"]');
  await page.waitForTimeout(300);
  await page.click('.pose-row:first-child [data-pose-action="mirror"]');
  await page.waitForTimeout(300);
  const mirror = await page.isChecked('.pose-row:first-child [data-pose-action="mirror"]');
  await page.click('.pose-row:first-child [data-pose-action="select"]');
  await page.waitForTimeout(300);
  const selectMsg = await status();
  answers.push(true);
  await page.click('.pose-row:nth-child(2) [data-pose-action="delete"]');
  await page.waitForTimeout(300);
  const names = await poseNames();
  expect(names.join(',') === 'Walk A renamed', `poses ${names}`);
  expect(mirror === false, 'Mirror OK still checked');
  expect(/Selected \d+ draw/.test(selectMsg), selectMsg);
  return selectMsg;
});

await s.test('Set anchor: refused for multi-select, accepted for a unique tile', async () => {
  await marquee(page, t.x - 12, t.y - 12, t.x + 12, t.y + 12);
  await page.click('.pose-row:first-child [data-pose-action="anchor"]');
  await page.waitForTimeout(200);
  const multi = await status();
  const anchorBefore = ((await page.textContent('.pose-row:first-child .pose-row-main')) || '').replace(/\s+/g, ' ');
  let accepted = null;
  const refusals = new Set();
  for (let dy = -8; dy <= 8 && !accepted; dy += 8) {
    for (let dx = -8; dx <= 8 && !accepted; dx += 8) {
      await clickVip(page, t.x + 4 + dx, t.y + 4 + dy);
      const hint = (await page.textContent('#tile-selection-hint')) || '';
      if (!/^\s*1 tile/.test(hint)) continue;
      await page.click('.pose-row:first-child [data-pose-action="anchor"]');
      await page.waitForTimeout(200);
      const msg = await status();
      if (/Anchor for/.test(msg)) accepted = msg;
      else refusals.add(msg.slice(0, 60));
    }
  }
  const anchorAfter = ((await page.textContent('.pose-row:first-child .pose-row-main')) || '').replace(/\s+/g, ' ');
  expect(/exactly one tile/.test(multi), `multi-select message: ${multi}`);
  expect(accepted, `no tile accepted; refusals: ${[...refusals].join(' | ')}`);
  return `${anchorBefore} → ${anchorAfter}`;
});

await s.test('Save and reopen keeps poses, flip flag, source frame, and schema v3', async () => {
  const path = `${OUT}/s3-poses.vbpack`;
  await painterSave(page, path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const g = saved.groups.find((x) => x.name === 'Reg Mario');
  const pose = g?.poses?.[0];
  expect(saved.groupsSchemaVersion === 3, `schema ${saved.groupsSchemaVersion}`);
  expect(pose?.name === 'Walk A renamed' && pose.allowFlipMacro === false, `pose ${JSON.stringify(pose)?.slice(0, 120)}`);
  expect(pose.anchorFlipH === true, `anchorFlipH ${pose.anchorFlipH}`);
  expect(pose.sourceFrameId === t.frameId, `sourceFrameId ${pose.sourceFrameId} vs ${t.frameId}`);
  await openPainter(page, path);
  await selectGroup(page, 'Reg Mario');
  await page.waitForTimeout(300);
  expect((await poseNames()).join(',') === 'Walk A renamed', `after reopen: ${await poseNames()}`);
  return `tiles=${pose.tiles.length} anchor=#${pose.anchorHash.toString(16)}`;
});

await s.test('A pose captured on the Current frame is saved with a frame that is in the pack', async () => {
  // The Current (Colorize!) frame has no registry row and the next Colorize! replaces it, so
  // Save has to point the pose at a saved frame showing it, or save Current as a frame.
  await openPainter(page);
  await selectFrame(page, 'Current');
  await page.selectOption('#layer-select', '2');
  await page.waitForTimeout(300);
  await marquee(page);
  await newPose({ target: '__new_sprite_group__', groupName: 'Reg Current', poseName: 'On Current' });
  expect((await poseNames()).includes('On Current'), `pose not listed: ${await poseNames()}`);

  const path = `${OUT}/s3-pose-on-current.vbpack`;
  await painterSave(page, path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const pose = saved.groups.find((x) => x.name === 'Reg Current')?.poses?.[0];
  const frameId = pose?.sourceFrameId;
  expect(typeof frameId === 'string' && frameId.length > 0, `pose saved without a source frame: ${JSON.stringify(pose)?.slice(0, 120)}`);
  const entry = (saved.manifest?.frameRegistry || []).find((e) => e.frameId === frameId);
  expect(entry, `source frame ${frameId} has no registry row`);
  const file = String(entry.vipStateFile || '').replace(/^vipstates\//, '');
  expect(saved.vipStatesFolder.some((f) => f.name === file), `registry row points at missing ${entry.vipStateFile}`);
  return `${frameId} (${entry.stateName === 'Current (Colorize!)' ? 'Current saved as a frame' : `existing frame "${entry.stateName}"`})`;
});

await s.test('A background selection becomes a background pose in a new background group, and saves', async () => {
  await openPainter(page);
  await selectFrame(page, t.frame);
  await page.selectOption('#layer-select', '0');
  await page.waitForTimeout(300);
  await marquee(page, 96, 56, 200, 120);
  await page.click('#btn-new-pose-from-selection');
  await page.waitForSelector('#new-pose-dialog[open]');
  const title = (await page.textContent('#new-pose-dialog-title')) || '';
  const summary = (await page.textContent('#new-pose-summary')) || '';
  const options = await page.$$eval('#new-pose-target option', (os) => os.map((o) => o.textContent || ''));
  const warned = await page.isVisible('#new-pose-warning');
  // No background group used yet in this browser: they are in name order. Using one (selecting it
  // in the tree) moves it to the top; typing narrows the list to it.
  // (The ordering itself is unit-tested in src/group-search.test.js; this pack may have one group.)
  const names = options.slice(0, -1).map((l) => l.split(' · ')[0]);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  expect(names.length >= 1 && names.join('|') === sorted.join('|'), `background groups not in name order: ${names.join(' | ')}`);
  const last = names[names.length - 1];
  if (names.length >= 2) {
    await page.click('#new-pose-cancel');
    await selectGroup(page, last);
    await page.selectOption('#layer-select', '0');
    await page.waitForTimeout(300);
    await marquee(page, 96, 56, 200, 120);
    await page.click('#btn-new-pose-from-selection');
    await page.waitForSelector('#new-pose-dialog[open]');
    const reordered = await page.$$eval('#new-pose-target option', (os) => os.map((o) => (o.textContent || '').split(' · ')[0]));
    expect(reordered[0] === last, `“${last}” was just used but the list starts ${reordered.slice(0, 3).join(' | ')}`);
  }
  await page.type('#new-pose-target-filter', last.slice(0, Math.max(3, Math.ceil(last.length / 2))));
  const typed = await page.$$eval('#new-pose-target option', (os) => os.map((o) => (o.textContent || '').split(' · ')[0]));
  expect(typed[0] === last && (await page.inputValue('#new-pose-target')) !== '__new_sprite_group__', `typing part of “${last}” kept ${typed.join(' | ')}`);
  await page.fill('#new-pose-target-filter', '');
  await page.selectOption('#new-pose-target', '__new_sprite_group__');
  await page.fill('#new-pose-group-name', 'BG Poses');
  await page.fill('#new-pose-name', 'Screen A');
  await page.click('#new-pose-submit');
  await page.waitForTimeout(400);
  const head = (await page.textContent('#group-pose-section .pose-section-head')) || '';
  expect(/background pose/i.test(title), `dialog title: ${title}`);
  expect(/background tile\(s\) captured/.test(summary), `summary: ${summary}`);
  expect(options.includes('+ New background group…') && !options.includes('+ New sprite group…'), `targets: ${options}`);
  expect(!warned, 'the screen-edge warning showed for a background pose');
  expect((await poseNames()).includes('Screen A'), `pose not listed: ${await poseNames()}`);
  expect(/^Poses/.test(head.trim()), `pose section head: ${head}`);

  const path = `${OUT}/s3-bg-pose.vbpack`;
  await painterSave(page, path);
  const saved = await parseArtPack((await readFile(path)).buffer);
  const g = saved.groups.find((x) => x.name === 'BG Poses');
  const pose = g?.poses?.[0];
  expect(g?.authoringKind === 'bg' && g.criteria?.layers?.includes(0), `group: ${JSON.stringify(g)?.slice(0, 160)}`);
  expect(pose?.name === 'Screen A' && pose.tiles.every((tile) => Number.isFinite(tile.dx)), `pose: ${JSON.stringify(pose)?.slice(0, 160)}`);
  expect(g.criteria.hashes.length > 0, 'the pose did not add its tiles to the group');
  return `${pose.tiles.length} tile(s) · ${g.criteria.hashes.length} hash(es)`;
});

await s.test('No page errors during the poses run', async () => {
  expect(errors.length === 0, errors.slice(0, 4).join(' | '));
});

s.summary();
await browser.close();
