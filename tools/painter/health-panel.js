/**
 * The Project tool's "Check project" list (src/project-health.js finds the issues): problems first,
 * each with its one fix and a "Show me" that opens an example frame on the pixel; the rest (tiles
 * not painted yet, shared tiles that can only take one colour) folded away below. Built from DOM
 * nodes — group names are user text.
 */

/**
 * @typedef {import('../../src/project-health.js').HealthIssue} HealthIssue
 * @typedef {{ onFix: (issue: HealthIssue) => void, onShow: (issue: HealthIssue) => void }} HealthHandlers
 */

/** @param {HealthIssue} issue @param {HealthHandlers} on */
function issueRow(issue, on) {
  const li = document.createElement('li');
  li.className = `health-issue${issue.problem ? ' is-problem' : ''}`;
  li.dataset.kind = issue.kind;
  const text = document.createElement('p');
  text.textContent = issue.sentence;
  li.appendChild(text);
  const actions = document.createElement('div');
  actions.className = 'health-actions';
  const fix = document.createElement('button');
  fix.type = 'button';
  fix.className = 'btn-ghost health-fix';
  fix.textContent = issue.fix.label;
  fix.addEventListener('click', () => on.onFix(issue));
  actions.appendChild(fix);
  if (issue.example) {
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'btn-ghost health-show';
    show.textContent = 'Show me';
    show.title = 'Open a frame that shows it, with This pixel explaining the spot';
    show.addEventListener('click', () => on.onShow(issue));
    actions.appendChild(show);
  }
  li.appendChild(actions);
  return li;
}

/**
 * @param {HTMLElement} box
 * @param {{ issues: HealthIssue[] | null, frames: number, checking: boolean }} result
 * @param {HealthHandlers} on
 */
export function renderHealthList(box, result, on) {
  box.replaceChildren();
  const status = document.createElement('p');
  status.className = 'muted health-status';
  box.appendChild(status);
  if (!result.issues) {
    status.textContent = result.checking ? 'Checking the captured frames…' : 'Open a project to check it.';
    return;
  }
  const problems = result.issues.filter((i) => i.problem);
  const todos = result.issues.filter((i) => !i.problem);
  const frames = `${result.frames} captured frame${result.frames === 1 ? '' : 's'}`;
  status.textContent = problems.length
    ? `${problems.length} thing${problems.length === 1 ? '' : 's'} to check, across ${frames}.${result.checking ? ' Checking again…' : ''}`
    : `Nothing to fix across ${frames}.${result.checking ? ' Checking again…' : ''}`;
  if (problems.length) {
    const ul = document.createElement('ul');
    ul.className = 'health-list';
    for (const i of problems) ul.appendChild(issueRow(i, on));
    box.appendChild(ul);
  }
  const sections = [
    ['unpainted', (n) => `Not painted yet (${n} group${n === 1 ? '' : 's'})`],
    ['order', (n) => `Shared tiles that take one colour (${n})`],
    ['screen', () => 'Frames no screen recognises'],
  ];
  for (const [kind, title] of sections) {
    const list = todos.filter((i) => i.kind === kind);
    if (!list.length) continue;
    const more = document.createElement('details');
    more.className = 'health-todos';
    more.dataset.kind = kind;
    const sum = document.createElement('summary');
    sum.textContent = title(list.length);
    more.appendChild(sum);
    const ul = document.createElement('ul');
    ul.className = 'health-list';
    for (const i of list) ul.appendChild(issueRow(i, on));
    more.appendChild(ul);
    box.appendChild(more);
  }
}
