import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArtPack } from '../../src/art-pack.js';
import {
  OUT, BASE, REPO_ROOT, PACK_PLAIN, PACK_ANNOTATED, launch, instrument, suite, expect, openPainter, painterSave, framesAdvanced,
  captureDownload,
} from './harness.mjs';

const s = suite('5. Old packs and other pages');
const { browser, context } = await launch();
const errors = [];
const newPage = async () => {
  const p = await context.newPage();
  instrument(p, { errors });
  return p;
};

await s.test('Old pack (no groups, no poses) saved from the painter stays pose-free', async () => {
  const page = await newPage();
  await openPainter(page, PACK_PLAIN);
  const path = `${OUT}/s5-plain-resaved.vbpack`;
  await painterSave(page, path);
  await page.close();
  const orig = await parseArtPack((await readFile(PACK_PLAIN)).buffer);
  const saved = await parseArtPack((await readFile(path)).buffer);
  expect(!(saved.groups || []).some((g) => Array.isArray(g.poses)), 'poses appeared');
  expect(saved.groupsSchemaVersion !== 3, `schema bumped to ${saved.groupsSchemaVersion}`);
  expect((saved.vipStatesFolder || []).length === (orig.vipStatesFolder || []).length, 'frames lost');
  return `schema ${orig.groupsSchemaVersion ?? 'none'} → ${saved.groupsSchemaVersion ?? 'none'}, pools ${orig.gameStatePools.length} → ${saved.gameStatePools.length}`;
});

for (const [label, path] of [
  ['re-saved old pack', `${OUT}/s5-plain-resaved.vbpack`],
  ['pack with poses', `${OUT}/s3-poses.vbpack`],
]) {
  await s.test(`Emulator plays the ${label}`, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/`);
    await page.setInputFiles('#pack-file-input', path);
    await page.waitForFunction(() => !document.getElementById('btn-colorize')?.disabled, null, { timeout: 90000 });
    await page.waitForTimeout(2500);
    const n = await framesAdvanced(page);
    await page.close();
    expect(n > 30, `not running (${n})`);
  });
}

await s.test('Tools page: card titles left, Open → right', async () => {
  const page = await newPage();
  await page.goto(`${BASE}/tools/`);
  await page.waitForTimeout(1000);
  const bad = await page.$$eval('.tool', (tools) =>
    tools.filter((t) => {
      const title = t.querySelector('.tool-title').getBoundingClientRect();
      const go = t.querySelector('.tool-go').getBoundingClientRect();
      return !(go.left > title.left);
    }).length,
  );
  await page.close();
  expect(bad === 0, `${bad} cards misaligned`);
});

await s.test('Tile extractor reads a VIP dump and downloads a manifest', async () => {
  const page = await newPage();
  await page.goto(`${BASE}/tools/`);
  await page.setInputFiles('#dump-input', `${OUT}/vbstate-sample.json`);
  await page.waitForTimeout(1200);
  const report = ((await page.textContent('#extract-report')) || '').trim();
  const name = await captureDownload(page, () => page.click('#btn-download-manifest'), `${OUT}/s5-manifest.json`);
  await page.close();
  expect(report.length > 0, 'empty report');
  return `${report.slice(0, 70)} · downloaded ${name}`;
});

await s.test('Pack validator checks a .vbcolor pack against a VIP dump', async () => {
  const saved = await parseArtPack((await readFile(`${OUT}/s2-painter-saved.vbpack`)).buffer);
  expect(saved.vbcolor?.byteLength > 0, 'no vbcolor to validate');
  await writeFile(`${OUT}/s5-pack.vbcolor`, Buffer.from(saved.vbcolor));
  const page = await newPage();
  await page.goto(`${BASE}/tools/`);
  await page.setInputFiles('#pack-input', `${OUT}/s5-pack.vbcolor`);
  await page.setInputFiles('#validator-dump', `${OUT}/vbstate-sample.json`);
  await page.waitForTimeout(1200);
  const report = ((await page.textContent('#validator-report')) || '').trim();
  await page.close();
  expect(report.length > 0, 'empty report');
  return report.slice(0, 90);
});

await s.test('Project tool runs the memory analysis into the pack it has open', async () => {
  const page = await newPage();
  await openPainter(page, PACK_PLAIN);
  await page.click('#project-menu > summary');
  await page.waitForTimeout(200);
  expect(!(await page.isDisabled('#file-menu-analyze-memory')), 'Analyze memory is disabled for a pack with captured frames');
  await page.click('#file-menu-analyze-memory');
  await page.waitForFunction(
    () => /Memory analysis (complete|failed)/i.test(document.getElementById('status')?.textContent || ''),
    null,
    { timeout: 180000 },
  );
  const status = (await page.textContent('#status')) || '';
  const path = `${OUT}/s5-memory-analyzed.vbpack`;
  await painterSave(page, path);
  await page.close();

  const saved = await parseArtPack((await readFile(path)).buffer);
  const states = Object.keys(saved.manifest?.memoryAnalysis?.topCandidatesByState || {});
  const pools = saved.gameStatePools || [];
  const withConditions = pools.filter((p) => (p?.variants?.[0]?.ramConditions || []).length > 0);
  expect(/complete/i.test(status), status.slice(0, 120));
  expect(states.length > 0, 'manifest.memoryAnalysis has no states');
  expect(withConditions.length > 0, `${pools.length} pools saved, none with ramConditions`);
  return `${states.length} state(s) analyzed · ${withConditions.length}/${pools.length} pools with a fingerprint`;
});

await s.test('Memory analysis loads a pack and runs the analyzer', async () => {
  const page = await newPage();
  await page.goto(`${BASE}/tools/memory-analysis.html`);
  await page.setInputFiles('#vbpack-input', PACK_ANNOTATED);
  await page.waitForTimeout(3000);
  const frames = await page.$$eval('#frame-list > *', (els) => els.length);
  const enabled = !(await page.isDisabled('#btn-run-analysis'));
  if (enabled) {
    await page.click('#btn-run-analysis');
    await page.waitForTimeout(6000);
  }
  const st = ((await page.textContent('#analysis-status')) || '').trim();
  await page.close();
  expect(frames > 0, 'no frames listed');
  return `${frames} frames listed · ${st.slice(0, 80)}`;
});

await s.test('Frame viewer loads a VIP dump', async () => {
  const page = await newPage();
  await page.goto(`${BASE}/tools/viewer.html`);
  await page.setInputFiles('#file-input', `${OUT}/vbstate-sample.json`);
  await page.waitForTimeout(1500);
  const drawn = await page.evaluate(() => {
    for (const c of document.querySelectorAll('canvas')) {
      try {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 40) return true;
      } catch (_) {}
    }
    return false;
  });
  await page.screenshot({ path: `${OUT}/s5-viewer.png` });
  await page.close();
  expect(drawn, 'no canvas content drawn');
});

await s.test('Narrow window (900px): no sideways overflow, painter controls reachable, compact world grid', async () => {
  const page = await newPage();
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/s5-narrow-emulator.png` });
  const emuOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto(`${BASE}/tools/project.html`);
  await page.setInputFiles('#file-vbpack', PACK_ANNOTATED);
  await page.waitForFunction(() => document.querySelectorAll('#frame-select option').length > 0, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/s5-narrow-painter.png`, fullPage: true });
  const painter = await page.evaluate(() => {
    const right = (id) => document.getElementById(id).getBoundingClientRect().right;
    const worldBtn = document.querySelector('#world-grid button:not(.all)');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      brightnessRight: right('preview-brightness'),
      reloadRight: right('btn-reload'),
      worldButtonHeight: worldBtn ? worldBtn.getBoundingClientRect().height : 0,
    };
  });
  await page.close();
  expect(emuOverflow <= 1, `emulator overflows sideways by ${emuOverflow}px`);
  expect(painter.overflow <= 1, `painter overflows sideways by ${painter.overflow}px`);
  expect(painter.brightnessRight <= 900 && painter.reloadRight <= 900, `controls off-screen: brightness ${painter.brightnessRight}, reload ${painter.reloadRight}`);
  expect(painter.worldButtonHeight < 60, `world grid buttons ${painter.worldButtonHeight}px tall`);
  return `world button ${Math.round(painter.worldButtonHeight)}px`;
});

await s.test('The old painter.html URL forwards to project.html, query string intact', async () => {
  const page = await newPage();
  await page.goto(`${BASE}/tools/painter.html?from=test#frame`);
  await page.waitForURL(/\/tools\/project\.html/, { timeout: 15000 });
  const url = page.url();
  const title = await page.title();
  await page.close();
  expect(url.endsWith('/tools/project.html?from=test#frame'), `landed on ${url}`);
  expect(/Project tool/.test(title), `title: ${title}`);
  return url.replace(BASE, '');
});

