/**
 * The Project tool's groups panel: the pool and variant tree of groups, group rows, search, and
 * which sections stay open. Split out of tools/painter.js, which passes in the state and functions it shares (initGroupsPanel).
 */
import { frameGroupIndex, groupInFrame } from '../../src/group-screens.js';
import { layerArtOf } from '../../src/layer-art.js';
import { touchUpOf } from '../../src/touch-up.js';
import { matchesGroupQuery } from '../../src/group-search.js';
import { appendSharedGroupsSection, conditionPill, screenLimitPill, screensPill } from './screens-ui.js';
import { behindPill, poolSummaryText } from './group-detail.js';
import { classifyGroupsByPoolVariant, findDefaultPoolVariantForFrame, getCurrentFrameSelectIndex } from './pools.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initGroupsPanel(context) {
  ctx = context;
}

function snapshotAccordionOpenState() {
  /** @type {Set<string>} */
  const pools = new Set();
  /** @type {Set<string>} */
  const variants = new Set();
  if (!ctx.groupsTree) return { pools, variants };
  ctx.groupsTree.querySelectorAll('details.pool-accordion[data-pool-id]').forEach((el) => {
    const d = /** @type {HTMLDetailsElement} */ (el);
    const id = el.getAttribute('data-pool-id') || '';
    if (id && d.open) pools.add(id);
  });
  ctx.groupsTree.querySelectorAll('details.variant-accordion[data-variant-key]').forEach((el) => {
    const d = /** @type {HTMLDetailsElement} */ (el);
    const k = el.getAttribute('data-variant-key') || '';
    if (k && d.open) variants.add(k);
  });
  return { pools, variants };
}

/**
 * @param {string} poolId
 * @param {{ pools: Set<string>, variants: Set<string> }} snap
 * @param {number} poolIndex
 * @param {number|null} defaultPoolIndex
 */
function poolShouldBeOpen(poolId, snap, poolIndex, defaultPoolIndex) {
  if (snap.pools.has(poolId)) return true;
  for (const vk of snap.variants) {
    if (vk.startsWith(`${poolId}::`)) return true;
  }
  const fresh = snap.pools.size === 0 && snap.variants.size === 0;
  if (fresh) return defaultPoolIndex != null ? poolIndex === defaultPoolIndex : poolIndex === 0;
  return false;
}

/**
 * @param {string} poolId
 * @param {string} variantId
 * @param {{ pools: Set<string>, variants: Set<string> }} snap
 * @param {number} pi
 * @param {number} vi
 * @param {number|null} defaultPi
 * @param {number|null} defaultVi
 */
function variantShouldBeOpen(poolId, variantId, snap, pi, vi, defaultPi, defaultVi) {
  const k = `${poolId}::${variantId}`;
  if (snap.variants.has(k)) return true;
  const fresh = snap.pools.size === 0 && snap.variants.size === 0;
  if (fresh) return defaultPi != null && defaultVi != null ? pi === defaultPi && vi === defaultVi : pi === 0 && vi === 0;
  return false;
}

/**
 * @param {typeof groups[0]} g
 */
export function createGroupRow(g) {
  const row = document.createElement('div');
  row.className = 'group-row';
  row.tabIndex = 0;
  row.role = 'button';
  row.dataset.groupId = g.id;
  const layers = g.criteria?.layers || [];
  const isObj = Array.isArray(layers) && layers.includes(2);
  const isBg = Array.isArray(layers) && layers.includes(0) && !layers.includes(2);
  row.classList.add(isBg && !isObj ? 'bg-kind' : 'obj-kind');
  if (ctx.selectedGroupId === g.id) row.classList.add('group-selected');
  const badge = document.createElement('span');
  badge.className = 'badge ' + (isBg && !isObj ? 'badge-bg' : 'badge-obj');
  badge.textContent = isBg && !isObj ? 'BG' : 'OBJ';
  const name = document.createElement('span');
  name.className = 'group-name';
  name.textContent = g.name || g.id;
  name.style.flex = '1';
  name.style.overflow = 'hidden';
  name.style.textOverflow = 'ellipsis';
  row.appendChild(badge);
  // A group limited to some screens shows that instead of where its tiles appear (in its details).
  const pill = screenLimitPill(g) || screensPill(g);
  if (pill) row.appendChild(pill);
  const when = conditionPill(g);
  if (when) row.appendChild(when);
  const behind = behindPill(g);
  if (behind) row.appendChild(behind);
  if (layerArtOf(g)) {
    const opPill = document.createElement('span');
    opPill.className = 'screens-pill touch-up-pill overpaint-pill';
    opPill.textContent = 'overpaint';
    opPill.title = 'Has overpaint: a picture pinned to this layer’s map, painted over its tiles (or instead of them). Edit it in SpriteStudio.';
    row.appendChild(opPill);
  } else if (touchUpOf(g)) {
    const tuPill = document.createElement('span');
    tuPill.className = 'screens-pill touch-up-pill';
    tuPill.textContent = 'touch-up';
    tuPill.title = 'Has an old touch-up: paint pinned to the tiles around the anchor. SpriteStudio turns it into overpaint when you open the project there.';
    row.appendChild(tuPill);
  }
  row.appendChild(name);
  row.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    // Selecting stays idempotent: letting go is Esc or the Deselect button, so clicking a
    // group you thought was not selected never silently drops it. It also selects the
    // group's tiles on this frame, turning on any world or layer that hid them.
    ctx.selectGroupFromTree(g);
  });
  row.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      row.click();
    }
  });
  return row;
}

