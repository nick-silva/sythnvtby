/**
 * The Project tool's inspector: This pixel (what colours it, or why not, with one fix), the
 * inspector panel for the tiles under the pointer, and the developer details. Split out of tools/painter.js, which passes in the state and functions it shares (initInspector).
 */
import { getTileBytes, hashTile, isBlankTile } from '../../src/vip-state.js';
import { getCompositeDrawOwners, getCompositePixelInfo } from '../../src/color-layer.js';
import { explainPixel } from '../../src/pixel-explain.js';
import { wramForFrameIndex } from './frame-data.js';
import { updatePaintV2TopButton } from './pack-rules.js';
import { drawEye, filterStateForView, getEye } from './view-filters.js';
import { groupsOnThisFrame } from './screens-ui.js';
import { reorderGroup, setGroupWorlds } from './group-detail.js';
import { getCurrentFrameSelectIndex } from './pools.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initInspector(context) {
  ctx = context;
  initDevDetails();
}

/* ------------------------------------------------- "This pixel": what colours it, or why not */
// One sentence and at most one fix (src/pixel-explain.js); the raw tile data and every draw under
// the pixel sit in the collapsed Details below it.

/** Explain the clicked pixel again: the next render does it, from its own composite. */
export function explainInspectPoint() {
  ctx.render();
}

/** Right after render's composite, while its per-pixel record is this frame's and this eye's. */
export function explainFromComposite(viewState) {
  if (!ctx.inspectPoint) return;
  ctx.inspectAnswer = explainPixel({
    state: viewState,
    eye: getEye(),
    x: ctx.inspectPoint.x,
    y: ctx.inspectPoint.y,
    pack: ctx.pack,
    groups: groupsOnThisFrame(),
    allGroups: ctx.groups,
    overrides: ctx.overrides,
    gameStatePools: ctx.gameStatePools,
    wram: wramForFrameIndex(getCurrentFrameSelectIndex() ?? -1),
    info: getCompositePixelInfo(),
    owners: getCompositeDrawOwners(),
  });
  renderInspectorAnswer();
}

function renderInspectorAnswer() {
  const box = document.getElementById('inspector-answer');
  const whyBox = document.getElementById('inspector-why');
  if (!box) return;
  const e = ctx.inspectAnswer;
  if (!e || !ctx.inspectPoint) {
    box.innerHTML = '<span class="muted">Click the frame to see what colours a pixel, or why nothing does.</span>';
    if (whyBox) whyBox.innerHTML = '';
    return;
  }
  const filtered = ctx.worldFilter !== 'all' || (ctx.layerSelect && ctx.layerSelect.value !== 'all');
  const why = [...e.why, ...(filtered ? ['View filters are on: hidden worlds and layers are left out of this answer.'] : [])];
  box.innerHTML = `<p class="inspector-answer-line is-${e.status}">${ctx.escapeHtml(e.sentence)}</p>`
    + (e.fix ? `<button type="button" class="btn-ghost inspector-fix" id="btn-inspector-fix">${ctx.escapeHtml(e.fix.label)}</button>` : '')
    + (e.reorder ? `<button type="button" class="btn-ghost inspector-fix" id="btn-inspector-reorder" title="Move it just above the group that wins now, in the group list">${ctx.escapeHtml(e.reorder.label)}</button>` : '');
  if (whyBox) whyBox.innerHTML = why.map((t) => `<p>${ctx.escapeHtml(t)}</p>`).join('');
  document.getElementById('btn-inspector-fix')?.addEventListener('click', () => applyInspectorFix(e.fix));
  const reorder = e.reorder;
  if (reorder) document.getElementById('btn-inspector-reorder')?.addEventListener('click', () => reorderGroup(reorder.groupId, reorder.beforeId));
}

