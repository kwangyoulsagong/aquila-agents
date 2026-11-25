// Layered-drawing primitives for the focus view: crossing count, two-layer ordering, column placement.
// Pure and deterministic (same input → same picture), small enough to run on every recentre.
//
// - Crossings: Barth, Jünger, Mutzel (2004), "Simple and Efficient Bilayer Cross Counting", JGAA 8(2) — the
//   accumulator tree, O(E log V).
// - Ordering: barycenter sweeps (Jünger & Mutzel 1997: within 1–4 % of the optimum on one side, but stuck badly on
//   two free layers without restarts → seeded restarts), then adjacent swaps while they help (Gansner et al. 1993,
//   "transpose"). A small first layer is searched exhaustively instead.
// - Placement: each item as close as possible to the (weighted) median of its neighbours, in order, at least one row
//   apart — the |Δy| objective of Gansner et al. §4, solved per column as an L1 isotonic regression (pool adjacent
//   violators with block medians).

/** Edges between two layers as [index in layer A, index in layer B]. */
export type LayerEdge = readonly [number, number];

/** Number of crossings between layer A (in order) and layer B (`nb` positions) for edges given as positions. */
export function countCrossings(edges: readonly LayerEdge[], nb: number): number {
  if (edges.length < 2) return 0;
  const sorted = [...edges].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let first = 1;
  while (first < nb) first *= 2;
  const tree = new Int32Array(2 * first - 1);
  first -= 1;
  let cross = 0;
  for (const [, b] of sorted) {
    let i = b + first;
    tree[i]!++;
    while (i > 0) {
      // A left child (odd index) counts the earlier edges that ended further right: its right sibling.
      if (i % 2) cross += tree[i + 1]!;
      i = (i - 1) >> 1;
      tree[i]!++;
    }
  }
  return cross;
}

/** Seeded PRNG (mulberry32): restarts are random but repeatable. */
export function prng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TwoLayerOrder {
  /** Layer A as original indices, left → right (top → bottom). */
  a: number[];
  b: number[];
  crossings: number;
}

/** Restarts besides the given order (Jünger & Mutzel, Tables 5/7: a few random starts fix most of the damage). */
const RESTARTS = 15;
/** Sweeps per start; dot uses 24 and stops early when nothing improves. */
const MAX_SWEEPS = 24;
/** Layer A up to this size is searched exhaustively (7! = 5,040 orders). */
const EXHAUSTIVE = 7;

/**
 * Orders two layers to cross as little as possible. Index order is the preferred order (rank): among orders with the
 * same number of crossings the one closest to it wins, so with nothing to untangle the ranking stays as it was.
 */
