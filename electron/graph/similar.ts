// Knowledge graph (T68): local keyword similarity between notes, no AI. TF-IDF over the words of each note's body;
// a note's nearest neighbours become suggested edges. Incremental: only notes whose file changed are scored again
// (their old pairs are dropped first), so an edit costs one note's lookup, not the whole index. Runs in the worker.

export interface SimilarPair {
  a: string;
  b: string;
  /** Cosine similarity, 0–1. */
  score: number;
  /** The words they share that weigh most (≤3), for "why". */
  terms: string[];
}

export interface SimilarDoc {
  id: string;
  /** Changes when the file changes (mtime + size): a different signature = score again. */
  sig: string;
  /** Lowercased body text. */
  text: string;
}

/** Nearest neighbours kept per note, the lowest cosine that counts, and how many weighty words must be shared. */
const TOP_K = 3;
const MIN_SCORE = 0.2;
const MIN_SHARED = 2;
/**
 * Korean words that end like a verb or a clause ("이동됐다", "정리이며", "있어요"): they say what happened, not what
 * a note is about, so they don't name a group. Two-syllable endings only, so nouns like 회고 / 재고 stay.
 */
const PREDICATE =
  /(했다|됐다|된다|한다|있다|없다|이다|였다|았다|었다|겠다|니다|이며|하며|되며|이고|하고|되고|해요|어요|아요|에요|예요|는데|지만|어서|아서|해서|에서|으로|했음|됐음)$/u;
/** Body words sent with each note for naming groups (T75). */
const TERMS_PER_NOTE = 8;
/** Words a note is looked up by (its heaviest). */
const LOOKUP_TERMS = 24;
/** A word in more than this share of notes is too common to look up by. */
const MAX_DF_SHARE = 0.25;

const TOKEN = /[\p{L}\p{N}_]+/gu;
// eslint-disable-next-line no-control-regex -- the whole ASCII range on purpose
const ASCII = /^[\x00-\x7f]*$/;
const STOP = new Set(
  (
    'the and for are but not you all any can had her was one our out has have this that with from they will what ' +
    'when which their there been were into than then them these some more also just only very about after before ' +
    'over such each other would could should does did its it’s our your how who why where while being because ' +
    'here http https www com org html todo note notes see via per new use used using make made get got yes '
  )
    .trim()
    .split(/\s+/)
    .concat(
      '그리고 그래서 하지만 그런데 또는 및 등 이 그 저 것 수 때 좀 더 잘 안 못 왜 다 또 한 하는 했다 한다 있다 없다 있음 없음 했음 같은 위해 대한 통해 이번 다음 지금 오늘'.split(
        ' ',
      ),
    ),
);
/** Korean particles that attach to a word (longest first). */
const PARTICLES = [
  '에서는',
  '으로는',
  '에서',
  '으로',
  '에게',
  '까지',
  '부터',
  '처럼',
  '보다',
  '이랑',
  '하고',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '의',
  '에',
  '로',
  '와',
  '과',
  '도',
  '만',
];

