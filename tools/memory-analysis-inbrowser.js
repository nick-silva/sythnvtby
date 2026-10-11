import { tryExtractWramFromMednafenSavestate } from '../src/mednafen-savestate-wram.js';

const WRAM_SIZE = 0x10000;
const ANALYZER_VERSION = '2.2-js';
/** Discriminant locations kept per state (written to vbpack + paint dropdown). */
const TOP_CANDIDATES_PER_STATE = 10;
const CANDIDATE_TOTAL_HIGH_THRESHOLD = 2500;

function scoreLabel(score, maxScore) {
  if (maxScore <= 0) return 'unknown';
  const ratio = score / maxScore;
  if (ratio >= 0.95) return 'global discriminator';
  if (ratio >= 0.7) return 'strong discriminator';
  if (ratio >= 0.4) return 'moderate discriminator';
  return 'weak discriminator';
}

function normalizeZipPath(p) {
  return String(p || '').replace(/\\/g, '/');
}

function findZipMemberNameCI(zip, preferredPath) {
  const want = normalizeZipPath(preferredPath).toLowerCase();
  const direct = zip.file(normalizeZipPath(preferredPath));
  if (direct) return normalizeZipPath(preferredPath);
  for (const name of Object.keys(zip.files || {})) {
    if (normalizeZipPath(name).toLowerCase() === want) return name;
  }
  return null;
}

async function readZipBytesCi(zip, preferredPath) {
  const memberName = findZipMemberNameCI(zip, preferredPath);
  if (!memberName) return null;
  const f = zip.file(memberName);
  if (!f) return null;
  const ab = await f.async('arraybuffer');
  return new Uint8Array(ab);
}

