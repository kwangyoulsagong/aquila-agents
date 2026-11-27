import { describe, expect, it } from 'vitest';
import type { VaultCard } from '@/shared/api';
import {
  defaultColumns,
  byStatus,
  filterRows,
  FOLDER,
  groupRows,
  keysOf,
  MODIFIED,
  nextSort,
  prepare,
  sortRows,
  splitList,
  statusCounts,
  TITLE,
  valuesOf,
} from './table';

const card = (rel: string, props: VaultCard['props'], mtime = 0): VaultCard => ({
  path: `/v/${rel}`,
  rel,
  title: rel.replace(/^.*\//, '').replace(/\.md$/, ''),
  props,
  mtime,
});

const rows = prepare([
  card('specs/Login.md', { status: 'todo', owner: 'Kim', tags: ['auth', 'ui'] }, 3),
  card('specs/Signup.md', { status: 'done', owner: 'Lee', tags: ['auth'] }, 1),
  card('notes/Idea 10.md', { status: 'todo' }, 2),
  card('notes/Idea 9.md', {}, 4),
  card('Top.md', { priority: '2' }, 5),
]);
const titles = (rs: { card: VaultCard }[]) => rs.map((r) => r.card.title);
const none = { text: '', folder: '', prop: null };

describe('table model', () => {
  it('finds keys, most used first, and default columns', () => {
    expect(keysOf(rows)).toEqual(['status', 'owner', 'tags', 'priority']);
    expect(defaultColumns(keysOf(rows))).toEqual([FOLDER, 'status', 'owner', 'tags', 'priority', MODIFIED]);
    expect(valuesOf(rows, 'tags')).toEqual([
      { value: 'auth', count: 2 },
      { value: 'ui', count: 1 },
    ]);
  });

  it('filters by text, folder and property = value (lists match an item)', () => {
    expect(titles(filterRows(rows, { ...none, text: 'KIM' }))).toEqual(['Login']);
    expect(titles(filterRows(rows, { ...none, text: 'notes/' }))).toEqual(['Idea 10', 'Idea 9']);
    expect(titles(filterRows(rows, { ...none, folder: 'specs' }))).toEqual(['Login', 'Signup']);
    expect(titles(filterRows(rows, { ...none, prop: { key: 'tags', value: 'ui' } }))).toEqual(['Login']);
  });

  it('counts statuses and filters by one', () => {
    expect(statusCounts(rows)).toEqual([
      { value: 'todo', count: 2 },
      { value: 'done', count: 1 },
    ]);
    expect(titles(byStatus(rows, 'done'))).toEqual(['Signup']);
    expect(byStatus(rows, null)).toHaveLength(5);
    expect(statusCounts(prepare([card('a.md', {})]))).toEqual([]);
  });

  it('sorts naturally with empty values last, by modified, and by default newest first', () => {
    expect(titles(sortRows(rows, { key: TITLE, dir: 1 }))).toEqual([
      'Idea 9',
      'Idea 10',
      'Login',
      'Signup',
      'Top',
    ]);
    expect(titles(sortRows(rows, { key: 'status', dir: -1 }))).toEqual([
      'Idea 10',
      'Login',
      'Signup',
      'Idea 9',
      'Top',
    ]);
    expect(titles(sortRows(rows, { key: 'status', dir: 1 })).slice(-2)).toEqual(['Idea 9', 'Top']);
    expect(titles(sortRows(rows, { key: MODIFIED, dir: 1 }))).toEqual([
      'Signup',
      'Idea 10',
      'Login',
      'Idea 9',
      'Top',
    ]);
    expect(titles(sortRows(rows, null))).toEqual(['Top', 'Idea 9', 'Login', 'Idea 10', 'Signup']);
  });

  it('groups by a property or folder, "none" last', () => {
    const items = groupRows(sortRows(rows, { key: TITLE, dir: 1 }), 'status');
    expect(items.map((i) => (i.kind === 'group' ? `#${i.key}:${i.count}` : i.row.card.title))).toEqual([
      '#done:1',
      'Signup',
      '#todo:2',
      'Idea 10',
      'Login',
      '#:2',
      'Idea 9',
      'Top',
    ]);
    expect(
      groupRows(rows, FOLDER)
        .filter((i) => i.kind === 'group')
        .map((i) => i.kind === 'group' && i.key),
    ).toEqual(['notes', 'specs', '']);
    expect(groupRows(rows, '')).toHaveLength(5);
  });

  it('cycles the sort on header clicks and splits list input', () => {
    expect(nextSort(null, 'a')).toEqual({ key: 'a', dir: 1 });
    expect(nextSort({ key: 'a', dir: 1 }, 'a')).toEqual({ key: 'a', dir: -1 });
    expect(nextSort({ key: 'a', dir: -1 }, 'a')).toBeNull();
    expect(nextSort(null, MODIFIED)).toEqual({ key: MODIFIED, dir: -1 });
    expect(splitList(' a, b ,, c')).toEqual(['a', 'b', 'c']);
  });
});
