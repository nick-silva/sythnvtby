/**
 * The Project tool's frames and pools: registry lookups for the frame on screen; which game-state
 * pool and variant a frame or a group belongs to; the New group pool picker and its overlap
 * checks; pool-based filters, and selecting the tiles no group of a variant has yet. Split out of
 * tools/painter.js, which passes in the state and functions it shares (initPools).
 */import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { vipMatchKey, findFrameRegistryEntry } from './frame-registry.js';
import { findPoolVariantForFrameByRam } from './frame-data.js';
import { getActiveV2VariantId, updatePaintV2TopButton } from './pack-rules.js';
import { clearSelection, refreshInspectorFromSelection, syncLastTopTileFromSelection, updateSelectionUi } from './selection.js';
import { drawEye, getEye, updateWorldFilterDebug } from './view-filters.js';
import { drawMatchesGroup } from './zoom-target.js';
import { drawSelectionOverlay, syncWorldButtons } from './world-grid.js';
import { manifestHasMemoryAnalysis } from './group-detail.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initPools(context) {
  ctx = context;
}

export function getCurrentFrameSelectIndex() {
  if (!ctx.frameSelect) return null;
  const i = Number(ctx.frameSelect.value);
  if (!Number.isFinite(i) || i < 0 || i >= ctx.availableFrames.length) return null;
  return i;
}

/** Leaf VIP filename for manifest (e.g. `vipstates/title.json`); used to reopen the same frame after reload. */
export function getPainterV2LastVipFileForManifest() {
  const idx = getCurrentFrameSelectIndex();
  if (idx == null) return undefined;
  const leaf = ctx.availableFrames[idx]?.vipFile;
  if (typeof leaf === 'string' && leaf.trim()) return leaf.trim();
  return undefined;
}

/**
 * @param {number|null} i
 * @returns {Record<string, unknown>|null}
 */
function getRegistryEntryForFrameIndex(i) {
  if (i == null || !ctx.lastFrameRegistry?.length || !ctx.availableFrames[i]) return null;
  const f = ctx.availableFrames[i];
  const leaf = (f.vipFile || '').trim();
  const labelTrim = (f.label || '').trim();

  let ent = leaf ? findFrameRegistryEntry(ctx.lastFrameRegistry, leaf) : null;
  if (!ent && /^current\b/i.test(labelTrim)) {
    const curKey = vipMatchKey(ctx.lastManifestCurrentVipRef || 'vipstate-current.json');
    for (const e of ctx.lastFrameRegistry) {
      const ref = vipMatchKey(/** @type {string} */ (e.vipStateFile || ''));
      if (ref && (ref === curKey || ref.includes('vipstate-current'))) {
        ent = e;
        break;
      }
    }
  }
  if (!ent && labelTrim.endsWith('.json')) {
    ent = findFrameRegistryEntry(ctx.lastFrameRegistry, labelTrim);
  }
  return ent && typeof ent === 'object' ? ent : null;
}

/** @param {number|null} i */
export function getRegistryStateNameForFrameIndex(i) {
  const ent = getRegistryEntryForFrameIndex(i);
  const sn = ent?.stateName != null ? String(ent.stateName).trim() : '';
  return sn || null;
}

/** @param {number|null} i */
export function getRegistrySubStateNameForFrameIndex(i) {
  const ent = getRegistryEntryForFrameIndex(i);
  const s = ent?.subStateName != null ? String(ent.subStateName).trim() : '';
  return s || null;
}

/** @param {number|null} i */
export function getRegistryFrameIdForFrameIndex(i) {
  const ent = getRegistryEntryForFrameIndex(i);
  const fid = ent?.frameId != null ? String(ent.frameId).trim() : '';
  return fid || null;
}

/**
 * Collect strings that may appear in `gameStatePools[].variants[].analysisStateKey` (or variant `id`)
 * for this frame — registry names, `frameId`, and VIP entry stems (e.g. `vipstate-current` for the root snapshot).
 * @param {number|null} i
 * @returns {string[]}
 */
