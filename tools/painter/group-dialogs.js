/**
 * The Project tool's group actions: New group (with its pool and kind suggestions) and New pose
 * from a selection, pose actions in the inspector, rename, duplicate and delete (with undo). Also
 * the canvas size setting, which sat among them. Split out of tools/painter.js, which passes in the
 * state and functions it shares (initGroupDialogs).
 */import { getTileBytes, hashTile } from '../../src/vip-state.js';
import { patternsInPoses, unclaimedPatterns } from '../../src/obj-sprite-profiles.js';
import { comparePoolSuggestions } from '../../src/pool-match-by-ram.js';
import { normalizeGroup } from '../../src/group-schema.js';
import { openNewPoseDialog, submitNewPoseDialog, applyPoseAction } from './sprite-profiles-ui.js';
import { recordGroupUse } from '../shared/recent-groups.js';
import { findPoolVariantForFrameByRam } from './frame-data.js';
import { getActiveV2VariantId, updatePaintV2TopButton } from './pack-rules.js';
import { clearTileSelectionPreserveZoom, refreshInspectorFromSelection, syncLastTopTileFromSelection, topSelectedDrawFullIndex, updateSelectionUi } from './selection.js';
import { drawEye, getEye } from './view-filters.js';
import { drawSelectionOverlay } from './world-grid.js';
import { countDrawsMatchingGroup, refreshNewGroupMembershipBanner, updateGroupDetail } from './group-detail.js';
import { fillNewGroupPoolVariantSelect, findDefaultPoolVariantForFrame, findOptionValueMatchingActiveV2Variant, findSingleUnambiguousPoolVariantValue, getCurrentFrameSelectIndex, getRegistryFrameIdForFrameIndex, getRegistryStateNameForFrameIndex, getRegistrySubStateNameForFrameIndex, inferPoolVariantValueFromSelectionMatchingGroups, newGroupPoolSelectHasValue, overlappingGroupsForNewVariant, reconstructPoolVariantValueFromDef, variantExistsInPools } from './pools.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initGroupDialogs(context) {
  ctx = context;
}

/**
 * After `fillNewGroupPoolVariantSelect()`: value to select + hint for the dialog.
 * Order: registry / VIP stem match → existing group matching selection → Painter v2 variant id → single pool → first row.
 * @returns {{ value: string, hintLine: string, frameMapped: boolean }}
 */