/** The group list, then the quick search over it. */
export function updateGroupsPanel() {
  buildGroupsPanel();
  applyGroupSearch();
}

/**
 * The group list's quick search (src/group-search.js): what the box holds — empty shows every
 * group — and which pools and variants were open before a search opened the ones with matches.
 */
let groupQuery = '';
let accordionBeforeSearch = /** @type {ReturnType<typeof snapshotAccordionOpenState> | null} */ (null);
let restoreAccordionAfterSearch = /** @type {ReturnType<typeof snapshotAccordionOpenState> | null} */ (null);

/** "On this frame": only groups with tiles on the frame on screen (remembered in this browser). */
const GROUPS_ON_FRAME_KEY = 'painter.groupsOnThisFrame';
let groupsOnFrameOnly = (() => {
  try {
    return localStorage.getItem(GROUPS_ON_FRAME_KEY) === '1';
  } catch {
    return false;
  }
})();
/** The frame on screen's group index (src/group-screens.js), worked out once per frame. */
let currentFrameIndexMemo = { state: /** @type {any} */ (null), index: /** @type {any} */ (null) };
function currentFrameGroupIndex() {
  if (!ctx.currentState) return null;
  if (currentFrameIndexMemo.state !== ctx.currentState) currentFrameIndexMemo = { state: ctx.currentState, index: frameGroupIndex(ctx.currentState, 0) };
  return currentFrameIndexMemo.index;
}

/** Only the rows matching the search (and, with On this frame, on the frame), in pools and variants opened to show them. */
function applyGroupSearch() {
  if (!ctx.groupsTree) return;
  const q = groupQuery.trim();
  const count = document.getElementById('group-search-count');
  ctx.groupsTree.querySelector('.group-search-empty')?.remove();
  const rows = /** @type {HTMLElement[]} */ ([...ctx.groupsTree.querySelectorAll('.group-row')]);
  const sections = /** @type {HTMLDetailsElement[]} */ ([...ctx.groupsTree.querySelectorAll('details')]);
  const frameIndex = groupsOnFrameOnly ? currentFrameGroupIndex() : null;
  if (!q && !frameIndex) {
    for (const r of rows) r.hidden = false;
    for (const d of sections) d.hidden = false;
    if (count) count.textContent = '';
    return;
  }
  const byId = new Map(ctx.groups.map((g) => [g.id, g]));
  const found = new Set();
  for (const r of rows) {
    const g = byId.get(r.dataset.groupId);
    const ok = !!g && matchesGroupQuery(g, q) && (!frameIndex || groupInFrame(g, frameIndex));
    r.hidden = !ok;
    if (ok) found.add(g.id);
  }
  // Innermost first, so a pool sees whether its variants kept any rows.
  for (const d of sections.reverse()) {
    const any = [...d.querySelectorAll('.group-row')].some((r) => !(/** @type {HTMLElement} */ (r)).hidden);
    d.hidden = !any;
    if (any) d.open = true;
  }
  if (count) count.textContent = `${found.size} of ${ctx.groups.length}`;
  if (!found.size) {
    const none = document.createElement('div');
    none.className = 'variant-empty group-search-empty';
    none.textContent = q ? `No groups match “${q}”${frameIndex ? ' on this frame' : ''}.` : 'No groups have tiles on this frame.';
    ctx.groupsTree.prepend(none);
  }
}

