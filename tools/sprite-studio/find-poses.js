/**
 * SpriteStudio's Find poses window, for a background character: the poses its frames show that are
 * not kept yet, ticked to keep, and kept poses that duplicate one another, ticked to fold into
 * their twin (tools/sprite-studio/poses.js poseSuggestions, src/pose-suggest.js). Split out like
 * the other parts: tools/sprite-studio.js passes in what it shares (initFindPoses).
 */
import { posesOf } from '../shared/pack-session.js';
import { isObjGroup } from '../../src/obj-sprite-profiles.js';
import { applyPoseSuggestions, drawPoseThumb, isAnimatedGroup, poseSuggestions } from './poses.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

/** What the window offers: new poses and duplicate sets, each with its tick box. */
let offered = { fresh: /** @type {Array<{ item: any, box: HTMLInputElement }>} */ ([]), duplicates: /** @type {Array<{ item: any, box: HTMLInputElement }>} */ ([]) };

export function initFindPoses(context) {
  ctx = context;
  ctx.el('find-poses-cancel').addEventListener('click', () => ctx.el('find-poses-dialog').close());
  ctx.el('find-poses-apply').addEventListener('click', apply);
}

/**
 * Can Find poses look at this group? A background character: not a sprite, an animated tile set or
 * one pose's own group. Its scaled poses (an intro drawn through the court's zoom) are left alone.
 */
export function canFindPoses(group) {
  return !!group && !isObjGroup(group) && !isAnimatedGroup(group) && group.wholePose !== true;
}

/** Look for poses and, when there is anything to offer, open the window. */
export async function openFindPoses() {
  const group = ctx.selectedGroup;
  if (!canFindPoses(group)) {
    ctx.setStatus('Find poses works on a background character: a group with poses on layers that are not scaled.');
    return;
  }
  ctx.setStatus(`Looking for poses of ${group.name || group.id} in the captured frames…`);
  // Let the status show before the frames are read.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const found = poseSuggestions(group);
  const dupCount = found.duplicates.reduce((n, d) => n + d.drop.length, 0);
  if (!found.fresh.length && !dupCount) {
    ctx.setStatus(`${group.name || group.id}: every pose on the ${found.frames} frame(s) it shows on is kept already, and none is kept twice.`);
    return;
  }
  ctx.el('find-poses-title').textContent = `Find poses: ${group.name || group.id}`;
  ctx.el('find-poses-summary').textContent = `Looked at ${found.frames} captured frame(s) where ${group.name || group.id} shows${(group.conditions || []).length ? ' (its game-state conditions hold)' : ''}.`;
  renderFresh(found.fresh);
  renderDuplicates(found.duplicates);
  syncApply();
  ctx.el('find-poses-dialog').showModal();
}

function renderFresh(fresh) {
  const section = ctx.el('find-poses-new');
  const list = ctx.el('find-poses-new-list');
  list.textContent = '';
  section.hidden = !fresh.length;
  ctx.el('find-poses-new-count').textContent = String(fresh.length);
  offered.fresh = fresh.map((item) => {
    const card = document.createElement('label');
    card.className = 'find-pose-card';
    const thumb = document.createElement('canvas');
    drawPoseThumb(thumb, item.view);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', syncApply);
    const label = document.createElement('span');
    label.className = 'find-pose-label';
    const frameName = (ctx.session.frames[item.frames[0]]?.label || `Frame ${item.frames[0] + 1}`).split(' – ')[0];
    label.textContent = `${frameName} · ${item.tiles} tiles${item.frames.length > 1 ? ` · on ${item.frames.length} frames` : ''}`;
    const row = document.createElement('span');
    row.className = 'find-pose-keep';
    row.append(box, ' Keep');
    card.append(thumb, label, row);
    list.append(card);
    return { item, box };
  });
}

function renderDuplicates(duplicates) {
  const section = ctx.el('find-poses-dups');
  const list = ctx.el('find-poses-dups-list');
  list.textContent = '';
  const nameOf = (id) => posesOf(ctx.selectedGroup).find((p) => p.poseId === id)?.name || id;
  section.hidden = !duplicates.length;
  ctx.el('find-poses-dups-count').textContent = String(duplicates.reduce((n, d) => n + d.drop.length, 0));
  offered.duplicates = duplicates.map((item) => {
    const row = document.createElement('label');
    row.className = 'find-pose-dup';
    const box = document.createElement('input');
    box.type = 'checkbox';
    // A pose with a name you chose may be the same art used in another animation: yours to decide.
    box.checked = item.safe && !item.named;
    box.disabled = !item.safe;
    box.addEventListener('change', syncApply);
    const text = document.createElement('span');
    const drop = item.drop.map(nameOf).map((n) => `“${n}”`).join(', ');
    text.textContent = !item.safe
      ? `“${nameOf(item.keep)}” and ${drop} have the same tiles, but more than one has its own overpaint: remove one yourself after moving its picture.`
      : `Keep “${nameOf(item.keep)}”, remove ${drop} (same tiles in the same places)${item.named ? '. Not ticked: you named the one that would go; its animation steps would move to the one kept, but the name would go.' : '.'}`;
    row.append(box, text);
    list.append(row);
    return { item, box };
  });
}

function syncApply() {
  const keep = offered.fresh.filter((o) => o.box.checked).length;
  const remove = offered.duplicates.filter((o) => o.box.checked).reduce((n, o) => n + o.item.drop.length, 0);
  const button = /** @type {HTMLButtonElement} */ (ctx.el('find-poses-apply'));
  button.disabled = !keep && !remove;
  const parts = [keep && `keep ${keep} pose${keep === 1 ? '' : 's'}`, remove && `remove ${remove} duplicate${remove === 1 ? '' : 's'}`].filter(Boolean);
  button.textContent = parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Nothing ticked';
}

function apply() {
  const views = offered.fresh.filter((o) => o.box.checked).map((o) => o.item.view);
  const merges = offered.duplicates.filter((o) => o.box.checked).flatMap((o) => o.item.drop.map((drop) => ({ keep: o.item.keep, drop })));
  const { kept, removed } = applyPoseSuggestions(views, merges);
  ctx.el('find-poses-dialog').close();
  const name = ctx.selectedGroup?.name || ctx.selectedGroup?.id;
  const parts = [kept && `kept ${kept} new pose${kept === 1 ? '' : 's'}`, removed && `removed ${removed} duplicate pose${removed === 1 ? '' : 's'} (their animation steps and pictures moved to the pose kept)`].filter(Boolean);
  ctx.setStatus(parts.length ? `${name}: ${parts.join('; ')}. Save to keep it.` : 'Nothing changed.');
}
