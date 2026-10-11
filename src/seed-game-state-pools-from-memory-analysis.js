/**
 * Build starter {@link gameStatePools} rows from `manifest.memoryAnalysis` (memory tool output).
 * One pool per key in `topCandidatesByState`, one variant `__default__` using the **first** (best-score) WRAM candidate.
 *
 * @param {unknown} memoryAnalysis - `manifest.memoryAnalysis`
 * @returns {Array<Record<string, unknown>>}
 */
export function seedGameStatePoolsFromMemoryAnalysis(memoryAnalysis) {
  if (!memoryAnalysis || typeof memoryAnalysis !== 'object' || Array.isArray(memoryAnalysis)) return [];
  const top = /** @type {Record<string, unknown>} */ (memoryAnalysis).topCandidatesByState;
  if (!top || typeof top !== 'object' || Array.isArray(top)) return [];

  const names = Object.keys(top).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const usedIds = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const stateName of names) {
    const rows = top[stateName];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const fullKey = String(stateName ?? '').trim();
    let ram = null;
    for (const row of rows) {
      ram = ramConditionFromAnalysisRow(row, fullKey);
      if (ram) break;
    }
    if (!ram) continue;

    const baseId = slugifyPoolIdSegment(fullKey);
    let poolId = `pool-${baseId}`;
    let n = 0;
    while (usedIds.has(poolId)) {
      n += 1;
      poolId = `pool-${baseId}-${n}`;
    }
    usedIds.add(poolId);

    const label = shortPoolLabelFromAnalysisKey(fullKey) || poolId;
    out.push({
      id: poolId,
      label,
      analysisStateKey: fullKey,
      analysisSource: 'memoryAnalysis',
      variants: [
        {
          id: '__default__',
          label: 'Default',
          ramConditions: [ram],
        },
      ],
    });
  }
  return out;
}

/**
 * @param {unknown} row
 * @param {string} stateName
 * @returns {{ offset: number, expectedValue: number, stateName?: string, source: string } | null}
 */
function ramConditionFromAnalysisRow(row, stateName) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const o = Number(row.offset);
  const ev = Number(row.expectedValue);
  if (!Number.isFinite(o) || o < 0 || o > 0xffff) return null;
  if (!Number.isFinite(ev) || ev < 0 || ev > 255) return null;
  const sn = String(stateName ?? '').trim();
  return {
    offset: o | 0,
    expectedValue: ev & 0xff,
    ...(sn ? { stateName: sn } : {}),
    source: 'memoryAnalysis',
  };
}

/**
 * UI-only short name: first segment before ` / ` or en/em dash (registry-style
 * “title / rest”), then cap length. Full key stays in {@link analysisStateKey}.
 * When multi-variant pools exist later, labels can include variant suffixes.
 *
 * @param {string} fullKey - `topCandidatesByState` key (full analysis state string)
 */
export function shortPoolLabelFromAnalysisKey(fullKey) {
  let s = String(fullKey ?? '').trim();
  if (!s) return '';
  if (s.includes('/')) {
    s = s.split(/\s*\/\s*/)[0]?.trim() || s;
  } else if (/[–—]/.test(s)) {
    s = s.split(/\s*[–—]\s*/)[0]?.trim() || s;
  }
  if (!s) return '';
  const max = 28;
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** @param {string} name */
function slugifyPoolIdSegment(name) {
  const s = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s || 'state';
}
