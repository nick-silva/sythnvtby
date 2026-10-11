/**
 * SpriteStudio's group lists: sprites and other groups, their folders (src/group-folders.js),
 * search, and moving groups between folders. Split out of tools/sprite-studio.js, which passes in
 * the state and functions it shares (initGroupList).
 */
import { spriteGroups, posesOf } from '../shared/pack-session.js';
import { isObjGroup } from '../../src/obj-sprite-profiles.js';
import { buildFolderTree, folderOf, folderMovedInto, normalizeFolderPath, withFolder, renameFolderInGroups, removeFolderFromGroups, renameFolderPaths, removeFolderPath } from '../../src/group-folders.js';
import { filterGroups } from '../../src/group-search.js';
import { recordGroupUse } from '../shared/recent-groups.js';

/** SpriteStudio's state and functions this part uses (tools/sprite-studio.js passes them in). */
let ctx;

export function initGroupList(context) {
  ctx = context;
}

/* ------------------------------------------------------------- sprite list */

function groupTileCount(g) {
  return Array.isArray(g?.criteria?.hashes) ? g.criteria.hashes.length : 0;
}

/* ---------------------------------------------------------------- folders */
// Each list (sprites, other groups) has its own folders: a group's `folder` path, saved in
// groups.json (src/group-folders.js). A new folder stays in `emptyFolders` until a group
// moves into it; which folders are collapsed is remembered per browser.

const COLLAPSED_FOLDERS_KEY = 'sprite-studio.collapsedFolders';
/** @type {{ objs: string[], rest: string[] }} */
let emptyFolders = { objs: [], rest: [] };

/** A pack just opened: no empty folders yet. */
export function clearEmptyFolders() {
  emptyFolders = { objs: [], rest: [] };
}
const collapsedFolders = new Set(readCollapsedFolders());

function readCollapsedFolders() {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveCollapsedFolders() {
  try {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsedFolders]));
  } catch {
    // Private windows can refuse storage; folders then just open expanded next time.
  }
}

/** @param {any} g @returns {'objs' | 'rest'} */
const sectionOf = (g) => (isObjGroup(g) ? 'objs' : 'rest');

/** Apply `fn` to the groups of one list only, leaving the other list's folders alone. */
function updateSectionGroups(section, fn) {
  const inSection = ctx.session.groups.filter((g) => sectionOf(g) === section);
  const changed = new Map(fn(inSection).map((g) => [g.id, g]));
  ctx.session.groups = ctx.session.groups.map((g) => changed.get(g.id) || g);
  if (ctx.selectedGroup) ctx.selectedGroup = ctx.session.groups.find((g) => g.id === ctx.selectedGroup.id) || ctx.selectedGroup;
}

function moveGroupToFolder(groupId, path) {
  const g = ctx.session?.groups.find((x) => x.id === groupId);
  if (!g) return;
  const folder = normalizeFolderPath(path);
  if (folderOf(g) === folder) return;
  updateSectionGroups(sectionOf(g), (list) => list.map((x) => (x.id === groupId ? withFolder(x, folder) : x)));
  ctx.markDirty();
  renderSpriteLists();
  ctx.renderDetail();
  ctx.setStatus(`Moved “${g.name || g.id}” to ${folder ? `folder “${folder}”` : 'the top level'}.`);
}

function newFolder(section) {
  const raw = window.prompt('New folder name (use / to nest, e.g. Enemies/Koopas):', '');
  const path = normalizeFolderPath(raw);
  if (!path) return;
  if (!emptyFolders[section].includes(path)) emptyFolders = { ...emptyFolders, [section]: [...emptyFolders[section], path] };
  renderSpriteLists();
  ctx.renderDetail(); // the Folder picker lists the new folder too
  ctx.setStatus(`Folder “${path}” added — drag groups onto it, or pick it under Folder on the right.`);
}

function renameFolder(section, path) {
  const raw = window.prompt(`Rename folder “${path}” to (use / to nest):`, path);
  const next = normalizeFolderPath(raw);
  if (!next || next === path) return;
  updateSectionGroups(section, (list) => renameFolderInGroups(list, path, next));
  emptyFolders = { ...emptyFolders, [section]: renameFolderPaths(emptyFolders[section], path, next) };
  ctx.markDirty();
  renderSpriteLists();
  ctx.renderDetail();
  ctx.setStatus(`Folder “${path}” is now “${next}”.`);
}

