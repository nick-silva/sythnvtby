/**
 * The Project tool's screens and game-state conditions in the group details: which screens a
 * frame is, Paint shows on / Paint shows when, learning a game state, and the row pills. Split out of tools/painter.js, which passes in the state and functions it shares
 * (initScreensUi).
 */
import { screensForGroup, framesShowingGroup } from '../../src/group-screens.js';
import { toGroupIndex } from '../../src/frame-summary.js';
import { frameSummary } from './frame-summaries.js';
import { groupsForScreen, groupScreensOf, withGroupScreens, matchedScreens, groupShownOnScreens, describeGroupScreens, screenLabel } from '../../src/screen-gate.js';
import { setProjectGameStates, projectGameStates, heldProjectGameStates, projectConditionsAllow, groupConditionsOf, withGroupConditions, withGameState, newGameStateId, failingCondition, describeGroupConditions } from '../../src/game-states.js';
import { planSubState, groupOnScreen } from '../../src/sub-state-learn.js';
import { PROMOTED_FRAME_STATE_NAME } from '../../src/pose-source-frames.js';
import { normalizeGroup } from '../../src/group-schema.js';
import { wramForFrameIndex } from './frame-data.js';

/** The tool's state and functions this part uses (tools/painter.js passes them in). */
let ctx;

export function initScreensUi(context) {
  ctx = context;
}

/**
 * The screen a captured frame belongs to (its capture label), or "" for the live Current frame
 * and for Colorize! frames saved only because a pose was drawn on them — neither is a screen.
 */
function screenNameForFrame(row) {
  const n = row?.frameRegistryEntry?.stateName;
  const name = typeof n === 'string' ? n.trim() : '';
  return name && name !== PROMOTED_FRAME_STATE_NAME ? name : '';
}

/**
 * Index every captured frame for "which screens show this group", a few frames per tick so
 * a large pack does not stall the page, then refresh the groups panel.
 */
export function rebuildScreenIndex() {
  const gen = ++ctx.screenIndexGeneration;
  ctx.screenIndexReady = false;
  const rows = ctx.availableFrames.slice();
  /** @type {typeof screenIndexFrames} */
  const out = [];
  let i = 0;
  const step = () => {
    if (gen !== ctx.screenIndexGeneration) return;
    const until = performance.now() + 12;
    while (i < rows.length && performance.now() < until) {
      const frameIndex = i;
      const row = rows[i++];
      // Frames that are not a screen (Current, pose-only) still count for the screens setting.
      const screen = screenNameForFrame(row);
      try {
        // From the frame's saved summary when it has one: no need to decode it (src/frame-summary.js).
        out.push({ screen, frameIndex, index: toGroupIndex(frameSummary(ctx.loadedPackParts, row)) });
      } catch (err) {
        console.warn('[Groups] Could not index frame for screen usage:', row?.vipFile, err);
      }
    }
    if (i < rows.length) {
      setTimeout(step, 0);
      return;
    }
    ctx.screenIndexFrames = out;
    ctx.screenIndexReady = true;
    ctx.updateGroupsPanel();
    // Refresh the details' "Shows on" line, unless the user is typing a new name there.
    const sel = ctx.groups.find((x) => x.id === ctx.selectedGroupId);
    if (sel && document.activeElement?.id !== 'group-display-name-input') ctx.updateGroupDetail(sel);
  };
  setTimeout(step, 0);
}

/**
 * Frame index → the patterns it shows on the left eye, from the screen index (null while it is
 * building, or for a frame it could not read).
 * @returns {(i: number) => Set<number> | null}
 */
export function framePatternsForIndex() {
  if (!ctx.screenIndexReady) return () => null;
  const byFrame = new Map(ctx.screenIndexFrames.map((f) => [f.frameIndex, f.index.byWorldLayer.get('*|*')?.hashes || new Set()]));
  return (i) => byFrame.get(i) ?? null;
}

/** @returns {Array<{ screen: string, frames: number }> | null} null while the index is building */
function screensOfGroup(g) {
  return ctx.screenIndexReady ? screensForGroup(g, ctx.screenIndexFrames) : null;
}