function computeNewGroupPoolVariantFromFrame() {
  const fi = getCurrentFrameSelectIndex();
  const frameLabel =
    fi != null && ctx.availableFrames[fi]?.label ? String(ctx.availableFrames[fi].label) : 'this frame';

  const def = findDefaultPoolVariantForFrame();

  // Fingerprint first: the analysis recorded the bytes that identify each state,
  // and every captured frame carries its own WRAM — that is real evidence, where
  // the name match below is only a string match (and "Current" has no registry row).
  const byRam = findPoolVariantForFrameByRam(fi);
  if (byRam.match) {
    const value = `${byRam.match.poolId}::${byRam.match.variantId}`;
    if (newGroupPoolSelectHasValue(value)) {
      const agreement = comparePoolSuggestions(def, byRam.match);
      const poolName = ctx.escapeHtml(byRam.match.poolLabel);
      const detail =
        agreement === 'conflict'
          ? ` <span class="muted">The frame's name points at <code>${ctx.escapeHtml(def.poolId)}</code> instead — trusting the fingerprint.</span>`
          : byRam.ambiguous
            ? ` <span class="muted">${byRam.all.length} pools have an equally specific fingerprint here — check before saving.</span>`
            : '';
      return {
        value,
        frameMapped: true,
        hintLine: `Suggested: <strong>${poolName}</strong> — this frame's WRAM matches its memory fingerprint (${byRam.match.conditionCount} byte(s)).${detail}`,
      };
    }
  }

  if (def) {
    const primary = def.poolId && def.variantId ? `${def.poolId}::${def.variantId}` : '';
    if (primary && newGroupPoolSelectHasValue(primary)) {
      const sn = getRegistryStateNameForFrameIndex(fi);
      const sub = getRegistrySubStateNameForFrameIndex(fi);
      const key = sn || sub || '';
      return {
        value: primary,
        frameMapped: true,
        hintLine: `Suggested: memory variant linked to <strong>${ctx.escapeHtml(frameLabel)}</strong>${key ? ` (registry / VIP stem ↔ <code>analysisStateKey</code> / variant <code>id</code>)` : ' (registry / VIP stem ↔ pool keys)'}.`,
      };
    }
    const recon = reconstructPoolVariantValueFromDef(def);
    if (recon && newGroupPoolSelectHasValue(recon)) {
      const sn = getRegistryStateNameForFrameIndex(fi);
      const sub = getRegistrySubStateNameForFrameIndex(fi);
      const key = sn || sub || '';
      return {
        value: recon,
        frameMapped: true,
        hintLine: `Suggested: memory variant linked to <strong>${ctx.escapeHtml(frameLabel)}</strong>${key ? ` (registry <code>${ctx.escapeHtml(key)}</code>)` : ''}.`,
      };
    }
  }

  const fromGroups = inferPoolVariantValueFromSelectionMatchingGroups();
  if (fromGroups) {
    return {
      value: fromGroups,
      frameMapped: true,
      hintLine:
        'Suggested: an <strong>existing group</strong> that matches your selection already uses this pool row — same as that group unless you are splitting state.',
    };
  }

  const fromV2 = findOptionValueMatchingActiveV2Variant();
  if (fromV2) {
    const vid = getActiveV2VariantId();
    return {
      value: fromV2,
      frameMapped: true,
      hintLine: `Suggested: <strong>Painter v2 variant</strong> <code>${ctx.escapeHtml(vid)}</code> matches <strong>only one</strong> pool row here — using that row.`,
    };
  }

  const single = findSingleUnambiguousPoolVariantValue();
  if (single && newGroupPoolSelectHasValue(single)) {
    return {
      value: single,
      frameMapped: true,
      hintLine: `Suggested: this pack has only <strong>one</strong> memory variant — using it.`,
    };
  }

  if (ctx.newGroupPoolVariant?.options.length) {
    const first = ctx.newGroupPoolVariant.options[0].value;
    const v2id = getActiveV2VariantId();
    const v2Ambiguous =
      v2id &&
      Array.from(ctx.newGroupPoolVariant.options).filter((o) => {
        const s = o.value.indexOf('::');
        return s >= 0 && o.value.slice(s + 2).trim() === v2id;
      }).length > 1;
    const v2Note = v2Ambiguous
      ? ` <span class="muted">Painter v2 variant <code>${ctx.escapeHtml(v2id)}</code> appears on several pools — not used for auto-pick.</span>`
      : '';
    const ramNote = byRam.wram
      ? ' <span class="muted">This frame has a WRAM dump, but no pool fingerprint matches it — re-run the memory analysis if this state should have a pool.</span>'
      : ' <span class="muted">No WRAM dump for this frame, so the memory fingerprint could not be checked.</span>';
    return {
      value: first,
      frameMapped: false,
      hintLine: `No unique automatic link for <strong>${ctx.escapeHtml(frameLabel)}</strong> (registry / VIP / selection did not resolve; v2 variant did not single out one row).${v2Note}${ramNote} Defaulting to the <strong>first</strong> row — pick manually.`,
    };
  }

  const noPoolHint = !ctx.packHadGroupsJsonOnLoad
    ? 'No <code>groups.json</code> yet — new group will be <strong>legacy / unassigned</strong> until you save (then you can add <code>gameStatePools</code> for RAM variants).'
    : 'No pool rows in <code>groups.json</code> — new group will be legacy / unassigned.';
  return {
    value: '',
    frameMapped: false,
    hintLine: noPoolHint,
  };
}

