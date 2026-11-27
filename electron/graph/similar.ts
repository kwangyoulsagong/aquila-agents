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
/** T81: a pasted text against a note — longer and of another kind, so a lower bar. */
const QUERY_MIN_SCORE = 0.08;
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
/**
 * Notes scored exactly per note: the best by the lookup words' share of the dot product. Scoring every note that
 * shares a word was O(n²) (4,000 notes: 45 s of a cold index); the exact cosine of the best few picks the same
 * neighbours.
 */
const CANDIDATES = 30;
/** More changed notes than this in one sync: every note's length is worked out again instead of tracked. */
const NORM_KEEP_MAX = 64;

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
  /** Its number in the index (postings and per-sync arrays are by number, not id). */
  slot: number;
}

/**
 * The `k` best of `vals` (by value, ties to the lower index), best first — what a stable sort by value would put
 * first, without sorting thousands of rough scores per note.
 */
export function topIndices(vals: ArrayLike<number>, k: number): number[] {
  const top: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]!;
    if (top.length === k && v <= vals[top[k - 1]!]!) continue;
    // Insert after every kept index with a value ≥ v (earlier indices win ties).
    let j = top.length;
    while (j > 0 && vals[top[j - 1]!]! < v) j--;
    top.splice(j, 0, i);
    if (top.length > k) top.pop();
  }
  return top;
}

/** A note's weights for scoring: in its own word order, and sorted by word number for merging two notes. */
interface Vec {
  terms: string[];
  weights: number[];
  norm: number;
  sorted: Int32Array;
  sortedW: Float64Array;
  /** Where each sorted word is in `terms`. */
  sortedAt: Int32Array;
}

export class SimilarIndex {
  private docs = new Map<string, Entry>();
  private df = new Map<string, number>();
  /** term → the notes that have it (slot → 1 + log of its count there). */
  private postings = new Map<string, Map<number, number>>();
  /** slot → note id; freed slots are reused. */
  private ids: string[] = [];
  private free: number[] = [];
  /** word → its number (only grows; numbers just need to be stable while the index lives). */
  private termIds = new Map<string, number>();
  private pairs = new Map<string, SimilarPair>();
  private byNote = new Map<string, Set<string>>();
  /** T76: `terms` per note (by its signature), and the note count they were weighed at. */
  private termsCache = new Map<string, { sig: string; terms: string[] }>();
  private termsAt = 0;
  /**
   * Each note's vector length by slot (NaN / missing = work it out), kept between syncs: an edit changes the
   * lengths of only the notes sharing a word whose note count changed, not of the thousands it is ranked against.
   * `normsAt` is the note count they hold for (every length changes with it).
   */
  private norms: number[] = [];
  private normsAt = -1;
  /** Words whose note count may change in this sync, with the count before (null: too many changes, start over). */
  private dfBefore: Map<string, number> | null = null;

