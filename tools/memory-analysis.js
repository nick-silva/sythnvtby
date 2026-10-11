/**
 * Browse vbpack frameRegistry + screenshots (grouped by stateName).
 */
import JSZip from 'jszip';
import { runInBrowserWramAnalysis, buildMemoryAnalysisManifest } from './memory-analysis-inbrowser.js';
import { PACK_ZIP_COMPRESSION } from '../src/art-pack.js';

const WRAM_SIZE = 0x10000;

const vbpackInput = document.getElementById('vbpack-input');
const frameListEl = document.getElementById('frame-list');
const previewImg = document.getElementById('preview-img');
const previewPlaceholder = document.getElementById('preview-placeholder');
const previewMeta = document.getElementById('preview-meta');
const statusEl = document.getElementById('status');
const vbpackLoadedNameEl = document.getElementById('vbpack-loaded-name');
const btnDlPack = document.getElementById('btn-dl-pack');
const analysisUi = document.getElementById('analysis-ui');
const btnRunAnalysis = document.getElementById('btn-run-analysis');
const btnAcceptAnalysis = document.getElementById('btn-accept-analysis');
const btnDownloadAnnotated = document.getElementById('btn-download-annotated');
const analysisStatusEl = document.getElementById('analysis-status');
const analysisWarningsEl = document.getElementById('analysis-warnings');
const analysisSummaryEl = document.getElementById('analysis-summary');

let currentZip = null;
let currentBuffer = null;
let currentName = 'pack.vbpack';
let currentFrameRegistry = null;
let lastPreviewUrl = null;
let latestAnalysis = null;
let latestAnnotatedBlob = null;
let latestAnnotatedName = null;

function stemFromRegistry(entry) {
  const ref = entry.vipStateFile || '';
  const base = ref.replace(/^vipstates\//i, '').replace(/\.json$/i, '');
  return entry.frameId || base || 'unknown';
}

function stateGroupKey(ent) {
  const s = (ent.stateName || '').trim();
  return s || '(unnamed)';
}

/** Case-insensitive JSZip member lookup (path separators normalized). */
function findZipFile(zip, preferredPath) {
  const n = preferredPath.replace(/\\/g, '/');
  const direct = zip.file(n);
  if (direct) return direct;
  const low = n.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    if (name.replace(/\\/g, '/').toLowerCase() === low) return zip.file(name);
  }
  return null;
}

vbpackInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  // Clear value so the same path can be chosen again later; the input then shows "No file chosen"
  // even though we loaded — see #vbpack-loaded-name for the real filename.
  e.target.value = '';
  currentName = file.name || 'pack.vbpack';
  if (vbpackLoadedNameEl) vbpackLoadedNameEl.textContent = `File: ${currentName}`;
  currentBuffer = await file.arrayBuffer();
  currentZip = await JSZip.loadAsync(currentBuffer);
  latestAnalysis = null;
  latestAnnotatedBlob = null;
  latestAnnotatedName = null;
  if (analysisUi) analysisUi.style.display = 'none';
  let manifest = {};
  try {
    const raw = await currentZip.file('manifest.json')?.async('string');
    if (raw) manifest = JSON.parse(raw);
  } catch (_) {
    manifest = {};
  }
  const registry = Array.isArray(manifest.frameRegistry) ? manifest.frameRegistry : null;
  currentFrameRegistry = registry;
  const vipFiles = currentZip.filter((p) => /^vipstates\/[^/]+\.json$/i.test(p));

  statusEl.textContent = registry
    ? `Loaded ${currentName}: frameRegistry ${registry.length} entr${registry.length === 1 ? 'y' : 'ies'}; vipstates/: ${vipFiles.length} file(s).`
    : `Loaded ${currentName}: no frameRegistry — listing ${vipFiles.length} vip/state JSON(s) only.`;
  btnDlPack.disabled = false;
  if (analysisUi) {
    analysisUi.style.display = '';
    btnRunAnalysis.disabled = !(registry && registry.length > 0);
    btnAcceptAnalysis.disabled = true;
    btnDownloadAnnotated.disabled = true;
    if (analysisStatusEl) analysisStatusEl.textContent = 'Load a vbpack to enable analysis.';
    if (analysisSummaryEl) analysisSummaryEl.textContent = '';
  }

  const entries = [];
  if (registry && registry.length > 0) {
    for (const ent of registry) entries.push({ type: 'registry', ent });
  } else {
    for (const f of vipFiles) {
      const name = (f.name || '').replace(/^vipstates\//i, '');
      entries.push({ type: 'viponly', name });
    }
  }

  frameListEl.innerHTML = '';
  previewImg.style.display = 'none';
  previewPlaceholder.style.display = '';
  previewMeta.textContent = '';

  let firstSelectBtn = null;

  if (registry && registry.length > 0) {
    /** @type {Map<string, typeof entries>} */
    const byState = new Map();
    for (const item of entries) {
      if (item.type !== 'registry') continue;
      const key = stateGroupKey(item.ent);
      if (!byState.has(key)) byState.set(key, []);
      byState.get(key).push(item);
    }
    const sortedKeys = [...byState.keys()].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    for (const stateName of sortedKeys) {
      const group = byState.get(stateName) || [];
      const det = document.createElement('details');
      det.className = 'frame-state-group';
      det.open = true;
      const sum = document.createElement('summary');
      const lowConf = group.length < 2 ? ' ⚠ low confidence (need ≥2 frames)' : '';
      sum.textContent = `${stateName} (${group.length} frame${group.length === 1 ? '' : 's'})${lowConf}`;
      det.appendChild(sum);
      const inner = document.createElement('div');
      inner.className = 'frame-group-children';
      for (const item of group) {
        const e = item.ent;
        const btn = document.createElement('button');
        const labelParts = [];
        if ((e.subStateName || '').trim()) labelParts.push(e.subStateName.trim());
        labelParts.push(e.frameId || stemFromRegistry(e));
        if ((e.note || '').trim()) {
          const n = e.note.trim();
          labelParts.push(n.length > 48 ? `${n.slice(0, 48)}…` : n);
        }
        btn.textContent = labelParts.join(' · ');
        btn.title = [e.subStateName, e.note].filter(Boolean).join('\n') || e.frameId || '';
        btn.type = 'button';
        btn.setAttribute('data-frame-select', '1');
        btn.addEventListener('click', () => selectFrame(item, btn));
        inner.appendChild(btn);
        if (!firstSelectBtn) firstSelectBtn = btn;
      }
      det.appendChild(inner);
      frameListEl.appendChild(det);
    }
  } else {
    entries.forEach((item, i) => {
      const btn = document.createElement('button');
      if (item.type === 'registry') {
        const e = item.ent;
        btn.textContent = `${e.stateName || '(state)'}${e.subStateName ? ' / ' + e.subStateName : ''}\n${e.frameId || stemFromRegistry(e)}`;
      } else {
        btn.textContent = item.name;
      }
      btn.type = 'button';
      btn.setAttribute('data-frame-select', '1');
      btn.addEventListener('click', () => selectFrame(item, btn));
      frameListEl.appendChild(btn);
      if (i === 0) firstSelectBtn = btn;
    });
  }

  if (firstSelectBtn) firstSelectBtn.click();
  else if (entries.length === 0) {
    statusEl.textContent += ' No vipstates/*.json found.';
  }
});

