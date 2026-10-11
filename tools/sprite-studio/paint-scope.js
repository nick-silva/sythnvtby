/**
 * SpriteStudio's paint scope: "Only this group's paint" (a session that draws just the selected
 * group), clearing the paint a card shows, and offering to clear old overlay paint. Split out of
 * tools/sprite-studio.js, which passes in the state and functions it shares (initPaintScope).
 */
import { paintTargetGroupFor, clearGroupOverlay } from '../shared/pack-session.js';
import { splitPosePatterns } from '../../src/pose-clear.js';
import { isObjGroup } from '../../src/obj-sprite-profiles.js';
import { updateReferenceUi } from './reference.js';
import { renderStrip } from './poses.js';
import { pushUndo, undoStack } from './history.js';
import { drawStage, invalidateRender, renderDetail } from './render.js';
import { paintStore } from './ghost-box.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initPaintScope(context) {
  ctx = context;
}

/* ------------------------------------------------- only this group's paint */
// While painting a character, its tiles show its own paint only: not the colours another group
// (listed first) or the shared pack would give the same patterns in the game. Those used to show
// on the stage and in the cards, so a character looked half-painted in someone else's colours.

export const OWN_PAINT_KEY = 'studio.ownPaintOnly';
const EMPTY_PACK = new Map();

export function ownPaintOnly() {
  return ctx.el('toggle-own-paint')?.checked !== false;
}

/** Cached per selected group and groups list, so the compositor's caches keep working. */
let ownPaintMemo = { group: null, groups: null, pack: null, value: null };

/**
 * The session the selected group's own layer is drawn from: with Only this group's paint, just
 * that group (and, for a background group, no shared pack paint); otherwise the whole session.
 */
export function layerSession() {
  if (!ownPaintOnly() || !ctx.selectedGroup) return ctx.session;
  if (ownPaintMemo.group === ctx.selectedGroup && ownPaintMemo.groups === ctx.session.groups && ownPaintMemo.pack === ctx.session.pack) return ownPaintMemo.value;
  const value = { ...ctx.session, groups: [ctx.selectedGroup], pack: isObjGroup(ctx.selectedGroup) ? ctx.session.pack : EMPTY_PACK };
  ownPaintMemo = { group: ctx.selectedGroup, groups: ctx.session.groups, pack: ctx.session.pack, value };
  return value;
}

/** The tile patterns a card shows: a scaled card's visible patterns, else its tiles'. */
export function viewPatterns(view) {
  return Array.isArray(view?.patterns) && view.patterns.length ? view.patterns : (view?.pose?.tiles || []).map((t) => t.hash >>> 0);
}

/**
 * Ask how much of a pose's paint to clear. Resolves 'own' (patterns no other pose uses), 'all',
 * or null for Cancel.
 * @param {{ what: string, own: number, shared: number, sharedWith: Array<{ name: string, count: number }> }} info
 * @returns {Promise<'own'|'all'|null>}
 */
function askClearPaint({ what, own, shared, sharedWith }) {
  const dlg = /** @type {HTMLDialogElement} */ (ctx.el('clear-paint-dialog'));
  ctx.el('clear-paint-title').textContent = `Clear paint on ${what}`;
  ctx.el('clear-paint-summary').textContent = shared
    ? `${own + shared} painted tile pattern(s): ${own} only here, ${shared} also used elsewhere:`
    : `${own} painted tile pattern(s), none used anywhere else.`;
  const list = ctx.el('clear-paint-shared');
  list.textContent = '';
  for (const { name, count } of sharedWith.slice(0, 8)) {
    const li = document.createElement('li');
    li.textContent = `“${name}” uses ${count}`;
    list.append(li);
  }
  if (sharedWith.length > 8) {
    const li = document.createElement('li');
    li.textContent = `…and ${sharedWith.length - 8} more`;
    list.append(li);
  }
  list.hidden = !sharedWith.length;
  const btnOwn = /** @type {HTMLButtonElement} */ (ctx.el('clear-paint-own'));
  const btnAll = /** @type {HTMLButtonElement} */ (ctx.el('clear-paint-all'));
  btnOwn.textContent = shared ? `Clear this pose only (${own} tile pattern${own === 1 ? '' : 's'})` : `Clear (${own} tile pattern${own === 1 ? '' : 's'})`;
  btnOwn.disabled = own === 0;
  btnOwn.title = own ? 'Shared tiles keep their colour, here and in the other poses' : 'Every painted tile here is shared with another pose';
  btnAll.hidden = shared === 0;
  btnAll.textContent = `Clear all, shared tiles too (${own + shared}) — the other poses lose that paint`;
  return new Promise((resolve) => {
    const finish = (choice) => {
      btnOwn.removeEventListener('click', onOwn);
      btnAll.removeEventListener('click', onAll);
      ctx.el('clear-paint-cancel').removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onCancel);
      if (dlg.open) dlg.close();
      resolve(choice);
    };
    const onOwn = () => finish('own');
    const onAll = () => finish('all');
    const onCancel = () => finish(null);
    btnOwn.addEventListener('click', onOwn);
    btnAll.addEventListener('click', onAll);
    ctx.el('clear-paint-cancel').addEventListener('click', onCancel);
    dlg.addEventListener('close', onCancel);
    dlg.showModal();
    (own ? btnOwn : ctx.el('clear-paint-cancel')).focus();
  });
}