/** Loose name match between a capture label ("IntroCin") and a memory pool ("pool-introcin"). */
function sameScreenName(a, b) {
  const key = (s) => String(s || '').toLowerCase().replace(/^pool-/, '').replace(/[^a-z0-9]/g, '');
  return !!key(a) && key(a) === key(b);
}

/** The screen a group is filed under in the tree (its memory pool), for comparison. */
function homeScreenNames(g) {
  const sid = typeof g.statePoolId === 'string' ? g.statePoolId.trim() : '';
  if (!sid) return [];
  const pool = ctx.gameStatePools.find((p) => p?.id === sid);
  return [sid, typeof pool?.label === 'string' ? pool.label : ''].filter(Boolean);
}

/** "IntroCin (7 frames), Title (2 frames)" */
function describeScreens(list) {
  return list.map((s) => `${s.screen} (${s.frames} frame${s.frames === 1 ? '' : 's'})`).join(', ');
}

/**
 * The screens pill on a group row: "3 screens" when shared, the screen's name when it shows on
 * one screen other than the one it is filed under, a warning when no capture shows it.
 * @returns {HTMLSpanElement | null}
 */
export function screensPill(g) {
  const list = screensOfGroup(g);
  if (!list) return null;
  const pill = document.createElement('span');
  pill.className = 'screens-pill';
  const note = 'Colours apply wherever these tiles appear, unless the group’s “Paint shows on” setting limits them; the tree only files a group under the screen it was made on.';
  if (list.length === 0) {
    pill.classList.add('screens-none');
    pill.textContent = 'not in captures';
    pill.title = `No captured frame shows this group's tiles. ${note}`;
    return pill;
  }
  if (list.length === 1) {
    if (homeScreenNames(g).some((n) => sameScreenName(n, list[0].screen))) return null;
    pill.textContent = list[0].screen;
    pill.title = `Shows on ${describeScreens(list)} — not the screen it is filed under. ${note}`;
    return pill;
  }
  pill.classList.add('screens-shared');
  pill.textContent = `${list.length} screens`;
  pill.title = `Shows on ${describeScreens(list)}. ${note}`;
  return pill;
}

/** Groups tree section listing every group more than one screen shows (they also stay in place). */
export function appendSharedGroupsSection() {
  if (!ctx.groupsTree || !ctx.screenIndexReady) return;
  const shared = ctx.groups.filter((g) => (screensOfGroup(g) || []).length > 1);
  if (!shared.length) return;
  const wrap = document.createElement('details');
  wrap.className = 'pool-accordion shared-pool';
  wrap.open = ctx.sharedGroupsOpen;
  wrap.addEventListener('toggle', () => {
    ctx.sharedGroupsOpen = wrap.open;
  });
  const sum = document.createElement('summary');
  sum.textContent = `Shared by several screens (${shared.length})`;
  sum.title = 'Groups whose tiles appear on more than one captured screen. Painting one changes it on all of them.';
  wrap.appendChild(sum);
  const body = document.createElement('div');
  body.className = 'pool-body';
  const ul = document.createElement('ul');
  ul.className = 'groups-in-variant';
  for (const g of shared) ul.appendChild(ctx.createGroupRow(g));
  body.appendChild(ul);
  wrap.appendChild(body);
  ctx.groupsTree.appendChild(wrap);
}

/** Details line: where the group's colours show up. */
export function groupScreensHtml(g) {
  const list = screensOfGroup(g);
  if (!list) return `<div class="muted" style="font-size:0.72rem;margin-top:0.35rem"><strong>Shows on</strong>: checking captured frames…</div>`;
  if (!list.length) {
    return `<div style="font-size:0.72rem;margin-top:0.35rem;color:var(--accent-warm)"><strong>Shows on</strong>: no captured frame — capture a frame where it appears.</div>`;
  }
  const shared = list.length > 1;
  return `<div style="font-size:0.72rem;margin-top:0.35rem${shared ? ';color:var(--accent-warm)' : ''}"><strong>Tiles appear on</strong>: ${ctx.escapeHtml(describeScreens(list))}${shared ? ' — painting it changes every one of these screens' : ''}</div>`;
}

/* ------------------------------------------------- screens setting (src/screen-gate.js) */

/** Screens each frame's memory matches, kept per frame list and pools. */
let frameScreensMemo = { frames: /** @type {any} */ (null), pools: /** @type {any} */ (null), byIndex: new Map() };

