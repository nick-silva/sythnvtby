/**
 * The emulator's Memory panel (docs/design/memory-states.md §5.1): record memory for a question's
 * side (src/memory-recorder.js), and see live which screen and game states hold, with the bytes
 * they test — to check a game state's name is right before any paint depends on it.
 *
 * Keys while the panel is open (not while typing in it): 1–9 pick a side (switching the recording
 * to it when one is going), 0 stops.
 *
 * Each part is rebuilt only when its shape changes (question, side, recording on or off; which
 * game states hold); otherwise only its text is updated, so a button is never replaced under a
 * click.
 */

/** How often the live part reads the game's memory. */
const LIVE_MS = 250;

const hex = (n) => `0x${n.toString(16).toUpperCase()}`;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (label, onClick, title = '') => {
  const b = el('button', 'btn-secondary', label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};

/**
 * @param {{
 *   root: HTMLElement,
 *   recorder: ReturnType<typeof import('./memory-recorder.js').createMemoryRecorder>,
 *   live: () => { wram: Uint8Array | null, screens: string[], states: Array<{ id: string, name: string, conditions: Array<{ offset: number, value: number }>, checkedLive?: string }> },
 *   onMarkChecked: (stateId: string) => void,
 * }} deps
 */
export function createMemoryPanel({ root, recorder, live, onMarkChecked }) {
  let questionId = '';
  let sideId = '';
  let seconds = 5;
  let timer = null;
  const controls = el('div', 'memory-controls');
  const liveBox = el('div', 'memory-live');
  root.replaceChildren(controls, liveBox);
  let controlsKey = '';
  let liveKey = '';

  const question = () => recorder.questions().find((q) => q.id === questionId) || null;

  function pickSide(id) {
    sideId = id;
    if (recorder.recording()) recorder.switchSide(id);
    renderControls();
  }

  function newQuestion() {
    const name = (window.prompt('The question (e.g. "Who is the player?"):', '') || '').trim();
    if (!name) return;
    const sides = window.prompt('Its sides, separated by commas (e.g. "Luigi is the player, Mario is the player"):', '');
    if (sides == null) return;
    const made = recorder.addQuestion(name, sides.split(','));
    if (made) {
      questionId = made.id;
      sideId = made.sides[0].id;
    }
    renderControls();
  }

  function recordingText(q, rec) {
    return `● Recording “${q.sides.find((s) => s.id === rec.side)?.name}” — ${rec.samples} sample${rec.samples === 1 ? '' : 's'}, ${rec.elapsed.toFixed(1)}${rec.seconds ? ` of ${rec.seconds}` : ''} s`;
  }

  function buildControls(q, rec) {
    const qs = document.createElement('select');
    qs.id = 'memory-question';
    qs.appendChild(new Option(recorder.questions().length ? 'Pick a question…' : 'No questions yet', ''));
    for (const x of recorder.questions()) qs.appendChild(new Option(x.name, x.id, false, x.id === questionId));
    qs.addEventListener('change', () => {
      questionId = qs.value;
      sideId = question()?.sides[0]?.id || '';
      renderControls();
    });
    const head = el('div', 'memory-record-row');
    head.append(qs, button('New question…', newQuestion, 'A question tells game states apart; it goes to the Project tool with the next Colorize! or Export .vbpack'));
    controls.replaceChildren(head);
    if (!q) return;
    const counts = recorder.counts(q.id);
    const sides = el('div', 'memory-sides');
    q.sides.forEach((s, i) => {
      const c = counts[s.id] || { recordings: 0, thisSession: 0 };
      const b = button(`${i + 1} ${s.name} · ${c.recordings}${c.thisSession ? ` (${c.thisSession} now)` : ''}`, () => pickSide(s.id), `Record “${s.name}” (key ${i + 1})`);
      b.dataset.sideId = s.id;
      if (s.id === sideId) b.classList.add('is-picked');
      if (rec?.side === s.id) b.classList.add('is-recording');
      sides.appendChild(b);
    });
    controls.appendChild(sides);
    const row = el('div', 'memory-record-row');
    if (rec) {
      row.appendChild(el('span', 'memory-recording', recordingText(q, rec)));
      row.appendChild(button('Stop (0)', () => {
        recorder.stop();
        renderControls();
      }));
    } else {
      const len = document.createElement('input');
      len.type = 'number';
      len.min = '1';
      len.max = '600';
      len.value = String(seconds);
      len.id = 'memory-seconds';
      len.title = 'How long a timed recording lasts, in seconds';
      len.addEventListener('change', () => {
        seconds = Math.max(1, Math.min(600, Number(len.value) || 5));
        renderControls();
      });
      const timed = button(`Record ${seconds} s`, () => recorder.start(q.id, sideId, seconds), 'Record the game’s memory for the picked side');
      timed.id = 'memory-record';
      const open = button('Record until stopped', () => recorder.start(q.id, sideId, null), 'Record until you press Stop (0); 1–9 switch side as you play');
      open.id = 'memory-record-open';
      row.append(timed, len, el('span', null, 's'), open);
    }
    controls.appendChild(row);
  }

  function renderControls() {
    if (root.hidden) return;
    const q = question();
    const rec = recorder.recording();
    const key = JSON.stringify([recorder.questions().map((x) => x.id), questionId, sideId, seconds, rec ? rec.side : null, q ? recorder.counts(q.id) : null]);
    if (key !== controlsKey) {
      controlsKey = key;
      buildControls(q, rec);
    } else if (rec && q) {
      const span = controls.querySelector('.memory-recording');
      if (span) span.textContent = recordingText(q, rec);
    }
  }

  function renderLive() {
    if (root.hidden) return;
    const now = live();
    const holds = (s) => !!now.wram && s.conditions.every((c) => now.wram[c.offset] === c.value);
    const key = JSON.stringify([!!now.wram, now.screens, now.states.map((s) => [s.id, s.name, holds(s), !!s.checkedLive])]);
    if (key !== liveKey) {
      liveKey = key;
      liveBox.replaceChildren(el('h4', null, 'Now'));
      if (!now.wram) {
        liveBox.appendChild(el('p', 'muted', 'The game’s memory is not available yet.'));
        return;
      }
      liveBox.appendChild(el('p', 'memory-screen', ''));
      if (!now.states.length) liveBox.appendChild(el('p', 'muted', 'No game states in this project yet.'));
      for (const s of now.states) {
        const row = el('div', `memory-state${holds(s) ? ' holds' : ''}`);
        row.dataset.stateId = s.id;
        row.appendChild(el('span', null, `${holds(s) ? '●' : '○'} ${s.name}`));
        row.appendChild(el('span', 'muted memory-bytes', ''));
        if (holds(s)) row.appendChild(button('Looks right', () => onMarkChecked(s.id), 'Mark this game state as checked in play: it holds when its name says it should'));
        if (s.checkedLive) row.appendChild(el('span', 'muted', '· checked'));
        liveBox.appendChild(row);
      }
    }
    if (!now.wram) return;
    const screen = liveBox.querySelector('.memory-screen');
    if (screen) screen.textContent = `Screen: ${now.screens.length ? now.screens.join(', ') : 'none recognised'}`;
    for (const s of now.states) {
      const bytes = liveBox.querySelector(`[data-state-id="${CSS.escape(s.id)}"] .memory-bytes`);
      if (bytes) bytes.textContent = ` ${s.conditions.map((c) => `${hex(c.offset)} = ${now.wram[c.offset]} (wants ${c.value})`).join(', ')}`;
    }
  }

  function onKey(e) {
    if (root.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(/** @type {HTMLElement} */ (e.target)?.tagName || '')) return;
    const q = question();
    if (!q) return;
    if (e.key === '0') {
      recorder.stop();
      renderControls();
    } else if (/^[1-9]$/.test(e.key) && q.sides[Number(e.key) - 1]) {
      pickSide(q.sides[Number(e.key) - 1].id);
    } else return;
    e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  return {
    /** Redraw what changed (the recorder calls this as it records). */
    render() {
      renderControls();
      renderLive();
    },
    open() {
      root.hidden = false;
      if (!questionId && recorder.questions().length === 1) {
        questionId = recorder.questions()[0].id;
        sideId = recorder.questions()[0].sides[0].id;
      }
      controlsKey = '';
      liveKey = '';
      this.render();
      clearInterval(timer);
      timer = setInterval(renderLive, LIVE_MS);
    },
    close() {
      root.hidden = true;
      clearInterval(timer);
      timer = null;
    },
    toggle() {
      if (root.hidden) this.open();
      else this.close();
    },
  };
}
