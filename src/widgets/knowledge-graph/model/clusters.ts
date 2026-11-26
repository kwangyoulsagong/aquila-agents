import type { GraphView } from './view';

// Groups of densely linked nodes for the Map's "colour by group" (T72): Louvain modularity optimisation (Blondel et
// al. 2008) — move each node to the neighbouring group that raises modularity most, merge groups into nodes,
// repeat. Visits nodes in a fixed (id) order and breaks ties towards the lower group, so the same graph always gives
// the same groups. ~2,000 nodes take a few ms.

/** Passes over all nodes per level before giving up on more moves. */
const MAX_PASSES = 12;
const MAX_LEVELS = 8;

/** Community index per node (indices into `n`), from weighted undirected edges. */
export function louvain(n: number, edges: readonly (readonly [number, number, number])[]): Int32Array {
  // Level graph: adjacency with weights (multi-edges summed), self-loop weight separately.
  let size = n;
  let adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  let self = new Float64Array(n);
  for (const [a, b, w] of edges) {
    if (a === b) self[a]! += w;
    else {
      adj[a]!.set(b, (adj[a]!.get(b) ?? 0) + w);
      adj[b]!.set(a, (adj[b]!.get(a) ?? 0) + w);
    }
  }
  // Original node → its node at the current level.
  const top = new Int32Array(n).map((_, i) => i);

  for (let level = 0; level < MAX_LEVELS; level++) {
    const k = new Float64Array(size);
    let m2 = 0;
    for (let i = 0; i < size; i++) {
      let d = 2 * self[i]!;
      for (const w of adj[i]!.values()) d += w;
      k[i] = d;
      m2 += d;
    }
    if (m2 === 0) break;
    const comm = new Int32Array(size).map((_, i) => i);
    const tot = Float64Array.from(k);
    let moved = false;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let any = false;
      for (let i = 0; i < size; i++) {
        const ci = comm[i]!;
        const toComm = new Map<number, number>();
        for (const [j, w] of adj[i]!) toComm.set(comm[j]!, (toComm.get(comm[j]!) ?? 0) + w);
        tot[ci]! -= k[i]!;
        let best = ci;
        let bestGain = (toComm.get(ci) ?? 0) - (tot[ci]! * k[i]!) / m2;
        for (const [c, w] of toComm) {
          const gain = w - (tot[c]! * k[i]!) / m2;
          if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && c < best)) {
            best = c;
            bestGain = gain;
          }
        }
        tot[best]! += k[i]!;
        if (best !== ci) {
          comm[i] = best;
          any = true;
          moved = true;
        }
      }
      if (!any) break;
    }
    if (!moved) break;
    // Renumber, then fold each group into one node.
    const renum = new Map<number, number>();
    for (let i = 0; i < size; i++) if (!renum.has(comm[i]!)) renum.set(comm[i]!, renum.size);
    const next = renum.size;
    const nAdj: Map<number, number>[] = Array.from({ length: next }, () => new Map());
    const nSelf = new Float64Array(next);
    for (let i = 0; i < size; i++) {
      const ci = renum.get(comm[i]!)!;
      nSelf[ci]! += self[i]!;
      for (const [j, w] of adj[i]!) {
        const cj = renum.get(comm[j]!)!;
        // Each undirected edge is seen from both ends: halve internal ones into the self-loop.
        if (ci === cj) nSelf[ci]! += w / 2;
        else nAdj[ci]!.set(cj, (nAdj[ci]!.get(cj) ?? 0) + w);
      }
    }
    for (let o = 0; o < n; o++) top[o] = renum.get(comm[top[o]!]!)!;
    if (next === size) break;
    size = next;
    adj = nAdj;
    self = nSelf;
  }
  return top;
}

