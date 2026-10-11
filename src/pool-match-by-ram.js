/**
 * Match a captured frame to a `gameStatePools` variant by its WRAM fingerprint.
 *
 * Pools seeded from the memory analysis carry `ramConditions` — the bytes that
 * identify a game state. Every captured frame ships its own 64 KiB WRAM dump, so
 * "which pool is this frame?" can be answered by testing those conditions instead
 * of string-matching frame names, which fails for frames that have no registry
 * entry (notably the live "Current" frame).
 */
import { ramConditionsSatisfied, normalizeGroupRamConditionsList } from './color-layer.js';

/**
 * @typedef {{ poolId: string, variantId: string, poolLabel: string, variantLabel: string, conditionCount: number }} PoolVariantMatch
 */

/** Flat list of every variant in the pools, with its normalized conditions. */
function eachVariant(gameStatePools) {
  const out = [];
  for (const p of Array.isArray(gameStatePools) ? gameStatePools : []) {
    const poolId = typeof p?.id === 'string' ? p.id.trim() : '';
    if (!poolId) continue;
    for (const v of Array.isArray(p.variants) ? p.variants : []) {
      const variantId = typeof v?.id === 'string' ? v.id.trim() : '';
      if (!variantId) continue;
      out.push({
        poolId,
        variantId,
        poolLabel: (typeof p.label === 'string' && p.label.trim()) || poolId,
        variantLabel: (typeof v.label === 'string' && v.label.trim()) || variantId,
        conditions: normalizeGroupRamConditionsList({ ramConditions: v.ramConditions }) || [],
      });
    }
  }
  return out;
}

/**
 * Every variant whose conditions hold for this WRAM. Variants with no conditions
 * are skipped: they match everything, which is not evidence of anything.
 *
 * @param {unknown} gameStatePools
 * @param {Uint8Array|null|undefined} wram 64 KiB CPU WRAM
 * @returns {PoolVariantMatch[]}
 */
export function matchPoolVariantsByRam(gameStatePools, wram) {
  if (!wram || wram.byteLength < 0x10000) return [];
  const out = [];
  for (const v of eachVariant(gameStatePools)) {
    if (v.conditions.length === 0) continue;
    if (!ramConditionsSatisfied(wram, v.conditions)) continue;
    out.push({
      poolId: v.poolId,
      variantId: v.variantId,
      poolLabel: v.poolLabel,
      variantLabel: v.variantLabel,
      conditionCount: v.conditions.length,
    });
  }
  return out;
}

/**
 * The single best fingerprint match for a frame, plus whatever else matched so
 * callers can say "3 pools claim this frame" instead of silently picking one.
 * Ties break on the most conditions checked (the most specific fingerprint).
 *
 * @param {unknown} gameStatePools
 * @param {Uint8Array|null|undefined} wram
 * @returns {{ match: PoolVariantMatch|null, all: PoolVariantMatch[], ambiguous: boolean }}
 */
export function bestPoolVariantByRam(gameStatePools, wram) {
  const all = matchPoolVariantsByRam(gameStatePools, wram);
  if (all.length === 0) return { match: null, all, ambiguous: false };
  const ranked = [...all].sort((a, b) => b.conditionCount - a.conditionCount);
  const ambiguous = ranked.length > 1 && ranked[0].conditionCount === ranked[1].conditionCount;
  return { match: ranked[0], all: ranked, ambiguous };
}

/**
 * Compare a name-based suggestion with the fingerprint, so the UI can flag a
 * disagreement rather than quietly preferring one.
 *
 * @param {{ poolId: string, variantId: string }|null|undefined} byName
 * @param {PoolVariantMatch|null|undefined} byRam
 * @returns {'agree'|'name-only'|'ram-only'|'conflict'|'none'}
 */
export function comparePoolSuggestions(byName, byRam) {
  const n = byName?.poolId && byName?.variantId ? `${byName.poolId}::${byName.variantId}` : '';
  const r = byRam?.poolId && byRam?.variantId ? `${byRam.poolId}::${byRam.variantId}` : '';
  if (!n && !r) return 'none';
  if (n && !r) return 'name-only';
  if (!n && r) return 'ram-only';
  return n === r ? 'agree' : 'conflict';
}
