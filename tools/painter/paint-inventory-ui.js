/**
 * The Project tool's paint inventory: every painted pattern listed with where its paint lives,
 * moving paint into the selected group and clearing it; also clearing a group's paint. Split out of tools/painter.js, which passes in the state and functions it shares
 * (initPaintInventoryUi).
 */
import { decodeGroupTileColors, withoutAnyGroupTileColor } from '../../src/group-tile-colors.js';
import { buildPaintInventory, PAINT_SOURCE } from '../../src/paint-inventory.js';
import { createSaveProgressUi } from '../shared/save-progress-ui.js';
import { normalizeGroup } from '../../src/group-schema.js';
import { updatePaintV2TopButton } from './pack-rules.js';
import { getEye } from './view-filters.js';
import { getSelectedPaintGroupOrNull } from './zoom-target.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initPaintInventoryUi(context) {
  ctx = context;
}

/**
 * Throw away the paint on a group's tile patterns, to start it over.
 *
 * A group's own colours only affect that group, so clearing them is safe. Colours in the
 * global pack are keyed by pattern alone, so a pattern this group shares with another loses
 * its colour there too — the confirmation says how many are shared and with whom. Recorded as
 * one paint-undo entry, so Ctrl+Z brings it back if the answer was wrong.
 */
export function clearPaintForGroup(g) {
  const own = decodeGroupTileColors(ctx.groups.find((x) => x.id === g.id) ?? g);
  const hashes = (g?.criteria?.hashes || []).map((h) => Number(h) >>> 0);
  const globallyPainted = hashes.filter((h) => ctx.pack.has(h));
  // An anchored group keeps its paint in a positional overlay, so clearing has to reach that
  // too — otherwise Clear paint silently does nothing on exactly the groups that use it.
  const overlays = [];
  for (const [eye, buf] of ctx.vipAuthoringByGroupAndEye.get(g.id) ?? []) {
    let painted = 0;
    for (let i = 3; i < buf.length; i += 4) if (buf[i] !== 0) painted++;
    if (painted) overlays.push({ eye, buf, painted });
  }
  if (!own.size && !globallyPainted.length && !overlays.length) {
    ctx.setStatus(`“${g.name || g.id}” has no paint to clear.`);
    return;
  }
  const sharedWith = new Map();
  for (const other of ctx.groups) {
    if (other.id === g.id) continue;
    const theirs = new Set((other.criteria?.hashes || []).map((h) => Number(h) >>> 0));
    const n = globallyPainted.filter((h) => theirs.has(h)).length;
    if (n > 0) sharedWith.set(other.name || other.id, n);
  }
  const sharedNote = sharedWith.size
    ? `\n\n${[...sharedWith].map(([name, n]) => `• ${n} of them are also in “${name}”`).join('\n')}\n`
      + 'Those groups lose that paint too, because colour in the pack is stored per tile pattern.'
    : '';
  const lines = [];
  if (own.size) lines.push(`• ${own.size} colour(s) this group owns — only this group changes`);
  for (const o of overlays) {
    lines.push(`• its anchored overlay on the ${o.eye === 1 ? 'right' : 'left'} eye — only this group changes`);
  }
  if (globallyPainted.length) lines.push(`• ${globallyPainted.length} pattern(s) painted in the shared pack`);
  const ok = window.confirm(
    `Clear the paint on “${g.name || g.id}”?\n\n${lines.join('\n')}${sharedNote}\n\n`
      + 'Ctrl+Z undoes this. It is written to the pack only when you save.',
  );
  if (!ok) return;

  // One undo entry covers both stores, so a single Ctrl+Z puts the group back as it was.
  const entry = { kind: 'clear', groupId: g.id, groupMap: new Map(), packMap: new Map(), overlayMap: new Map() };
  for (const [h, rgba] of own) entry.groupMap.set(h, Uint8Array.from(rgba));
  for (const h of globallyPainted) entry.packMap.set(h, Uint8Array.from(ctx.pack.get(h)));
  for (const o of overlays) entry.overlayMap.set(o.eye, Uint8Array.from(o.buf));
  if (own.size) {
    ctx.groups = ctx.groups.map((x) => (x.id === g.id ? withoutAnyGroupTileColor(x) : x));
    ctx.markGroupsDirty();
  }
  for (const h of globallyPainted) ctx.pack.delete(h);
  for (const o of overlays) o.buf.fill(0);
  ctx.paintEditsSinceSave++;
  ctx.pushPaintUndo(entry);
  ctx.render();
  ctx.updateGroupDetail(ctx.groups.find((x) => x.id === g.id) ?? g);
  if (ctx.paintInventoryDialog?.open) renderPaintInventory();
  ctx.setStatus(
    `Cleared paint on “${g.name || g.id}”: ${own.size} group colour(s), `
      + `${overlays.length} overlay(s), ${globallyPainted.length} shared pattern(s).`
      + ' Ctrl+Z undoes it; save to keep it.',
  );
}