export function refreshNewGroupPoolVariantHint() {
  const el = document.getElementById('new-group-pool-hint');
  if (!el) return;
  if (!ctx.newGroupDialogFrameVariant) {
    el.innerHTML = '';
    return;
  }
  const cur = ctx.newGroupPoolVariant?.value ?? '';
  const target = ctx.newGroupDialogFrameVariant.value;
  const { hintLine, frameMapped } = ctx.newGroupDialogFrameVariant;
  const showReset = target && cur !== target;
  const btnLabel = frameMapped ? 'Use frame default' : 'Reset to suggested';
  const btn = showReset
    ? ` <button type="button" class="btn-ghost" id="new-group-use-frame-pool" style="font-size:0.62rem;padding:0.12rem 0.35rem;margin-left:0.25rem;vertical-align:baseline">${btnLabel}</button>`
    : '';
  const ok = target && cur === target ? ' <strong>Selected.</strong>' : '';
  el.innerHTML = `<span class="muted">${hintLine}${ok}${btn}</span>`;
}

export function refreshNewGroupOverlapBanner() {
  if (!ctx.newGroupOverlap || !ctx.newGroupPoolVariant) return;
  const raw = ctx.newGroupPoolVariant.value || '';
  const sep = raw.indexOf('::');
  const poolId = sep >= 0 ? raw.slice(0, sep).trim() : '';
  const variantId = sep >= 0 ? raw.slice(sep + 2).trim() : '';
  const overlaps = overlappingGroupsForNewVariant(poolId, variantId);
  if (!overlaps.length) {
    ctx.newGroupOverlap.hidden = true;
    ctx.newGroupOverlap.innerHTML = '';
    return;
  }
  const names = overlaps.map((g) => g.name || g.id).slice(0, 8);
  const more = overlaps.length > names.length ? ` (+${overlaps.length - names.length} more)` : '';
  ctx.newGroupOverlap.hidden = false;
  ctx.newGroupOverlap.innerHTML = `<strong>Selection already matches</strong> ${overlaps.length} existing group(s) for this pool/variant scope (including legacy where applicable): ${ctx.escapeHtml(names.join(', '))}${ctx.escapeHtml(more)}. <span class="muted">You can still create the group.</span>`;
}

export function readNewGroupKind() {
  if (ctx.newGroupKindBg?.checked) return 'bg';
  return 'obj';
}

export function suggestKindFromSelection() {
  const fi = topSelectedDrawFullIndex();
  if (fi == null || !ctx.currentState?.drawList) return 'obj';
  const L = ctx.currentState.drawList[fi].layer;
  if (L === 0 || L === 1) return 'bg';
  return 'obj';
}

export function openNewGroupDialog() {
  if (!ctx.newGroupDialog || !ctx.currentState || ctx.selectedDrawFullIndices.size === 0) return;
  fillNewGroupPoolVariantSelect();
  if (ctx.newGroupName) ctx.newGroupName.value = '';
  const defKind = suggestKindFromSelection();
  if (defKind === 'bg') {
    if (ctx.newGroupKindBg) ctx.newGroupKindBg.checked = true;
  } else if (ctx.newGroupKindObj) ctx.newGroupKindObj.checked = true;
  const sug = computeNewGroupPoolVariantFromFrame();
  ctx.newGroupDialogFrameVariant = {
    value: sug.value || '',
    hintLine: sug.hintLine,
    frameMapped: sug.frameMapped,
  };
  if (ctx.newGroupPoolVariant) {
    ctx.newGroupPoolVariant.value = sug.value || (ctx.newGroupPoolVariant.options[0]?.value ?? '');
  }
  refreshNewGroupPoolVariantHint();
  refreshNewGroupMembershipBanner();
  refreshNewGroupOverlapBanner();
  ctx.newGroupDialog.showModal();
  queueMicrotask(() => ctx.newGroupName?.focus());
}

