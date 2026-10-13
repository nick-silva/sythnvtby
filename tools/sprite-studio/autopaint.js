/**
 * SpriteStudio's Auto-paint dialog: pick the poses to learn from and the poses to paint, then
 * colour the second from the first (src/pose-autopaint.js) as one undoable change. Only pixels
 * nobody chose a colour for are painted. Split out like the other parts: tools/sprite-studio.js
 * passes in the state and functions it shares (initAutopaint).
 */
import { frameState, poseBounds, poseTileLookup, shadeAt, paintTilePixel, paintTargetGroupFor, patternShades } from '../shared/pack-session.js';
import { isObjGroup } from '../../src/obj-sprite-profiles.js';
import { isStarterShade } from '../../src/starter-paint.js';
import { originalShade } from '../../src/original-view.js';
import { autopaint, paintedShare, REFERENCE_SHARE } from '../../src/pose-autopaint.js';
import { pushUndo } from './history.js';
import { colourForHash, paintStore } from './ghost-box.js';
import { renderStrip } from './poses.js';
import { drawStage, invalidateRender } from './render.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initAutopaint(context) {
  ctx = context;
  ctx.el('autopaint-run').addEventListener('click', run);
  ctx.el('autopaint-cancel').addEventListener('click', () => {
    if (running) stopAsked = true;
    else ctx.el('autopaint-dialog').close();
  });
  ctx.el('autopaint-refs-painted').addEventListener('click', () => pickDefaults({ refs: true }));
  ctx.el('autopaint-targets-rest').addEventListener('click', () => pickDefaults({ targets: true }));
  ctx.el('autopaint-targets-none').addEventListener('click', () => {
    for (const row of rows) row.paint.checked = false;
    syncRun();
  });
  // Esc while painting stops it instead of leaving it running behind a closed window.
  ctx.el('autopaint-dialog').addEventListener('cancel', (e) => {
    if (!running) return;
    e.preventDefault();
    stopAsked = true;
  });
}

/** One row per pose: its grid, the patterns it draws, and its two ticks. */
let rows = [];
let running = false;
let stopAsked = false;

/**
 * A pose as auto-paint sees it, from the frame it was captured on: per lit pixel, its shade, its
 * pattern pixel, the colour someone chose (`c`) and, separately, a starting grey left on a painted
 * tile (`starter`), which counts as the colour only in a reference.
 */
function poseGrid(view, id) {
  const state = view.origin && view.frameIndex >= 0 ? frameState(ctx.session, view.frameIndex) : null;
  const bounds = state ? poseBounds(view.pose, view.origin) : null;
  if (!bounds) return null;
  const lookup = poseTileLookup(state, view.pose, view.origin, ctx.eye());
  const w = bounds.x1 - bounds.x0;
  const h = bounds.y1 - bounds.y0;
  const px = [];
  const tiles = new Map();
  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const hit = lookup(x, y);
      const value = hit ? shadeAt(hit.tileBytes, hit.lx, hit.ly) : 0;
      if (!value) {
        px.push(null);
        continue;
      }
      const o = hit.ly * 8 + hit.lx;
      const buf = colourForHash(hit.hash);
      const lit = buf && buf[o * 4 + 3] === 255;
      const starter = lit && isStarterShade(buf, o, value);
      const rgb = lit ? [buf[o * 4], buf[o * 4 + 1], buf[o * 4 + 2]] : null;
      px.push({ s: originalShade(value, hit.draw, state.gplt), h: hit.hash, o, c: starter ? null : rgb, starter: starter ? rgb : null });
      if (!tiles.has(hit.hash)) tiles.set(hit.hash, { tileBytes: hit.tileBytes, frameIndex: view.frameIndex });
    }
  }
  return { grid: { id, w, h, px }, tiles };
}

/** Open the dialog for the selected group. */
export function openAutopaint() {
  if (ctx.el('autopaint-dialog').open) return;
  const group = ctx.selectedGroup;
  if (!group || ctx.poseViews.length < 2) {
    ctx.setStatus('Auto-paint needs a group with at least two poses: paint one, and it colours the others from it.');
    return;
  }
  rows = ctx.poseViews
    .map((view, i) => {
      const built = poseGrid(view, String(i));
      if (!built) return null;
      // A starting grey left on a painted tile (outlines, often) counts as painted here.
      const share = paintedShare({ ...built.grid, px: built.grid.px.map((q) => q && { ...q, c: q.c || q.starter }) });
      return { index: i, view, ...built, share };
    })
    .filter(Boolean);
  ctx.el('autopaint-title').textContent = `Auto-paint “${group.name || group.id}”`;
  renderRows();
  pickDefaults({ refs: true, targets: true });
  setProgress(0, 1, '');
  ctx.el('autopaint-dialog').showModal();
}

function renderRows() {
  const host = ctx.el('autopaint-list');
  host.textContent = '';
  for (const row of rows) {
    const card = document.createElement('div');
    card.className = 'autopaint-pose';
    const thumb = document.createElement('canvas');
    const source = /** @type {HTMLCanvasElement|null} */ (document.querySelector(`#pose-strip .pose-card[data-pose-index="${row.index}"] canvas`));
    if (source?.width) {
      thumb.width = source.width;
      thumb.height = source.height;
      thumb.getContext('2d')?.drawImage(source, 0, 0);
    }
    const name = document.createElement('span');
    name.className = 'autopaint-name';
    name.textContent = row.view.pose.name || row.view.pose.poseId;
    const share = document.createElement('span');
    share.className = 'autopaint-share';
    share.textContent = `${Math.round(row.share * 100)}% painted`;
    const tick = (label, title) => {
      const wrap = document.createElement('label');
      wrap.title = title;
      const box = document.createElement('input');
      box.type = 'checkbox';
      wrap.append(box, ` ${label}`);
      return { wrap, box };
    };
    const learn = tick('Learn from', 'Take colours from this pose. Its tiles are never repainted.');
    const paint = tick('Paint', 'Colour this pose’s unpainted pixels.');
    // One job per pose: ticking one unticks the other.
    learn.box.addEventListener('change', () => {
      if (learn.box.checked) paint.box.checked = false;
      syncRun();
    });
    paint.box.addEventListener('change', () => {
      if (paint.box.checked) learn.box.checked = false;
      syncRun();
    });
    row.learn = learn.box;
    row.paint = paint.box;
    card.append(thumb, name, share, learn.wrap, paint.wrap);
    host.append(card);
  }
}

