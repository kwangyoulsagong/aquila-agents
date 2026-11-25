import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeKind } from '@/shared/api';
import { hash01 } from './layout';
import { orderTwoLayers, placeColumn, type LayerEdge } from './ordering';
import type { GraphView } from './view';

// The focus view ("around this note"): one node in the middle, what it links to in columns either side. Position
// says what a thing is — knowledge (notes, tags, people, decisions) on the left, work (sessions, to-dos, changed
// files, code, trends) on the right — the way TheBrain / ExcaliBrain put each relation in its own place. The inner
// column is one link away, the outer one two. Each column shows its most interesting items first and the rest
// behind "+N more" (van Ham & Perer 2009, "show context, expand on demand"), so the picture stays well under the
// ~50 nodes where people stop reading node-link drawings correctly (Yoghourdjian et al. 2020).

export type FocusSide = 'left' | 'right';
export type FocusColumnKey = 'l2' | 'l1' | 'r1' | 'r2';

const WORK_KINDS = new Set<GraphNodeKind>(['session', 'file', 'code', 'todo', 'trend', 'apply']);
export const sideOfKind = (kind: GraphNodeKind): FocusSide => (WORK_KINDS.has(kind) ? 'right' : 'left');

/** Items a column shows before "+N more"; each "+N more" adds this many again. */
export const COLUMN_STEP = { 1: 7, 2: 5 } as const;

export interface FocusItem {
  node: GraphNode;
  /** Rows from the centre (0 = level with it); fractional when placed next to a neighbour. */
  row: number;
  /** Inner-column items it hangs on (outer columns only). */
  parents: string[];
}

export interface FocusColumn {
  key: FocusColumnKey;
  side: FocusSide;
  depth: 1 | 2;
  items: FocusItem[];
  /** Not shown yet ("+N more"). */
  hidden: number;
}