export function createGroupFromDialog() {
  if (!ctx.currentState?.patternTable || ctx.selectedDrawFullIndices.size === 0) return;
  const name = ctx.newGroupName?.value.trim() || 'New group';
  const raw = ctx.newGroupPoolVariant?.value || '';
  const sep = raw.indexOf('::');
  const poolId = sep >= 0 ? raw.slice(0, sep).trim() : '';
  const variantId = sep >= 0 ? raw.slice(sep + 2).trim() : '';
  const kind = readNewGroupKind();
  const pt = ctx.currentState.patternTable;
  const windowSet = new Set();
  const hashSet = new Set();
  for (const fi of ctx.selectedDrawFullIndices) {
    const d = ctx.currentState.drawList[fi];
    if (!d) continue;
    if (d.world !== undefined && d.world !== null) windowSet.add(Number(d.world));
    hashSet.add(hashTile(getTileBytes(pt, d.tileIndex)));
  }
  const fiTop = topSelectedDrawFullIndex();
  let anchorHash;
  let anchorUnique = false;
  if (kind === 'bg' && fiTop != null) {
    // Only a *unique* anchor gets the VIP overlay path (useVipOverlayForZoomPaint);
    // a duplicated one silently falls back to per-pattern tile8 paint, which colors
    // every copy of that pattern. So prefer a hash that appears once in its
    // world+layer on this eye, starting from the frontmost selected draw.
    const ordered = [fiTop, ...ctx.selectedDrawFullIndices].filter((fi, i, arr) => arr.indexOf(fi) === i);
    for (const fi of ordered) {
      const d = ctx.currentState.drawList[fi];
      if (!d) continue;
      const h = hashTile(getTileBytes(pt, d.tileIndex)) >>> 0;
      if (ctx.countSameHashWorldLayerEye(d, h) === 1) {
        anchorHash = h;
        anchorUnique = true;
        break;
      }
    }
    if (anchorHash === undefined) {
      anchorHash = hashTile(getTileBytes(pt, ctx.currentState.drawList[fiTop].tileIndex));
    }
  }
  /** @type {typeof groups[0]} */
  const row = normalizeGroup({
    id: newUniqueGroupId(),
    name,
    criteria: {
      windowIds: [...windowSet].sort((a, b) => a - b),
      hashes: [...hashSet],
      layers: kind === 'bg' ? [0] : [2],
    },
    authoringKind: kind,
    ...(poolId && variantId ? { statePoolId: poolId, stateVariantId: variantId } : {}),
    ...(kind === 'bg' && anchorHash !== undefined ? { anchorHash } : {}),
    visible: true,
    expanded: false,
  });
  ctx.groups = [...ctx.groups, row];
  ctx.markGroupsDirty();
  ctx.selectedGroupId = row.id;
  clearTileSelectionPreserveZoom();
  ctx.updateGroupsPanel();
  updateGroupDetail(row);
  updateSelectionUi();
  ctx.render();
  const nMatch = countDrawsMatchingGroup(row);
  const nHash = Array.isArray(row.criteria?.hashes) ? row.criteria.hashes.length : 0;
  const copies = nHash > 0 && nMatch > nHash;
  const anchorNote =
    kind !== 'bg' || anchorHash === undefined
      ? ''
      : anchorUnique
        ? ` Anchor #${(anchorHash >>> 0).toString(16).toUpperCase()} is unique here — painting uses the VIP overlay.`
        : ` No unique anchor in this selection: #${(anchorHash >>> 0).toString(16).toUpperCase()} appears more than once in its world/layer, so painting colors every copy of each pattern (tile8). Press A to pick a different anchor.`;
  ctx.setStatus(
    `Added group “${name}” (${ctx.groups.length} total). ${nHash} hash(es) → ${nMatch} draw(s) on this eye${copies ? ' (includes copies)' : ''}.${anchorNote} Save .vbpack to write groups.json.`,
  );
}

const CANVAS_SIZE_KEY = 'painter.canvasSize';

/**
 * Size: Fill (the default) makes the frame as large as the work column and the window allow;
 * 1:1 is the original 768-pixel-wide canvas. Clicks are mapped through the canvas's on-screen
 * size, so painting and selecting work the same at either size.
 * @param {'fill'|'normal'} mode
 */
