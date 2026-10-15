/**
 * SpriteStudio's Find sprites window: the sprites the captured frames show that no sprite group
 * keeps yet, grouped into characters (src/sprite-suggest.js). Each character becomes a new sprite
 * group, or new poses of the group it shares tiles with; you pick which, and which poses. Split out
 * like the other parts: tools/sprite-studio.js passes in what it shares (initFindSprites).
 */
import { normalizeGroup } from '../../src/group-schema.js';
import { addPoseToGroup, isObjGroup, nextPoseId } from '../../src/obj-sprite-profiles.js';
import { drawPoseThumb, spriteSuggestions, suggestedPoseView } from './poses.js';
import { describeSuggestion } from './find-poses.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

/**
 * What the window offers: per character, its target (a group id, or a name box for a new group),
 * its tick box, and each pose's view and tick box.
 * @type {Array<{ groupId: string | null, nameBox: HTMLInputElement | null, box: HTMLInputElement, poses: Array<{ view: any, box: HTMLInputElement }> }>}
 */
let offered = [];

export function initFindSprites(context) {
  ctx = context;
  ctx.el('btn-find-sprites').addEventListener('click', openFindSprites);
  ctx.el('find-sprites-cancel').addEventListener('click', () => ctx.el('find-sprites-dialog').close());
  ctx.el('find-sprites-apply').addEventListener('click', apply);
}

/** A character of only one- and two-tile sprites: a spark or a digit more often than a character. */
const isSmallBit = (c) => c.groupId === null && c.poses.every((p) => p.size <= 2);

/** Look for sprites and, when there is anything to offer, open the window. */
export async function openFindSprites() {
  if (!ctx.session) return;
  ctx.setStatus(`Looking for sprites in ${ctx.session.frames.length} captured frame(s)…`);
  // Let the status show before the frames are read.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const found = spriteSuggestions();
  if (!found.characters.length) {
    ctx.setStatus(`Every sprite on the ${ctx.session.frames.length} captured frame(s) is a pose a sprite group keeps (${found.sprites} looked at).`);
    return;
  }
  const left = [found.touching && `${found.touching} that were two sprites touching`, found.cutOff && `${found.cutOff} cut off by the screen's edge`].filter(Boolean);
  ctx.el('find-sprites-summary').textContent =
    `${found.sprites} sprite(s) on ${ctx.session.frames.length} captured frame(s); ${found.keptSeen} are poses your sprite groups keep (a mirror image counts). `
    + `The rest are below, grouped into characters by the tiles their poses share. Mirror images of a pose are one pose.`
    + (left.length ? ` Left out: ${left.join(' and ')}.` : '');
  let newCount = 0;
  offered = [];
  const main = found.characters.filter((c) => !isSmallBit(c));
  const small = found.characters.filter(isSmallBit);
  fillList(ctx.el('find-sprites-list'), main, () => ++newCount, true);
  fillList(ctx.el('find-sprites-small-list'), small, () => ++newCount, false);
  ctx.el('find-sprites-small').hidden = !small.length;
  ctx.el('find-sprites-small-count').textContent = `(${small.length})`;
  syncApply();
  ctx.el('find-sprites-dialog').showModal();
  ctx.setStatus(`Found ${found.characters.length} character(s) to look at.`);
}

function fillList(list, characters, nextNumber, ticked) {
  list.textContent = '';
  for (const c of characters) {
    const block = renderCharacter(c, nextNumber, ticked);
    if (block) list.append(block);
  }
}

