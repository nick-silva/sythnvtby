import { describe, it, expect } from 'vitest';
import { matchesGroupQuery, filterGroups, orderByRecent, withRecentUse } from './group-search.js';

const g = (id, name, folder) => ({ id, name, ...(folder && { folder }) });

describe('matchesGroupQuery', () => {
  it('matches every word of the query in the name or folder, ignoring case and order', () => {
    const luigi = g('a', 'Luigi-PlayingAs', 'Players/Luigi');
    expect(matchesGroupQuery(luigi, '')).toBe(true);
    expect(matchesGroupQuery(luigi, 'luigi')).toBe(true);
    expect(matchesGroupQuery(luigi, 'playing LUI')).toBe(true);
    expect(matchesGroupQuery(luigi, 'players')).toBe(true);
    expect(matchesGroupQuery(luigi, 'luigi toad')).toBe(false);
    expect(matchesGroupQuery(g('b', ''), 'b')).toBe(true); // nameless groups go by id
  });

  it('filters a list, keeping its order', () => {
    const list = [g('1', 'Mario'), g('2', 'Luigi'), g('3', 'Mario Background')];
    expect(filterGroups(list, 'mario').map((x) => x.id)).toEqual(['1', '3']);
    expect(filterGroups(list, '  ')).toBe(list);
  });
});

describe('orderByRecent', () => {
  it('puts recently used groups first, newest use first, then the rest by name', () => {
    const list = [g('1', 'Zelda'), g('2', 'apple'), g('3', 'Mario'), g('4', 'Luigi')];
    expect(orderByRecent(list, ['4', 'gone', '1']).map((x) => x.id)).toEqual(['4', '1', '2', '3']);
    expect(orderByRecent(list, []).map((x) => x.name)).toEqual(['apple', 'Luigi', 'Mario', 'Zelda']);
  });

  it('records a use at the front, once, and keeps the list short', () => {
    expect(withRecentUse(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(withRecentUse(['a'], 'z', 2)).toEqual(['z', 'a']);
    expect(withRecentUse(['a', 'b'], 'z', 2)).toEqual(['z', 'a']);
    expect(withRecentUse(['a'], '')).toEqual(['a']);
  });
});