function applyCanvasSize(mode) {
  const fill = mode !== 'normal';
  for (const sel of ['.canvas-wrap', '.canvas-meta']) document.querySelector(sel)?.classList.toggle('fill', fill);
  const btn = document.getElementById('btn-canvas-size');
  if (btn) {
    btn.textContent = fill ? 'Size: Fill' : 'Size: 1:1';
    btn.classList.toggle('active', fill);
    btn.setAttribute('aria-pressed', fill ? 'true' : 'false');
  }
  try {
    localStorage.setItem(CANVAS_SIZE_KEY, fill ? 'fill' : 'normal');
  } catch {
    /* remembered for this page only */
  }
}

export function wireCanvasSize() {
  let saved = 'fill';
  try {
    saved = localStorage.getItem(CANVAS_SIZE_KEY) || 'fill';
  } catch {
    /* private mode: the default */
  }
  applyCanvasSize(saved === 'normal' ? 'normal' : 'fill');
  document.getElementById('btn-canvas-size')?.addEventListener('click', () => {
    applyCanvasSize(document.querySelector('.canvas-wrap')?.classList.contains('fill') ? 'normal' : 'fill');
  });
}

function newUniqueGroupId() {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function openNewPoseFromSelection() {
  if (!ctx.currentState || ctx.selectedDrawFullIndices.size === 0) return;
  openNewPoseDialog({
    currentState: ctx.currentState,
    selectedDrawFullIndices: ctx.selectedDrawFullIndices,
    eye: getEye(),
    drawEye,
    topFullIndex: topSelectedDrawFullIndex(),
    groups: ctx.groups,
    selectedGroupId: ctx.selectedGroupId,
    setStatus: ctx.setStatus,
    escapeHtml: ctx.escapeHtml,
  });
}

export function submitNewPoseFromDialog() {
  const result = submitNewPoseDialog({
    groups: ctx.groups,
    sourceFrameId: getRegistryFrameIdForFrameIndex(getCurrentFrameSelectIndex()),
    normalizeGroup,
    createSpriteGroup: (name, windowIds) => {
      const def = findDefaultPoolVariantForFrame();
      return normalizeGroup({
        id: newUniqueGroupId(),
        name,
        criteria: { windowIds, hashes: [], layers: [2] },
        authoringKind: 'obj',
        ...(def?.poolId && def?.variantId ? { statePoolId: def.poolId, stateVariantId: def.variantId } : {}),
        visible: true,
        expanded: false,
      });
    },
    // A background group made from a pose: the captured worlds, background and scaled layers.
    createBgGroup: (name, windowIds) => {
      const def = findDefaultPoolVariantForFrame();
      return normalizeGroup({
        id: newUniqueGroupId(),
        name,
        criteria: { windowIds, hashes: [], layers: [0] },
        authoringKind: 'bg',
        ...(def?.poolId && def?.variantId ? { statePoolId: def.poolId, stateVariantId: def.variantId } : {}),
        visible: true,
        expanded: false,
      });
    },
  });
  const dialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('new-pose-dialog'));
  if (!result) {
    dialog?.close();
    return;
  }
  if ('error' in result) {
    ctx.setStatus(result.error);
    document.getElementById(result.focusId)?.focus();
    return;
  }
  dialog?.close();
  ctx.groups = result.groups;
  ctx.markGroupsDirty();
  ctx.selectedGroupId = result.group.id;
  recordGroupUse(result.group.id);
  ctx.updateGroupsPanel();
  updateGroupDetail(result.group);
  updateSelectionUi();
  ctx.render();
  const clipped = result.pose.clippedAtCapture ? ' Touches the screen edge — tiles may be missing.' : '';
  ctx.setStatus(
    `Added pose “${result.pose.name}” (${result.pose.tiles.length} tiles) to “${result.group.name}”.${clipped} Save .vbpack to persist.`,
  );
}

/**
 * @param {string} groupId
 * @param {string} poseId
 * @param {string} action
 * @param {boolean} checked
 */
