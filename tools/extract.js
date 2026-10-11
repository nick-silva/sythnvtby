/**
 * Tools: tile extractor (load vbstate.json → tile manifest) and pack validator.
 */

import { extractTilesFromDump, exportTileManifest } from '../src/tile-extractor.js';
import { validatePack, coverageReport } from '../src/pack-validator.js';
import { validateVIPState } from '../src/vip-dump.js';
import { saveExportToHome } from '../src/project-home.js';

let lastManifest = null;

document.getElementById('dump-input')?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  const report = document.getElementById('extract-report');
  const btn = document.getElementById('btn-download-manifest');
  if (!report || !btn) return;
  lastManifest = null;
  report.textContent = '';
  btn.disabled = true;
  if (files.length === 0) {
    report.textContent = 'Select one or more vbstate.json files.';
    return;
  }
  try {
    const mergedTiles = new Map();
    let lastValidation = null;
    for (const file of files) {
      const text = await file.text();
      const obj = JSON.parse(text);
      const validation = validateVIPState(obj);
      lastValidation = validation;
      if (!validation.valid) {
        report.innerHTML = `Invalid vbstate (${file.name}): ${validation.errors.join('; ')}`;
        return;
      }
      const { tiles } = extractTilesFromDump(obj);
      for (const [hash, data] of tiles) {
        if (!mergedTiles.has(hash)) mergedTiles.set(hash, data);
      }
    }
    lastManifest = exportTileManifest(mergedTiles);
    let msg = `Extracted <strong>${mergedTiles.size}</strong> unique tiles from <strong>${files.length}</strong> file(s). Download the manifest below.`;
    if (lastValidation?.warnings?.length) {
      msg += ` <span class="warnings" title="${lastValidation.warnings.join(' ')}">⚠ ${lastValidation.warnings.length} warning(s)</span>`;
    }
    report.innerHTML = msg;
    btn.disabled = false;
  } catch (err) {
    report.textContent = 'Error: ' + (err.message || String(err));
  }
});

document.getElementById('btn-download-manifest')?.addEventListener('click', async () => {
  if (!lastManifest) return;
  const blob = new Blob([JSON.stringify(lastManifest, null, 2)], { type: 'application/json' });
  const wrote = await saveExportToHome(blob, 'tile-manifest.json');
  if (wrote) {
    const report = document.getElementById('extract-report');
    if (report) report.textContent = `Wrote ${wrote} to your project home folder.`;
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tile-manifest.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

let lastPackBuffer = null;
document.getElementById('pack-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  lastPackBuffer = await file.arrayBuffer();
  updateValidatorReport();
});

let lastValidatorDump = null;
document.getElementById('validator-dump')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    lastValidatorDump = JSON.parse(await file.text());
  } catch {
    lastValidatorDump = null;
  }
  updateValidatorReport();
});

function updateValidatorReport() {
  const report = document.getElementById('validator-report');
  if (!report) return;
  if (!lastPackBuffer) {
    report.textContent = 'Load a color pack to validate.';
    return;
  }
  const v = validatePack(lastPackBuffer);
  if (!v.valid) {
    report.innerHTML = `Invalid pack: ${v.error}`;
    return;
  }
  let html = `Pack valid. Game ID: <strong>${v.gameId}</strong>, entries: <strong>${v.entryCount}</strong>.`;
  if (lastValidatorDump) {
    const cov = coverageReport(lastPackBuffer, lastValidatorDump);
    html += ` Coverage vs dump: <strong>${cov.tilesCovered}/${cov.tilesInDump}</strong> tiles (<strong>${cov.coveragePercent}%</strong>).`;
  }
  report.innerHTML = html;
}
