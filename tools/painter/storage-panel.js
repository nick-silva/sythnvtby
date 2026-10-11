/**
 * The Project tool's "Project storage" window (File ▸ Project storage…; src/project-storage.js):
 * what the project's space is used for, kind by kind, and the memory recordings per question,
 * with the ways to make it smaller. Built from DOM nodes; the Project tool does the actions.
 */

/**
 * @typedef {import('../../src/project-storage.js').StorageRow} StorageRow
 * @typedef {{ fileBytes: number | null, rows: StorageRow[], questions: Array<{ id: string, name: string, recordings: number, bytes: number }> }} StorageData
 * @typedef {{ cleanUpFrames: () => void, deleteRecordings: (questionId: string) => void, format: (bytes: number) => string }} StorageActions
 */

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

/** @param {HTMLElement} box @param {StorageData} data @param {StorageActions} on */
export function renderStoragePanel(box, data, on) {
  box.replaceChildren();
  const total = data.rows.reduce((n, r) => n + r.bytes, 0);
  box.appendChild(el('p', 'storage-total', data.fileBytes != null
    ? `The .vbpack is ${on.format(data.fileBytes)} on disk; ${on.format(total)} before compression.`
    : `${on.format(total)} before compression (not saved yet).`));
  const table = el('table', 'storage-table');
  const head = el('tr');
  for (const h of ['What', 'Files', 'Size', 'For', 'Without it']) head.appendChild(el('th', null, h));
  table.appendChild(head);
  for (const r of data.rows) {
    const tr = el('tr');
    tr.dataset.kind = r.kind;
    tr.appendChild(el('td', null, r.label));
    tr.appendChild(el('td', null, String(r.count)));
    tr.appendChild(el('td', null, on.format(r.bytes)));
    tr.appendChild(el('td', 'muted', r.purpose));
    const without = el('td', 'muted', r.without);
    if (r.kind === 'frames') without.appendChild(button('Clean up frames…', on.cleanUpFrames, 'Archive or delete captured frames you no longer need'));
    tr.appendChild(without);
    table.appendChild(tr);
  }
  box.appendChild(table);
  const withRecordings = data.questions.filter((q) => q.recordings > 0);
  if (withRecordings.length) {
    box.appendChild(el('h3', null, 'Memory recordings, by question'));
    for (const q of withRecordings) {
      const row = el('div', 'storage-question');
      row.dataset.questionId = q.id;
      row.appendChild(el('span', null, `${q.name} — ${q.recordings} recording${q.recordings === 1 ? '' : 's'}, ${on.format(q.bytes)}`));
      row.appendChild(button('Delete recordings', () => on.deleteRecordings(q.id), 'Take this question’s recordings out of the project. The question and the game states it made stay; re-checking it needs new recordings.'));
      box.appendChild(row);
    }
  }
}