export function handlePoseAction(groupId, poseId, action, checked) {
  const g = ctx.groups.find((x) => x.id === groupId);
  if (!g) return;
  const result = applyPoseAction({
    group: g,
    poseId,
    action,
    checked,
    currentState: ctx.currentState,
    selectedDrawFullIndices: ctx.selectedDrawFullIndices,
    eye: getEye(),
    drawEye,
  });
  if (result.selectIndices) {
    ctx.selectedDrawFullIndices.clear();
    for (const fi of result.selectIndices) ctx.selectedDrawFullIndices.add(fi);
    syncLastTopTileFromSelection();
    drawSelectionOverlay();
    updateSelectionUi();
    refreshInspectorFromSelection();
    updatePaintV2TopButton();
  }
  if (result.group) {
    const next = normalizeGroup(result.group);
    ctx.groups = ctx.groups.map((x) => (x.id === groupId ? next : x));
    // Shared paint for patterns that left the group and no group claims any more.
    if (result.dropPatterns?.length) for (const h of unclaimedPatterns(ctx.groups, result.dropPatterns)) ctx.pack.delete(h >>> 0);
    ctx.markGroupsDirty();
    ctx.updateGroupsPanel();
    updateGroupDetail(next);
    ctx.render();
  }
  if (result.message) ctx.setStatus(result.message);
}

export function applyRenameGroupFromInspector(id) {
  const inp = /** @type {HTMLInputElement|null} */ (document.getElementById('group-display-name-input'));
  if (!inp) return;
  let name = inp.value.trim();
  if (!name) name = id;
  if (name.length > 200) {
    ctx.setStatus('Display name is too long (max 200 characters).');
    return;
  }
  const cur = ctx.groups.find((x) => x.id === id);
  if (!cur || cur.name === name) return;
  ctx.groups = ctx.groups.map((x) => (x.id === id ? { ...x, name } : x));
  ctx.markGroupsDirty();
  const g = /** @type {typeof groups[0]} */ (ctx.groups.find((x) => x.id === id));
  ctx.updateGroupsPanel();
  updateGroupDetail(g);
  ctx.setStatus(`Updated group display name (${ctx.groups.length} groups). Save .vbpack to persist.`);
}

/**
 * `poolId::variantId` when the group is attached to a valid pool row; otherwise `null` (legacy / unassigned).
 * @param {typeof groups[0]} g
 */
function pooledVariantSelectValueForGroup(g) {
  const sid = typeof g?.statePoolId === 'string' ? g.statePoolId.trim() : '';
  const vid = typeof g?.stateVariantId === 'string' ? g.stateVariantId.trim() : '';
  if (!sid || !vid || !variantExistsInPools(sid, vid)) return null;
  return `${sid}::${vid}`;
}

/**
 * Fill duplicate dialog `<select>`. Omits `excludeValue` when set (cannot pick the same row as the source).
 * @param {string|null} excludeValue `poolId::variantId` or null
 */