await s.test('Every internal link on the emulator and tool pages resolves', async () => {
  // The dev server answers unknown paths with the emulator's index.html and a 200,
  // so a status check would pass broken links. Check the file exists instead.
  const fileFor = (pathname) => {
    const rel = decodeURIComponent(pathname).replace(/^\//, '');
    const candidates = rel === '' || rel.endsWith('/') ? [`${rel}index.html`] : [rel];
    for (const c of candidates) {
      for (const root of [REPO_ROOT, resolve(REPO_ROOT, 'public')]) {
        if (existsSync(resolve(root, c))) return resolve(root, c);
      }
    }
    return null;
  };
  const pages = ['/', '/tools/', '/tools/project.html', '/tools/sprite-studio.html', '/tools/memory-analysis.html'];
  const page = await newPage();
  const checked = new Map();
  for (const path of pages) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(300);
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
    for (const href of hrefs) {
      const u = new URL(href);
      if (u.origin !== new URL(BASE).origin || checked.has(u.pathname)) continue;
      checked.set(u.pathname, { file: fileFor(u.pathname), from: path });
    }
  }
  await page.close();
  const broken = [...checked].filter(([, v]) => !v.file);
  expect(broken.length === 0, broken.map(([p, v]) => `${p} (linked from ${v.from})`).join(' | '));
  expect(!checked.has('/tools/painter.html'), `a page still links to the old painter.html: ${checked.get('/tools/painter.html')?.from}`);
  return `${checked.size} distinct internal link(s) across ${pages.length} pages, all present on disk`;
});

await s.test('No page errors on these pages', async () => {
  expect(errors.length === 0, errors.slice(0, 4).join(' | '));
});

s.summary();
await browser.close();
