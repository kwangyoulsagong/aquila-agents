import type { GraphNode } from '@/shared/api';
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

export interface Cluster {
  /** 0 = the biggest. */
  index: number;
  /** Named after its most linked note (or node). */
  name: string;
  size: number;
}

export interface Clusters {
  /** Node id → cluster index (biggest first). */
  of: Map<string, number>;
  /** Biggest first. */
  list: Cluster[];
}

/** Groups of the (filtered) view, biggest first, each named after its best-connected note. */
export function clustersOf(view: GraphView): Clusters {
  const ids = [...view.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const idx = new Map(ids.map((n, i) => [n.id, i]));
  const degree = new Map<string, number>();
  const edges: [number, number, number][] = [];
  for (const e of view.edges) {
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    if (a === undefined || b === undefined) continue;
    edges.push([a, b, Math.max(0.1, e.strength)]);
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const raw = louvain(ids.length, edges);
  const members = new Map<number, GraphNode[]>();
  ids.forEach((n, i) => {
    const c = raw[i]!;
    const list = members.get(c);
    if (list) list.push(n);
    else members.set(c, [n]);
  });
  const rank = (n: GraphNode) => (degree.get(n.id) ?? 0) + (n.kind === 'note' ? 0.5 : 0);
  const groups = [...members.values()]
    .map((ns) => ({
      ns,
      head: [...ns].sort((a, b) => rank(b) - rank(a) || a.label.localeCompare(b.label))[0]!,
    }))
    .sort((a, b) => b.ns.length - a.ns.length || a.head.label.localeCompare(b.head.label));
  const of = new Map<string, number>();
  const list: Cluster[] = groups.map((g, index) => {
    for (const n of g.ns) of.set(n.id, index);
    return { index, name: g.head.label, size: g.ns.length };
  });
  return { of, list };
}