/** @returns {Set<string>|null} screen (pool) ids frame `i`'s memory matches; null when unknown */
export function matchedScreensForFrame(i) {
  if (frameScreensMemo.frames !== ctx.availableFrames || frameScreensMemo.pools !== ctx.gameStatePools) {
    frameScreensMemo = { frames: ctx.availableFrames, pools: ctx.gameStatePools, byIndex: new Map() };
  }
  if (!frameScreensMemo.byIndex.has(i)) frameScreensMemo.byIndex.set(i, matchedScreens(ctx.gameStatePools, wramForFrameIndex(i)));
  return frameScreensMemo.byIndex.get(i);
}

/** The groups whose paint shows on the frame on screen: a group can be limited to some screens. */
export function groupsOnThisFrame() {
  return groupsForScreen(ctx.groups, ctx.gameStatePools, currentFrameWram());
}

/** The frame on screen's memory (its RAM dump), for its screens and game states; null when none. */
export function currentFrameWram() {
  const i = ctx.getCurrentFrameSelectIndex();
  return i == null ? null : wramForFrameIndex(i);
}

/** Screens Analyze memory gave a memory recipe — the only ones a frame can be recognised as. */
export function recognisableScreens() {
  return ctx.gameStatePools.filter((p) => typeof p?.id === 'string' && (p.variants || []).some((v) => Array.isArray(v?.ramConditions) && v.ramConditions.length > 0));
}

/** "Only on…" / "Every screen except…" picked with no screen ticked yet: shown, not yet saved. */
let pendingScreensMode = /** @type {{ groupId: string, mode: 'only'|'except' } | null} */ (null);

/**
 * The group's "Paint shows when…" rules, all of which must allow its paint: the screens setting
 * (every screen, only on some, or every screen except some — src/screen-gate.js), and conditions on
 * the project's game states (src/game-states.js), each "is" or "is not". Each says what it does on
 * this frame; the effect line says what they do together.
 */
export function groupScreenSettingHtml(g) {
  const screens = recognisableScreens();
  const set = groupScreensOf(g);
  const mode = set?.mode || (pendingScreensMode?.groupId === g.id ? pendingScreensMode.mode : '');
  const ticked = new Set(set?.pools || []);
  const option = (value, label) => `<option value="${value}"${mode === value ? ' selected' : ''}>${label}</option>`;
  const recognised = (id) => ctx.availableFrames.reduce((n, _, i) => n + (matchedScreensForFrame(i)?.has(id) ? 1 : 0), 0);
  // Screens it lists that no longer have a recipe stay visible, so they can be unticked.
  const listed = [...screens, ...[...ticked].filter((id) => !screens.some((p) => p.id === id)).map((id) => ({ id }))];
  const boxes = mode
    ? `<div style="display:flex;flex-direction:column;gap:0.1rem;margin-top:0.2rem">${listed
      .map((p) => {
        const n = recognised(p.id);
        const title = `The game's memory matches ${screenLabel(ctx.gameStatePools, p.id)}'s recipe on ${n} captured frame${n === 1 ? '' : 's'}. Frames it misses count as some other screen.`;
        return `<label style="font-size:0.7rem;display:flex;gap:0.3rem;align-items:center" title="${ctx.escapeHtml(title)}"><input type="checkbox" data-screen-pool="${ctx.escapeHtml(p.id)}"${ticked.has(p.id) ? ' checked' : ''} /> ${ctx.escapeHtml(screenLabel(ctx.gameStatePools, p.id))} <span class="muted">· ${n} frame${n === 1 ? '' : 's'}</span></label>`;
      })
      .join('')}</div>`
    : '';
  const screenRow = screens.length || set
    ? `<div style="margin-top:0.2rem"><label for="group-screens-mode">Screen</label>
      <select id="group-screens-mode" style="font-size:0.7rem;margin-left:0.3rem" title="Limit this group's colours and overpaint to some screens, recognised by the game's memory (File → Analyze memory). Its tiles stay in the group either way.">
        ${option('', 'any')}${option('only', 'is one of…')}${option('except', 'is not…')}
      </select></div>${boxes}`
    : `<div class="muted" style="font-size:0.66rem;margin-top:0.2rem;line-height:1.35">Screen: any. To limit it to some screens, run <strong>File → Analyze memory…</strong> first — it teaches the tools to recognise each screen.</div>`;
  const note = learnNote?.groupId === g.id ? `<div class="muted" id="group-learn-note" style="font-size:0.66rem;margin-top:0.2rem;line-height:1.4">${ctx.escapeHtml(learnNote.text)}</div>` : '';
  return `<div class="paint-shows-when" style="font-size:0.72rem;margin-top:0.35rem"><strong>Paint shows when…</strong>${screenRow}${groupConditionsHtml(g, screens.length > 0)}${note}</div>${groupScreenEffectHtml(g)}`;
}

