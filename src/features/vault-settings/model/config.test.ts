import { describe, expect, it } from 'vitest';
import type { VaultCard, VaultViewData } from '@/shared/api';
import {
  cellText,
  formatConfig,
  frontmatterKeys,
  gridItems,
  neighbor,
  nextSort,
  parseDraft,
  summarize,
  TITLE,
} from './config';

describe('vault settings model', () => {
  it('summarizes a config by section, skipping empty ones', () => {
    expect(
      summarize({
        links: [{ pattern: 'DB-\\d+', to: 'name' }],
        properties: [],
        companions: { folders: ['specs', 'reports'] },
        views: [{ id: 'b', name: 'Board', kind: 'board', group: 'folder' }],
        actions: [{ id: 'c', name: 'Changelog', kind: 'insert' }],
      }),
    ).toEqual([
      { section: 'links', names: ['DB-\\d+'] },
      { section: 'companions', names: ['specs', 'reports'] },
      { section: 'views', names: ['Board'] },
      { section: 'actions', names: ['Changelog'] },
    ]);
    expect(summarize({})).toEqual([]);
  });

  it('parses the draft and round-trips formatting', () => {
    const c = { v: 1 as const, links: [], properties: [], templates: [], views: [], actions: [] };
    expect(parseDraft(formatConfig(c))).toEqual({ config: c });
    expect(parseDraft('[]')).toEqual({ error: 'notObject' });
    expect('error' in parseDraft('{')).toBe(true);
  });

  it('finds the neighbouring group and formats cells', () => {
    const data = { groups: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] } as unknown as VaultViewData;
    expect(neighbor(data, 'b', -1)).toBe('a');
    expect(neighbor(data, 'c', 1)).toBeNull();
    expect(neighbor(data, 'x', 1)).toBeNull();
    expect(cellText(['a', 'b'])).toBe('a, b');
    expect(cellText(undefined)).toBe('');
  });
});

describe('table / list view on the grid', () => {
  const card = (title: string, prio?: string): VaultCard => ({
    path: `/v/${title}.md`,
    rel: `${title}.md`,
    title,
    props: prio ? { prio } : {},
    mtime: 0,
  });
  const data = {
    view: { id: 't', name: 'T', kind: 'table', group: 'folder', columns: ['prio'] },
    groups: [
      { key: 'a', cards: [card('b', '10'), card('a'), card('c', '2')] },
      { key: 'empty', cards: [] },
    ],
    properties: [],
  } as unknown as VaultViewData;
  const cellOf = (c: VaultCard, k: string) => (k === TITLE ? c.title : cellText(c.props[k]));
  const titles = (s: Parameters<typeof gridItems>[2]) =>
    gridItems(data, cellOf, s).map((i) => (i.kind === 'group' ? `#${i.key}:${i.count}` : i.card.title));

  it('lists non-empty groups with their cards, in order or sorted (numbers numerically, empty last)', () => {
    expect(titles(null)).toEqual(['#a:3', 'b', 'a', 'c']);
    expect(titles({ key: 'prio', dir: 1 })).toEqual(['#a:3', 'c', 'b', 'a']);
    expect(titles({ key: 'prio', dir: -1 })).toEqual(['#a:3', 'b', 'c', 'a']);
    expect(titles({ key: TITLE, dir: 1 })).toEqual(['#a:3', 'a', 'b', 'c']);
  });

  it('cycles a header through ascending, descending, unsorted', () => {
    expect(nextSort(null, 'k')).toEqual({ key: 'k', dir: 1 });
    expect(nextSort({ key: 'k', dir: 1 }, 'k')).toEqual({ key: 'k', dir: -1 });
    expect(nextSort({ key: 'k', dir: -1 }, 'k')).toBeNull();
    expect(nextSort({ key: 'k', dir: -1 }, 'j')).toEqual({ key: 'j', dir: 1 });
  });
});

describe('frontmatterKeys', () => {
  it('reads top-level keys only, from a closed block at the top', () => {
    expect([
      ...frontmatterKeys('---\r\nstatus: draft\r\ntags:\r\n  - a\r\n"due date": x\r\n---\r\nbody: no'),
    ]).toEqual(['status', 'tags', 'due date']);
    expect(frontmatterKeys('\uFEFF---\nk: 1\n...\n').has('k')).toBe(true);
    expect(frontmatterKeys('---\nk: 1\n').size).toBe(0);
    expect(frontmatterKeys('text\n---\nk: 1\n---').size).toBe(0);
  });
});