function setGroupQuery(text) {
  const was = groupQuery.trim();
  const now = String(text || '').trim();
  if (!was && now && ctx.groupsTree && !groupsOnFrameOnly) accordionBeforeSearch = snapshotAccordionOpenState();
  groupQuery = String(text || '');
  const box = /** @type {HTMLInputElement|null} */ (document.getElementById('group-search'));
  if (box && box.value !== groupQuery) box.value = groupQuery;
  if (was && !now && !groupsOnFrameOnly) {
    // Back to the pools and variants that were open before the search.
    restoreAccordionAfterSearch = accordionBeforeSearch;
    accordionBeforeSearch = null;
    updateGroupsPanel();
  } else applyGroupSearch();
}

/** The search box: filters on every keystroke; Enter selects the first match, ↓ moves into the list, Esc clears; Ctrl+K jumps to it. */
export function bindGroupSearch() {
  const box = /** @type {HTMLInputElement|null} */ (document.getElementById('group-search'));
  if (!box) return;
  const firstRow = () => /** @type {HTMLElement|null} */ ([...(ctx.groupsTree?.querySelectorAll('.group-row') || [])].find((r) => !(/** @type {HTMLElement} */ (r)).hidden) || null);
  box.addEventListener('input', () => setGroupQuery(box.value));
  const onFrame = /** @type {HTMLInputElement|null} */ (document.getElementById('group-on-frame'));
  if (onFrame) {
    onFrame.checked = groupsOnFrameOnly;
    onFrame.addEventListener('change', () => {
      const was = groupsOnFrameOnly || !!groupQuery.trim();
      groupsOnFrameOnly = onFrame.checked;
      try {
        localStorage.setItem(GROUPS_ON_FRAME_KEY, groupsOnFrameOnly ? '1' : '0');
      } catch {
        /* not remembered */
      }
      if (groupsOnFrameOnly && !groupQuery.trim() && !accordionBeforeSearch) accordionBeforeSearch = snapshotAccordionOpenState();
      if (was && !groupsOnFrameOnly && !groupQuery.trim()) {
        restoreAccordionAfterSearch = accordionBeforeSearch;
        accordionBeforeSearch = null;
        updateGroupsPanel();
      } else applyGroupSearch();
    });
  }
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      firstRow()?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (box.value) setGroupQuery('');
      else box.blur();
    } else if (e.key === 'ArrowDown') {
      const row = firstRow();
      if (row) {
        e.preventDefault();
        row.focus();
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      box.focus();
      box.select();
    }
  });
}