/**
 * Throw away the paint on what is on screen — this pose, or this card of a background group — to
 * start over. Paint is per tile pattern, so a pattern this card shares with the group's other poses
 * or cards can only be cleared for all of them: the dialog offers this card's own patterns alone,
 * or everything it shows.
 */
export async function clearPaintForCurrentView() {
  const view = ctx.poseViews[ctx.poseIndex];
  if (!ctx.session || !view?.pose) return;
  const store = paintStore();
  const painted = [...new Set(viewPatterns(view))].filter((h) => store.has(h));
  const what = `“${view.pose.name || view.pose.poseId}”`;
  if (!painted.length) {
    ctx.setStatus(`Nothing painted on ${what} yet.`);
    return;
  }
  const others = ctx.poseViews.filter((v) => v !== view).map((v) => ({ name: v.pose.name || v.pose.poseId, patterns: viewPatterns(v) }));
  const split = splitPosePatterns(painted, others);
  const choice = await askClearPaint({ what, own: split.own.length, shared: split.shared.length, sharedWith: split.sharedWith });
  if (!choice) return;
  const clear = choice === 'own' ? split.own : painted;
  const snapshot = new Map();
  for (const h of clear) {
    snapshot.set(h, Uint8Array.from(store.get(h)));
    store.delete(h);
  }
  pushUndo({ groupId: paintTargetGroupFor(ctx.selectedGroup)?.id ?? null, map: snapshot });
  if (undoStack.length > 50) undoStack.shift();
  ctx.el('btn-undo').disabled = false;
  ctx.markDirty();
  invalidateRender();
  drawStage();
  renderStrip();
  ctx.renderPalette();
  updateReferenceUi();
  const kept = choice === 'own' && split.shared.length ? ` ${split.shared.length} shared tile pattern(s) kept their colour.` : '';
  ctx.setStatus(`Cleared paint on ${clear.length} tile pattern(s) in ${what}.${kept} Undo brings it back; save to keep it.`);
}

/** @param {any} group */
export function hasOverlayPaint(group) {
  return !!group && !isObjGroup(group) && !!ctx.session?.vipOverlays?.has(group.id);
}

/**
 * The Project tool paints BG groups as a full-frame overlay, blended over everything, so it
 * hides per-pattern paint on the same group. Offer to drop it; undo brings it back.
 * @param {any} group
 * @returns {boolean} true when the overlay was cleared
 */
export function offerToClearOverlay(group) {
  const name = group.name || group.id;
  const ok = window.confirm(
    `“${name}” has overlay paint from the Project tool. Overlay paint is drawn over the finished frame, `
      + 'so anything painted here per tile pattern would be hidden under it.\n\n'
      + `Clear “${name}”’s overlay paint and paint it here instead?\n\n`
      + 'Undo brings the overlay back. Nothing is written until you save.',
  );
  if (!ok) {
    ctx.setStatus(`Left “${name}”’s overlay paint alone — paint it in the Project tool, or clear the overlay to paint it here.`);
    return false;
  }
  pushUndo({ overlay: clearGroupOverlay(ctx.session, group.id) });
  if (undoStack.length > 50) undoStack.shift();
  ctx.el('btn-undo').disabled = false;
  ctx.markDirty();
  invalidateRender();
  drawStage();
  renderDetail();
  ctx.setStatus(`Cleared “${name}”’s overlay paint — paint away. Undo brings it back.`);
  return true;
}