/** One character: whether it becomes a group (or poses of one), and its poses' cards. */
function renderCharacter(c, nextNumber, ticked) {
  const target = c.groupId ? ctx.session.groups.find((g) => g.id === c.groupId) : null;
  const views = c.poses.map((p, n) => ({ p, view: suggestedPoseView(p, n) })).filter((v) => v.view);
  if (!views.length) return null;
  const block = document.createElement('section');
  block.className = 'find-sprite-char';
  const head = document.createElement('div');
  head.className = 'find-sprite-head';
  const box = document.createElement('input');
  box.type = 'checkbox';
  const label = document.createElement('label');
  label.append(box, target ? ` Add to “${target.name || target.id}”` : ' New sprite group');
  head.append(label);
  let nameBox = null;
  if (!target) {
    nameBox = document.createElement('input');
    nameBox.type = 'text';
    nameBox.value = `Sprite ${nextNumber()}`;
    nameBox.setAttribute('aria-label', 'Name for the new sprite group');
    head.append(nameBox);
  }
  const frames = new Set(c.poses.flatMap((p) => p.frames)).size;
  const note = document.createElement('span');
  note.className = 'muted';
  note.textContent = `${views.length} pose${views.length === 1 ? '' : 's'} · on ${frames} frame${frames === 1 ? '' : 's'}`;
  head.append(note);

  const grid = document.createElement('div');
  grid.className = 'autopaint-list';
  const poses = views.map(({ p, view }) => {
    const card = document.createElement('label');
    card.className = 'find-pose-card';
    const thumb = document.createElement('canvas');
    drawPoseThumb(thumb, view);
    const poseBox = document.createElement('input');
    poseBox.type = 'checkbox';
    // One that also has another group's tiles is more likely two sprites touching than a pose; one
    // only ever seen cut by the screen's edge has little to paint on its frame.
    poseBox.checked = ticked && !p.mixed && !p.clipped;
    poseBox.addEventListener('change', () => {
      box.checked = poses.some((o) => o.box.checked);
      syncApply();
    });
    const text = document.createElement('span');
    text.className = 'find-pose-label';
    text.textContent = describeSuggestion(ctx.session, p);
    const row = document.createElement('span');
    row.className = 'find-pose-keep';
    row.append(poseBox, ' Keep');
    card.append(thumb, text, row);
    grid.append(card);
    return { view, box: poseBox };
  });
  box.checked = poses.some((o) => o.box.checked);
  box.addEventListener('change', () => {
    for (const o of poses) o.box.checked = box.checked;
    syncApply();
  });
  block.append(head, grid);
  offered.push({ groupId: target ? target.id : null, nameBox, box, poses });
  return block;
}

/** What Apply would do now: new groups, and poses in all. */
function plan() {
  const chosen = offered.map((o) => ({ ...o, picked: o.poses.filter((p) => p.box.checked) })).filter((o) => o.picked.length);
  return { chosen, groups: chosen.filter((o) => !o.groupId).length, poses: chosen.reduce((n, o) => n + o.picked.length, 0) };
}

function syncApply() {
  const { groups, poses } = plan();
  const button = /** @type {HTMLButtonElement} */ (ctx.el('find-sprites-apply'));
  button.disabled = !poses;
  const parts = [groups && `make ${groups} sprite group${groups === 1 ? '' : 's'}`, poses && `keep ${poses} pose${poses === 1 ? '' : 's'}`].filter(Boolean);
  button.textContent = parts.length ? parts.join(', ').replace(/^./, (ch) => ch.toUpperCase()) : 'Nothing ticked';
}

const newGroupId = () => `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A new sprite group, made as the Project tool makes one from a capture. */
function newSpriteGroup(name, windowIds) {
  return normalizeGroup({ id: newGroupId(), name, criteria: { windowIds, hashes: [], layers: [2] }, authoringKind: 'obj', visible: true, expanded: false });
}

/** Keep what is ticked: each new character as a sprite group, the others as poses of theirs. */
function apply() {
  const { chosen } = plan();
  if (!chosen.length) return;
  let groups = ctx.session.groups;
  let made = 0;
  let kept = 0;
  let first = null;
  for (const o of chosen) {
    const worlds = [...new Set(o.picked.flatMap((p) => p.view.worlds))].sort((a, b) => a - b);
    let group = o.groupId ? groups.find((g) => g.id === o.groupId) : newSpriteGroup(o.nameBox?.value.trim() || `Sprite ${made + 1}`, worlds);
    if (!group) continue;
    for (const { view } of o.picked) {
      const n = (group.poses || []).length + 1;
      group = addPoseToGroup(group, { ...view.captured, poseId: nextPoseId(group), name: `Pose ${n}` }, { windowIds: view.worlds });
      kept++;
    }
    if (o.groupId) {
      const id = o.groupId;
      groups = groups.map((g) => (g.id === id ? group : g));
    } else {
      groups = [...groups, group];
      made++;
    }
    first = first || group;
  }
  ctx.el('find-sprites-dialog').close();
  ctx.session.groups = groups;
  ctx.markDirty();
  ctx.renderSpriteLists();
  if (first) ctx.selectGroup(groups.find((g) => g.id === first.id) || null);
  const sprites = groups.filter(isObjGroup).length;
  ctx.setStatus(`${[made && `Made ${made} sprite group(s)`, `kept ${kept} pose(s)`].filter(Boolean).join(', ').replace(/^./, (ch) => ch.toUpperCase())}; ${sprites} sprite group(s) now. Save to keep it (groups can be renamed in the Project tool).`);
}