/** The group's conditions on game states, and the controls to add one. */
function groupConditionsHtml(g, canLearn) {
  const states = projectGameStates();
  const conds = groupConditionsOf(g);
  const cur = ctx.getCurrentFrameSelectIndex();
  const held = cur == null ? null : heldStatesForFrame(cur);
  const rows = conds.map((c) => {
    const state = states.find((s) => s.id === c.state);
    if (!state) {
      return `<div class="group-condition is-missing" style="margin-top:0.15rem">“${ctx.escapeHtml(c.state)}” <span class="muted">— not one of this project's game states, so it is ignored</span> <button type="button" class="btn-ghost" data-cond-remove="${ctx.escapeHtml(c.state)}" aria-label="Remove this condition" title="Remove this condition">×</button></div>`;
    }
    const frames = ctx.availableFrames.reduce((n, _, i) => n + (heldStatesForFrame(i)?.has(state.id) ? 1 : 0), 0);
    const here = !held ? 'this frame: memory not captured' : `this frame: ${held.has(state.id) ? 'holds' : 'does not hold'}`;
    const bytes = state.conditions.map((x) => `0x${x.offset.toString(16).toUpperCase()} = ${x.value}`).join(', ');
    return `<div class="group-condition" style="margin-top:0.15rem;display:flex;flex-wrap:wrap;gap:0.3rem;align-items:center" title="${ctx.escapeHtml(`Memory: ${bytes}. Holds on ${frames} captured frame${frames === 1 ? '' : 's'}.`)}">
      <span>${ctx.escapeHtml(state.name)}</span>
      <select data-cond-is="${ctx.escapeHtml(state.id)}" style="font-size:0.68rem" aria-label="Whether ${ctx.escapeHtml(state.name)} must hold">
        <option value="is"${c.is ? ' selected' : ''}>is true</option><option value="not"${c.is ? '' : ' selected'}>is not true</option>
      </select>
      <span class="muted" style="font-size:0.64rem">${here} · ${frames} frame${frames === 1 ? '' : 's'}</span>
      <button type="button" class="btn-ghost" data-cond-remove="${ctx.escapeHtml(state.id)}" aria-label="Remove this condition" title="Remove this condition from the group (the game state stays in the project)" style="font-size:0.62rem;padding:0 0.25rem;line-height:1.1">×</button>
    </div>`;
  });
  const unused = states.filter((s) => !conds.some((c) => c.state === s.id));
  const add = `<select id="group-add-condition" style="font-size:0.68rem;margin-top:0.2rem" title="Show this group's paint only while a game state holds (or does not)">
      <option value="">Add a condition…</option>
      ${unused.map((s) => `<option value="${ctx.escapeHtml(s.id)}">${ctx.escapeHtml(s.name)}</option>`).join('')}
      <option value="__new__">New game state…</option>
    </select>`;
  const learn = canLearn
    ? ` <button type="button" class="btn-ghost" id="btn-learn-on-screen" style="font-size:0.66rem;padding:0.12rem 0.4rem" title="Find a byte of game memory that is the same on every captured frame showing this group and different on the rest of that screen's frames, keep it as a game state, and show the paint only while it holds. Works where the game keeps a state for it (who is playing, which menu item is picked) — not where the same scene just has different things on screen.">Only while it's on screen (learn from memory)</button>`
    : '';
  return `${rows.join('')}<div>${add}${learn}</div>`;
}