function fillDupGroupPoolVariantSelect(excludeValue) {
  if (!ctx.dupGroupPoolVariant) return;
  ctx.dupGroupPoolVariant.innerHTML = '';
  const add = (poolId, variantId, label) => {
    const v = `${poolId}::${variantId}`;
    if (excludeValue && v === excludeValue) return;
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    ctx.dupGroupPoolVariant.appendChild(o);
  };
  if (!ctx.gameStatePools.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = ctx.packHadGroupsJsonOnLoad
      ? '(No pools — copy will be legacy / unassigned)'
      : '(No groups.json / pools — copy stays legacy)';
    if (!excludeValue) ctx.dupGroupPoolVariant.appendChild(o);
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
}

export function openDuplicateGroupDialog(sourceId) {
  const g = ctx.groups.find((x) => x.id === sourceId);
  if (!g || !ctx.duplicateGroupDialog) return;
  const intro = document.getElementById('dup-group-intro');
  const errEl = document.getElementById('dup-group-error');
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = '';
  }
  const exclude = pooledVariantSelectValueForGroup(g);
  fillDupGroupPoolVariantSelect(exclude);
  const realOpts = Array.from(ctx.dupGroupPoolVariant?.options ?? []).filter((o) => o.value.indexOf('::') >= 0);
  if (exclude && realOpts.length === 0) {
    window.alert(
      'There is no other memory pool row to assign this copy to (the original row is excluded). Add another pool variant, then duplicate again.',
    );
    ctx.dupGroupPoolVariant.innerHTML = '';
    return;
  }
  if (!ctx.dupGroupPoolVariant.options.length) {
    window.alert('No pool rows to choose. Add gameStatePools to the pack or duplicate after defining variants.');
    return;
  }
  ctx.pendingDuplicateSourceId = sourceId;
  if (intro) {
    const srcLabel = ctx.escapeHtml(g.name || g.id);
    if (exclude) {
      intro.innerHTML = `Copy of <strong>${srcLabel}</strong> — the original row <code>${ctx.escapeHtml(exclude)}</code> is not listed here. Choose a <strong>different</strong> pool + variant.`;
    } else {
      intro.innerHTML = `Copy of <strong>${srcLabel}</strong> (legacy / unassigned). Choose which memory pool + variant this copy should use.`;
    }
  }
  if (ctx.dupGroupPoolVariant.options.length) ctx.dupGroupPoolVariant.value = ctx.dupGroupPoolVariant.options[0].value;
  ctx.duplicateGroupDialog.showModal();
  queueMicrotask(() => ctx.dupGroupPoolVariant?.focus());
}

export function confirmDuplicateGroup() {
  const sourceId = ctx.pendingDuplicateSourceId;
  const errEl = document.getElementById('dup-group-error');
  if (!sourceId || !ctx.dupGroupPoolVariant) return;
  const g = ctx.groups.find((x) => x.id === sourceId);
  if (!g) {
    ctx.duplicateGroupDialog?.close();
    ctx.pendingDuplicateSourceId = null;
    return;
  }
  const raw = ctx.dupGroupPoolVariant.value || '';
  const exclude = pooledVariantSelectValueForGroup(g);
  if (exclude && raw === exclude) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = 'Pick a different pool row than the original group.';
    }
    return;
  }
  const sep = raw.indexOf('::');
  const poolId = sep >= 0 ? raw.slice(0, sep).trim() : '';
  const variantId = sep >= 0 ? raw.slice(sep + 2).trim() : '';
  const nid = newUniqueGroupId();
  const baseName = g.name || g.id;
  /** @type {Record<string, unknown>} */
  const payload = { ...g };
  delete payload.id;
  delete payload.name;
  delete payload.criteria;
  delete payload.ramConditions;
  delete payload.statePoolId;
  delete payload.stateVariantId;
  delete payload.expanded;
  const copy = normalizeGroup({
    ...payload,
    id: nid,
    name: `${baseName} (copy)`,
    criteria: JSON.parse(JSON.stringify(g.criteria || {})),
    ramConditions: Array.isArray(g.ramConditions) ? JSON.parse(JSON.stringify(g.ramConditions)) : undefined,
    expanded: false,
    ...(poolId && variantId ? { statePoolId: poolId, stateVariantId: variantId } : {}),
  });
  ctx.groups = [...ctx.groups, copy];
  ctx.markGroupsDirty();
  ctx.selectedGroupId = copy.id;
  ctx.pendingDuplicateSourceId = null;
  ctx.duplicateGroupDialog?.close();
  ctx.updateGroupsPanel();
  updateGroupDetail(copy);
  ctx.setStatus(`Duplicated group as “${copy.name}”. Save .vbpack to persist.`);
}

