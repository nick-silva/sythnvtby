/**
 * Folders for groups: a user's own tree for sorting groups (SpriteStudio's left rail).
 *
 * A group's folder is an optional `folder` path in groups.json, segments joined by "/"
 * ("Enemies/Koopas"); no folder means the top level. Folders only organise — nothing about
 * matching, painting or rendering reads them. A folder exists while a group is in it; an empty
 * one the user just made is passed in as an extra path until something moves into it.
 */

export const FOLDER_SEPARATOR = '/';

/**
 * @param {unknown} raw
 * @returns {string} normalised path ("" for the top level)
 */
export function normalizeFolderPath(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .split(FOLDER_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(FOLDER_SEPARATOR);
}

/** @param {{ folder?: unknown } | null | undefined} group */
export function folderOf(group) {
  return normalizeFolderPath(group?.folder);
}

/**
 * @template {object} G
 * @param {G} group
 * @param {string} path
 * @returns {G} a new group in `path` (no `folder` key at the top level)
 */
export function withFolder(group, path) {
  const folder = normalizeFolderPath(path);
  const { folder: _old, ...rest } = /** @type {any} */ (group);
  return /** @type {G} */ (folder ? { ...rest, folder } : rest);
}

/**
 * @template G
 * @typedef {{ name: string, path: string, folders: FolderNode<G>[], groups: G[], total: number }} FolderNode
 */

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * @template {{ folder?: unknown }} G
 * @param {G[]} groups
 * @param {string[]} [extraPaths] empty folders to show as well
 * @returns {FolderNode<G>} the top level: its groups, then folders sorted by name
 */
export function buildFolderTree(groups, extraPaths = []) {
  /** @type {FolderNode<G>} */
  const root = { name: '', path: '', folders: [], groups: [], total: 0 };
  /** @type {Map<string, FolderNode<G>>} */
  const nodes = new Map([['', root]]);
  const ensure = (path) => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const parts = path.split(FOLDER_SEPARATOR);
    const parent = ensure(parts.slice(0, -1).join(FOLDER_SEPARATOR));
    /** @type {FolderNode<G>} */
    const node = { name: parts[parts.length - 1], path, folders: [], groups: [], total: 0 };
    parent.folders.push(node);
    nodes.set(path, node);
    return node;
  };
  for (const p of extraPaths) {
    const path = normalizeFolderPath(p);
    if (path) ensure(path);
  }
  for (const g of groups) ensure(folderOf(g)).groups.push(g);
  const finish = (node) => {
    node.folders.sort((a, b) => byName.compare(a.name, b.name));
    node.total = node.groups.length + node.folders.reduce((n, f) => n + finish(f), 0);
    return node.total;
  };
  finish(root);
  return root;
}

/** True when `path` is `folder` itself or inside it. */
function isInside(path, folder) {
  return path === folder || path.startsWith(folder + FOLDER_SEPARATOR);
}

/** @param {string} path @param {string} from @param {string} to */
function renamedPath(path, from, to) {
  return normalizeFolderPath(to + path.slice(from.length));
}

/** Where `path` goes when `folder` is removed: its contents move up one level. */
function withoutFolder(path, folder) {
  const parent = folder.split(FOLDER_SEPARATOR).slice(0, -1).join(FOLDER_SEPARATOR);
  return normalizeFolderPath(parent + FOLDER_SEPARATOR + path.slice(folder.length));
}

/**
 * @template {{ folder?: unknown }} G
 * @param {G[]} groups @param {string} from @param {string} to
 * @returns {G[]} groups in `from` (and below) moved to `to`; the others unchanged
 */
export function renameFolderInGroups(groups, from, to) {
  const src = normalizeFolderPath(from);
  if (!src) return groups;
  return groups.map((g) => (isInside(folderOf(g), src) ? withFolder(g, renamedPath(folderOf(g), src, to)) : g));
}

/**
 * @template {{ folder?: unknown }} G
 * @param {G[]} groups @param {string} folder
 * @returns {G[]} groups in `folder` (and below) moved up one level
 */
export function removeFolderFromGroups(groups, folder) {
  const target = normalizeFolderPath(folder);
  if (!target) return groups;
  return groups.map((g) => (isInside(folderOf(g), target) ? withFolder(g, withoutFolder(folderOf(g), target)) : g));
}

/**
 * Where `folder` lands when it is dropped into `into` ("" for the top level): `into` plus the
 * folder's own name. Null when that is no move — the folder is already there, or `into` is the
 * folder itself or one of its sub-folders.
 * @param {string} folder @param {string} into
 * @returns {string | null}
 */
export function folderMovedInto(folder, into) {
  const src = normalizeFolderPath(folder);
  const dest = normalizeFolderPath(into);
  if (!src || (dest && isInside(dest, src))) return null;
  const name = src.split(FOLDER_SEPARATOR).pop();
  const next = normalizeFolderPath(dest ? dest + FOLDER_SEPARATOR + name : name);
  return next === src ? null : next;
}

/** The empty-folder list after a rename. @param {string[]} paths @param {string} from @param {string} to */
export function renameFolderPaths(paths, from, to) {
  const src = normalizeFolderPath(from);
  return paths.map((p) => (isInside(normalizeFolderPath(p), src) ? renamedPath(normalizeFolderPath(p), src, to) : p));
}

/** The empty-folder list after a removal. @param {string[]} paths @param {string} folder */
export function removeFolderPath(paths, folder) {
  const target = normalizeFolderPath(folder);
  const out = [];
  for (const p of paths) {
    const path = normalizeFolderPath(p);
    if (path === target) continue;
    const next = isInside(path, target) ? withoutFolder(path, target) : path;
    if (next && !out.includes(next)) out.push(next);
  }
  return out;
}