function collectFramePoolMatchKeys(i) {
  /** @type {string[]} */
  const out = [];
  const add = (s) => {
    const t = String(s ?? '').trim();
    if (!t) return;
    const low = t.toLowerCase();
    if (out.some((x) => x.toLowerCase() === low)) return;
    out.push(t);
    const st = vipMatchKey(t);
    if (st && st.toLowerCase() !== low) {
      if (!out.some((x) => x.toLowerCase() === st.toLowerCase())) out.push(st);
    }
  };
  if (i == null || !ctx.availableFrames[i]) return out;
  const f = ctx.availableFrames[i];
  add(getRegistryStateNameForFrameIndex(i));
  add(getRegistrySubStateNameForFrameIndex(i));
  add(getRegistryFrameIdForFrameIndex(i));
  add(f.vipFile || '');
  const labelTrim = (f.label || '').trim();
  if (/^current\b/i.test(labelTrim) && ctx.lastManifestCurrentVipRef) {
    add(ctx.lastManifestCurrentVipRef);
  }
  return out;
}

/**
 * @param {Set<string>} frameKeysLower plus vipMatchKey stems (stored lowercased)
 * @param {unknown} akRaw
 * @param {unknown} variantIdRaw
 */
function poolVariantSideMatchesFrameKeys(frameKeySet, akRaw, variantIdRaw) {
  const tryOne = (raw) => {
    const s = String(raw ?? '').trim();
    if (!s) return false;
    if (frameKeySet.has(s.toLowerCase())) return true;
    const st = vipMatchKey(s);
    return !!(st && frameKeySet.has(st.toLowerCase()));
  };
  const ak = String(akRaw ?? '').trim();
  if (ak && tryOne(ak)) return true;
  const vid = String(variantIdRaw ?? '').trim();
  if (vid && tryOne(vid)) return true;
  return false;
}

/**
 * Pick pool/variant row that best matches the current frame (registry + VIP path stems vs `analysisStateKey` / variant `id`).
 * @returns {{ poolIndex: number, variantIndex: number, poolId: string, variantId: string } | null}
 */
export function findDefaultPoolVariantForFrame() {
  const i = getCurrentFrameSelectIndex();
  if (i == null) return null;
  const rawKeys = collectFramePoolMatchKeys(i);
  /** @type {Set<string>} */
  const frameKeySet = new Set();
  for (const k of rawKeys) {
    const t = String(k).trim();
    if (!t) continue;
    frameKeySet.add(t.toLowerCase());
    const st = vipMatchKey(t);
    if (st) frameKeySet.add(st.toLowerCase());
  }
  if (frameKeySet.size === 0) return null;
  const pools = ctx.gameStatePools;
  for (let pi = 0; pi < pools.length; pi++) {
    const p = pools[pi];
    const pid = typeof p?.id === 'string' ? p.id : '';
    const variants = Array.isArray(p?.variants) ? p.variants : [];
    for (let vi = 0; vi < variants.length; vi++) {
      const v = variants[vi];
      const vid = typeof v?.id === 'string' ? v.id.trim() : '';
      const ak = v?.analysisStateKey ?? p?.analysisStateKey;
      if (poolVariantSideMatchesFrameKeys(frameKeySet, ak, vid)) {
        return { poolIndex: pi, variantIndex: vi, poolId: pid, variantId: vid };
      }
    }
    const pidTrim = typeof p?.id === 'string' ? p.id.trim() : '';
    if (pidTrim && variants.length > 0 && poolVariantSideMatchesFrameKeys(frameKeySet, '', pidTrim)) {
      let defI = variants.findIndex((vv) => vv && typeof vv.id === 'string' && vv.id.trim() === '__default__');
      if (defI < 0) defI = 0;
      const vPick = variants[defI];
      const vidPick = typeof vPick?.id === 'string' ? vPick.id.trim() : '';
      return { poolIndex: pi, variantIndex: defI, poolId: pid, variantId: vidPick };
    }
  }
  return null;
}

/** @param {string} poolId @param {string} variantId */
export function variantExistsInPools(poolId, variantId) {
  if (!poolId || !variantId) return false;
  for (const p of ctx.gameStatePools) {
    if (!p || typeof p.id !== 'string' || p.id !== poolId) continue;
    const vars = p.variants;
    if (!Array.isArray(vars)) return false;
    return vars.some((v) => v && typeof v.id === 'string' && v.id === variantId);
  }
  return false;
}