/** Drop a folder (and everything in it) into another folder, or onto the list for the top level. */
function moveFolderInto(section, path, into) {
  const next = folderMovedInto(path, into);
  if (!next) return;
  const inSection = ctx.session.groups.filter((g) => sectionOf(g) === section);
  const clash = inSection.some((g) => folderOf(g) === next || folderOf(g).startsWith(next + '/')) || emptyFolders[section].includes(next);
  if (clash && !window.confirm(`There is already a folder “${next}”. Put the contents of “${path}” in it too?`)) return;
  updateSectionGroups(section, (list) => renameFolderInGroups(list, path, next));
  emptyFolders = { ...emptyFolders, [section]: [...new Set(renameFolderPaths(emptyFolders[section], path, next))] };
  // Keep a collapsed folder collapsed under its new path.
  for (const key of [...collapsedFolders]) {
    const prefix = `${section}:${path}`;
    if (key === prefix || key.startsWith(prefix + '/')) {
      collapsedFolders.delete(key);
      collapsedFolders.add(`${section}:${next}${key.slice(prefix.length)}`);
    }
  }
  saveCollapsedFolders();
  ctx.markDirty();
  renderSpriteLists();
  ctx.renderDetail();
  ctx.setStatus(`Folder “${path}” moved to ${into ? `“${normalizeFolderPath(into)}”` : 'the top level'} (now “${next}”).`);
}

function removeFolder(section, node) {
  const msg = node.total
    ? `Remove folder “${node.path}”? Its ${node.total} group(s) move up one level; nothing is deleted.`
    : `Remove empty folder “${node.path}”?`;
  if (!window.confirm(msg)) return;
  updateSectionGroups(section, (list) => removeFolderFromGroups(list, node.path));
  emptyFolders = { ...emptyFolders, [section]: removeFolderPath(emptyFolders[section], node.path) };
  if (node.total) ctx.markDirty();
  renderSpriteLists();
  ctx.renderDetail();
  ctx.setStatus(`Removed folder “${node.path}”.`);
}

/** The folder being dragged, if any (the drag data itself cannot be read during dragover). */
let draggedFolder = /** @type {{ section: string, path: string } | null} */ (null);

/**
 * Rows and folders accept a dragged group row, and a dragged folder of the same list; dropping
 * moves the group, or the folder with everything in it, there.
 */
