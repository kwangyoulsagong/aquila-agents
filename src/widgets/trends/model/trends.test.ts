import { describe, expect, it } from 'vitest';
import type { CliNews, NewsItem } from '@/shared/api';
import { translator } from '@/shared/i18n';
import {
  bucketIndustry,
  filterCli,
  hasCliUpdate,
  relativeTime,
  rowIds,
  SUMMARY_ID,
  summaryLines,
} from './trends';

const item = (id: string, over: Partial<NewsItem> = {}): NewsItem => ({
  id,
  source: 'openai',
  title: id,
  url: `https://x/${id}`,
  excerpt: '',
  publishedAt: 0,
  groups: [],
  ...over,
});

const cli: CliNews[] = [
  {
    tool: 'claude',
    installed: '2.1.1',
    upToDate: false,
    releases: [{ version: '2.1.2', url: 'u', publishedAt: 1, added: ['Added hooks view'] }],
  },
  {
    tool: 'codex',
    installed: null,
    upToDate: false,
    releases: [{ version: '0.1.0', url: 'u', publishedAt: 1, added: [] }],
  },
];

describe('trends model', () => {
  it('buckets by first keyword group, the rest under latest, in group order', () => {
    const b = bucketIndustry(
      [item('a', { groups: ['hook', 'subagent'] }), item('b'), item('c', { groups: ['subagent'] })],
      '',
    );
    expect(b.map((x) => [x.key, x.items.map((i) => i.id)])).toEqual([
      ['subagent', ['c']],
      ['hook', ['a']],
      ['latest', ['b']],
    ]);
  });

  it('filters by title, excerpt or source name', () => {
    const items = [item('Claude news'), item('x', { excerpt: 'about Codex' }), item('y', { source: 'hn' })];
    expect(bucketIndustry(items, 'codex')[0].items.map((i) => i.id)).toEqual(['x']);
    expect(bucketIndustry(items, 'hacker')[0].items.map((i) => i.id)).toEqual(['y']);
  });

  it('filters CLI releases and lists row ids in order', () => {
    expect(filterCli(cli, 'hooks')[0].releases).toHaveLength(1);
    expect(filterCli(cli, 'hooks')[1].releases).toHaveLength(0);
    expect(rowIds('cli', cli, [])).toEqual(['claude@2.1.2', 'codex@0.1.0']);
    expect(rowIds('industry', cli, bucketIndustry([item('a')], ''))).toEqual([SUMMARY_ID, 'a']);
  });

  it('formats ages and summary bullets', () => {
    const t = translator('en');
    expect(relativeTime(0, 3 * 3_600_000, t, 'en-US')).toBe(t('history.ago.hour', { n: '3' }));
    expect(summaryLines('- one\n\n* two\nthree')).toEqual(['one', 'two', 'three']);
  });
});

describe('hasCliUpdate', () => {
  const rel = { version: '2.2.0', publishedAt: 0, url: 'https://x', added: [] };
  const news = (over: Partial<CliNews>): CliNews => ({
    tool: 'claude',
    installed: '2.1.0',
    upToDate: false,
    releases: [rel],
    ...over,
  });

  it('is on only for a known installed version with a newer release', () => {
    expect(hasCliUpdate(null)).toBe(false);
    expect(hasCliUpdate({ cli: [] })).toBe(false);
    expect(hasCliUpdate({ cli: [news({})] })).toBe(true);
    expect(hasCliUpdate({ cli: [news({ upToDate: true })] })).toBe(false);
    // Not installed: the latest release is shown, but it isn't an update.
    expect(hasCliUpdate({ cli: [news({ installed: null })] })).toBe(false);
    expect(hasCliUpdate({ cli: [news({ releases: [] })] })).toBe(false);
  });
});
