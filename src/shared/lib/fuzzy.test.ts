import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches characters in order, case-insensitively', () => {
    expect(fuzzyMatch('db', 'data-bahn')?.indices).toEqual([0, 5]);
    expect(fuzzyMatch('SALT', 'salt')?.indices).toEqual([0, 1, 2, 3]);
    expect(fuzzyMatch('tla', 'salt')).toBeNull();
    expect(fuzzyMatch('salty', 'salt')).toBeNull();
  });

  it('matches everything with an empty or blank query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch('  ', 'anything')).toEqual({ score: 0, indices: [] });
  });

  it('ignores spaces in the query', () => {
    expect(fuzzyMatch('open cl', 'Open Claude')).not.toBeNull();
  });

  it('prefers word starts over letters in the middle', () => {
    // "db" takes the "b" of "bahn", not the earlier mid-word "b" of "dabble".
    expect(fuzzyMatch('db', 'dabble-bahn')?.indices).toEqual([0, 7]);
    expect(fuzzyMatch('sb', 'sub-bar')?.indices).toEqual([0, 4]);
  });

  it('scores consecutive runs and word starts higher', () => {
    const run = fuzzyMatch('sal', 'salt')!.score;
    const spread = fuzzyMatch('sal', 'super-alpha-lime')!.score;
    const mid = fuzzyMatch('alt', 'basalt')!.score;
    expect(run).toBeGreaterThan(spread);
    expect(run).toBeGreaterThan(mid);
  });

  it('treats camelCase humps as word starts', () => {
    expect(fuzzyMatch('rp', 'roadToPro')?.indices).toEqual([0, 6]);
  });

  it('works with Korean text', () => {
    expect(fuzzyMatch('세닫', '세션 닫기')?.indices).toEqual([0, 3]);
  });
});

describe('fuzzyRank', () => {
  const items = [
    { label: 'Open Codex', detail: '' },
    { label: 'Open Claude', detail: '' },
    { label: 'SALT', detail: '~/Desktop/SALT · Personal' },
    { label: 'data-bahn', detail: '~/work/data-bahn · Work' },
  ];
  const rank = (q: string) =>
    fuzzyRank(
      items,
      q,
      (i) => i.label,
      (i) => i.detail,
    ).map((r) => r.item.label);

  it('keeps input order for an empty query', () => {
    expect(rank('')).toEqual(items.map((i) => i.label));
  });

  it('sorts best first and drops non-matches', () => {
    expect(rank('ocl')).toEqual(['Open Claude']);
    expect(rank('oc')[0]).toBe('Open Codex');
  });

  it('falls back to the detail text, ranked below label matches', () => {
    expect(rank('work')).toEqual(['data-bahn']);
    const r = fuzzyRank(
      items,
      'desk',
      (i) => i.label,
      (i) => i.detail,
    );
    expect(r[0].item.label).toBe('SALT');
    expect(r[0].indices).toEqual([]);
  });
});