/** A byte count the way a person reads it, for the save window. */
export function formatByteSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/* ------------------------------------------------------------- save progress */

export const saveUi = createSaveProgressUi();

/* ------------------------------------------------------ painted-tile inventory */

/**
 * Which rows the dialog is showing; kept across re-renders after a clear. Defaults to this
 * frame, because that is what someone looking at the canvas is asking about.
 */
let paintInventoryFilter = 'frame';

/** @param {string} value which painted patterns the inventory lists */
export function setPaintInventoryFilter(value) {
  paintInventoryFilter = value;
}

/** An 8×8 RGBA tile as a data URL, for the swatch next to each row. */
function tileSwatchDataUrl(rgba) {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const ctx2 = c.getContext('2d');
  if (!ctx2) return '';
  const img = ctx2.createImageData(8, 8);
  img.data.set(rgba.subarray(0, 256));
  ctx2.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** Which overlay rows are expanded into their individual tiles, keyed `groupId:eye`. */
const paintInventoryExpanded = new Set();

/** One 8×8 cell of a full-frame overlay, as a swatch. */
function overlayCellDataUrl(buf, x, y) {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const ctx2 = c.getContext('2d');
  if (!ctx2) return '';
  const img = ctx2.createImageData(8, 8);
  for (let row = 0; row < 8; row++) {
    const src = ((y + row) * ctx.W + x) * 4;
    img.data.set(buf.subarray(src, src + 32), row * 32);
  }
  ctx2.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** A thumbnail of the painted part of a full-frame overlay, cropped to its bounding box. */
function overlayThumbDataUrl(buf, box) {
  const full = document.createElement('canvas');
  full.width = ctx.W;
  full.height = ctx.H;
  const fctx = full.getContext('2d');
  if (!fctx) return '';
  const img = fctx.createImageData(ctx.W, ctx.H);
  img.data.set(buf);
  fctx.putImageData(img, 0, 0);
  const bw = Math.max(1, box.x1 - box.x0 + 1);
  const bh = Math.max(1, box.y1 - box.y0 + 1);
  const out = document.createElement('canvas');
  out.width = 24;
  out.height = 24;
  const octx = out.getContext('2d');
  if (!octx) return '';
  octx.imageSmoothingEnabled = false;
  // Fit the box inside the square without stretching it out of shape.
  const k = Math.min(24 / bw, 24 / bh);
  const dw = Math.max(1, Math.round(bw * k));
  const dh = Math.max(1, Math.round(bh * k));
  octx.drawImage(full, box.x0, box.y0, bw, bh, ((24 - dw) / 2) | 0, ((24 - dh) / 2) | 0, dw, dh);
  return out.toDataURL();
}

function paintInventoryRows() {
  const inv = buildPaintInventory({
    pack: ctx.pack,
    groups: ctx.groups,
    state: ctx.currentState,
    eye: getEye(),
    overlays: ctx.vipAuthoringByGroupAndEye,
  });
  const keep = {
    all: () => true,
    orphan: (e) => e.orphan,
    pack: (e) => e.source === PAINT_SOURCE.PACK,
    group: (e) => e.source !== PAINT_SOURCE.PACK,
    frame: (e) => e.draws > 0,
  }[paintInventoryFilter] || (() => true);
  return { inv, rows: inv.entries.filter(keep) };
}

/** "Move into the selected group" for a shared-pack row, disabled with the reason when it cannot. */
function moveButton(hash) {
  const { group, why } = moveTargetGroup();
  const label = group ? `→ ${ctx.escapeHtml(group.name || group.id)}` : '→ group';
  const title = group
    ? `Move this colour into “${ctx.escapeHtml(group.name || group.id)}”, so only that group has it and other copies of the pattern go back to unpainted.`
    : ctx.escapeHtml(why);
  return `<button type="button" class="btn-ghost" data-move-hash="${hash}"${group ? '' : ' disabled'} title="${title}">${label}</button>`;
}

export function renderPaintInventory() {
  const list = document.getElementById('paint-inventory-list');
  const summary = document.getElementById('paint-inventory-summary');
  if (!list || !summary) return;
  const { inv, rows } = paintInventoryRows();
  const t = inv.totals;
  summary.innerHTML = t.total === 0
    ? 'Nothing is painted in this project yet.'
    : `<strong>${t.total}</strong> painted item(s): <strong>${t.group}</strong> owned by a group, `
      + `<strong>${t.overlay}</strong> anchored overlay(s), <strong>${t.pack}</strong> in the shared pack. `
      + `<strong>${t.onFrame}</strong> show on this frame.`
      + (t.orphan
        ? ` <span style="color:var(--accent-warm)"><strong>${t.orphan}</strong> that no group can reach.</span>`
        : '');

  if (!rows.length) {
    list.innerHTML = `<div class="paint-inventory-empty">Nothing matches this filter.</div>`;
    return;
  }
  list.innerHTML = rows
    .map((e) => {
      const isOverlay = e.source === PAINT_SOURCE.OVERLAY;
      const label = isOverlay
        ? `<strong>${ctx.escapeHtml(e.groupName || '')}</strong> <span class="paint-row-where">· anchored overlay</span>`
        : `<code>#${e.hash.toString(16).toUpperCase()}</code>`;
      const seen = isOverlay
        ? e.draws
          ? `${e.cells} tile cell(s) painted · its anchor is on this frame`
          : `${e.cells} tile cell(s) painted · its anchor is not on this frame`
        : e.draws
          ? `${e.draws} draw(s) here${e.worlds.length ? ` · world ${e.worlds.join(', ')}` : ''}`
          : 'not on this frame';
      const where = isOverlay
        ? `painted by position, not by pattern — eye ${e.eye === 1 ? 'R' : 'L'}`
        : e.source === PAINT_SOURCE.GROUP
          ? `owned by “${ctx.escapeHtml(e.groupName || '')}”`
          : e.orphan
            ? `<span class="orphan-flag">shared pack · no group names it</span>`
            : `shared pack · in ${e.claimedBy.map((c) => `“${ctx.escapeHtml(c.name)}”`).join(', ')}`;
      const swatch = isOverlay ? overlayThumbDataUrl(e.rgba, e.box) : tileSwatchDataUrl(e.rgba);
      const key = isOverlay ? `${e.groupId}:${e.eye}` : '';
      const open = isOverlay && paintInventoryExpanded.has(key);
      const toggle = isOverlay
        ? `<button type="button" class="paint-expand" data-expand="${ctx.escapeHtml(key)}" aria-expanded="${open}"
            title="${open ? 'Hide' : 'Show'} the ${e.cells} tile(s) this overlay paints">${open ? '▾' : '▸'}</button>`
        : '';
      const head = `<div class="paint-row${e.orphan ? ' is-orphan' : ''}${isOverlay ? ' is-overlay' : ''}">
        <img class="paint-swatch" src="${swatch}" alt="" />
        <div class="paint-row-main">
          <div>${toggle}${label} <span class="paint-row-where">· ${seen}</span></div>
          <div class="paint-row-where">${where}</div>
        </div>
        <span class="paint-row-actions">${e.source === PAINT_SOURCE.PACK ? moveButton(e.hash) : ''}
        <button type="button" class="btn-ghost" data-clear-hash="${e.hash ?? ''}" data-clear-source="${e.source}"
          data-clear-group="${ctx.escapeHtml(e.groupId || '')}" data-clear-eye="${e.eye ?? ''}"
          title="${isOverlay ? 'Wipe every tile this overlay paints.' : 'Throw this colour away.'} Ctrl+Z undoes it; save the pack to keep it.">${isOverlay ? 'Clear all' : 'Clear'}</button></span>
      </div>`;
      if (!open) return head;
      // One row per painted tile, so a single tile can be cleared without losing the group.
      const kids = e.cellList
        .map((c) => `<div class="paint-row is-child">
          <img class="paint-swatch" src="${overlayCellDataUrl(e.rgba, c.x, c.y)}" alt="" />
          <div class="paint-row-main">
            <div><code>${c.x},${c.y}</code> <span class="paint-row-where">· ${c.pixels} painted pixel(s)</span></div>
            <div class="paint-row-where">in “${ctx.escapeHtml(e.groupName || '')}”${c.hash === null ? '' : ` · over pattern <code>#${c.hash.toString(16).toUpperCase()}</code>`}</div>
          </div>
          <button type="button" class="btn-ghost" data-clear-source="${PAINT_SOURCE.OVERLAY}"
            data-clear-group="${ctx.escapeHtml(e.groupId || '')}" data-clear-eye="${e.eye}"
            data-clear-cell="${c.x},${c.y}"
            title="Clear just this tile. Ctrl+Z undoes it; save the pack to keep it.">Clear</button>
        </div>`)
        .join('');
      return head + kids;
    })
    .join('');

  list.querySelectorAll('[data-expand]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-expand') || '';
      if (paintInventoryExpanded.has(key)) paintInventoryExpanded.delete(key);
      else paintInventoryExpanded.add(key);
      renderPaintInventory();
    });
  });
  list.querySelectorAll('[data-move-hash]').forEach((btn) => {
    btn.addEventListener('click', () => movePaintIntoSelectedGroup(Number(btn.getAttribute('data-move-hash')) >>> 0));
  });
  list.querySelectorAll('[data-clear-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cell = btn.getAttribute('data-clear-cell');
      clearPaintedPattern(
        Number(btn.getAttribute('data-clear-hash')) >>> 0,
        btn.getAttribute('data-clear-source'),
        btn.getAttribute('data-clear-group') || null,
        Number(btn.getAttribute('data-clear-eye')) & 1,
        cell ? cell.split(',').map(Number) : null,
      );
    });
  });
}

/** The BG group a pack colour could be moved into, or null with the reason it cannot be. */
function moveTargetGroup() {
  const g = getSelectedPaintGroupOrNull();
  if (!g) return { group: null, why: 'Select a BG group first — that is where the colour would go.' };
  if (g.authoringKind !== 'bg') {
    return { group: null, why: 'Only a BG group can own a colour; sprite patterns stay shared across poses.' };
  }
  return { group: g, why: '' };
}

/**
 * Move a colour out of the shared pack and into the selected group.
 *
 * The shared pack colours every copy of a pattern on every frame. A group owns its colour, so
 * the same pattern can be a different colour in each layer that draws it — this is how a tile
 * shared by a dozen worlds gets there. The group has to *claim* the pattern for its colour to
 * apply, so the hash joins its criteria if it is not already there; without that the moved
 * paint would simply vanish.
 */
function movePaintIntoSelectedGroup(hash) {
  const h = hash >>> 0;
  const { group: target, why } = moveTargetGroup();
  if (!target) {
    ctx.setStatus(why);
    return;
  }
  const rgba = ctx.pack.get(h);
  if (!rgba) {
    ctx.setStatus('That colour is no longer in the shared pack.');
    renderPaintInventory();
    return;
  }
  const criteriaHashes = (target.criteria?.hashes || []).map((v) => Number(v) >>> 0);
  const addedHash = !criteriaHashes.includes(h);
  const live = ctx.ensureGroupTileColorMap(target.id);
  const groupPrev = live.has(h) ? Uint8Array.from(live.get(h)) : null;

  ctx.pushPaintUndo({
    kind: 'move',
    groupId: target.id,
    hash: h,
    packPrev: Uint8Array.from(rgba),
    groupPrev,
    addedHash,
  });

  live.set(h, Uint8Array.from(rgba));
  ctx.pack.delete(h);
  if (addedHash) {
    ctx.groups = ctx.groups.map((x) =>
      x.id === target.id
        ? normalizeGroup({ ...x, criteria: { ...(x.criteria || {}), hashes: [...criteriaHashes, h] } })
        : x,
    );
  }
  ctx.markGroupsDirty();
  ctx.invalidateGroupColorIndex();
  ctx.paintEditsSinceSave++;
  ctx.render();
  ctx.updateGroupsPanel();
  ctx.updateGroupDetail(ctx.groups.find((x) => x.id === target.id) ?? target);
  updatePaintV2TopButton();
  renderPaintInventory();
  ctx.setStatus(
    `Moved #${h.toString(16).toUpperCase()} into “${target.name || target.id}”`
      + `${addedHash ? ' (added to its criteria so the group claims it)' : ''}`
      + '. Other copies of that pattern go back to unpainted. Ctrl+Z undoes it; save to keep it.',
  );
}

/**
 * Throw away one painted pattern, from whichever store holds it.
 *
 * This is the only way to reach a colour in the shared pack that no group's criteria name —
 * the group panel's *Clear paint* works through a group's hash list, so it cannot see one.
 */
function clearPaintedPattern(hash, source, groupId, overlayEye = 0, cell = null) {
  const h = hash >>> 0;
  if (source === PAINT_SOURCE.OVERLAY) {
    const buf = ctx.vipAuthoringByGroupAndEye.get(groupId)?.get(overlayEye & 1);
    if (!buf) {
      ctx.setStatus('That overlay is already gone.');
      renderPaintInventory();
      return;
    }
    const g = ctx.groups.find((x) => x.id === groupId);
    ctx.pushPaintUndo({ kind: 'vip', groupId, eye: overlayEye & 1, prev: Uint8Array.from(buf) });
    if (cell) {
      // One 8×8 tile of the overlay; the rest of the group's paint stays.
      const [cx, cy] = cell;
      for (let row = 0; row < 8; row++) {
        const start = ((cy + row) * ctx.W + cx) * 4;
        buf.fill(0, start, start + 32);
      }
    } else {
      buf.fill(0);
    }
    while (ctx.paintUndoStack.length > ctx.PAINT_UNDO_MAX) ctx.paintUndoStack.shift();
    ctx.paintEditsSinceSave++;
    ctx.render();
    updatePaintV2TopButton();
    renderPaintInventory();
    ctx.setStatus(
      cell
        ? `Cleared the tile at ${cell[0]},${cell[1]} in “${g?.name || groupId}”. Ctrl+Z undoes it; save to keep it.`
        : `Wiped the overlay paint on “${g?.name || groupId}”. Ctrl+Z undoes it; save to keep it.`,
    );
    return;
  }
  if (source === PAINT_SOURCE.GROUP) {
    const g = ctx.groups.find((x) => x.id === groupId);
    const rgba = g ? decodeGroupTileColors(g).get(h) : null;
    if (!g || !rgba) {
      ctx.setStatus('That colour is already gone.');
      renderPaintInventory();
      return;
    }
    const live = ctx.ensureGroupTileColorMap(groupId);
    ctx.pushPaintUndo({ kind: 'clear', groupId, groupMap: new Map([[h, Uint8Array.from(rgba)]]), packMap: new Map() });
    live.delete(h);
    ctx.markGroupsDirty();
    ctx.setStatus(`Cleared #${h.toString(16).toUpperCase()} from “${g.name || g.id}”. Ctrl+Z undoes it; save to keep it.`);
  } else {
    const rgba = ctx.pack.get(h);
    if (!rgba) {
      ctx.setStatus('That colour is already gone.');
      renderPaintInventory();
      return;
    }
    ctx.pushPaintUndo({ kind: 'clear', groupId: null, groupMap: new Map(), packMap: new Map([[h, Uint8Array.from(rgba)]]) });
    ctx.pack.delete(h);
    ctx.setStatus(`Cleared #${h.toString(16).toUpperCase()} from the shared pack. Ctrl+Z undoes it; save to keep it.`);
  }
  while (ctx.paintUndoStack.length > ctx.PAINT_UNDO_MAX) ctx.paintUndoStack.shift();
  ctx.paintEditsSinceSave++;
  ctx.invalidateGroupColorIndex();
  ctx.render();
  updatePaintV2TopButton();
  renderPaintInventory();
}

export function openPaintInventory() {
  if (!ctx.paintInventoryDialog) return;
  renderPaintInventory();
  if (!ctx.paintInventoryDialog.open) ctx.paintInventoryDialog.showModal();
}