export function deleteGroupById(id) {
  const g = ctx.groups.find((x) => x.id === id);
  if (!g) return;
  // A background group's colours go with it; a sprite's live in the shared paint, so its patterns
  // that no other group lists or uses in a pose lose their paint too.
  const own = [...(g.criteria?.hashes || []).map((h) => Number(h) >>> 0), ...patternsInPoses(g)];
  const sharedOrphans = unclaimedPatterns(ctx.groups.filter((x) => x.id !== id), own).filter((h) => ctx.pack.has(h));
  const paintNote = sharedOrphans.length
    ? `\n\nIts paint on ${sharedOrphans.length} tile pattern(s) no other group uses goes too.`
    : '';
  if (!confirm(`Delete group “${g.name || g.id}”?${paintNote}\n\nCtrl+Z brings it back.`)) return;
  const entry = removeGroupNow(id);
  if (!entry) return;
  ctx.pushPaintUndo(entry);
  const ovNote = entry.overrides.length > 0 ? ` · removed ${entry.overrides.length} group-scoped override(s)` : '';
  ctx.setStatus(`Removed a group (${ctx.groups.length} left)${ovNote}. Ctrl+Z brings it back; save .vbpack to persist.`);
}

/**
 * Delete a group with everything that goes with it, and return what undo needs to put it all back
 * (`kind: 'group-delete'`): the group and its place in the list, its overlays, its group-scoped
 * overrides and the shared paint only it used. No question asked — the caller asks.
 * @param {string} id
 */
export function removeGroupNow(id) {
  const index = ctx.groups.findIndex((x) => x.id === id);
  if (index < 0) return null;
  const g = ctx.groups[index];
  const own = [...(g.criteria?.hashes || []).map((h) => Number(h) >>> 0), ...patternsInPoses(g)];
  const sharedOrphans = unclaimedPatterns(ctx.groups.filter((x) => x.id !== id), own).filter((h) => ctx.pack.has(h));
  const trimmed = id.trim();
  const entry = {
    kind: 'group-delete',
    group: g,
    index,
    sharedPaint: new Map(sharedOrphans.map((h) => [h, Uint8Array.from(ctx.pack.get(h))])),
    overlays: new Map([trimmed, id].filter((k, i, a) => a.indexOf(k) === i && ctx.vipAuthoringByGroupAndEye.has(k)).map((k) => [k, ctx.vipAuthoringByGroupAndEye.get(k)])),
    overrides: ctx.overrides.map((o, i) => ({ o, i })).filter(({ o }) => (typeof o?.groupId === 'string' ? o.groupId.trim() : '') === trimmed),
  };
  for (const h of sharedOrphans) ctx.pack.delete(h);
  if (ctx.viewGroupFilterId === id) ctx.viewGroupFilterId = null;
  if (ctx.anchorPickGroupId === id) ctx.anchorPickGroupId = null;
  ctx.groups = ctx.groups.filter((x) => x.id !== id);
  ctx.vipAuthoringByGroupAndEye.delete(trimmed);
  ctx.vipAuthoringByGroupAndEye.delete(id);
  const gone = new Set(entry.overrides.map(({ o }) => o));
  ctx.overrides = ctx.overrides.filter((o) => !gone.has(o));
  ctx.markGroupsDirty();
  ctx.invalidateGroupColorIndex();
  if (ctx.selectedGroupId === id) {
    ctx.selectedGroupId = null;
    updateGroupDetail(null);
  }
  ctx.updateGroupsPanel();
  ctx.render();
  return entry;
}

/** Undo of a delete: the group back where it was, selected, with its overlays, overrides and paint. */
export function restoreDeletedGroup(e) {
  const at = Math.min(Math.max(0, e.index), ctx.groups.length);
  ctx.groups = [...ctx.groups.slice(0, at), e.group, ...ctx.groups.slice(at)];
  for (const [h, buf] of e.sharedPaint) ctx.pack.set(h, new Uint8Array(buf));
  for (const [k, byEye] of e.overlays) ctx.vipAuthoringByGroupAndEye.set(k, byEye);
  const next = ctx.overrides.slice();
  for (const { o, i } of [...e.overrides].sort((a, b) => a.i - b.i)) next.splice(Math.min(i, next.length), 0, o);
  ctx.overrides = next;
  ctx.markGroupsDirty();
  ctx.invalidateGroupColorIndex();
  ctx.selectedGroupId = e.group.id;
  ctx.updateGroupsPanel();
  updateGroupDetail(e.group);
}
