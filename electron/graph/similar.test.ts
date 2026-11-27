import { describe, expect, it } from 'vitest';
import { SimilarIndex, termCounts, topIndices } from './similar';

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

describe('terms (T75)', () => {
  it("a note's telling body words: its own subject first, words every note has left out", () => {
    const idx = new SimilarIndex();
    const docs = [
      { id: 'a', sig: '1', text: 'coupon discount coupon checkout total project' },
      { id: 'b', sig: '1', text: 'coupon discount refund project' },
      { id: 'c', sig: '1', text: 'login token refresh project' },
      { id: 'd', sig: '1', text: 'login token expiry project' },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `x${i}`,
        sig: '1',
        text: `project filler${i} other${i}`,
      })),
    ];
    idx.sync(docs);
    const a = idx.terms('a');
    expect(a.slice(0, 2)).toEqual(['coupon', 'discount']);
    expect(a).not.toContain('project');
    expect(idx.terms('c')).toEqual(expect.arrayContaining(['login', 'token']));
    expect(idx.terms('nope')).toEqual([]);
    // Korean predicates ("제거됐다", "정리이며") say what happened, not what it's about.
    const ko = new SimilarIndex();
    ko.sync([
      { id: 'k1', sig: '1', text: '회고 할인 제거됐다 정리이며' },
      { id: 'k2', sig: '1', text: '회고 할인 제거됐다 정리이며' },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `y${i}`, sig: '1', text: `기타${i} 다른${i}` })),
    ]);
    expect(ko.terms('k1').sort()).toEqual(['할인', '회고']);
  });
});

describe('topIndices', () => {
  it('the k best, best first, ties to the lower index — as a stable sort would', () => {
    const vals = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
    const sorted = vals
      .map((v, i) => [v, i] as const)
      .sort((x, y) => y[0] - x[0])
      .map(([, i]) => i);
    for (const k of [0, 1, 3, 5, 11, 20]) expect(topIndices(vals, k)).toEqual(sorted.slice(0, k));
  });
});

describe('SimilarIndex lengths kept between syncs', () => {
  it('after edits, removals and re-adds the kept lengths are the ones worked out fresh', () => {
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike'.split(' ');
    const text = (i: number, extra = '') =>
      `${words[i % 13]} ${words[(i * 3) % 13]} ${words[(i * 7) % 13]} ${words[(i + 5) % 13]} ${extra}`;
    let docs = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, sig: '1', text: text(i) }));
    const idx = new SimilarIndex();
    idx.sync(docs);
    const steps: ((d: typeof docs) => typeof docs)[] = [
      (d) => d.map((x, i) => (i === 3 ? { ...x, sig: '2', text: text(3, 'zulu yankee') } : x)),
      (d) => d.filter((x) => x.id !== 'n7'),
      (d) => [...d, { id: 'n7', sig: '3', text: text(7, 'zulu') }],
      (d) => d.map((x, i) => (i === 10 ? { ...x, sig: '4', text: 'alpha bravo' } : x)),
    ];
    // White-box: the private length cache against a fresh index's lengths for the same notes.
    type Inner = {
      norms: number[];
      docs: Map<string, { slot: number; tf: Map<string, number> }>;
      norm(tf: Map<string, number>): number;
    };
    let checked = 0;
    for (const step of steps) {
      docs = step(docs);
      idx.sync(docs);
      const fresh = new SimilarIndex();
      fresh.sync(docs);
      const inner = idx as unknown as Inner;
      const other = fresh as unknown as Inner;
      for (const [id, e] of inner.docs) {
        const kept = inner.norms[e.slot];
        if (kept === undefined || Number.isNaN(kept)) continue;
        expect(kept).toBe(other.norm(other.docs.get(id)!.tf));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