/** Below this, a linked group isn't worth a bubble: its notes join "the rest". */
export const TOPIC_MIN = 3;
/** Groups made at most (the Map shows 12 bubbles a level; one is the rest). */
const TOPIC_MAX = 11;
/** Words shorter than this, numbers, dates and IDs don't name a group. */
const WORD_MIN = 2;
const SPLIT = /[\s\-_·—–:;,.()[\]{}<>/\\`'"@#|!?*=+~&%$^]+/u;
const NOISE = /^(\d+|v\d+|[a-z]{1,3}\d+|\d{4}|\d{2})$/i;

/** Words of a title, lowercased, noise dropped (numbers, short IDs like f012 / v2, one-letter words). */
export function titleWords(label: string): string[] {
  return [
    ...new Set(
      label
        .toLowerCase()
        .split(SPLIT)
        .filter((w) => w.length >= WORD_MIN && !NOISE.test(w)),
    ),
  ];
}

export interface Topic {
  /** Stable for the same members: `topic:<words, sorted>`; `topic:~` for the rest. */
  key: string;
  /** The words that name it (none for the rest). */
  words: string[];
  ids: string[];
}

/**
 * A big set of nodes with no folders left to split by (T75), split by what works in any repo: how they link
 * (Louvain over the links among them) and what their titles say — each group is named by the two words its titles
 * use far more than the rest do (tf × idf), not after one note. Notes that link to too little form "the rest".
 * Null when that gives fewer than two named groups (then the dots are shown).
 */
export function topicGroups(view: GraphView, members: readonly string[]): Topic[] | null {
  const inSet = new Set(members);
  // Links out of the set count too: notes that point at the same outside note (two checklists of one spec) belong
  // together even when they never link to each other. The outside notes help group, they aren't listed.
  const near = new Set(inSet);
  for (const e of view.edges) {
    if (inSet.has(e.source)) near.add(e.target);
    if (inSet.has(e.target)) near.add(e.source);
  }
  const ids = [...near].sort();
  const idx = new Map(ids.map((id, i) => [id, i]));
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const edges: [number, number, number][] = [];
  for (const e of view.edges) {
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) edges.push([a, b, Math.max(0.1, e.strength)]);
  }
  const comm = edges.length ? louvain(ids.length, edges) : null;
  const groups = new Map<number, string[]>();
  const sorted = [...members].sort();
  sorted.forEach((id, i) => {
    // No links at all: a community of its own (it lands in the rest).
    const c = comm ? comm[idx.get(id)!]! : -1 - i;
    const g = groups.get(c);
    if (g) g.push(id);
    else groups.set(c, [id]);
  });
  // Document frequency of each title word over the set.
  const words = new Map(sorted.map((id) => [id, titleWords(byId.get(id)?.label ?? '')]));
  const df = new Map<string, number>();
  for (const ws of words.values()) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const n = sorted.length;
  // A word in half the titles or more ("checklist" in a folder of checklists) says nothing about a group.
  const telling = (w: string) => df.get(w)! <= n / 2;
  /** The two words these titles use far more than the set does (tf × idf), in at least two of them. */
  const nameOf = (g: readonly string[]): string[] => {
    const tf = new Map<string, number>();
    for (const id of g) for (const w of words.get(id)!) tf.set(w, (tf.get(w) ?? 0) + 1);
    return [...tf]
      .filter(([w, c]) => c >= 2 && telling(w))
      .map(([w, c]) => [w, (c / g.length) * Math.log(n / df.get(w)!)] as const)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([w]) => w);
  };
  const named: Topic[] = [];
  const add = (words: string[], ids: readonly string[]) => {
    // Louvain cuts a long chain of one subject into pieces: pieces named the same are one group.
    const key = `topic:${[...words].sort().join('·')}`;
    const same = named.find((t) => t.key === key);
    if (same) same.ids.push(...ids);
    else named.push({ key, words, ids: [...ids] });
  };
  let rest: string[] = [];
  for (const g of groups.values()) {
    const top = g.length >= TOPIC_MIN ? nameOf(g) : [];
    if (top.length) add(top, g);
    else rest.push(...g);
  }
  // What links to nothing (or too little) still has a title: group it by the word most of its titles share,
  // while a word is shared by enough of them.
  for (;;) {
    const count = new Map<string, number>();
    for (const id of rest)
      for (const w of words.get(id)!) if (telling(w)) count.set(w, (count.get(w) ?? 0) + 1);
    const best = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best || best[1] < TOPIC_MIN || named.length >= TOPIC_MAX) break;
    const hit = rest.filter((id) => words.get(id)!.includes(best[0]));
    add([best[0]], hit);
    rest = rest.filter((id) => !hit.includes(id));
  }
  if (named.length < 2) return null;
  named.sort((a, b) => b.ids.length - a.ids.length || a.key.localeCompare(b.key));
  if (rest.length) named.push({ key: 'topic:~', words: [], ids: rest });
  return named;
}