/** The project's game states holding on frame `i`; null when its memory is unknown. */
let heldStatesMemo = { frames: /** @type {any} */ (null), states: /** @type {any} */ (null), byIndex: new Map() };
function heldStatesForFrame(i) {
  if (heldStatesMemo.frames !== ctx.availableFrames || heldStatesMemo.states !== projectGameStates()) {
    heldStatesMemo = { frames: ctx.availableFrames, states: projectGameStates(), byIndex: new Map() };
  }
  if (!heldStatesMemo.byIndex.has(i)) heldStatesMemo.byIndex.set(i, heldProjectGameStates(wramForFrameIndex(i)));
  return heldStatesMemo.byIndex.get(i);
}

/** Does the group's paint show on frame `i`: screens and conditions both? */
function groupPaintShownOnFrame(g, i) {
  return groupShownOnScreens(g, matchedScreensForFrame(i)) && projectConditionsAllow(g, heldStatesForFrame(i));
}

/** What the last "learn from memory" found (or why it could not), shown in that group's details. */
let learnNote = /** @type {{ groupId: string, text: string } | null} */ (null);
/** Below this many frames showing the group, or above this many equally good bytes, say it may be chance. */
const LEARN_FEW_FRAMES = 5;
const LEARN_MANY_ALTERNATIVES = 30;

/** Replace the project's game states, telling the colour rules. */
export function setGameStates(next) {
  ctx.gameStates = next;
  setProjectGameStates(ctx.gameStates);
}

/**
 * "Only while it's on screen": learn the state of the frames showing the group (src/sub-state-learn.js),
 * keep it as a game state, and add a condition on it to the group.
 */
function learnWhileOnScreen(g) {
  const states = ctx.frameStatesByIndex();
  const inside = [];
  const outside = [];
  states.forEach((st, i) => {
    if (!st) return;
    const f = { index: i, wram: wramForFrameIndex(i), matched: matchedScreensForFrame(i) };
    (groupOnScreen(st, g, ctx.groups) ? inside : outside).push(f);
  });
  const name = g.name || g.id;
  const plan = planSubState({ inside, outside, pools: ctx.gameStatePools, states: ctx.gameStates, label: `${name} on screen`, describe: `frames showing ${name}` });
  if (!plan.ok) {
    learnNote = { groupId: g.id, text: `Could not learn it: ${plan.reason}. Its paint shows as before.` };
    ctx.updateGroupDetail(g);
    ctx.setStatus(`“${name}”: ${learnNote.text}`);
    return;
  }
  setGameStates(withGameState(ctx.gameStates, plan.state));
  const unsure = plan.inside < LEARN_FEW_FRAMES || plan.alternatives > LEARN_MANY_ALTERNATIVES
    ? ` With ${plan.inside} frame${plan.inside === 1 ? '' : 's'} showing it${plan.alternatives ? ` and ${plan.alternatives} other byte${plan.alternatives === 1 ? '' : 's'} that would do as well` : ''}, it may be chance: capture more frames with and without it, then learn again.`
    : '';
  learnNote = {
    groupId: g.id,
    text: `Learned “${plan.state.name}”: memory byte 0x${plan.learned.offset.toString(16).toUpperCase()} is ${plan.learned.value} on all ${plan.inside} ${screenLabel(ctx.gameStatePools, plan.poolId)} frames showing it, and never on the other ${plan.outside}.${unsure}`,
  };
  setGroupConditions(g.id, [...groupConditionsOf(g), { state: plan.state.id, is: true }]);
}

/** "New game state…": a name and its memory bytes, typed in. */
function newGameStateByHand(g) {
  const name = (window.prompt('Name the game state (e.g. "Luigi is the player"):', '') || '').trim();
  if (!name) return;
  const typed = window.prompt('Its memory bytes, as offset = value, separated by commas (offsets in hex, e.g. 0x2014 = 2):', '');
  if (typed == null) return;
  const conditions = [];
  for (const part of typed.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(0x[0-9a-f]+|\d+)\s*=\s*(0x[0-9a-f]+|\d+)$/i);
    const offset = m ? Number(m[1]) : NaN;
    const value = m ? Number(m[2]) : NaN;
    if (!(offset >= 0 && offset < 0x10000 && value >= 0 && value <= 255)) {
      ctx.setStatus(`“${part}” is not offset = value (an offset below 0x10000 and a value 0–255). Nothing was added.`);
      return;
    }
    conditions.push({ offset, value });
  }
  if (!conditions.length) {
    ctx.setStatus('A game state needs at least one memory byte. Nothing was added.');
    return;
  }
  const state = { id: newGameStateId(ctx.gameStates, name), name, conditions, source: 'manual' };
  setGameStates(withGameState(ctx.gameStates, state));
  setGroupConditions(g.id, [...groupConditionsOf(g), { state: state.id, is: true }]);
}

