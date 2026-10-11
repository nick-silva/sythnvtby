import { describe, it, expect } from 'vitest';
import {
  normalizeFolderPath,
  folderOf,
  withFolder,
  buildFolderTree,
  renameFolderInGroups,
  removeFolderFromGroups,
  renameFolderPaths,
  removeFolderPath,
  folderMovedInto,
} from './group-folders.js';

const g = (id, folder) => (folder === undefined ? { id, name: id } : { id, name: id, folder });

describe('normalizeFolderPath', () => {
  it('trims segments, drops empty ones, and joins with /', () => {
    expect(normalizeFolderPath('  Enemies / Koopas  ')).toBe('Enemies/Koopas');
    expect(normalizeFolderPath('/Enemies//Koopas/')).toBe('Enemies/Koopas');
    expect(normalizeFolderPath('')).toBe('');
    expect(normalizeFolderPath(undefined)).toBe('');
    expect(normalizeFolderPath(42)).toBe('');
  });
});

describe('withFolder', () => {
  it('returns a new group with the folder set, leaving the original alone', () => {
    const a = g('a');
    const b = withFolder(a, ' Heroes ');
    expect(b).not.toBe(a);
    expect(b.folder).toBe('Heroes');
    expect(a.folder).toBeUndefined();
  });

  it('removes the folder key when moved to the top level', () => {
    const b = withFolder(g('a', 'Heroes'), '');
    expect('folder' in b).toBe(false);
    expect(folderOf(b)).toBe('');
  });
});

describe('buildFolderTree', () => {
  it('nests folders, creates missing parents, sorts folders by name and keeps group order', () => {
    const groups = [g('mario', 'Heroes'), g('koopa', 'Enemies/Koopas'), g('hud'), g('spiny', 'Enemies'), g('luigi', 'Heroes')];
    const root = buildFolderTree(groups);
    expect(root.groups.map((x) => x.id)).toEqual(['hud']);
    expect(root.folders.map((f) => f.name)).toEqual(['Enemies', 'Heroes']);
    const enemies = root.folders[0];
    expect(enemies.path).toBe('Enemies');
    expect(enemies.groups.map((x) => x.id)).toEqual(['spiny']);
    expect(enemies.folders.map((f) => f.path)).toEqual(['Enemies/Koopas']);
    expect(enemies.folders[0].groups.map((x) => x.id)).toEqual(['koopa']);
    expect(root.folders[1].groups.map((x) => x.id)).toEqual(['mario', 'luigi']);
  });

  it('counts every group below a folder', () => {
    const root = buildFolderTree([g('a', 'X'), g('b', 'X/Y'), g('c', 'X/Y/Z')]);
    expect(root.folders[0].total).toBe(3);
    expect(root.folders[0].folders[0].total).toBe(2);
  });

  it('shows empty folders the user just made', () => {
    const root = buildFolderTree([g('a')], ['Bosses/Final']);
    expect(root.folders.map((f) => f.path)).toEqual(['Bosses']);
    expect(root.folders[0].folders[0].path).toBe('Bosses/Final');
    expect(root.folders[0].total).toBe(0);
  });

  it('sorts numbered folders naturally', () => {
    const root = buildFolderTree([g('a', 'Level 10'), g('b', 'Level 2')]);
    expect(root.folders.map((f) => f.name)).toEqual(['Level 2', 'Level 10']);
  });
});

describe('renaming and removing folders', () => {
  const groups = [g('a', 'Enemies'), g('b', 'Enemies/Koopas'), g('c', 'Enemy'), g('d')];

  it('renames a folder and everything under it, but not look-alike names', () => {
    const out = renameFolderInGroups(groups, 'Enemies', 'Baddies');
    expect(out.map(folderOf)).toEqual(['Baddies', 'Baddies/Koopas', 'Enemy', '']);
    expect(out[2]).toBe(groups[2]); // untouched groups keep their identity
    expect(out[3]).toBe(groups[3]);
  });

  it('removing a folder moves its contents up one level', () => {
    const out = removeFolderFromGroups(groups, 'Enemies');
    expect(out.map(folderOf)).toEqual(['', 'Koopas', 'Enemy', '']);
    const nested = removeFolderFromGroups([g('x', 'A/B/C'), g('y', 'A/B')], 'A/B');
    expect(nested.map(folderOf)).toEqual(['A/C', 'A']);
  });

  it('keeps the list of empty folders in step', () => {
    expect(renameFolderPaths(['Enemies/Bosses', 'Heroes'], 'Enemies', 'Baddies')).toEqual(['Baddies/Bosses', 'Heroes']);
    expect(removeFolderPath(['Enemies', 'Enemies/Bosses', 'Heroes'], 'Enemies')).toEqual(['Bosses', 'Heroes']);
  });
});

describe('folderMovedInto', () => {
  it('puts a folder, with its name, inside another', () => {
    expect(folderMovedInto('Koopas', 'Enemies')).toBe('Enemies/Koopas');
    expect(folderMovedInto('Enemies/Koopas', 'Bosses')).toBe('Bosses/Koopas');
  });

  it('moves a nested folder back to the top level', () => {
    expect(folderMovedInto('Enemies/Koopas', '')).toBe('Koopas');
  });

  it('refuses no-op moves and moves into itself or its own sub-folders', () => {
    expect(folderMovedInto('Enemies/Koopas', 'Enemies')).toBeNull();
    expect(folderMovedInto('Koopas', '')).toBeNull();
    expect(folderMovedInto('Enemies', 'Enemies')).toBeNull();
    expect(folderMovedInto('Enemies', 'Enemies/Koopas')).toBeNull();
    expect(folderMovedInto('', 'Enemies')).toBeNull();
  });

  it('a look-alike name is not a sub-folder', () => {
    expect(folderMovedInto('Enemies', 'EnemiesOld')).toBe('EnemiesOld/Enemies');
  });

  it('with renameFolderInGroups, carries the groups below it along', () => {
    const groups = [g('a', 'Koopas'), g('b', 'Koopas/Red'), g('c', 'Enemies')];
    const to = folderMovedInto('Koopas', 'Enemies');
    expect(renameFolderInGroups(groups, 'Koopas', to).map(folderOf)).toEqual(['Enemies/Koopas', 'Enemies/Koopas/Red', 'Enemies']);
  });
});
