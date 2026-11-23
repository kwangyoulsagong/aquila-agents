import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeKind, GraphSnapshot } from '@/shared/api';

/** How far back the time filter reaches. Only notes have a time; other nodes stay while something links them. */
export type TimeWindow = 'any' | '7d' | '30d' | '365d';
export const TIME_WINDOWS: readonly TimeWindow[] = ['any', '7d', '30d', '365d'];
const DAY = 86_400_000;
const WINDOW_MS: Record<TimeWindow, number> = {
  any: Infinity,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  '365d': 365 * DAY,
};

export interface GraphFilter {
  /** Source ids to show; empty = all. */
  sources: string[];
  /** Node kinds to hide. */
  hiddenKinds: GraphNodeKind[];
  /** Only notes with this tag (and what they link to); empty = any. */
  tag: string;
  time: TimeWindow;
  /** Edges weaker than this are hidden (0–1). */
  minStrength: number;
}

export const DEFAULT_FILTER: GraphFilter = {
  sources: [],
  hiddenKinds: [],
  tag: '',
  time: 'any',
  minStrength: 0,
};

/** Line style by how sure a link is: written or caused by the app = solid, found in text = dashed, suggested = dotted. */
export type LineStyle = 'solid' | 'dashed' | 'dotted';
const LINE: Record<GraphEdgeKind, LineStyle> = {
  explicit: 'solid',
  action: 'solid',
  mention: 'dashed',
  suggested: 'dotted',
};
export const lineStyle = (kind: GraphEdgeKind): LineStyle => LINE[kind];

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * What the filters leave of the snapshot. Notes are kept by source, tag and time; the other nodes (tags, code
 * names, missing links) only while a kept note still links to them, so filtering never leaves orphans floating.
 */
export function filterSnapshot(snap: GraphSnapshot, f: GraphFilter, now = Date.now()): GraphView {
  const hidden = new Set(f.hiddenKinds);
  const sources = f.sources.length ? new Set(f.sources) : null;
  const since = now - WINDOW_MS[f.time];
  const keepNote = (n: GraphNode) =>
    (!sources || (n.sourceId !== undefined && sources.has(n.sourceId))) &&
    (!f.tag || !!n.tags?.includes(f.tag)) &&
    (f.time === 'any' || (n.mtime ?? 0) >= since);

  const kept = new Map<string, GraphNode>();
  const others = new Map<string, GraphNode>();
  for (const n of snap.nodes) {
    if (hidden.has(n.kind)) continue;
    if (n.kind === 'note') {
      if (keepNote(n)) kept.set(n.id, n);
    } else others.set(n.id, n);
  }
  const edges: GraphEdge[] = [];
  for (const e of snap.edges) {
    if (e.strength < f.minStrength) continue;
    const a = kept.get(e.source) ?? others.get(e.source);
    const b = kept.get(e.target) ?? others.get(e.target);
    if (!a || !b) continue;
    // A non-note joins only through a kept note.
    if (!kept.has(a.id) && !kept.has(b.id)) continue;
    edges.push(e);
  }
  const linked = new Set<string>();
  for (const e of edges) {
    linked.add(e.source);
    linked.add(e.target);
  }
  const nodes = snap.nodes.filter((n) => kept.has(n.id) || (others.has(n.id) && linked.has(n.id)));
  return { nodes, edges };
}

/** Nodes within `depth` links of `center` (both directions), center included. */
export function neighbourhood(edges: GraphEdge[], center: string, depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const l = adj.get(a);
    if (l) l.push(b);
    else adj.set(a, [b]);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const seen = new Set([center]);
  let ring = [center];
  for (let d = 0; d < depth && ring.length; d++) {
    const next: string[] = [];
    for (const id of ring)
      for (const n of adj.get(id) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
    ring = next;
  }
  return seen;
}

/** The local view: only the center's neighbourhood. A center the filters removed gives the view unchanged. */
export function localView(view: GraphView, center: string | null, depth: number): GraphView {
  if (!center || !view.nodes.some((n) => n.id === center)) return view;
  const keep = neighbourhood(view.edges, center, depth);
  return {
    nodes: view.nodes.filter((n) => keep.has(n.id)),
    edges: view.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

/** Ids of nodes whose label or path contains every word of the query (case-insensitive). Empty query = none. */
export function searchMatches(nodes: GraphNode[], query: string): Set<string> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  if (!words.length) return out;
  for (const n of nodes) {
    const hay = `${n.label} ${n.path ?? ''}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) out.add(n.id);
  }
  return out;
}

/** Tags used by notes, most used first (for the tag filter). */
export function tagsOf(nodes: GraphNode[]): string[] {
  const count = new Map<string, number>();
  for (const n of nodes) for (const t of n.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** Kinds present in the snapshot, in a fixed order (for the kind filter). */
const KIND_ORDER: readonly GraphNodeKind[] = [
  'note',
  'tag',
  'code',
  'missing',
  'person',
  'decision',
  'todo',
  'session',
  'file',
  'trend',
  'apply',
];
export function kindsOf(nodes: GraphNode[]): GraphNodeKind[] {
  const present = new Set(nodes.map((n) => n.kind));
  return KIND_ORDER.filter((k) => present.has(k));
}

/** Node size from its number of links: 4–14 px, square-root so hubs don't swallow the view. */
export function nodeSizes(view: GraphView): Map<string, number> {
  const degree = new Map<string, number>();
  for (const e of view.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const sizes = new Map<string, number>();
  for (const n of view.nodes) sizes.set(n.id, Math.min(14, 4 + Math.sqrt(degree.get(n.id) ?? 0) * 2));
  return sizes;
}
