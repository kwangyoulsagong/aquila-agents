import { describe, expect, it } from 'vitest';
import { SimilarIndex, termCounts } from './similar';

const doc = (id: string, text: string, sig = '1') => ({ id, sig, text: text.toLowerCase() });

const NOTES = [
  doc(
    'meeting',
    'Pagination breaks tables. Margins too narrow, footer overlaps totals. Landscape for wide tables.',
  ),
  doc(
    'spec',
    'Pagination never splits a table row. Wide tables switch to landscape. Margins 18 mm, footer has numbers.',
  ),
  doc('memo', 'Search index per year would help the archive.'),
  doc('bug', 'Login loop after password reset; session cookie cleared twice.'),
  doc('other', 'Archive search takes seconds with many years.'),
];

const pairOf = (idx: SimilarIndex, a: string, b: string) =>
  idx.all().find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

describe('termCounts', () => {
  it('drops stop words, numbers and short ASCII words; strips Korean particles', () => {
    const t = termCounts('the DB is in 2026 회의에서 결정을 했다 결정 pagination');
    expect([...t.keys()]).toEqual(expect.arrayContaining(['회의', '결정', 'pagination']));
    expect(t.get('결정')).toBe(2);
    for (const gone of ['the', 'db', 'is', '2026', '했다']) expect(t.has(gone)).toBe(false);
  });
});

describe('SimilarIndex', () => {
  it('pairs notes that share weighty words, with the words as the reason', () => {
    const idx = new SimilarIndex();
    expect(idx.sync(NOTES)).toBe(true);
    const p = pairOf(idx, 'meeting', 'spec');
    expect(p).toBeDefined();
    expect(p!.score).toBeGreaterThan(0.2);
    expect(p!.terms.length).toBeGreaterThanOrEqual(2);
    expect(pairOf(idx, 'meeting', 'bug')).toBeUndefined();
  });

  it('scores only changed notes again, and forgets notes that are gone', () => {
    const idx = new SimilarIndex();
    idx.sync(NOTES);
    expect(idx.sync(NOTES)).toBe(false); // nothing changed
    const edited = NOTES.map((d) =>
      d.id === 'spec' ? doc('spec', 'Completely unrelated groceries list', '2') : d,
    );
    idx.sync(edited);
    expect(pairOf(idx, 'meeting', 'spec')).toBeUndefined();
    idx.sync(NOTES.map((d) => (d.id === 'spec' ? { ...d, sig: '3' } : d)));
    expect(pairOf(idx, 'meeting', 'spec')).toBeDefined();
    idx.sync(NOTES.filter((d) => d.id !== 'meeting'));
    expect(idx.all().some((p) => p.a === 'meeting' || p.b === 'meeting')).toBe(false);
  });
});