/** Set the group's conditions and redraw. */
function setGroupConditions(id, conditions) {
  const g = ctx.groups.find((x) => x.id === id);
  if (!g) return;
  const next = normalizeGroup(withGroupConditions(g, conditions));
  ctx.groups = ctx.groups.map((x) => (x.id === id ? next : x));
  ctx.markGroupsDirty();
  ctx.updateGroupsPanel();
  ctx.updateGroupDetail(next);
  ctx.render();
  const what = describeGroupConditions(next);
  ctx.setStatus(`“${next.name || next.id}” paint shows ${what || 'whatever the game state'}. Save .vbpack to keep it.`);
}

/** What the paint rules do: this frame, and the captured frames showing the group's tiles. */
function groupScreenEffectHtml(g) {
  if (!groupScreensOf(g) && !groupConditionsOf(g).length) return '';
  const cur = ctx.getCurrentFrameSelectIndex();
  const here = cur == null ? null : matchedScreensForFrame(cur);
  const held = cur == null ? null : heldStatesForFrame(cur);
  const shownHere = cur == null || groupPaintShownOnFrame(g, cur);
  const failing = failingCondition(g, held);
  const why = !shownHere && failing ? ` — ${ctx.escapeHtml(failing.name)} ${failing.is ? 'does not hold' : 'holds'}` : '';
  const screenNote = here === null
    ? ' (its memory was not captured, so it is not checked)'
    : groupScreensOf(g) ? (here.size ? ` — it looks like ${ctx.escapeHtml([...here].map((id) => screenLabel(ctx.gameStatePools, id)).join(', '))}` : ' — no screen recognises it') : '';
  const hereLine = `This frame: <strong>${shownHere ? 'shown' : 'hidden'}</strong>${why}${screenNote}.`;
  let framesLine = '';
  if (ctx.screenIndexReady) {
    const on = framesShowingGroup(g, ctx.screenIndexFrames);
    const hidden = on.filter((f) => !groupPaintShownOnFrame(g, f.frameIndex));
    const where = new Map();
    for (const f of hidden) {
      const name = f.screen || 'Current / pose frames';
      where.set(name, (where.get(name) || 0) + 1);
    }
    const whereText = [...where].map(([k, n]) => `${k} ×${n}`).join(', ');
    framesLine = `<br>Its tiles are on ${on.length} captured frame${on.length === 1 ? '' : 's'}: paint shows on ${on.length - hidden.length}${hidden.length ? `, hidden on ${hidden.length} (${ctx.escapeHtml(whereText)})` : ''}.`;
  }
  return `<div class="muted" id="group-paint-effect" style="font-size:0.66rem;margin-top:0.2rem;line-height:1.4${shownHere ? '' : ';color:var(--accent-warm)'}">${hereLine}${framesLine}</div>`;
}