function buildGroupsPanel() {
  if (!ctx.groupsTree) return;
  const curIdx = getCurrentFrameSelectIndex();
  const frameChangedForAccordion = ctx.lastFrameIndexForGroupsAccordion !== curIdx;
  const snap = restoreAccordionAfterSearch
    || (frameChangedForAccordion ? { pools: new Set(), variants: new Set() } : snapshotAccordionOpenState());
  restoreAccordionAfterSearch = null;
  ctx.groupsTree.innerHTML = '';
  ctx.lastFrameIndexForGroupsAccordion = curIdx;
  if (!ctx.groups.length) {
    const empty = document.createElement('div');
    empty.className = 'variant-empty';
    empty.style.lineHeight = '1.4';
    if (!ctx.packHadGroupsJsonOnLoad) {
      empty.innerHTML =
        ctx.memoryAnalysisSeededPools && ctx.gameStatePools.length > 0
          ? '<strong>New pack</strong> — no <code>groups.json</code> on disk; <code>gameStatePools</code> are <strong>auto-seeded</strong> from <code>manifest.memoryAnalysis</code> (first candidate per state → <code>__default__</code>). Use <strong>New group from selection…</strong>, then <strong>Save .vbpack</strong> to persist.'
          : '<strong>New pack</strong> — no <code>groups.json</code> in the zip yet. Use <strong>New group from selection…</strong> (legacy / unassigned pool is fine) or <strong>Save .vbpack</strong> to create the file. If you run memory analysis, save an annotated manifest so Painter can seed pools automatically.';
    } else {
      empty.textContent = 'No groups yet — use New group from selection…';
    }
    ctx.groupsTree.appendChild(empty);
    return;
  }

  const def = findDefaultPoolVariantForFrame();
  const defaultPi = def?.poolIndex ?? null;
  const defaultVi = def?.variantIndex ?? null;

  appendSharedGroupsSection();

  if (!ctx.gameStatePools.length) {
    const wrap = document.createElement('details');
    wrap.className = 'pool-accordion';
    wrap.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `All groups (${ctx.groups.length})`;
    wrap.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'pool-body';
    const ul = document.createElement('ul');
    ul.className = 'groups-in-variant';
    for (const g of ctx.groups) {
      ul.appendChild(createGroupRow(g));
    }
    body.appendChild(ul);
    wrap.appendChild(body);
    ctx.groupsTree.appendChild(wrap);
    return;
  }

  const { byVariant, legacy } = classifyGroupsByPoolVariant();

  for (let pi = 0; pi < ctx.gameStatePools.length; pi++) {
    const p = ctx.gameStatePools[pi];
    const poolId = typeof p?.id === 'string' ? p.id : `pool-${pi}`;
    const poolLabel = typeof p?.label === 'string' && p.label.trim() ? p.label.trim() : poolId;

    const poolDetails = document.createElement('details');
    poolDetails.className = 'pool-accordion';
    poolDetails.dataset.poolId = poolId;
    poolDetails.open = poolShouldBeOpen(poolId, snap, pi, defaultPi);

    const pSum = document.createElement('summary');
    pSum.textContent = poolLabel;
    poolDetails.appendChild(pSum);

    const poolBody = document.createElement('div');
    poolBody.className = 'pool-body';

    const variants = Array.isArray(p?.variants) ? p.variants : [];
    if (variants.length === 0) {
      const miss = document.createElement('div');
      miss.className = 'variant-empty';
      miss.textContent = 'No variants in this pool.';
      poolBody.appendChild(miss);
    } else if (variants.length === 1) {
      const v = variants[0];
      const variantId = typeof v?.id === 'string' ? v.id.trim() : 'default';
      const variantLabel = typeof v?.label === 'string' && v.label.trim() ? v.label.trim() : variantId;
      pSum.textContent = `${poolLabel} · ${variantLabel}`;
      const vKey = `${poolId}::${variantId}`;
      const bucket = byVariant.get(vKey) || [];
      if (bucket.length === 0) {
        const z = document.createElement('div');
        z.className = 'variant-empty';
        z.textContent = 'No groups reference this variant.';
        poolBody.appendChild(z);
      } else {
        const ul = document.createElement('ul');
        ul.className = 'groups-in-variant';
        for (const g of bucket) ul.appendChild(createGroupRow(g));
        poolBody.appendChild(ul);
      }
    } else {
      for (let vi = 0; vi < variants.length; vi++) {
        const v = variants[vi];
        const variantId = typeof v?.id === 'string' ? v.id.trim() : `v-${vi}`;
        const variantLabel = typeof v?.label === 'string' && v.label.trim() ? v.label.trim() : variantId;
        const vKey = `${poolId}::${variantId}`;
        const bucket = byVariant.get(vKey) || [];

        const vDetails = document.createElement('details');
        vDetails.className = 'variant-accordion';
        vDetails.dataset.variantKey = vKey;
        vDetails.open = variantShouldBeOpen(poolId, variantId, snap, pi, vi, defaultPi, defaultVi);

        const vSum = document.createElement('summary');
        vSum.textContent = `${variantLabel} (${bucket.length})`;
        vDetails.appendChild(vSum);

        const vBody = document.createElement('div');
        vBody.className = 'variant-body';
        if (bucket.length === 0) {
          const z = document.createElement('div');
          z.className = 'variant-empty';
          z.textContent = 'No groups reference this variant.';
          vBody.appendChild(z);
        } else {
          const ul = document.createElement('ul');
          ul.className = 'groups-in-variant';
          for (const g of bucket) ul.appendChild(createGroupRow(g));
          vBody.appendChild(ul);
        }
        vDetails.appendChild(vBody);
        poolBody.appendChild(vDetails);
      }
    }
    poolDetails.appendChild(poolBody);
    ctx.groupsTree.appendChild(poolDetails);
  }

  if (legacy.length) {
    const leg = document.createElement('details');
    leg.className = 'pool-accordion legacy-pool';
    leg.dataset.poolId = '__legacy__';
    leg.open = snap.pools.has('__legacy__');
    const s = document.createElement('summary');
    s.textContent = `Legacy & unassigned (${legacy.length})`;
    leg.appendChild(s);
    const lb = document.createElement('div');
    lb.className = 'pool-body';
    const ul = document.createElement('ul');
    ul.className = 'groups-in-variant';
    for (const g of legacy) ul.appendChild(createGroupRow(g));
    lb.appendChild(ul);
    leg.appendChild(lb);
    ctx.groupsTree.appendChild(leg);
  }
}

export function updatePoolSummary() {
  if (ctx.poolSummary) ctx.poolSummary.innerHTML = poolSummaryText();
  // Memory pools come from Analyze memory; a pack without them has nothing to show here.
  const panel = document.getElementById('pool-panel');
  if (panel) panel.hidden = !ctx.gameStatePools.length;
}