export interface FocusEdge {
  id: string;
  /** Inner end (the centre, or an inner-column item). */
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface FocusLayout {
  center: GraphNode;
  /** Always four, outer-left → outer-right (`l2`, `l1`, `r1`, `r2`). */
  columns: FocusColumn[];
  edges: FocusEdge[];
  /** Links of the centre in the whole (filtered) view. */
  degree: number;
}

const DAY = 86_400_000;

/**
 * Degree of interest of one candidate (Furnas 1986 / van Ham & Perer 2009, a-priori interest minus distance — the
 * distance is the column): how strong and how many its links to the inner column are, how recent it is, a little
 * for how connected it is overall. A missing note and a mere suggestion rank lower.
 */
function interest(node: GraphNode, links: readonly GraphEdge[], degree: number, now: number): number {
  let strength = 0;
  for (const e of links)
    strength = Math.max(strength, e.kind === 'suggested' ? e.strength * 0.5 : e.strength);
  const recency = node.mtime ? Math.exp(-Math.max(0, now - node.mtime) / (30 * DAY)) : 0;
  return (
    strength * 2 +
    Math.log2(1 + links.length) * 0.75 +
    recency +
    Math.log2(1 + degree) * 0.25 -
    (node.kind === 'missing' ? 0.5 : 0)
  );
}

const byInterest = (a: { score: number; node: GraphNode }, b: { score: number; node: GraphNode }) =>
  b.score - a.score || a.node.label.localeCompare(b.node.label) || a.node.id.localeCompare(b.node.id);

export interface FocusOptions {
  /** Items shown per column (default `COLUMN_STEP`); "+N more" raises it. */
  shown?: Partial<Record<FocusColumnKey, number>>;
  now?: number;
}

/** The focus layout around `centerId`, or null when the (filtered) view doesn't have it. */
export function focusLayout(view: GraphView, centerId: string, opts: FocusOptions = {}): FocusLayout | null {
  const now = opts.now ?? Date.now();
  const nodes = new Map(view.nodes.map((n) => [n.id, n]));
  const center = nodes.get(centerId);
  if (!center) return null;
  const adj = new Map<string, Map<string, GraphEdge>>();
  const link = (a: string, b: string, e: GraphEdge) => {
    let m = adj.get(a);
    if (!m) adj.set(a, (m = new Map()));
    const had = m.get(b);
    if (!had || e.strength > had.strength) m.set(b, e);
  };
  for (const e of view.edges) {
    if (e.source === e.target || !nodes.has(e.source) || !nodes.has(e.target)) continue;
    link(e.source, e.target, e);
    link(e.target, e.source, e);
  }
  const degree = (id: string) => adj.get(id)?.size ?? 0;
  const limit = (key: FocusColumnKey, depth: 1 | 2) => Math.max(0, opts.shown?.[key] ?? COLUMN_STEP[depth]);

  // Depth 1, split by kind and ranked.
  const ring1 = [...(adj.get(centerId)?.entries() ?? [])].map(([id, e]) => ({
    node: nodes.get(id)!,
    score: interest(nodes.get(id)!, [e], degree(id), now),
  }));
  const inner: Record<FocusSide, typeof ring1> = { left: [], right: [] };
  for (const c of ring1) inner[sideOfKind(c.node.kind)].push(c);
  const shown1: Record<FocusSide, GraphNode[]> = { left: [], right: [] };
  const hidden1: Record<FocusSide, number> = { left: 0, right: 0 };
  for (const side of ['left', 'right'] as const) {
    const key = side === 'left' ? 'l1' : 'r1';
    const ranked = inner[side].sort(byInterest);
    shown1[side] = ranked.slice(0, limit(key, 1)).map((c) => c.node);
    hidden1[side] = Math.max(0, ranked.length - shown1[side].length);
  }

  // Depth 2: neighbours of the *shown* inner items only (expand on demand), on the side most of their parents are.
  const ring1Ids = new Set([centerId, ...ring1.map((c) => c.node.id)]);
  const sideOf1 = new Map<string, FocusSide>();
  for (const side of ['left', 'right'] as const) for (const n of shown1[side]) sideOf1.set(n.id, side);
  const outer = new Map<string, { parents: Map<FocusSide, string[]>; links: GraphEdge[] }>();
  for (const [pid, side] of sideOf1)
    for (const [id, e] of adj.get(pid) ?? []) {
      if (ring1Ids.has(id)) continue;
      let o = outer.get(id);
      if (!o) outer.set(id, (o = { parents: new Map(), links: [] }));
      o.parents.set(side, [...(o.parents.get(side) ?? []), pid]);
      o.links.push(e);
    }
  const ring2: Record<FocusSide, { node: GraphNode; score: number; parents: string[] }[]> = {
    left: [],
    right: [],
  };
  for (const [id, o] of outer) {
    const node = nodes.get(id)!;
    const l = o.parents.get('left')?.length ?? 0;
    const r = o.parents.get('right')?.length ?? 0;
    const side: FocusSide = l === r ? sideOfKind(node.kind) : l > r ? 'left' : 'right';
    const parents = o.parents.get(side) ?? [];
    if (!parents.length) continue;
    const links = o.links.filter((e) => parents.includes(e.source) || parents.includes(e.target));
    ring2[side].push({ node, parents, score: interest(node, links, degree(id), now) });
  }

  const columns: FocusColumn[] = [];
  const edges: FocusEdge[] = [];
  const cols: Partial<Record<FocusColumnKey, FocusColumn>> = {};
  for (const side of ['left', 'right'] as const) {
    const k1: FocusColumnKey = side === 'left' ? 'l1' : 'r1';
    const k2: FocusColumnKey = side === 'left' ? 'l2' : 'r2';
    const ranked2 = ring2[side].sort(byInterest);
    const shown2 = ranked2.slice(0, limit(k2, 2));
    const a = shown1[side];
    const ia = new Map(a.map((n, i) => [n.id, i]));
    const pairs: LayerEdge[] = [];
    shown2.forEach((c, j) => {
      for (const p of c.parents) {
        const i = ia.get(p);
        if (i !== undefined) pairs.push([i, j]);
      }
    });
    // Seeded by the centre: the same centre always gives the same picture.
    const order = orderTwoLayers(a.length, shown2.length, pairs, Math.floor(hash01(centerId) * 2 ** 31));
    const innerItems: FocusItem[] = order.a.map((i, pos) => ({
      node: a[i]!,
      row: pos - (a.length - 1) / 2,
      parents: [centerId],
    }));
    const rowOf = new Map(innerItems.map((it) => [it.node.id, it.row]));
    const outerOrdered = order.b.map((j) => shown2[j]!);
    const targets = outerOrdered.map((c) => {
      const rs = c.parents
        .map((p) => rowOf.get(p))
        .filter((r): r is number => r !== undefined)
        .sort((x, y) => x - y);
      if (!rs.length) return Number.NaN;
      const m = rs.length >> 1;
      return rs.length % 2 ? rs[m]! : (rs[m - 1]! + rs[m]!) / 2;
    });
    const rows = placeColumn(targets);
    const outerItems: FocusItem[] = outerOrdered.map((c, i) => ({
      node: c.node,
      row: rows[i]!,
      parents: c.parents,
    }));
    cols[k1] = { key: k1, side, depth: 1, items: innerItems, hidden: hidden1[side] };
    cols[k2] = { key: k2, side, depth: 2, items: outerItems, hidden: ranked2.length - shown2.length };
    for (const it of innerItems) {
      const e = adj.get(centerId)!.get(it.node.id)!;
      edges.push({ id: `${centerId}|${it.node.id}`, from: centerId, to: it.node.id, kind: e.kind });
    }
    for (const it of outerItems)
      for (const p of it.parents) {
        const e = adj.get(p)?.get(it.node.id);
        if (e) edges.push({ id: `${p}|${it.node.id}`, from: p, to: it.node.id, kind: e.kind });
      }
  }
  for (const k of ['l2', 'l1', 'r1', 'r2'] as const) columns.push(cols[k]!);
  return { center, columns, edges, degree: degree(centerId) };
}

/** Where to start when the graph opens with nothing chosen: the most recently changed note, else any node. */
export function defaultCenter(view: GraphView): string | null {
  let best: GraphNode | null = null;
  for (const n of view.nodes)
    if (n.kind === 'note' && (!best || (n.mtime ?? 0) > (best.mtime ?? 0))) best = n;
  return best?.id ?? view.nodes[0]?.id ?? null;
}

/** Ids lit when `id` is hovered: it, the centre, and the inner items it hangs on. */
export function pathTo(layout: FocusLayout, id: string): Set<string> {
  const lit = new Set([layout.center.id, id]);
  for (const c of layout.columns)
    for (const it of c.items) if (it.node.id === id) for (const p of it.parents) lit.add(p);
  return lit;
}
