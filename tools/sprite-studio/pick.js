/**
 * SpriteStudio's Pick: what colours the pixel under the pointer, or why it is not coloured
 * (src/pixel-explain.js), shown in a bubble with one fix. Split out of tools/sprite-studio.js, which
 * passes in the state and functions it shares (initPick).
 */
import { getCompositePixelInfo, getCompositeDrawOwners } from '../../src/color-layer.js';
import { explainPixel } from '../../src/pixel-explain.js';
import { withWorlds } from '../../src/group-worlds.js';
import { frameState, frameWram, poseDraws, renderFrame, poseBounds, FRAME_W, FRAME_H } from '../shared/pack-session.js';
import { showTouchUps } from './overpaint.js';
import { renderSpriteLists } from './group-list.js';
import { drawStage, invalidateRender } from './render.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initPick(context) {
  ctx = context;
}

/* ---------------------------------------- Pick: what colours this pixel, or why not */
// Pick also says, in a small bubble by the pointer, what colours the pixel in the game — or why
// nothing does (src/pixel-explain.js) — with at most one fix. It goes at the next click, Esc,
// or another tool; nothing stays on the page.

const explainImage = new ImageData(FRAME_W, FRAME_H);

export function explainAt(e) {
  const view = ctx.poseViews[ctx.poseIndex];
  const state = view && view.frameIndex >= 0 ? frameState(ctx.session, view.frameIndex) : null;
  if (!state) return hideExplainBubble();
  let { vx, vy } = ctx.vipFromClient(e);
  if (ctx.stageMirror && view.origin) {
    const b = poseBounds(view.pose, view.origin);
    if (b) vx = b.x0 + b.x1 - 1 - vx;
  }
  const wram = frameWram(ctx.session, view.frameIndex);
  // What the stage shows: the whole frame with the background on, else the pose's own tiles (so a
  // tile the game draws in front of the sprite does not answer for it).
  const poseOnly = !ctx.el('toggle-background')?.checked && view.origin && view.pose;
  const shownState = poseOnly ? { ...state, drawList: poseDraws(state, view.pose, view.origin, ctx.eye()) } : state;
  renderFrame({ session: ctx.session, state: shownState, imageData: explainImage, eye: ctx.eye(), brightness: ctx.brightness(), touchUps: showTouchUps(), wram });
  const answer = explainPixel({
    state: shownState,
    eye: ctx.eye(),
    x: vx,
    y: vy,
    pack: ctx.session.pack,
    groups: ctx.session.groups,
    allGroups: ctx.session.groups,
    overrides: ctx.session.overrides,
    gameStatePools: ctx.session.gameStatePools,
    wram,
    info: getCompositePixelInfo(),
    owners: getCompositeDrawOwners(),
  });
  showExplainBubble(e, answer);
}

/** @param {PointerEvent} e @param {ReturnType<typeof explainPixel>} answer */
function showExplainBubble(e, answer) {
  const bubble = ctx.el('explain-bubble');
  const wrap = ctx.el('canvas-wrap');
  if (!bubble || !wrap) return;
  // SpriteStudio can select a group or add a world; a new group is made in the Project tool.
  const fix = answer.fix && answer.fix.kind !== 'new-group' && !(answer.fix.kind === 'select-group' && answer.fix.groupId === ctx.selectedGroup?.id) ? answer.fix : null;
  bubble.className = `explain-bubble is-${answer.status}`;
  const line = (text, cls = '') => Object.assign(document.createElement('p'), { textContent: text, className: cls });
  const parts = [line(answer.sentence)];
  if (answer.why.length) parts.push(line(answer.why[0], 'explain-why'));
  if (fix) parts.push(Object.assign(document.createElement('button'), { type: 'button', id: 'btn-explain-fix', textContent: fix.label }));
  bubble.replaceChildren(...parts);
  const r = wrap.getBoundingClientRect();
  bubble.hidden = false;
  const left = Math.min(Math.max(4, e.clientX - r.left + 14), Math.max(4, r.width - bubble.offsetWidth - 4));
  const top = Math.min(Math.max(4, e.clientY - r.top + 14), Math.max(4, r.height - bubble.offsetHeight - 4));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  ctx.el('btn-explain-fix')?.addEventListener('click', () => {
    hideExplainBubble();
    applyExplainFix(fix);
  });
}

export function hideExplainBubble() {
  const bubble = ctx.el('explain-bubble');
  if (bubble && !bubble.hidden) bubble.hidden = true;
}

/** @param {NonNullable<ReturnType<typeof explainPixel>['fix']>} fix */
function applyExplainFix(fix) {
  const g = ctx.session.groups.find((x) => x.id === fix.groupId);
  if (!g) return;
  if (fix.kind === 'add-world') {
    const own = (g.criteria?.windowIds || []).map(Number);
    const next = withWorlds(g, [...new Set([...own, fix.world])].sort((a, b) => a - b));
    ctx.session.groups = ctx.session.groups.map((x) => (x.id === g.id ? next : x));
    if (ctx.selectedGroup?.id === g.id) ctx.selectedGroup = next;
    ctx.markDirty();
    invalidateRender();
    drawStage();
    renderSpriteLists();
    ctx.setStatus(`“${g.name || g.id}” now paints on world ${fix.world} too — save to keep it.`);
    return;
  }
  ctx.pickGroup(g);
}