/** Wire the "Paint shows when…" controls in the group details. */
export function bindGroupScreenSetting(g) {
  const modeSel = /** @type {HTMLSelectElement|null} */ (document.getElementById('group-screens-mode'));
  const modeNow = () => (modeSel?.value === 'only' || modeSel?.value === 'except' ? modeSel.value : '');
  modeSel?.addEventListener('change', () => {
    const mode = modeNow();
    const pools = groupScreensOf(g)?.pools || [];
    if (!mode) {
      pendingScreensMode = null;
      setGroupScreens(g.id, null);
    } else if (pools.length) {
      setGroupScreens(g.id, { mode, pools });
    } else {
      pendingScreensMode = { groupId: g.id, mode };
      ctx.updateGroupDetail(g);
      ctx.setStatus('Tick the screens this setting is about.');
    }
  });
  ctx.groupDetail?.querySelectorAll('[data-screen-pool]').forEach((box) =>
    box.addEventListener('change', () => {
      const mode = modeNow();
      if (!mode) return;
      const pools = [...ctx.groupDetail.querySelectorAll('[data-screen-pool]')]
        .filter((b) => /** @type {HTMLInputElement} */ (b).checked)
        .map((b) => /** @type {HTMLElement} */ (b).dataset.screenPool);
      if (!pools.length) pendingScreensMode = { groupId: g.id, mode };
      setGroupScreens(g.id, pools.length ? { mode, pools } : null);
    }),
  );
  document.getElementById('btn-learn-on-screen')?.addEventListener('click', () => learnWhileOnScreen(g));
  const add = /** @type {HTMLSelectElement|null} */ (document.getElementById('group-add-condition'));
  add?.addEventListener('change', () => {
    const v = add.value;
    add.value = '';
    if (v === '__new__') newGameStateByHand(g);
    else if (v) setGroupConditions(g.id, [...groupConditionsOf(g), { state: v, is: true }]);
  });
  ctx.groupDetail?.querySelectorAll('[data-cond-is]').forEach((sel) =>
    sel.addEventListener('change', () => {
      const id = /** @type {HTMLElement} */ (sel).dataset.condIs;
      const is = /** @type {HTMLSelectElement} */ (sel).value === 'is';
      setGroupConditions(g.id, groupConditionsOf(g).map((c) => (c.state === id ? { ...c, is } : c)));
    }),
  );
  ctx.groupDetail?.querySelectorAll('[data-cond-remove]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const id = /** @type {HTMLElement} */ (b).dataset.condRemove;
      setGroupConditions(g.id, groupConditionsOf(g).filter((c) => c.state !== id));
    }),
  );
}

/**
 * Where the group sits in the group list (its pool / variant). It only files the group: it never
 * decided where the paint shows, though it sits close to screens and reads like one.
 */
export function filedUnderHtml(g) {
  const sid = typeof g.statePoolId === 'string' ? g.statePoolId.trim() : '';
  if (!sid) return '';
  const pool = ctx.gameStatePools.find((p) => p?.id === sid);
  const variant = (pool?.variants || []).find((v) => v?.id === g.stateVariantId);
  const where = [screenLabel(ctx.gameStatePools, sid), variant && variant.id !== '__default__' ? (variant.label || variant.id) : ''].filter(Boolean).join(' · ');
  return `<div class="muted" id="group-filed-under" style="font-size:0.66rem;margin-top:0.3rem" title="Where this group sits in the group list. It does not change where its paint shows — that is Paint shows when, above.">Filed under: ${ctx.escapeHtml(where)}</div>`;
}

/** Set (or clear, with null) which screens the group's paint shows on, and redraw. */
function setGroupScreens(id, screens) {
  const g = ctx.groups.find((x) => x.id === id);
  if (!g) return;
  const next = normalizeGroup(withGroupScreens(g, screens));
  if (groupScreensOf(next)) pendingScreensMode = null;
  ctx.groups = ctx.groups.map((x) => (x.id === id ? next : x));
  ctx.markGroupsDirty();
  ctx.updateGroupsPanel();
  ctx.updateGroupDetail(next);
  ctx.render();
  ctx.setStatus(`“${next.name || next.id}” paint shows on: ${describeGroupScreens(next, ctx.gameStatePools).toLowerCase()}. Save .vbpack to keep it.`);
}

/** Row pill for a group with conditions on game states, e.g. "not while Luigi is the player". */
export function conditionPill(g) {
  const what = describeGroupConditions(g);
  if (!what) return null;
  const pill = document.createElement('span');
  pill.className = 'screens-pill condition-pill';
  pill.textContent = groupConditionsOf(g).length === 1 ? what : `${groupConditionsOf(g).length} conditions`;
  pill.title = `Paint shows ${what}.`;
  return pill;
}

/** Row pill for a group limited to some screens. */
export function screenLimitPill(g) {
  const s = groupScreensOf(g);
  if (!s) return null;
  const pill = document.createElement('span');
  pill.className = 'screens-pill screen-limit-pill';
  const names = s.pools.map((id) => screenLabel(ctx.gameStatePools, id));
  pill.textContent = `${s.mode === 'only' ? 'only' : 'not'} ${names.length === 1 ? names[0] : `${names.length} screens`}`;
  pill.title = `Paint shows on: ${describeGroupScreens(g, ctx.gameStatePools)}.`;
  return pill;
}