/** References: poses nearly all painted. Targets: every other pose. */
function pickDefaults({ refs = false, targets = false }) {
  for (const row of rows) {
    if (refs) row.learn.checked = row.share >= REFERENCE_SHARE;
    if (targets) row.paint.checked = !row.learn.checked && row.share < 1;
    if (row.learn.checked) row.paint.checked = false;
  }
  syncRun();
}

function syncRun() {
  const refs = rows.filter((r) => r.learn.checked).length;
  const targets = rows.filter((r) => r.paint.checked).length;
  const runButton = /** @type {HTMLButtonElement} */ (ctx.el('autopaint-run'));
  runButton.disabled = running || !refs || !targets;
  if (running) return;
  ctx.el('autopaint-now').textContent = !refs
    ? 'Tick at least one pose to learn from — a pose you have painted.'
    : !targets
      ? 'Tick the poses to paint.'
      : `Learn from ${refs} pose${refs === 1 ? '' : 's'}, paint ${targets}.`;
}

function setProgress(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  ctx.el('autopaint-fill').style.width = `${pct}%`;
  ctx.el('autopaint-bar').setAttribute('aria-valuenow', String(pct));
  if (label) ctx.el('autopaint-now').textContent = label;
}

function setRunning(on) {
  running = on;
  for (const control of ctx.el('autopaint-dialog').querySelectorAll('input, .autopaint-quick button')) {
    /** @type {HTMLInputElement} */ (control).disabled = on;
  }
  ctx.el('autopaint-cancel').textContent = on ? 'Stop' : 'Cancel';
  syncRun();
}

async function run() {
  const group = ctx.selectedGroup;
  const refs = rows.filter((r) => r.learn.checked);
  const targets = rows.filter((r) => r.paint.checked);
  if (!group || !refs.length || !targets.length) return;
  stopAsked = false;
  setRunning(true);
  try {
    const refIds = new Set(refs.map((r) => r.grid.id));
    // In a reference, a starting grey left on purpose (outlines, say) is its colour.
    const poses = rows.map((r) =>
      refIds.has(r.grid.id) ? { ...r.grid, px: r.grid.px.map((q) => (q && !q.c && q.starter ? { ...q, c: q.starter } : q)) } : r.grid,
    );
    const nameOf = new Map(rows.map((r) => [r.grid.id, r.view.pose.name || r.view.pose.poseId]));
    const result = await autopaint({
      poses,
      referenceIds: [...refIds],
      targetIds: targets.map((r) => r.grid.id),
      onProgress: ({ done, total, label }) => setProgress(done, total, label.replace(/^Painting (\S+)/, (_, id) => `Painting ${nameOf.get(id) ?? id}`)),
      shouldStop: () => stopAsked,
    });
    if (result.stopped) {
      setProgress(0, 1, 'Stopped — nothing was painted.');
      return;
    }
    const changed = applyFills(group, result.fills, rows);
    ctx.el('autopaint-dialog').close();
    ctx.setStatus(
      changed
        ? `Auto-painted ${changed.toLocaleString()} px on ${result.posesPainted} pose${result.posesPainted === 1 ? '' : 's'} from ${refs.length} reference${refs.length === 1 ? '' : 's'}. Check with Original (hold O); Ctrl+Z takes it all back.`
        : 'Auto-paint found nothing left to paint on those poses.',
    );
  } catch (err) {
    console.error('Auto-paint failed', err);
    setProgress(0, 1, `Auto-paint failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setRunning(false);
  }
}

/** Write the colours into the group's paint as one undo step; a colour someone chose stays. */
function applyFills(group, fills, poseRows) {
  const tiles = new Map();
  for (const r of poseRows) for (const [h, t] of r.tiles) if (!tiles.has(h)) tiles.set(h, t);
  const target = paintTargetGroupFor(group);
  const store = paintStore();
  const snapshot = new Map();
  let changed = 0;
  for (const [hash, pixels] of fills) {
    const tile = tiles.get(hash);
    if (!tile) continue;
    const before = store.get(hash);
    const prev = before ? Uint8Array.from(before) : null;
    const shades = isObjGroup(group) ? null : patternShades(frameState(ctx.session, tile.frameIndex), hash);
    let here = 0;
    for (const [o, rgb] of pixels) {
      const value = shadeAt(tile.tileBytes, o % 8, o >> 3);
      const now = colourForHash(hash);
      if (now && now[o * 4 + 3] === 255 && !isStarterShade(now, o, value)) continue;
      if (paintTilePixel(ctx.session, hash, tile.tileBytes, o % 8, o >> 3, { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 }, target, shades)) here++;
    }
    if (here) {
      snapshot.set(hash, prev);
      changed += here;
    } else if (!prev && store.has(hash)) {
      store.delete(hash); // a buffer started for nothing
    }
  }
  if (!changed) return 0;
  pushUndo({ groupId: target?.id ?? null, map: snapshot });
  ctx.markDirty();
  invalidateRender();
  drawStage();
  renderStrip();
  ctx.renderPalette();
  return changed;
}