  /**
   * Brings the index in line with these notes: new / changed ones are scored again, gone ones dropped. Returns
   * whether any pair changed.
   */
  sync(docs: Iterable<SimilarDoc>): boolean {
    const seen = new Set<string>();
    const dirty: string[] = [];
    this.dfBefore = new Map();
    for (const d of docs) {
      seen.add(d.id);
      const prev = this.docs.get(d.id);
      if (prev?.sig === d.sig) continue;
      if (dirty.length >= NORM_KEEP_MAX) this.dfBefore = null;
      if (prev) this.unindex(prev);
      const slot = prev ? prev.slot : (this.free.pop() ?? this.ids.length);
      this.ids[slot] = d.id;
      const entry: Entry = { sig: d.sig, tf: termCounts(d.text), slot };
      this.docs.set(d.id, entry);
      for (const [t, c] of entry.tf) {
        this.noteDf(t);
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
        let post = this.postings.get(t);
        if (!post) this.postings.set(t, (post = new Map()));
        post.set(slot, 1 + Math.log(c));
      }
      dirty.push(d.id);
    }
    let changed = false;
    for (const [id, e] of [...this.docs])
      if (!seen.has(id)) {
        this.unindex(e);
        this.docs.delete(id);
        this.free.push(e.slot);
        this.norms[e.slot] = NaN;
        changed = this.dropPairs(id) || changed;
      }
    this.staleNorms(dirty);
    if (!dirty.length) return changed;
    for (const id of dirty) this.dropPairs(id);
    const vecs: (Vec | undefined)[] = [];
    const norms = this.norms;
    const vec = (slot: number) => {
      let v = vecs[slot];
      if (!v) {
        vecs[slot] = v = this.vector(this.docs.get(this.ids[slot]!)!.tf);
        norms[slot] = v.norm;
      }
      return v;
    };
    // A note's length alone, for ranking the rough scores.
    const normOf = (slot: number) => {
      let v = norms[slot];
      if (v === undefined || Number.isNaN(v)) norms[slot] = v = this.norm(this.docs.get(this.ids[slot]!)!.tf);
      return v;
    };
    const n = this.docs.size;
    const maxDf = Math.max(2, Math.floor(n * MAX_DF_SHARE));
    // Rough scores by slot (0 = not touched), the slots in the order first touched.
    const rough = new Float64Array(this.ids.length);
    const touched: number[] = [];
    for (const id of dirty) {
      const mySlot = this.docs.get(id)!.slot;
      const me = vec(mySlot);
      if (!me.norm) continue;
      const lookup = me.terms
        .map((t, i) => [t, me.weights[i]!] as const)
        .filter(([t]) => (this.df.get(t) ?? 0) <= maxDf)
        .sort((x, y) => y[1] - x[1])
        .slice(0, LOOKUP_TERMS);
      // Rough score from the lookup words alone (their weight in the other note read straight from its counts),
      // then the exact cosine for the best few.
      touched.length = 0;
      for (const [t, w] of lookup) {
        const idf = this.idf(t);
        for (const [s, ltf] of this.postings.get(t) ?? []) {
          if (s === mySlot) continue;
          if (rough[s] === 0) touched.push(s);
          rough[s] += w * ltf * idf;
        }
      }
      // Divided by the other note's length, as the cosine is (a long note shares many words with everything).
      let candidates: number[];
      if (touched.length <= CANDIDATES) candidates = [...touched];
      else {
        const vals = touched.map((s) => rough[s]! / (normOf(s) || 1));
        candidates = topIndices(vals, CANDIDATES).map((i) => touched[i]!);
      }
      for (const s of touched) rough[s] = 0;
      const part = new Float64Array(me.terms.length);
      const scored: { other: string; score: number; at: Int32Array; parts: number[] }[] = [];
      for (const slot of candidates) {
        const them = vec(slot);
        if (!them.norm) continue;
        // Both word lists are sorted by word number: one merge, no lookups.
        const at: number[] = [];
        let sum = 0;
        const a = me.sorted;
        const b = them.sorted;
        for (let i = 0, j = 0; i < a.length && j < b.length;) {
          if (a[i]! < b[j]!) i++;
          else if (a[i]! > b[j]!) j++;
          else {
            const k = me.sortedAt[i]!;
            const x = me.sortedW[i]! * them.sortedW[j]!;
            part[k] = x;
            sum += x;
            at.push(k);
            i++;
            j++;
          }
        }
        // Clearly under the bar even with rounding: no need for the exact sum.
        if (at.length < MIN_SHARED || sum / (me.norm * them.norm) < MIN_SCORE * (1 - 1e-9)) continue;
        // Summed in the note's own word order, as a walk over its words would (the same score to the last bit).
        const order = Int32Array.from(at).sort();
        let dot = 0;
        const parts = Array.from(order, (k) => part[k]!);
        for (const x of parts) dot += x;
        const score = dot / (me.norm * them.norm);
        if (score < MIN_SCORE) continue;
        scored.push({ other: this.ids[slot]!, score: Math.min(1, score), at: order, parts });
      }
      scored.sort((x, y) => y.score - x.score);
      for (const s of scored.slice(0, TOP_K)) {
        const key = pairKey(id, s.other);
        const prev = this.pairs.get(key);
        if (prev && prev.score >= s.score) continue;
        // The three heaviest shared words, ties in the note's own word order.
        const top = topIndices(s.parts, 3).map((i) => me.terms[s.at[i]!]!);
        this.pairs.set(key, { a: id, b: s.other, score: s.score, terms: top });
        for (const x of [id, s.other]) {
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

  /**
   * T81: the notes nearest to a text that isn't in the index (a pasted guide or email), by the same TF-IDF —
   * looked up through the postings like `sync`, never a scan of every note. Words only one note has count here (a
   * rare word the text shares with exactly one note is a good reason).
   */
  query(text: string, k = 5): { id: string; score: number; terms: string[] }[] {
    const n = this.docs.size;
    if (!n) return [];
    const maxDf = Math.max(2, Math.floor(n * MAX_DF_SHARE));
    const q = new Map<string, number>();
    let sum = 0;
    for (const [t, c] of termCounts(text)) {
      const df = this.df.get(t);
      if (!df || df > maxDf || PREDICATE.test(t)) continue;
      const x = (1 + Math.log(c)) * this.idf(t);
      q.set(t, x);
      sum += x * x;
    }
    const norm = Math.sqrt(sum);
    if (!norm) return [];
    const lookup = [...q.entries()].sort((x, y) => y[1] - x[1]).slice(0, LOOKUP_TERMS * 2);
    const rough = new Map<string, number>();
    for (const [t, w] of lookup) {
      const idf = this.idf(t);
      for (const [s, ltf] of this.postings.get(t) ?? []) {
        const other = this.ids[s]!;
        rough.set(other, (rough.get(other) ?? 0) + w * ltf * idf);
      }
    }
    const docNorm = (tf: Map<string, number>) => {
      let s = 0;
      for (const [t, c] of tf) s += ((1 + Math.log(c)) * this.idf(t)) ** 2;
      return Math.sqrt(s);
    };
    const out: { id: string; score: number; terms: string[] }[] = [];
    const candidates = [...rough.entries()].sort((x, y) => y[1] - x[1]).slice(0, CANDIDATES * 2);
    for (const [id] of candidates) {
      const tf = this.docs.get(id)!.tf;
      const dn = docNorm(tf);
      if (!dn) continue;
      let dot = 0;
      const shared: [string, number][] = [];
      for (const [t, w] of q) {
        const c = tf.get(t);
        if (!c) continue;
        const x = w * (1 + Math.log(c)) * this.idf(t);
        dot += x;
        shared.push([t, x]);
      }
      const score = dot / (norm * dn);
      if (shared.length < MIN_SHARED || score < QUERY_MIN_SCORE) continue;
      shared.sort((x, y) => y[1] - x[1]);
      out.push({ id, score: Math.min(1, score), terms: shared.slice(0, 3).map(([t]) => t) });
    }
    return out.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id)).slice(0, k);
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

  /** How telling a word is (the IDF part of `weigh`). */
  private idf(t: string): number {
    return Math.log(1 + this.docs.size / (this.df.get(t) ?? 1));
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

  /** `weigh` as a `Vec`. */
  private vector(tf: Map<string, number>): Vec {
    const { w, norm } = this.weigh(tf);
    const terms = [...w.keys()];
    const weights = [...w.values()];
    const nums = terms.map((t) => {
      let k = this.termIds.get(t);
      if (k === undefined) this.termIds.set(t, (k = this.termIds.size));
      return k;
    });
    const sortedAt = Int32Array.from(terms.keys()).sort((x, y) => nums[x]! - nums[y]!);
    return {
      terms,
      weights,
      norm,
      sorted: Int32Array.from(sortedAt, (i) => nums[i]!),
      sortedW: Float64Array.from(sortedAt, (i) => weights[i]!),
      sortedAt,
    };
  }

  /** `weigh(tf).norm` without building the weights. */
  private norm(tf: Map<string, number>): number {
    const n = this.docs.size;
    let sum = 0;
    for (const [t, c] of tf) {
      const df = this.df.get(t) ?? 1;
      if (df < 2) continue;
      const x = (1 + Math.log(c)) * Math.log(1 + n / df);
      sum += x * x;
    }
    return Math.sqrt(sum);
  }

  /** Before `t`'s note count changes in a sync: remember what it was. */
  private noteDf(t: string): void {
    if (this.dfBefore && !this.dfBefore.has(t)) this.dfBefore.set(t, this.df.get(t) ?? 0);
  }

  /** After a sync's adds / removes: forget the lengths that changed (all of them when the note count did). */
  private staleNorms(dirty: readonly string[]): void {
    const before = this.dfBefore;
    this.dfBefore = null;
    if (!before || this.docs.size !== this.normsAt) {
      this.norms = [];
      this.normsAt = this.docs.size;
      return;
    }
    for (const [t, was] of before)
      if ((this.df.get(t) ?? 0) !== was)
        for (const s of this.postings.get(t)?.keys() ?? []) this.norms[s] = NaN;
    for (const id of dirty) this.norms[this.docs.get(id)!.slot] = NaN;
  }

  private unindex(e: Entry): void {
    for (const t of e.tf.keys()) {
      this.noteDf(t);
      const d = (this.df.get(t) ?? 1) - 1;
      if (d > 0) this.df.set(t, d);
      else this.df.delete(t);
      const post = this.postings.get(t);
      post?.delete(e.slot);
      if (post && !post.size) this.postings.delete(t);
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