export function orderTwoLayers(na: number, nb: number, edges: readonly LayerEdge[], seed = 1): TwoLayerOrder {
  const identity = (n: number) => Array.from({ length: n }, (_, i) => i);
  if (!edges.length || !na || !nb) return { a: identity(na), b: identity(nb), crossings: 0 };
  const nbrA: number[][] = Array.from({ length: na }, () => []);
  const nbrB: number[][] = Array.from({ length: nb }, () => []);
  for (const [x, y] of edges) {
    nbrA[x]!.push(y);
    nbrB[y]!.push(x);
  }

  const posOf = (order: readonly number[]) => {
    const pos = new Int32Array(order.length);
    order.forEach((v, i) => (pos[v] = i));
    return pos;
  };
  const cost = (a: readonly number[], b: readonly number[]): [number, number] => {
    const pa = posOf(a);
    const pb = posOf(b);
    const cross = countCrossings(
      edges.map(([x, y]) => [pa[x]!, pb[y]!] as const),
      nb,
    );
    let shift = 0;
    for (let i = 0; i < na; i++) shift += Math.abs(pa[i]! - i);
    for (let i = 0; i < nb; i++) shift += Math.abs(pb[i]! - i);
    return [cross, shift];
  };
  const better = (x: [number, number], y: [number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);

  /** One layer by the barycenter of its neighbours' positions; an item with none keeps its place. */
  const bary = (order: readonly number[], nbr: number[][], other: readonly number[]) => {
    const po = posOf(other);
    const cur = posOf(order);
    const key = order.map((v) => {
      const ns = nbr[v]!;
      if (!ns.length) return cur[v]!;
      let s = 0;
      for (const n of ns) s += po[n]!;
      return s / ns.length;
    });
    return order
      .map((v, i) => ({ v, k: key[i]!, i }))
      .sort((p, q) => p.k - q.k || p.v - q.v || p.i - q.i)
      .map((p) => p.v);
  };

  /** Swaps neighbours in one layer while that lowers the cost. */
  const transpose = (a: number[], b: number[]) => {
    let best = cost(a, b);
    for (let pass = 0; pass < 8; pass++) {
      let improved = false;
      for (const layer of [a, b]) {
        for (let i = 0; i + 1 < layer.length; i++) {
          [layer[i], layer[i + 1]] = [layer[i + 1]!, layer[i]!];
          const c = cost(a, b);
          if (better(c, best)) {
            best = c;
            improved = true;
          } else [layer[i], layer[i + 1]] = [layer[i + 1]!, layer[i]!];
        }
      }
      if (!improved) break;
    }
    return best;
  };

  let bestA = identity(na);
  let bestB = bary(identity(nb), nbrB, bestA);
  let best = cost(bestA, bestB);
  const consider = (a: number[], b: number[]) => {
    const c = cost(a, b);
    if (better(c, best)) {
      best = c;
      bestA = a;
      bestB = b;
    }
  };

  if (na <= EXHAUSTIVE) {
    // Every order of A, B by barycenter (exact enough for B: barycenter is within a few % on one free layer).
    const a = identity(na);
    const permute = (k: number) => {
      if (k === na) {
        consider([...a], bary(identity(nb), nbrB, a));
        return;
      }
      for (let i = k; i < na; i++) {
        [a[k], a[i]] = [a[i]!, a[k]!];
        permute(k + 1);
        [a[k], a[i]] = [a[i]!, a[k]!];
      }
    };
    permute(0);
  } else {
    const rand = prng(seed);
    for (let r = 0; r <= RESTARTS; r++) {
      let a = identity(na);
      if (r > 0)
        for (let i = na - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [a[i], a[j]] = [a[j]!, a[i]!];
        }
      let b = bary(identity(nb), nbrB, a);
      let stale = 0;
      let local = cost(a, b);
      consider(a, b);
      for (let s = 0; s < MAX_SWEEPS && stale < 2; s++) {
        a = bary(a, nbrA, b);
        b = bary(b, nbrB, a);
        const c = cost(a, b);
        consider(a, b);
        if (better(c, local)) {
          local = c;
          stale = 0;
        } else stale++;
      }
    }
  }
  const a = [...bestA];
  const b = [...bestB];
  const [crossings] = transpose(a, b);
  return { a, b, crossings };
}

/**
 * Positions for one column, in order, at least `gap` apart, each as close as possible (sum of |Δ|) to its target.
 * A NaN target (no neighbour placed) follows the item before it. L1 isotonic regression on `target − i·gap`.
 */
export function placeColumn(targets: readonly number[], gap = 1): number[] {
  const n = targets.length;
  if (!n) return [];
  const filled = [...targets];
  let last = filled.find((t) => !Number.isNaN(t)) ?? 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(filled[i]!)) filled[i] = last + (i ? gap : 0);
    last = filled[i]!;
  }
  const shifted = filled.map((t, i) => t - i * gap);
  const median = (vs: number[]) => {
    const s = [...vs].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const blocks: { values: number[]; value: number }[] = [];
  for (const v of shifted) {
    blocks.push({ values: [v], value: v });
    while (blocks.length > 1 && blocks[blocks.length - 2]!.value > blocks[blocks.length - 1]!.value) {
      const top = blocks.pop()!;
      const under = blocks[blocks.length - 1]!;
      under.values.push(...top.values);
      under.value = median(under.values);
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.values.length; k++) out.push(b.value + out.length * gap);
  return out;
}