/**
 * @returns {{ byVariant: Map<string, typeof groups>, legacy: typeof groups }}
 */
export function classifyGroupsByPoolVariant() {
  /** @type {Map<string, typeof groups>} */
  const byVariant = new Map();
  /** @type {typeof groups} */
  const legacy = [];
  for (const g of ctx.groups) {
    const sid = typeof g.statePoolId === 'string' ? g.statePoolId.trim() : '';
    const vid = typeof g.stateVariantId === 'string' ? g.stateVariantId.trim() : '';
    if (!sid || !vid || !variantExistsInPools(sid, vid)) {
      legacy.push(g);
      continue;
    }
    const k = `${sid}::${vid}`;
    if (!byVariant.has(k)) byVariant.set(k, []);
    byVariant.get(k).push(g);
  }
  return { byVariant, legacy };
}

/** Group is “legacy” in the tree when pool/variant is missing or not in `gameStatePools`. */
function isLegacyPoolGroup(g) {
  const sid = typeof g.statePoolId === 'string' ? g.statePoolId.trim() : '';
  const vid = typeof g.stateVariantId === 'string' ? g.stateVariantId.trim() : '';
  return !sid || !vid || !variantExistsInPools(sid, vid);
}

/**
 * Whether an existing group should count toward the “overlap” banner for a proposed pool/variant row.
 * Pooled + different variant → no overlap. Legacy existing groups always count when criteria match.
 * Proposed legacy (no pool row) → only overlaps other legacy groups.
 */
function groupOverlapsProposedVariant(g, proposedPoolId, proposedVariantId) {
  const poolP = typeof proposedPoolId === 'string' ? proposedPoolId.trim() : '';
  const varP = typeof proposedVariantId === 'string' ? proposedVariantId.trim() : '';
  const proposedSpecific = !!(poolP && varP);
  if (!proposedSpecific) return isLegacyPoolGroup(g);
  if (isLegacyPoolGroup(g)) return true;
  return g.statePoolId === poolP && g.stateVariantId === varP;
}

/**
 * @param {string} proposedPoolId
 * @param {string} proposedVariantId
 * @returns {typeof groups}
 */
export function overlappingGroupsForNewVariant(proposedPoolId, proposedVariantId) {
  if (!ctx.currentState?.drawList || !ctx.currentState.patternTable || ctx.selectedDrawFullIndices.size === 0) return [];
  const pt = ctx.currentState.patternTable;
  const eye = getEye();
  /** @type {typeof groups} */
  const out = [];
  const seen = new Set();
  for (const fi of ctx.selectedDrawFullIndices) {
    const d = ctx.currentState.drawList[fi];
    if (!d || drawEye(d) !== eye) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex));
    for (const g of ctx.groups) {
      if (!drawMatchesGroup(d, g, h)) continue;
      if (!groupOverlapsProposedVariant(g, proposedPoolId, proposedVariantId)) continue;
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
  }
  return out;
}

export function fillNewGroupPoolVariantSelect() {
  if (!ctx.newGroupPoolVariant) return;
  ctx.newGroupPoolVariant.innerHTML = '';
  const add = (poolId, variantId, label) => {
    const o = document.createElement('option');
    o.value = `${poolId}::${variantId}`;
    o.textContent = label;
    ctx.newGroupPoolVariant.appendChild(o);
  };
  if (!ctx.gameStatePools.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = ctx.packHadGroupsJsonOnLoad
      ? '(No pools — new group will be legacy / unassigned)'
      : '(No groups.json yet — legacy / unassigned; save pack to add file)';
    ctx.newGroupPoolVariant.appendChild(o);
    return;
  }
  for (const p of ctx.gameStatePools) {
    const poolId = typeof p?.id === 'string' ? p.id : '';
    const poolLabel = typeof p?.label === 'string' && p.label.trim() ? p.label.trim() : poolId || 'pool';
    const variants = Array.isArray(p?.variants) ? p.variants : [];
    for (const v of variants) {
      const variantId = typeof v?.id === 'string' ? v.id.trim() : '';
      if (!poolId || !variantId) continue;
      const vl = typeof v?.label === 'string' && v.label.trim() ? v.label.trim() : variantId;
      add(poolId, variantId, `${poolLabel} — ${vl}`);
    }
  }
  if (!ctx.newGroupPoolVariant.options.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(No valid pool variants — legacy)';
    ctx.newGroupPoolVariant.appendChild(o);
  }
}

