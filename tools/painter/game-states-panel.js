/**
 * The Project tool's "Game states" window (File ▸ Game states…; docs/design/memory-states.md §5.2):
 * the project's game states, and the questions that find them — each question's sides with their
 * recordings, what the analysis (src/memory-questions.js) says still fits, near misses, and Save
 * as game states. Built from DOM nodes: names are user text. The Project tool owns the data and
 * the actions; this only lays them out.
 */

/**
 * @typedef {{ id: string, name: string, conditions: Array<{ offset: number, value: number }>, source?: string, checkedLive?: string }} StateRow
 * @typedef {{ id: string, side: string, startedAt?: string, samples: number, session?: string, source?: string }} RecordingRow
 * @typedef {import('../../src/memory-questions.js').QuestionAnalysis} QuestionAnalysis
 * @typedef {{
 *   states: StateRow[],
 *   usedBy: (stateId: string) => string[],
 *   questions: Array<{ question: any, recordings: RecordingRow[], analysis: QuestionAnalysis }>,
 *   frameLabel: string | null,
 * }} PanelData
 * @typedef {{
 *   renameState: (id: string) => void,
 *   forgetState: (id: string) => void,
 *   newQuestion: () => void,
 *   deleteQuestion: (questionId: string) => void,
 *   addFrame: (questionId: string, sideId: string) => void,
 *   moveRecording: (recordingId: string, sideId: string) => void,
 *   dropRecording: (recordingId: string) => void,
 *   save: (questionId: string, offsets: number[]) => void,
 * }} PanelActions
 */

/** Candidates listed with a box each; the rest are counted. */
const SHOWN_CANDIDATES = 12;