btnDlPack?.addEventListener('click', () => {
  if (!currentBuffer) return;
  const url = URL.createObjectURL(new Blob([currentBuffer], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = currentName || 'pack.vbpack';
  a.click();
  URL.revokeObjectURL(url);
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function createAnnotatedVbpackBlobFromAnalysis(analysisResult) {
  if (!currentZip) throw new Error('No currentZip');

  const mf = findZipFile(currentZip, 'manifest.json');
  if (!mf) throw new Error('manifest.json missing from vbpack');
  const raw = await mf.async('string');
  let manifest = {};
  try {
    manifest = JSON.parse(raw);
  } catch (_) {
    manifest = {};
  }

  manifest.memoryAnalysis = buildMemoryAnalysisManifest(analysisResult);

  // Replace in the same member name (zip may have different casing).
  currentZip.file(mf.name, JSON.stringify(manifest, null, 2));
  const blob = await currentZip.generateAsync({ type: 'blob', ...PACK_ZIP_COMPRESSION });
  return blob;
}

function renderAnalysisSummaryText(analysisResult) {
  if (!analysisResult) return '';
  const wa = analysisResult.wramIngest || {};
  const top = analysisResult.topCandidatesByState || {};
  const scoreMax = Number(analysisResult.scoreMax || 0);
  const topN = Number(analysisResult.topCandidatesPerStateSaved || 10);

  const describeScore = (score) => {
    if (scoreMax <= 0) return 'unknown';
    const ratio = score / scoreMax;
    if (ratio >= 0.95) return 'global discriminator';
    if (ratio >= 0.7) return 'strong discriminator';
    if (ratio >= 0.4) return 'moderate discriminator';
    return 'weak discriminator';
  };

  const lines = [];
  lines.push(`WRAM ingest: ${wa.framesWithWram ?? 0} frames (missing: ${wa.missingWramFrames ?? 0})`);
  lines.push(`Candidate offsets (global): ${analysisResult.candidateTotal ?? 0}`);
  lines.push(`Top locations per analyzed state (up to ${topN}):`);
  if (scoreMax > 0) {
    lines.push(`Score meaning: higher is better; max=${scoreMax} (different from up to ${scoreMax} other states).`);
  }
  const entries = Object.entries(top);
  if (entries.length === 0) {
    lines.push('No top candidates found (insufficient stable bytes across states).');
    return lines.join('\n');
  }
  const sorted = entries
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
  for (const [stateName, list] of sorted) {
    lines.push(``);
    lines.push(`${stateName}:`);
    for (const it of list) {
      const ev = it.expectedValue != null ? ` expected=0x${it.expectedValue.toString(16).padStart(2, '0')}` : '';
      lines.push(`- ${it.addressCpu} (off ${it.offset}) score=${it.score}/${scoreMax} ${describeScore(it.score)}${ev}`);
    }
  }
  return lines.join('\n');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Prominent warnings (single-frame states, huge candidate count). HTML for #analysis-warnings.
 * @param {any} analysisResult
 * @returns {string}
 */
function renderAnalysisWarningsHtml(analysisResult) {
  if (!analysisResult) return '';
  const parts = [];
  const low = Array.isArray(analysisResult.lowConfidenceStateNames)
    ? analysisResult.lowConfidenceStateNames
    : [];
  if (low.length) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    parts.push(
      `<p><strong>Low confidence — only one frame for these state name(s):</strong> ${low.map(esc).join(', ')}</p>
      <p>Re-capture with <strong>2–3 frames per state</strong> for each high-level name you need. Those states are <strong>excluded</strong> from the cross-state comparison until then.</p>`,
    );
  }
  if (analysisResult.candidateTotalVeryHigh) {
    const n = analysisResult.candidateTotal ?? 0;
    parts.push(
      `<p><strong>Very high candidate count (${n}).</strong> If that seems wrong, check WRAM dumps and duplicate state names in captures.</p>`,
    );
  }
  if (analysisResult.note && String(analysisResult.note).includes('Not enough')) {
    parts.push(`<p><strong>Analysis did not run on state families:</strong> ${escHtml(String(analysisResult.note))}</p>`);
  }
  return parts.join('');
}

btnRunAnalysis?.addEventListener('click', async () => {
  if (!currentZip || !currentFrameRegistry || !currentFrameRegistry.length) return;
  latestAnnotatedBlob = null;
  latestAnnotatedName = null;
  latestAnalysis = null;

  btnRunAnalysis.disabled = true;
  btnAcceptAnalysis.disabled = true;
  btnDownloadAnnotated.disabled = true;
  if (analysisStatusEl) analysisStatusEl.textContent = 'Reading ramdumps and computing stable/discriminant bytes...';
  if (analysisWarningsEl) {
    analysisWarningsEl.textContent = '';
    analysisWarningsEl.style.display = 'none';
  }
  if (analysisSummaryEl) analysisSummaryEl.textContent = '';

  try {
    latestAnalysis = await runInBrowserWramAnalysis({ zip: currentZip, frameRegistry: currentFrameRegistry });
    if (analysisStatusEl) analysisStatusEl.textContent = 'Analysis complete.';
    const warnHtml = renderAnalysisWarningsHtml(latestAnalysis);
    if (analysisWarningsEl) {
      if (warnHtml) {
        analysisWarningsEl.innerHTML = warnHtml;
        analysisWarningsEl.style.display = 'block';
      } else {
        analysisWarningsEl.textContent = '';
        analysisWarningsEl.style.display = 'none';
      }
    }
    if (analysisSummaryEl) analysisSummaryEl.textContent = renderAnalysisSummaryText(latestAnalysis);
    btnAcceptAnalysis.disabled = false;
  } catch (err) {
    console.error('[Memory analysis] Run failed:', err);
    if (analysisStatusEl) analysisStatusEl.textContent = `Analysis failed: ${err?.message || String(err)}`;
    btnRunAnalysis.disabled = false;
  }
});

btnAcceptAnalysis?.addEventListener('click', async () => {
  if (!latestAnalysis) return;
  if (!currentName) return;

  btnAcceptAnalysis.disabled = true;
  btnDownloadAnnotated.disabled = true;
  if (analysisStatusEl) analysisStatusEl.textContent = 'Merging memoryAnalysis into manifest.json (in memory)…';

  try {
    latestAnnotatedBlob = await createAnnotatedVbpackBlobFromAnalysis(latestAnalysis);
    const base = (currentName || 'vb-pack').replace(/\.vbpack$/i, '');
    latestAnnotatedName = `${base}-annotated.vbpack`;
    if (analysisStatusEl) {
      analysisStatusEl.textContent =
        'Ready. Click “Save annotated .vbpack” to download, then open that file in the paint tool. The file you originally loaded is unchanged on disk until you replace it yourself.';
    }
    btnDownloadAnnotated.disabled = false;
  } catch (err) {
    console.error('[Memory analysis] Write failed:', err);
    if (analysisStatusEl) analysisStatusEl.textContent = `Write failed: ${err?.message || String(err)}`;
    btnAcceptAnalysis.disabled = false;
  }
});

btnDownloadAnnotated?.addEventListener('click', async () => {
  if (!latestAnnotatedBlob || !latestAnnotatedName) return;
  // Prefer the project home over Downloads. Better still: run this from the
  // Project tool's File → Analyze memory, which writes into the open pack.
  try {
    const { saveExportToHome } = await import('../src/project-home.js');
    const wrote = await saveExportToHome(latestAnnotatedBlob, latestAnnotatedName);
    if (wrote) {
      if (analysisStatusEl) analysisStatusEl.textContent = `Wrote ${wrote} to your project home folder.`;
      return;
    }
  } catch (err) {
    console.error('[Memory analysis] Project home write failed:', err);
  }
  downloadBlob(latestAnnotatedBlob, latestAnnotatedName);
});

async function selectFrame(item, btn) {
  frameListEl.querySelectorAll('[data-frame-select]').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');

  if (lastPreviewUrl) {
    URL.revokeObjectURL(lastPreviewUrl);
    lastPreviewUrl = null;
  }

  let stem = '';
  let metaLines = [];
  if (item.type === 'registry') {
    const e = item.ent;
    stem = stemFromRegistry(e);
    metaLines = [
      `frameId: ${e.frameId || '—'}`,
      `stateName: ${e.stateName || '—'}`,
      `subStateName: ${e.subStateName || '—'}`,
      `note: ${e.note || '—'}`,
      `wramSource: ${e.wramSource || '—'}`,
      `VIP: ${e.vipStateFile || '—'}`,
      `screenshot: ${e.screenshotFile || '—'}`,
      `ramdump: ${e.ramdumpFile || '—'} (${e.wramCaptureOk ? 'OK' : 'missing / failed'})`,
      `saveState: ${e.saveStateFile || '—'}`,
    ];
  } else {
    stem = item.name.replace(/\.json$/i, '');
    metaLines = [`vipstates/${item.name}`];
  }

  const shotPath = `screenshots/${stem}.png`;
  const ramPath = `ramdumps/${stem}.wram.bin`;
  let ramLen = '—';
  try {
    const rf = currentZip.file(shotPath) ?? currentZip.file(`screenshots/${stem}.PNG`);
    if (rf) {
      const blob = await rf.async('blob');
      lastPreviewUrl = URL.createObjectURL(blob);
      previewImg.src = lastPreviewUrl;
      previewImg.style.display = '';
      previewPlaceholder.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewPlaceholder.style.display = '';
      previewPlaceholder.textContent = 'No screenshot for this stem.';
    }
  } catch (_) {
    previewPlaceholder.textContent = 'Could not read screenshot.';
  }

  try {
    let ramf = findZipFile(currentZip, ramPath);
    if (!ramf) ramf = findZipFile(currentZip, `ramdumps/${stem}.bin`);
    if (ramf) {
      const b = await ramf.async('arraybuffer');
      ramLen = `${b.byteLength} bytes${b.byteLength === WRAM_SIZE ? ' (64K)' : ' (expected 64K)'}`;
    } else if (item.type === 'registry' && item.ent.saveStateFile) {
      const sf = findZipFile(currentZip, item.ent.saveStateFile);
      if (sf) {
        const b = await sf.async('arraybuffer');
        ramLen = `no ramdump; savestate present (${b.byteLength} bytes — re-export or run analyzer with savestate fallback)`;
      } else {
        ramLen = 'no ramdump file in zip';
      }
    } else {
      ramLen = 'no ramdump file in zip';
    }
  } catch (_) {
    ramLen = 'read error';
  }
  metaLines.push(`ram file size: ${ramLen}`);
  previewMeta.textContent = metaLines.join('\n');
}