export function newGroupPoolSelectHasValue(value) {
  if (!ctx.newGroupPoolVariant || !value) return false;
  return Array.from(ctx.newGroupPoolVariant.options).some((o) => o.value === value);
}

/**
 * @param {{ poolIndex: number, variantIndex: number, poolId: string, variantId: string } | null} def
 */
export function reconstructPoolVariantValueFromDef(def) {
  if (!def || def.poolIndex == null || def.variantIndex == null) return '';
  const p = ctx.gameStatePools[def.poolIndex];
  const vars = Array.isArray(p?.variants) ? p.variants : [];
  const v = vars[def.variantIndex];
  const poolId = typeof p?.id === 'string' ? p.id : '';
  const variantId = v && typeof v.id === 'string' ? v.id.trim() : '';
  if (!poolId || !variantId) return '';
  return `${poolId}::${variantId}`;
}

/** @returns {string} `poolId::variantId` or '' */
export function findSingleUnambiguousPoolVariantValue() {
  let count = 0;
  let last = '';
  for (const p of ctx.gameStatePools) {
    const poolId = typeof p?.id === 'string' ? p.id : '';
    const variants = Array.isArray(p?.variants) ? p.variants : [];
    for (const v of variants) {
      const variantId = typeof v?.id === 'string' ? v.id.trim() : '';
      if (!poolId || !variantId) continue;
      count++;
      last = `${poolId}::${variantId}`;
    }
  }
  return count === 1 ? last : '';
}

/**
 * If any selected draw already matches a pooled group, reuse that group’s pool/variant (most hits wins).
 * @returns {string} `poolId::variantId` or ''
 */