const hex = (n) => `0x${n.toString(16).toUpperCase()}`;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (label, onClick, title = '') => {
  const b = el('button', 'btn-ghost', label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};
const date = (iso) => (iso ? new Date(iso).toLocaleString() : '');

/** @param {PanelData} data @param {PanelActions} on */
function statesSection(data, on) {
  const sec = el('section', 'gs-states');
  sec.appendChild(el('h3', null, 'Game states'));
  if (!data.states.length) {
    sec.appendChild(el('p', 'muted', 'None yet. A game state is a named memory condition (e.g. “Luigi is the player”): learn one from a question below, from a group’s “Only while it’s on screen”, or type one in from a group’s “Add a condition”.'));
    return sec;
  }
  const ul = el('ul', 'gs-list');
  for (const s of data.states) {
    const li = el('li', 'gs-state');
    li.dataset.stateId = s.id;
    li.appendChild(el('strong', null, s.name));
    const used = data.usedBy(s.id);
    const meta = [
      s.conditions.map((c) => `${hex(c.offset)} = ${c.value}`).join(', '),
      used.length ? `used by ${used.join(', ')}` : 'no group uses it',
      s.checkedLive ? `checked live ${date(s.checkedLive)}` : 'not checked live yet',
    ];
    li.appendChild(el('span', 'muted', ` · ${meta.join(' · ')}`));
    const actions = el('span', 'gs-actions');
    actions.append(button('Rename', () => on.renameState(s.id)), button('Forget', () => on.forgetState(s.id), 'Take it out of the project and out of every group that uses it'));
    li.appendChild(actions);
    ul.appendChild(li);
  }
  sec.appendChild(ul);
  return sec;
}

/** The sides of a question: counts, and adding the frame on screen. */
function sidesTable(analysis, data, on, question) {
  const table = el('table', 'gs-sides');
  for (const s of analysis.sides) {
    const tr = el('tr');
    tr.dataset.sideId = s.id;
    tr.appendChild(el('td', null, s.name));
    tr.appendChild(el('td', 'muted', `${s.recordings} recording${s.recordings === 1 ? '' : 's'} · ${s.samples} sample${s.samples === 1 ? '' : 's'} · ${s.sessions} session${s.sessions === 1 ? '' : 's'}`));
    const td = el('td');
    if (data.frameLabel) td.appendChild(button('Add this frame', () => on.addFrame(question.id, s.id), `Add the memory of the frame on screen (${data.frameLabel}) to “${s.name}”`));
    tr.appendChild(td);
    table.appendChild(tr);
  }
  return table;
}

/** What still fits, with Save as game states, and the advice. */
function resultBlock(analysis, on, question) {
  const result = el('div', 'gs-result');
  if (analysis.candidates.length) {
    const n = analysis.candidates.length;
    result.appendChild(el('p', analysis.enough ? 'gs-enough' : null, `${n} byte${n === 1 ? '' : 's'} still fit${n === 1 ? 's' : ''}${analysis.enough ? ' — enough to trust it.' : '.'}`));
    const list = el('div', 'gs-candidates');
    analysis.candidates.slice(0, SHOWN_CANDIDATES).forEach((c, i) => {
      const label = el('label', 'gs-candidate');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = String(c.offset);
      box.checked = i === 0;
      label.appendChild(box);
      label.appendChild(document.createTextNode(` ${hex(c.offset)} (${question.sides.map((s) => `${s.name} ${c.values[s.id]}`).join(', ')})`));
      list.appendChild(label);
    });
    if (n > SHOWN_CANDIDATES) list.appendChild(el('span', 'muted', `and ${n - SHOWN_CANDIDATES} more — more recordings will narrow them down`));
    result.appendChild(list);
    const save = button('Save as game states', () => {
      const offsets = [...list.querySelectorAll('input:checked')].map((b) => Number(/** @type {HTMLInputElement} */ (b).value));
      on.save(question.id, offsets);
    }, 'Each side becomes a game state with the ticked bytes; groups can then show their paint only while one holds');
    save.classList.add('gs-save');
    result.appendChild(save);
  }
  for (const a of analysis.advice) result.appendChild(el('p', 'muted gs-advice', a));
  return result;
}

/** A recording's row: what it is, and moving or dropping it. */
function recordingRow(r, text, question, on) {
  const row = el('div', 'gs-recording');
  row.dataset.recordingId = r.id;
  row.appendChild(el('span', null, text));
  for (const s of question.sides.filter((x) => x.id !== r.side)) row.appendChild(button(`Move to ${s.name}`, () => on.moveRecording(r.id, s.id)));
  row.appendChild(button('Drop', () => on.dropRecording(r.id)));
  return row;
}

/**
 * @param {{ question: any, recordings: RecordingRow[], analysis: QuestionAnalysis }} item
 * @param {PanelData} data @param {PanelActions} on
 */
function questionCard({ question, recordings, analysis }, data, on) {
  const card = el('section', 'gs-question');
  card.dataset.questionId = question.id;
  const head = el('div', 'gs-question-head');
  head.appendChild(el('h3', null, question.name));
  head.appendChild(button('Delete question', () => on.deleteQuestion(question.id), 'Delete the question and its recordings (the game states it made stay)'));
  card.appendChild(head);
  const sideName = (id) => question.sides.find((s) => s.id === id)?.name || id;
  card.appendChild(sidesTable(analysis, data, on, question));
  card.appendChild(resultBlock(analysis, on, question));

  // Near misses: a recording that keeps a byte from fitting.
  if (analysis.nearMisses.length) {
    const box = el('details', 'gs-near');
    const byRec = new Map();
    for (const m of analysis.nearMisses) if (!byRec.has(m.recording)) byRec.set(m.recording, m);
    box.appendChild(el('summary', null, `Near misses (${byRec.size})`));
    for (const m of byRec.values()) {
      const r = recordings.find((x) => x.id === m.recording) || { id: m.recording, side: m.side, samples: 0 };
      const row = recordingRow(r, `${hex(m.offset)} fits all of “${sideName(m.side)}” but this recording${r.startedAt ? ` (${date(r.startedAt)})` : ''}.`, question, on);
      row.classList.add('gs-near-row');
      box.appendChild(row);
    }
    card.appendChild(box);
  }

  // Every recording, to move or drop.
  if (recordings.length) {
    const box = el('details', 'gs-recordings');
    box.appendChild(el('summary', null, `Recordings (${recordings.length})`));
    for (const r of recordings) {
      const what = r.source === 'frame' ? 'a captured frame' : `${r.samples} sample${r.samples === 1 ? '' : 's'}`;
      box.appendChild(recordingRow(r, `${sideName(r.side)} · ${what}${r.startedAt ? ` · ${date(r.startedAt)}` : ''}`, question, on));
    }
    card.appendChild(box);
  }
  return card;
}

/**
 * @param {HTMLElement} box @param {PanelData} data @param {PanelActions} on
 */
export function renderGameStatesPanel(box, data, on) {
  box.replaceChildren();
  box.appendChild(statesSection(data, on));
  const qs = el('section', 'gs-questions');
  const head = el('div', 'gs-question-head');
  head.appendChild(el('h3', null, 'Questions'));
  head.appendChild(button('New question…', () => on.newQuestion(), 'Ask the game’s memory something, e.g. “Who is the player?” with sides “Luigi” and “Mario”, and answer it from recordings'));
  qs.appendChild(head);
  if (!data.questions.length) {
    qs.appendChild(el('p', 'muted', 'A question tells game states apart from many recordings of each side — e.g. “Who is the player?”: Luigi / Mario. Record each side while playing in the emulator, or add captured frames to a side here; the bytes that still fit shrink as recordings come in.'));
  }
  for (const item of data.questions) qs.appendChild(questionCard(item, data, on));
  box.appendChild(qs);
}
