import { describe, expect, it } from 'vitest';
import { cleanIds, rankRelated, type RelatedCandidate } from './related';
import { SimilarIndex } from './similar';

const note = (id: string, title: string, rel: string, ids: string[] = []): RelatedCandidate => ({
  id,
  abs: `/notes/${rel}`,
  title,
  rel,
  sourceId: 's',
  ids,
});

describe('rankRelated', () => {
  const notes = [
    note('a', 'Login spec', 'specs/login.md', ['REQ-030']),
    note('b', 'REQ-030', 'specs/REQ-030.md', []),
    note('c', 'Billing', 'billing.md', ['PAY-1']),
    note('d', 'Archive search', 'archive.md'),
  ];

  it('a note named by the ID first, then one that mentions it, then shared words; each with why', () => {
    const out = rankRelated(['req-030'], [{ id: 'd', score: 0.4, terms: ['archive', 'search'] }], notes);
    expect(out.map((r) => r.title)).toEqual(['REQ-030', 'Login spec', 'Archive search']);
    expect(out[0].ids).toEqual(['REQ-030']);
    expect(out[2]).toMatchObject({ ids: [], words: ['archive', 'search'], path: '/notes/archive.md' });
  });

  it('merges both reasons into one entry and caps the list', () => {
    const out = rankRelated(['REQ-030'], [{ id: 'a', score: 0.5, terms: ['login'] }], notes, 1);
    expect(out).toHaveLength(1);
    expect(rankRelated(['REQ-030'], [{ id: 'a', score: 0.5, terms: ['login'] }], notes)[1]).toMatchObject({
      title: 'Login spec',
      ids: ['REQ-030'],
      words: ['login'],
    });
  });

  it('an ID is matched as a whole token (REQ-03 does not match REQ-030)', () => {
    expect(rankRelated(['REQ-03'], [], notes)).toEqual([]);
  });

  it('nothing in common → nothing', () => {
    expect(rankRelated([], [], notes)).toEqual([]);
  });
});

describe('cleanIds', () => {
  it('keeps ID-shaped strings, uppercased', () => {
    expect(cleanIds(['fe-req-030', 'remember me', 'DB-12', 3, 'X'])).toEqual(['FE-REQ-030', 'DB-12']);
    expect(cleanIds('nope')).toEqual([]);
  });
});

describe('SimilarIndex.query', () => {
  const doc = (id: string, text: string) => ({ id, sig: '1', text: text.toLowerCase() });
  const idx = new SimilarIndex();
  idx.sync([
    doc('spec', 'Pagination never splits a table row. Wide tables switch to landscape. Margins and footer.'),
    doc('memo', 'Search index per year would help the archive.'),
    doc('bug', 'Login loop after password reset; session cookie cleared twice.'),
    doc('other', 'Archive search takes seconds with many years.'),
    doc('misc', 'Weekly sync notes about hiring and the offsite.'),
  ]);

  it('finds the notes nearest to an outside text, with the shared words', () => {
    const out = idx.query('Guide: the archive search should be fast across years of records.');
    expect(out.map((r) => r.id)).toEqual(expect.arrayContaining(['other', 'memo']));
    expect(out[0].terms.length).toBeGreaterThanOrEqual(2);
    expect(out.find((r) => r.id === 'bug')).toBeUndefined();
  });

  it('nothing shared → nothing', () => {
    expect(idx.query('완전히 다른 내용입니다')).toEqual([]);
  });
});