export function inferPoolVariantValueFromSelectionMatchingGroups() {
  if (!ctx.currentState?.drawList || !ctx.currentState.patternTable || ctx.selectedDrawFullIndices.size === 0) return '';
  const pt = ctx.currentState.patternTable;
  const eye = getEye();
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const fi of ctx.selectedDrawFullIndices) {
    const d = ctx.currentState.drawList[fi];
    if (!d || drawEye(d) !== eye) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex));
    for (const g of ctx.groups) {
      if (!drawMatchesGroup(d, g, h)) continue;
      const sid = typeof g.statePoolId === 'string' ? g.statePoolId.trim() : '';
      const vid = typeof g.stateVariantId === 'string' ? g.stateVariantId.trim() : '';
      if (!sid || !vid || !variantExistsInPools(sid, vid)) continue;
      const k = `${sid}::${vid}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  let best = '';
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  if (!best) return '';
  const sep = best.indexOf('::');
  const pid = sep >= 0 ? best.slice(0, sep).trim() : '';
  const vid = sep >= 0 ? best.slice(sep + 2).trim() : '';
  return pid && vid && variantExistsInPools(pid, vid) ? best : '';
}

/**
 * If the Painter v2 variant id matches **exactly one** pool row in the dialog, return that row.
 * Skips when the id is shared (e.g. many pools use `__default__`) — otherwise we would always pick the first pool.
 * @returns {string} `poolId::variantId` or ''
 */
/**
 * Painter v2 variant id matches exactly one `poolId::variantId` row in `gameStatePools` (no DOM).
 * @returns {string} `poolId::variantId` or ''
 */
function findPoolVariantValueUniqueForActiveV2Id() {
  const want = getActiveV2VariantId();
  if (!want) return '';
  /** @type {string[]} */
  const matches = [];
  for (const p of ctx.gameStatePools) {
    const poolId = typeof p?.id === 'string' ? p.id : '';
    const variants = Array.isArray(p?.variants) ? p.variants : [];
    for (const v of variants) {
      const variantId = typeof v?.id === 'string' ? v.id.trim() : '';
      if (!poolId || !variantId) continue;
      if (variantId === want) matches.push(`${poolId}::${variantId}`);
    }
  }
  if (matches.length !== 1) return '';
  return matches[0];
}

export function findOptionValueMatchingActiveV2Variant() {
  const v = findPoolVariantValueUniqueForActiveV2Id();
  if (!v || !ctx.newGroupPoolVariant?.options.length) return '';
  return newGroupPoolSelectHasValue(v) ? v : '';
}

/**
 * Best-effort `poolId` + `variantId` for tools that need an “active memory row” without opening the new-group dialog.
 * Same resolution order as the new-group suggestion (except we do not fall back to “first dropdown row”).
 * @returns {{ poolId: string, variantId: string, source: string } | null}
 */
function resolveEditorPoolVariantForFilters() {
  const byRam = findPoolVariantForFrameByRam(getCurrentFrameSelectIndex()).match;
  if (byRam && variantExistsInPools(byRam.poolId, byRam.variantId)) {
    return { poolId: byRam.poolId, variantId: byRam.variantId, source: 'RAM fingerprint' };
  }
  const def = findDefaultPoolVariantForFrame();
  if (def) {
    if (def.poolId && def.variantId && variantExistsInPools(def.poolId, def.variantId)) {
      return { poolId: def.poolId, variantId: def.variantId, source: 'frame / registry' };
    }
    const recon = reconstructPoolVariantValueFromDef(def);
    if (recon) {
      const sep = recon.indexOf('::');
      const poolId = sep >= 0 ? recon.slice(0, sep).trim() : '';
      const variantId = sep >= 0 ? recon.slice(sep + 2).trim() : '';
      if (poolId && variantId && variantExistsInPools(poolId, variantId)) {
        return { poolId, variantId, source: 'frame / registry (reconstructed)' };
      }
    }
  }
  const fromSel = inferPoolVariantValueFromSelectionMatchingGroups();
  if (fromSel) {
    const sep = fromSel.indexOf('::');
    const poolId = sep >= 0 ? fromSel.slice(0, sep).trim() : '';
    const variantId = sep >= 0 ? fromSel.slice(sep + 2).trim() : '';
    if (poolId && variantId) return { poolId, variantId, source: 'selection → pooled group' };
  }
  const v2 = findPoolVariantValueUniqueForActiveV2Id();
  if (v2) {
    const sep = v2.indexOf('::');
    const poolId = sep >= 0 ? v2.slice(0, sep).trim() : '';
    const variantId = sep >= 0 ? v2.slice(sep + 2).trim() : '';
    if (poolId && variantId) return { poolId, variantId, source: 'Painter v2 variant (unique row)' };
  }
  const single = findSingleUnambiguousPoolVariantValue();
  if (single) {
    const sep = single.indexOf('::');
    const poolId = sep >= 0 ? single.slice(0, sep).trim() : '';
    const variantId = sep >= 0 ? single.slice(sep + 2).trim() : '';
    if (poolId && variantId && variantExistsInPools(poolId, variantId)) {
      return { poolId, variantId, source: 'single pool row in pack' };
    }
  }
  return null;
}

export function updateGroupsPoolContextHint() {
  const hint = document.getElementById('groups-pool-context-hint');
  const btnUn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-select-unassigned-pool-tiles'));
  if (ctx.btnClearGroupFilter) ctx.btnClearGroupFilter.disabled = !ctx.loadedPackParts;
  const btnInv = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-paint-inventory'));
  if (btnInv) btnInv.disabled = !ctx.loadedPackParts;
  if (btnUn) btnUn.hidden = !ctx.gameStatePools.length;
  if (!hint) return;
  if (!ctx.loadedPackParts || !ctx.gameStatePools.length) {
    let msg;
    if (!ctx.packHadGroupsJsonOnLoad) {
      msg =
        '<span class="muted"><strong>New pack:</strong> no <code>groups.json</code> yet — create a group or save to add it. Pool-scoped selection stays off until <code>gameStatePools</code> exists.</span>';
    } else {
      msg = '<span class="muted">No <code>gameStatePools</code> in this pack — pool-scoped selection stays off until you add pool rows.</span>';
    }
    if (ctx.loadedPackParts && manifestHasMemoryAnalysis()) {
      msg +=
        ' <span style="color:var(--accent-warm)"><code>memoryAnalysis</code> lives on the manifest only; pools are separate.</span>';
    }
    hint.innerHTML = msg;
    if (btnUn) btnUn.disabled = true;
    return;
  }
  const r = resolveEditorPoolVariantForFilters();
  if (!r) {
    hint.innerHTML =
      '<span class="muted">No resolved pool row: registry/VIP keys, <strong>unique</strong> Painter v2 variant id, tiles in a pooled group, or a single pack variant. Unassigned-tile selection stays off until one resolves.</span>';
    if (btnUn) btnUn.disabled = true;
    return;
  }
  hint.innerHTML = `<span class="muted">Pool context: <code>${ctx.escapeHtml(r.poolId)}</code> · <code>${ctx.escapeHtml(r.variantId)}</code> <span style="opacity:0.82">(${ctx.escapeHtml(r.source)})</span></span>`;
  if (btnUn) btnUn.disabled = !ctx.currentState?.drawList?.length;
}

export function clearGroupDerivedFilters() {
  ctx.worldFilter = 'all';
  syncWorldButtons();
  if (ctx.layerSelect) ctx.layerSelect.value = 'all';
  ctx.viewGroupFilterId = null;
  clearSelection();
  ctx.render();
  updateWorldFilterDebug();
  ctx.updatePoolSummary();
  updateGroupsPoolContextHint();
  ctx.setStatus('World and layer filters reset to All.');
}

/**
 * Groups attached to this exact pool variant (valid pooled rows only).
 * @param {string} poolId
 * @param {string} variantId
 */
function groupsWithExactPoolVariant(poolId, variantId) {
  if (!poolId || !variantId || !variantExistsInPools(poolId, variantId)) return [];
  return ctx.groups.filter((g) => {
    const sid = typeof g.statePoolId === 'string' ? g.statePoolId.trim() : '';
    const vid = typeof g.stateVariantId === 'string' ? g.stateVariantId.trim() : '';
    return sid === poolId && vid === variantId;
  });
}

/**
 * Full-frame draw indices (active eye) that do not match any group on this pool+variant row.
 * @param {string} poolId
 * @param {string} variantId
 * @returns {number[]}
 */
function collectUnassignedDrawIndicesForPoolVariant(poolId, variantId) {
  if (!ctx.currentState?.drawList || !ctx.currentState.patternTable) return [];
  const scoped = groupsWithExactPoolVariant(poolId, variantId);
  const pt = ctx.currentState.patternTable;
  const eye = getEye();
  /** @type {number[]} */
  const out = [];
  for (let fi = 0; fi < ctx.currentState.drawList.length; fi++) {
    const d = ctx.currentState.drawList[fi];
    if (!d || drawEye(d) !== eye) continue;
    const h = hashTile(getTileBytes(pt, d.tileIndex));
    let matched = false;
    for (const gr of scoped) {
      if (drawMatchesGroup(d, gr, h)) {
        matched = true;
        break;
      }
    }
    if (!matched) out.push(fi);
  }
  return out;
}

export function selectTilesUnassignedInEditorPoolVariant() {
  const pv = resolveEditorPoolVariantForFilters();
  if (!pv || !ctx.currentState?.drawList || !ctx.currentState.patternTable) {
    ctx.setStatus('Could not resolve pool + variant — use a unique Painter v2 variant, select tiles in a pooled group, or fix registry / pool keys.');
    return;
  }
  const indices = collectUnassignedDrawIndicesForPoolVariant(pv.poolId, pv.variantId);
  if (!indices.length) {
    ctx.setStatus(`Every visible draw on this frame already matches a group on ${pv.poolId} · ${pv.variantId} (or there are no draws).`);
    return;
  }
  ctx.selectedDrawFullIndices.clear();
  for (const fi of indices) ctx.selectedDrawFullIndices.add(fi);
  drawSelectionOverlay();
  updateSelectionUi();
  refreshInspectorFromSelection();
  syncLastTopTileFromSelection();
  updatePaintV2TopButton();
  ctx.setStatus(`Selected ${indices.length} tile(s) not in any group for ${pv.poolId} · ${pv.variantId} (${pv.source}).`);
}