function buildWorker() {
  const workerCode = `
    const WRAM_SIZE = 65536;
    function sortTopListDesc(list) {
      // Higher score first; tie-break by lower offset for determinism.
      list.sort((a, b) => (b.score - a.score) || (a.offset - b.offset));
    }

    self.onmessage = (ev) => {
      const msg = ev.data || {};
      const stateNames = msg.stateNames || [];
      const stateFramesBuffers = msg.stateFramesBuffers || [];
      const stateFramesCounts = msg.stateFramesCounts || [];

      const stateCount = stateNames.length;

      // Prebuild Uint8Array views.
      const stableValViews = new Array(stateCount);
      const stableMaskViews = new Array(stateCount);

      // Compute per-state stability:
      // stableMask[s][i]=1 if all frames in that state share the same byte at offset i.
      // stableVal[s][i]=the stable byte value (frames[0][i]).
      for (let s = 0; s < stateCount; s++) {
        const nFrames = stateFramesCounts[s];
        const frameBuffers = stateFramesBuffers[s];
        const framesU8 = new Array(nFrames);
        for (let f = 0; f < nFrames; f++) framesU8[f] = new Uint8Array(frameBuffers[f]);

        const stableMask = new Uint8Array(WRAM_SIZE);
        const stableVal = new Uint8Array(WRAM_SIZE);
        const base = framesU8[0];

        for (let i = 0; i < WRAM_SIZE; i++) {
          const v0 = base[i];
          let stable = 1;
          for (let f = 1; f < nFrames; f++) {
            if (framesU8[f][i] !== v0) { stable = 0; break; }
          }
          stableMask[i] = stable;
          stableVal[i] = v0;
        }
        stableMaskViews[s] = stableMask;
        stableValViews[s] = stableVal;
      }

      let candidateTotal = 0;

      const TOP_K = ${TOP_CANDIDATES_PER_STATE};
      // topKByState[stateIdx] = [{offset,addressCpu,expectedValue,score,valuesByStateName}, ...]
      const topKByState = new Array(stateCount).fill(0).map(() => []);

      const maxStates = stateCount;
      const stableIndicesU8 = new Uint8Array(maxStates);
      const stableValuesU8 = new Uint8Array(maxStates);
      const uniqValsU8 = new Uint8Array(maxStates);
      const uniqCountsU8 = new Uint8Array(maxStates);

      function considerCandidateForState(stateIdx, offset, score, stableCount, stableIndices, stableValues) {
        const list = topKByState[stateIdx];
        const addressCpu = 0x05000000 + offset;
        const expectedValue = stableValViews[stateIdx][offset];

        let improved = false;
        if (list.length < TOP_K) {
          improved = true;
        } else {
          const worst = list[list.length - 1];
          if ((score > worst.score) || (score === worst.score && offset < worst.offset)) improved = true;
        }

        if (!improved) return;

        const valuesByStateName = {};
        for (let k = 0; k < stableCount; k++) {
          valuesByStateName[stateNames[stableIndices[k]]] = stableValues[k];
        }

        list.push({ offset, addressCpu, expectedValue, score, valuesByStateName });
        sortTopListDesc(list);
        if (list.length > TOP_K) list.length = TOP_K;
      }

      for (let offset = 0; offset < WRAM_SIZE; offset++) {
        // Gather stable states + value counts for this offset.
        let stableCount = 0;
        let uniqCount = 0;

        for (let s = 0; s < stateCount; s++) {
          if (stableMaskViews[s][offset]) {
            const v = stableValViews[s][offset];
            stableIndicesU8[stableCount] = s;
            stableValuesU8[stableCount] = v;
            stableCount++;

            // update uniq counts
            let found = -1;
            for (let u = 0; u < uniqCount; u++) {
              if (uniqValsU8[u] === v) { found = u; break; }
            }
            if (found >= 0) uniqCountsU8[found]++; else {
              uniqValsU8[uniqCount] = v;
              uniqCountsU8[uniqCount] = 1;
              uniqCount++;
            }
          }
        }

        if (stableCount < 2 || uniqCount < 2) continue;

        // Candidate: stable in >=2 states and stable values not all identical.
        candidateTotal++;

        for (let k = 0; k < stableCount; k++) {
          const sIdx = stableIndicesU8[k];
          const v = stableValuesU8[k];

          // Find count for v in uniqCounts.
          let sameCount = 0;
          for (let u = 0; u < uniqCount; u++) {
            if (uniqValsU8[u] === v) { sameCount = uniqCountsU8[u]; break; }
          }
          const score = stableCount - sameCount;
          considerCandidateForState(sIdx, offset, score, stableCount, stableIndicesU8, stableValuesU8);
        }
      }

      const topK = {};
      for (let s = 0; s < stateCount; s++) {
        const stateName = stateNames[s];
        const list = topKByState[s] || [];
        topK[stateName] = list.map(it => ({
          offset: it.offset,
          addressCpu: '0x' + it.addressCpu.toString(16).padStart(8, '0'),
          expectedValue: it.expectedValue,
          score: it.score,
          valuesByStateName: it.valuesByStateName,
        }));
      }

      self.postMessage({ candidateTotal, topKByState: topK, stateCount });
    };
  `;
  const blob = new Blob([workerCode], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  return { url, workerCode };
}

/** @param {(path: string) => Promise<Uint8Array|null>} read */
async function tryLoadWramForEntry(read, entry) {
  const ramdumpFile = entry?.ramdumpFile;
  if (typeof ramdumpFile === 'string' && ramdumpFile.length) {
    const bytes = await read(ramdumpFile);
    if (bytes && bytes.byteLength >= WRAM_SIZE) return { wram: bytes.slice(0, WRAM_SIZE), source: 'ramdump-manifest' };
  }
  const stem = String(entry?.frameId || '').trim();
  if (stem) {
    const bytes = await read(`ramdumps/${stem}.wram.bin`);
    if (bytes && bytes.byteLength >= WRAM_SIZE) return { wram: bytes.slice(0, WRAM_SIZE), source: 'ramdump-by-stem' };
  }
  // Optional fallback via savestate (slower, but keeps tool robust).
  const saveStateFile = entry?.saveStateFile;
  if (typeof saveStateFile === 'string' && saveStateFile.length) {
    const ss = await read(saveStateFile);
    if (ss) {
      const extracted = tryExtractWramFromMednafenSavestate(ss);
      if (extracted && extracted.byteLength >= WRAM_SIZE) {
        return { wram: extracted.slice(0, WRAM_SIZE), source: 'savestate' };
      }
    }
  }
  return { wram: null, source: 'missing' };
}

/**
 * @param {{
 *   zip?: any,
 *   readEntry?: (path: string) => Promise<Uint8Array|null>,
 *   frameRegistry: Array<Record<string, unknown>>,
 *   maxStates?: number,
 * }} opts `readEntry` lets a caller that already holds the pack in memory (the
 *   Project tool) analyze it without a zip handle; `zip` keeps the tools page working.
 */
export async function runInBrowserWramAnalysis({ zip, readEntry, frameRegistry, maxStates = 64 } = {}) {
  const read = typeof readEntry === 'function' ? readEntry : zip ? (path) => readZipBytesCi(zip, path) : null;
  if (!read) throw new Error('zip or readEntry missing');
  if (!Array.isArray(frameRegistry)) throw new Error('frameRegistry missing');

  /** @type {Record<string, number>} */
  const framesCapturedByStateName = {};
  for (const ent of frameRegistry) {
    const s = String(ent?.stateName || '').trim() || '(unnamed)';
    framesCapturedByStateName[s] = (framesCapturedByStateName[s] || 0) + 1;
  }
  const singleFrameStateNames = Object.entries(framesCapturedByStateName)
    .filter(([, n]) => n < 2)
    .map(([name]) => name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Group entries by stateName.
  /** @type {Record<string, any[]>} */
  const byState = {};
  for (const ent of frameRegistry) {
    const s = String(ent?.stateName || '').trim() || '(unnamed)';
    if (!byState[s]) byState[s] = [];
    byState[s].push(ent);
  }

  const eligibleStates = Object.entries(byState)
    .filter(([_, rows]) => rows.length >= 2)
    .map(([s, rows]) => ({ stateName: s, rows }))
    .slice(0, maxStates);

  /** @type {Record<string, number>} */
  const framesPerStateCount = {};
  let missingWramFrames = 0;
  let framesWithWram = 0;
  let fromRamdumpManifest = 0;

  // Load WRAM for each state (only keep fully-ingested states).
  /** @type {string[]} */
  const stateNames = [];
  /** @type {Uint8Array[][]} */
  const framesByState = [];

  for (const { stateName, rows } of eligibleStates) {
    const frames = [];
    let ok = true;
    for (const ent of rows) {
      const { wram, source } = await tryLoadWramForEntry(read, ent);
      if (!wram) {
        ok = false;
        missingWramFrames++;
        continue;
      }
      frames.push({ ent, wram, source });
      framesWithWram++;
      if (source === 'ramdump-manifest') fromRamdumpManifest++;
    }
    if (!ok) continue;
    stateNames.push(stateName);
    framesPerStateCount[stateName] = frames.length;
    // Convert frames into Uint8Array list (strip ent/source).
    framesByState.push(frames.map((f) => f.wram));
  }

  if (stateNames.length < 2) {
    return {
      version: 1,
      analyzerVersion: ANALYZER_VERSION,
      generatedAt: new Date().toISOString(),
      wramSize: WRAM_SIZE,
      wramIngest: {
        framesWithWram,
        fromRamdumpManifest,
        missingWramFrames,
      },
      candidateTotal: 0,
      topCandidatesByState: {},
      note: 'Not enough fully-ingested states (need >=2).',
    };
  }

  // Build a transfer list for the worker.
  const stateFramesBuffers = framesByState.map((frames) => frames.map((u8) => u8.buffer));
  const transfer = [];
  for (const frames of stateFramesBuffers) for (const b of frames) transfer.push(b);

  const { url } = buildWorker();
  const worker = new Worker(url);

  const res = await new Promise((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = (e) => reject(e);
    worker.postMessage(
      {
        stateNames,
        stateFramesBuffers,
        stateFramesCounts: framesByState.map((frames) => frames.length),
      },
      transfer,
    );
  });

  worker.terminate();
  URL.revokeObjectURL(url);

  const candidateTotal = res.candidateTotal || 0;
  return {
    version: 1,
    analyzerVersion: ANALYZER_VERSION,
    generatedAt: new Date().toISOString(),
    wramSize: WRAM_SIZE,
    framesCapturedByStateName,
    lowConfidenceStateNames: singleFrameStateNames,
    topCandidatesPerStateSaved: TOP_CANDIDATES_PER_STATE,
    wramIngest: {
      framesWithWram,
      fromRamdumpManifest,
      missingWramFrames,
      eligibleStateCount: stateNames.length,
    },
    candidateTotal,
    candidateTotalVeryHigh: candidateTotal > CANDIDATE_TOTAL_HIGH_THRESHOLD,
    topCandidatesByState: res.topKByState || {},
    framesPerStateCount,
    scoreMax: Math.max(0, stateNames.length - 1),
  };
}

export function buildMemoryAnalysisManifest(memoryAnalysis) {
  const scoreMax = Number(memoryAnalysis?.scoreMax || 0);
  /** @type {Record<string, any[]>} */
  const withLabels = {};
  for (const [stateName, rows] of Object.entries(memoryAnalysis?.topCandidatesByState || {})) {
    withLabels[stateName] = (rows || []).map((r) => ({
      ...r,
      scoreLabel: scoreLabel(Number(r.score || 0), scoreMax),
    }));
  }
  return {
    version: 1,
    ...memoryAnalysis,
    topCandidatesByState: withLabels,
  };
}