/** @param {NonNullable<ReturnType<typeof explainPixel>['fix']>} fix */
function applyInspectorFix(fix) {
  if (fix.kind === 'new-group') {
    document.getElementById('btn-new-group-from-selection')?.click();
    return;
  }
  const g = ctx.groups.find((x) => x.id === fix.groupId);
  if (!g) return;
  if (fix.kind === 'add-world') {
    const own = (g.criteria?.windowIds || []).map(Number);
    setGroupWorlds(g.id, [...new Set([...own, fix.world])].sort((a, b) => a - b));
    return;
  }
  const point = ctx.inspectPoint;
  ctx.selectGroupFromTree(g);
  // Selecting a group selects its tiles; the pixel being explained stays the one clicked.
  ctx.inspectPoint = point;
  explainInspectPoint();
}

/** The overlay opacity slider, only while an overlay can show: the screenshot's, or a reference. */
export function syncOverlayAlphaUi(hasReference = !!ctx.activeReferenceMeta && ctx.referenceUrls.has(ctx.activeReferenceMeta.refId)) {
  const wrap = document.getElementById('overlay-alpha-wrap');
  if (wrap) wrap.hidden = !(ctx.screenshotOverlayEnabled || hasReference);
}

/** Project ▸ Developer details: debugging numbers and notes (`.dev-only`), off until asked for. */
const DEV_DETAILS_KEY = 'vbc.devDetails';
function initDevDetails() {
  const box = /** @type {HTMLInputElement|null} */ (document.getElementById('toggle-dev-details'));
  let on = false;
  try {
    on = localStorage.getItem(DEV_DETAILS_KEY) === '1';
  } catch {
    /* not remembered: off */
  }
  document.body.classList.toggle('dev-details', on);
  if (!box) return;
  box.checked = on;
  box.addEventListener('change', () => {
    document.body.classList.toggle('dev-details', box.checked);
    try {
      localStorage.setItem(DEV_DETAILS_KEY, box.checked ? '1' : '0');
    } catch {
      /* not remembered */
    }
  });
}


export function updateInspector(hits) {
  if (!ctx.inspector) return;
  if (!ctx.currentState?.patternTable || hits == null || hits.length === 0) {
    ctx.inspector.innerHTML = '<span class="muted">No tile clicked yet.</span>';
    updatePaintV2TopButton();
    return;
  }
  const view = filterStateForView(ctx.currentState);
  const drawList = view.drawList;
  const i = hits[0];
  const d = drawList[i];
  const tileBytes = getTileBytes(ctx.currentState.patternTable, d.tileIndex);
  const h = hashTile(tileBytes);
  const layerName = d.layer === 0 ? 'BG' : d.layer === 1 ? 'Affine' : d.layer === 2 ? 'OBJ' : '?';
  let nSame = 0;
  for (const call of ctx.currentState.drawList) {
    if (drawEye(call) !== getEye()) continue;
    const tb = getTileBytes(ctx.currentState.patternTable, call.tileIndex);
    if (hashTile(tb) === h) nSame++;
  }
  const under =
    hits.length > 1
      ? `<div style="margin-top:0.35rem;font-size:0.72rem;color:#e8a060"><strong>${hits.length - 1}</strong> other tile(s) under this one — only the front tile is detailed below.</div>`
      : '';
  ctx.inspector.innerHTML = `
    <div><strong>Hash</strong> #${h.toString(16).toUpperCase()}</div>
    <div><strong>Tile index</strong> ${d.tileIndex}</div>
    <div><strong>Layer</strong> ${layerName}</div>
    <div><strong>World</strong> ${d.world ?? '—'}</div>
    <div><strong>Appears</strong> ${nSame}× in this frame (${getEye() === 0 ? 'L' : 'R'} eye)${
      nSame > 24 ? ' <span style="color:var(--accent-warm)">— matches widely; prefer an anchor</span>' : ''
    }${isBlankTile(tileBytes) ? ' <span style="color:var(--accent-warm)">· blank tile</span>' : ''}</div>
    ${under}
    <pre>${JSON.stringify({ x: d.x, y: d.y, flipH: d.flipH, flipV: d.flipV, eye: d.eye }, null, 0)}</pre>
  `;
  updatePaintV2TopButton();
}
