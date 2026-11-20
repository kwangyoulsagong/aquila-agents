import { describe, expect, it } from 'vitest';
import type { Config, HistoryEntry } from '@/shared/api';
import { translator } from '@/shared/i18n';
import {
  daysLeft,
  filterHistory,
  groupHistory,
  parseRefKey,
  historyTitle,
  matchesListed,
  refKey,
  relativeTime,
} from './history';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const MIN = 60_000;
const DAY = 86_400_000;

const entry = (over: Partial<HistoryEntry> & Pick<HistoryEntry, 'id'>): HistoryEntry => ({
  agent: 'claude',
  cwd: '/work/app',
  firstMessage: 'first',
  startedAt: NOW - DAY,
  updatedAt: NOW - DAY,
  messages: 2,
  favorite: false,
  ...over,
});

const config: Config = {
  language: 'en',
  accounts: {},
  groups: [],
  projects: [{ id: 'app', name: 'App', group: 'work', account: 'shared', path: '~/work/app' }],
};

const a = entry({ id: 'a', title: 'auth bug', updatedAt: NOW - 5 * MIN, projectId: 'app', favorite: true });
const b = entry({
  id: 'b',
  agent: 'codex',
  cwd: '/work/api',
  firstMessage: 'Add rate limit',
  updatedAt: NOW - 2 * DAY,
});
const c = entry({
  id: 'c',
  cwd: '/work/app/web',
  projectId: 'app',
  autoTitle: 'Web build',
  updatedAt: NOW - MIN,
});
const all = [c, a, b];

describe('history panel model', () => {
  it('titles: our name, the CLI name, the auto title, the first message', () => {
    expect(historyTitle(a)).toBe('auth bug');
    expect(historyTitle({ ...a, name: 'mine' })).toBe('mine');
    expect(historyTitle(b)).toBe('Add rate limit');
    expect(historyTitle(c)).toBe('Web build');
  });

  it('filters by kind, favorites and the query, keeping order', () => {
    expect(filterHistory(all, '', 'all')).toEqual(all);
    expect(filterHistory(all, '', 'favorites')).toEqual([a]);
    expect(filterHistory(all, '', 'codex')).toEqual([b]);
    expect(filterHistory(all, 'RATE', 'all')).toEqual([b]);
    expect(filterHistory(all, 'api', 'all')).toEqual([b]); // folder
    expect(filterHistory(all, 'nothing here', 'all')).toEqual([]);
    // Full-text hits from main count too.
    expect(filterHistory(all, 'cookie', 'all', new Map([[refKey(a), '…cookie…']]))).toEqual([a]);
    expect(filterHistory(all, 'cookie', 'codex', new Map([[refKey(a), '…cookie…']]))).toEqual([]);
    expect(matchesListed(a, 'auth')).toBe(true);
    expect(matchesListed(a, 'cookie')).toBe(false);
  });

  it('groups by folder, most recent group first, labelled by project', () => {
    const groups = groupHistory(all, config);
    expect(groups.map((g) => [g.cwd, g.label, g.entries.map((e) => e.id)])).toEqual([
      ['/work/app/web', 'App · web', ['c']],
      ['/work/app', 'App', ['a']],
      ['/work/api', 'work/api', ['b']],
    ]);
  });

  it('says how long ago', () => {
    const t = translator('en');
    expect(relativeTime(NOW - 10_000, NOW, t, 'en-US')).toBe('just now');
    expect(relativeTime(NOW - 12 * MIN, NOW, t, 'en-US')).toBe('12 min ago');
    expect(relativeTime(NOW - 3 * 60 * MIN, NOW, t, 'en-US')).toBe('3 h ago');
    expect(relativeTime(NOW - 5 * DAY, NOW, t, 'en-US')).toBe('5 d ago');
    expect(relativeTime(NOW - 40 * DAY, NOW, t, 'en-US')).toMatch(/2026/);
  });

  it('warns a week before Claude deletes a transcript', () => {
    expect(daysLeft(a, NOW)).toBeNull();
    expect(daysLeft({ ...a, expiresAt: NOW + 20 * DAY }, NOW)).toBeNull();
    expect(daysLeft({ ...a, expiresAt: NOW + 3.5 * DAY }, NOW)).toBe(3);
    expect(daysLeft({ ...a, expiresAt: NOW - DAY }, NOW)).toBe(0);
  });
});

describe('remote sessions (T36)', () => {
  it('keys carry the host and parse back', () => {
    const r = { agent: 'claude' as const, id: 'abc', host: 'devbox' };
    expect(refKey(r)).toBe('claude:abc@devbox');
    expect(parseRefKey(refKey(r))).toEqual(r);
    expect(parseRefKey('codex:x-1')).toEqual({ agent: 'codex', id: 'x-1' });
  });

  it('the same folder on this Mac and on a host are two groups', () => {
    const groups = groupHistory(
      [entry({ id: 'a', cwd: '/work/zz' }), entry({ id: 'b', cwd: '/work/zz', host: 'devbox' })],
      config,
    );
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['/work/zz', 'work/zz'],
      ['devbox:/work/zz', 'devbox · zz'],
    ]);
  });
});