/** The words of a text that carry meaning: counts per word. */
export function termCounts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.toLowerCase().matchAll(TOKEN)) {
    let t = m[0];
    if (/^[\d_]+$/.test(t)) continue;
    if (ASCII.test(t)) {
      if (t.length < 3) continue;
    } else {
      const p = PARTICLES.find((x) => t.length - x.length >= 2 && t.endsWith(x));
      if (p) t = t.slice(0, -p.length);
      if (t.length < 2) continue;
    }
    if (STOP.has(t)) continue;
    out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

interface Entry {
  sig: string;
  tf: Map<string, number>;
}

export class SimilarIndex {
  private docs = new Map<string, Entry>();
  private df = new Map<string, number>();
  /** term → notes that have it. */
  private postings = new Map<string, Set<string>>();
  private pairs = new Map<string, SimilarPair>();
  private byNote = new Map<string, Set<string>>();
  /** T76: `terms` per note (by its signature), and the note count they were weighed at. */
  private termsCache = new Map<string, { sig: string; terms: string[] }>();
  private termsAt = 0;

  /**
   * Brings the index in line with these notes: new / changed ones are scored again, gone ones dropped. Returns
   * whether any pair changed.
   */
  sync(docs: Iterable<SimilarDoc>): boolean {
    const seen = new Set<string>();
    const dirty: string[] = [];
    for (const d of docs) {
      seen.add(d.id);
      const prev = this.docs.get(d.id);
      if (prev?.sig === d.sig) continue;
      if (prev) this.unindex(d.id, prev);
      const entry = { sig: d.sig, tf: termCounts(d.text) };
      this.docs.set(d.id, entry);
      for (const t of entry.tf.keys()) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
        let set = this.postings.get(t);
        if (!set) this.postings.set(t, (set = new Set()));
        set.add(d.id);
      }
      dirty.push(d.id);
    }
    let changed = false;
    for (const [id, e] of [...this.docs])
      if (!seen.has(id)) {
        this.unindex(id, e);
        this.docs.delete(id);
        changed = this.dropPairs(id) || changed;
      }
    if (!dirty.length) return changed;
    for (const id of dirty) this.dropPairs(id);
    const weights = new Map<string, { w: Map<string, number>; norm: number }>();
    const vec = (id: string) => {
      let v = weights.get(id);
      if (!v) weights.set(id, (v = this.weigh(this.docs.get(id)!.tf)));
      return v;
    };
    const n = this.docs.size;
    const maxDf = Math.max(2, Math.floor(n * MAX_DF_SHARE));
    for (const id of dirty) {
      const me = vec(id);
      if (!me.norm) continue;
      const lookup = [...me.w.entries()]
        .filter(([t]) => (this.df.get(t) ?? 0) <= maxDf)
        .sort((x, y) => y[1] - x[1])
        .slice(0, LOOKUP_TERMS);
      const candidates = new Set<string>();
      for (const [t] of lookup)
        for (const other of this.postings.get(t) ?? []) if (other !== id) candidates.add(other);
      const scored: SimilarPair[] = [];
      for (const other of candidates) {
        const them = vec(other);
        if (!them.norm) continue;
        let dot = 0;
        const shared: [string, number][] = [];
        for (const [t, w] of me.w) {
          const x = them.w.get(t);
          if (x === undefined) continue;
          dot += w * x;
          shared.push([t, w * x]);
        }
        const score = dot / (me.norm * them.norm);
        if (score < MIN_SCORE || shared.length < MIN_SHARED) continue;
        shared.sort((x, y) => y[1] - x[1]);
        scored.push({
          a: id,
          b: other,
          score: Math.min(1, score),
          terms: shared.slice(0, 3).map(([t]) => t),
        });
      }
      scored.sort((x, y) => y.score - x.score);
      for (const p of scored.slice(0, TOP_K)) {
        const key = pairKey(p.a, p.b);
        const prev = this.pairs.get(key);
        if (prev && prev.score >= p.score) continue;
        this.pairs.set(key, p);
        for (const x of [p.a, p.b]) {
          let set = this.byNote.get(x);
          if (!set) this.byNote.set(x, (set = new Set()));
          set.add(key);
        }
      }
    }
    return true;
  }

  all(): SimilarPair[] {
    return [...this.pairs.values()];
  }

  // ---- internals ----

  /** TF-IDF weights (log-scaled term frequency) and the vector's length. */
  /**
   * T75: a note's most telling body words — its heaviest by the same weights, words in too many notes left out —
   * so a group of notes can be named by what they say even when their titles are only IDs.
   */
  terms(id: string, k = TERMS_PER_NOTE): string[] {
    const doc = this.docs.get(id);
    if (!doc) return [];
    // Kept while the note is unchanged (T76): the weights drift a little as other notes come and go, not enough to
    // be worth weighing 1,500 notes again on every save; a big change in the note count starts over.
    if (Math.abs(this.docs.size - this.termsAt) > this.termsAt * 0.1) {
      this.termsCache.clear();
      this.termsAt = this.docs.size;
    }
    const kept = this.termsCache.get(id);
    if (kept && kept.sig === doc.sig) return kept.terms;
    const maxDf = Math.max(2, Math.floor(this.docs.size * MAX_DF_SHARE));
    const out = [...this.weigh(doc.tf).w]
      .filter(([t]) => (this.df.get(t) ?? 0) <= maxDf && !PREDICATE.test(t))
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, k)
      .map(([t]) => t);
    this.termsCache.set(id, { sig: doc.sig, terms: out });
    return out;
  }

  private weigh(tf: Map<string, number>): { w: Map<string, number>; norm: number } {
    const n = this.docs.size;
    const w = new Map<string, number>();
    let sum = 0;
    for (const [t, c] of tf) {
      const df = this.df.get(t) ?? 1;
      // A word only this note has can't connect it to anything; skip it so it doesn't dilute the score.
      if (df < 2) continue;
      const x = (1 + Math.log(c)) * Math.log(1 + n / df);
      w.set(t, x);
      sum += x * x;
    }
    return { w, norm: Math.sqrt(sum) };
  }

  private unindex(id: string, e: Entry): void {
    for (const t of e.tf.keys()) {
      const d = (this.df.get(t) ?? 1) - 1;
      if (d > 0) this.df.set(t, d);
      else this.df.delete(t);
      const set = this.postings.get(t);
      set?.delete(id);
      if (set && !set.size) this.postings.delete(t);
    }
  }

  private dropPairs(id: string): boolean {
    const keys = this.byNote.get(id);
    if (!keys?.size) return false;
    for (const key of keys) {
      const p = this.pairs.get(key);
      this.pairs.delete(key);
      if (p) this.byNote.get(p.a === id ? p.b : p.a)?.delete(key);
    }
    this.byNote.delete(id);
    return true;
  }
}
