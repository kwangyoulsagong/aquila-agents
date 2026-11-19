// Fuzzy matching for the command palette: the query's characters must appear in order (case-insensitive).
// Matches at word starts and runs of consecutive characters score higher; gaps cost a little.

export interface FuzzyMatch {
  score: number;
  /** Indices in `text` of the matched characters (for highlighting). */
  indices: number[];
}

const MATCH = 1;
const START_BONUS = 10; // first character of the text
const WORD_BONUS = 8; // after a separator, or a camelCase hump
const RUN_BONUS = 6; // follows the previous match directly
const GAP_PENALTY = 1; // per skipped character between matches (capped)
const MAX_GAP_PENALTY = 5;
const LEAD_PENALTY = 0.1; // per character before the first match: earlier is better

const SEPARATORS = new Set([' ', '-', '_', '.', '/', '\\', ':', '·', '(', '[']);

function boundaryBonus(text: string, i: number): number {
  if (i === 0) return START_BONUS;
  const prev = text[i - 1];
  if (SEPARATORS.has(prev)) return WORD_BONUS;
  const c = text[i];
  if (c !== c.toLowerCase() && prev === prev.toLowerCase() && prev !== prev.toUpperCase()) return WORD_BONUS;
  return 0;
}

/**
 * Best match of `query` in `text`, or null if the characters don't all appear in order.
 * Whitespace in the query is ignored. An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const m = q.length;
  const n = t.length;
  if (m > n) return null;

  // best[i][j]: best score with q[i] matched at t[j]; from[i][j]: where q[i-1] was matched.
  const best: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < m; i++) {
    best.push(new Array<number>(n).fill(-Infinity));
    from.push(new Array<number>(n).fill(-1));
    for (let j = i; j < n; j++) {
      if (t[j] !== q[i]) continue;
      const own = MATCH + boundaryBonus(text, j);
      if (i === 0) {
        best[i][j] = own - j * LEAD_PENALTY;
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        const prev = best[i - 1][k];
        if (prev === -Infinity) continue;
        const gap = j - k - 1;
        const link = gap === 0 ? RUN_BONUS : -Math.min(gap * GAP_PENALTY, MAX_GAP_PENALTY);
        const score = prev + own + link;
        if (score > best[i][j]) {
          best[i][j] = score;
          from[i][j] = k;
        }
      }
    }
  }

  let end = -1;
  for (let j = m - 1; j < n; j++) if (best[m - 1][j] > (end < 0 ? -Infinity : best[m - 1][end])) end = j;
  if (end < 0 || best[m - 1][end] === -Infinity) return null;

  const indices: number[] = [];
  for (let i = m - 1, j = end; i >= 0; j = from[i][j], i--) indices.unshift(j);
  return { score: best[m - 1][end], indices };
}

export interface Ranked<T> {
  item: T;
  /** Matched indices in the item's label (empty when it matched on `detail` only). */
  indices: number[];
  score: number;
}

/** A match on the detail text (path, group, project name) counts, but less than one on the label. */
const DETAIL_PENALTY = 8;

/**
 * Items that match `query` on their label (or, weaker, their detail), best first; ties keep input order.
 * An empty query returns every item in input order.
 */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  label: (item: T) => string,
  detail?: (item: T) => string,
): Ranked<T>[] {
  const out: (Ranked<T> & { order: number })[] = [];
  items.forEach((item, order) => {
    const onLabel = fuzzyMatch(query, label(item));
    if (onLabel) {
      out.push({ item, indices: onLabel.indices, score: onLabel.score, order });
      return;
    }
    const d = detail?.(item);
    const onDetail = d ? fuzzyMatch(query, d) : null;
    if (onDetail) out.push({ item, indices: [], score: onDetail.score - DETAIL_PENALTY, order });
  });
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out.map(({ item, indices, score }) => ({ item, indices, score }));
}