function acceptGroupDrop(target, path, section) {
  const folderFits = () => draggedFolder && draggedFolder.section === section && folderMovedInto(draggedFolder.path, path) != null;
  target.addEventListener('dragover', (ev) => {
    const types = ev.dataTransfer?.types || [];
    if (types.includes('text/x-folder-path')) {
      // A folder that cannot go here (itself, its own sub-folder) is still caught, so the drop
      // does not fall through to an outer folder.
      ev.stopPropagation();
      if (!folderFits()) return;
    } else if (!types.includes('text/x-group-id')) return;
    ev.preventDefault();
    ev.stopPropagation();
    target.classList.add('drop-target');
  });
  target.addEventListener('dragleave', () => target.classList.remove('drop-target'));
  target.addEventListener('drop', (ev) => {
    target.classList.remove('drop-target');
    if (ev.dataTransfer?.types.includes('text/x-folder-path')) {
      ev.preventDefault();
      ev.stopPropagation();
      const folder = draggedFolder;
      draggedFolder = null;
      if (folder && folder.section === section) moveFolderInto(section, folder.path, path);
      return;
    }
    const id = ev.dataTransfer?.getData('text/x-group-id');
    if (!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    moveGroupToFolder(id, path);
  });
}

/** Text as nodes, the query's words marked (case ignored). */
function highlightWords(text, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [document.createTextNode(text)];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return String(text).split(re).filter(Boolean).map((part) => {
    if (!words.includes(part.toLowerCase())) return document.createTextNode(part);
    const m = document.createElement('mark');
    m.textContent = part;
    return m;
  });
}

function groupRow(g) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sprite-row';
  btn.dataset.groupId = g.id;
  btn.draggable = true;
  const name = document.createElement('span');
  name.className = 'name';
  name.append(...highlightWords(g.name || g.id, groupQuery));
  const meta = document.createElement('span');
  meta.className = 'meta';
  const recovered = (ctx.session?.recovered || []).filter((i) => i.groupId === g.id).length;
  meta.textContent = `${posesOf(g).length} pose(s) · ${groupTileCount(g)} tile(s)${recovered ? ` · ${recovered} recovered` : ''}`;
  btn.append(name, meta);
  btn.addEventListener('click', () => {
    // Picking a group yourself counts as using it (the Project tool's New pose lists those first);
    // the selection a pack opens on does not.
    recordGroupUse(g.id);
    ctx.selectGroup(g);
  });
  btn.addEventListener('dragstart', (ev) => {
    ev.dataTransfer?.setData('text/x-group-id', g.id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  });
  return btn;
}

function folderButton(label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'folder-action';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return b;
}

/** One folder level: sub-folders first (collapsible), then the groups filed here. */
function renderFolderNode(node, host, section) {
  for (const f of node.folders) {
    const key = `${section}:${f.path}`;
    const details = document.createElement('details');
    details.className = 'folder';
    details.dataset.folderPath = f.path;
    // While searching, every folder with a match is open; that is not remembered as its state.
    const searching = !!groupQuery.trim();
    details.open = searching || !collapsedFolders.has(key);
    details.addEventListener('toggle', () => {
      if (searching) return;
      if (details.open) collapsedFolders.delete(key);
      else collapsedFolders.add(key);
      saveCollapsedFolders();
    });
    const summary = document.createElement('summary');
    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = f.name;
    const count = document.createElement('span');
    count.className = 'folder-count';
    count.textContent = String(f.total);
    summary.append(
      name,
      count,
      folderButton('✎', `Rename folder “${f.path}”`, () => renameFolder(section, f.path)),
      folderButton('✕', `Remove folder “${f.path}” (its groups move up a level)`, () => removeFolder(section, f)),
    );
    summary.draggable = true;
    summary.title = 'Drag onto another folder to put this folder inside it';
    summary.addEventListener('dragstart', (ev) => {
      ev.stopPropagation();
      draggedFolder = { section, path: f.path };
      ev.dataTransfer?.setData('text/x-folder-path', f.path);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    summary.addEventListener('dragend', () => {
      draggedFolder = null;
    });
    acceptGroupDrop(summary, f.path, section);
    const body = document.createElement('div');
    body.className = 'folder-body';
    acceptGroupDrop(body, f.path, section); // dropping onto a row inside the folder files it here too
    renderFolderNode(f, body, section);
    details.append(summary, body);
    host.append(details);
  }
  for (const g of node.groups) host.append(groupRow(g));
}

function renderGroupTree(list, host, section, emptyText) {
  host.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = emptyText;
    host.append(p);
    return;
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'folder-new';
  add.textContent = '+ Folder';
  add.title = 'New folder for these groups (use / to nest). Drag groups, or other folders, onto a folder to file them.';
  add.addEventListener('click', () => newFolder(section));
  host.append(add);
  // A search shows only folders holding a match, not the empty ones.
  renderFolderNode(buildFolderTree(list, groupQuery.trim() ? [] : emptyFolders[section]), host, section);
  // Dropping on the list itself, outside any folder, moves a group or folder to the top level.
  acceptGroupDrop(host, '', section);
}

/** The Folder picker in the details panel: the keyboard way to file the selected group. */
export function folderPicker(group) {
  const section = sectionOf(group);
  const paths = [];
  const walk = (node) => {
    for (const f of node.folders) {
      paths.push(f.path);
      walk(f);
    }
  };
  walk(buildFolderTree(ctx.session.groups.filter((g) => sectionOf(g) === section), emptyFolders[section]));
  const label = document.createElement('label');
  label.className = 'folder-picker';
  label.textContent = 'Folder ';
  const select = document.createElement('select');
  select.id = 'group-folder-select';
  const opt = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };
  select.append(opt('', '(top level)'), ...paths.map((p) => opt(p, p)), opt('__new__', 'New folder…'));
  select.value = folderOf(group);
  select.addEventListener('change', () => {
    if (select.value !== '__new__') {
      moveGroupToFolder(group.id, select.value);
      return;
    }
    const path = normalizeFolderPath(window.prompt('New folder name (use / to nest, e.g. Enemies/Koopas):', ''));
    if (path) moveGroupToFolder(group.id, path);
    else select.value = folderOf(group);
  });
  label.append(select);
  return label;
}

export function renderSpriteLists() {
  const { objs, rest } = spriteGroups(ctx.session);
  // Quick search (src/group-search.js): only matching groups, in folders opened to show them.
  const shownObjs = filterGroups(objs, groupQuery);
  const shownRest = filterGroups(rest, groupQuery);
  const none = groupQuery.trim() ? `No groups match “${groupQuery.trim()}”.` : null;
  renderGroupTree(shownObjs, ctx.el('sprite-list'), 'objs', none || 'No OBJ groups in this pack.');
  renderGroupTree(shownRest, ctx.el('other-list'), 'rest', none || 'No other groups.');
  const count = ctx.el('group-search-count');
  if (count) count.textContent = groupQuery.trim() ? `${shownObjs.length + shownRest.length} of ${objs.length + rest.length}` : '';
  markActiveRow();
}

/** What the quick search box holds; empty lists every group. */
let groupQuery = '';

function setGroupQuery(text) {
  groupQuery = text;
  const box = /** @type {HTMLInputElement|null} */ (ctx.el('group-search'));
  if (box && box.value !== text) box.value = text;
  if (ctx.session) renderSpriteLists();
}

/** The quick search box: filters on every keystroke; Enter opens the first match, Esc clears. */
export function bindGroupSearch() {
  const box = /** @type {HTMLInputElement|null} */ (ctx.el('group-search'));
  if (!box) return;
  box.addEventListener('input', () => setGroupQuery(box.value));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = /** @type {HTMLButtonElement|null} */ (document.querySelector('.rail-left .sprite-row'));
      if (first) first.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (box.value) setGroupQuery('');
      else box.blur();
    } else if (e.key === 'ArrowDown') {
      const first = /** @type {HTMLButtonElement|null} */ (document.querySelector('.rail-left .sprite-row'));
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      box.focus();
      box.select();
    }
  });
}

export function markActiveRow() {
  for (const btn of document.querySelectorAll('.sprite-row')) {
    btn.classList.toggle('active', btn.dataset.groupId === ctx.selectedGroup?.id);
  }
}
