import { describe, expect, it } from 'vitest';
import type { VaultViewData } from '@/shared/api';
import { cellText, formatConfig, neighbor, parseDraft, summarize } from './config';

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
