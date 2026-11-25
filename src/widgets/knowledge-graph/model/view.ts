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

/** Non-notes shown even with no note behind them (T70). */
const ROOT_KINDS = new Set<GraphNode['kind']>(['trend', 'apply']);

/** Line style by how sure a link is: written or caused by the app = solid, found in text = dashed, suggested = dotted. */
export type LineStyle = 'solid' | 'dashed' | 'dotted';
const LINE: Record<GraphEdgeKind, LineStyle> = {
  explicit: 'solid',
  action: 'solid',
  mention: 'dashed',
  suggested: 'dotted',
};
export const lineStyle = (kind: GraphEdgeKind): LineStyle => LINE[kind];

/**
 * One project's part of the graph (T73): notes of the sources inside its folder, and the app nodes (sessions,
 * files, code names, applies) of that project. Null = every project.
 */
export interface GraphScope {
  projectId: string;
  /** Note sources inside the project folder (the most specific project wins: see `projectSources`). */
  sourceIds: ReadonlySet<string>;
}

/** `~/a/b` is inside `~/a` (both as stored: `~/…` or absolute). */
const inside = (child: string, parent: string): boolean => {
  const p = parent.replace(/\/+$/, '');
  return child === p || child.startsWith(`${p}/`);
};

/**
 * Source id → the project it belongs to: the project with the longest folder that contains the source (so a
 * project at `~` only gets the sources no other project holds). Sources outside every project belong to none.
 */
export function projectSources(
  sources: readonly { id: string; path: string }[],
  projects: readonly { id: string; path: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sources) {
    const owner = projects
      .filter((p) => inside(s.path, p.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (owner) out.set(s.id, owner.id);
  }
  return out;
}

/** The scope of one project, from `projectSources`. */
export function scopeOf(projectId: string, owners: ReadonlyMap<string, string>): GraphScope {
  return { projectId, sourceIds: new Set([...owners].filter(([, p]) => p === projectId).map(([s]) => s)) };
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * What the filters leave of the snapshot. Notes are kept by source, tag and time; the other nodes (tags, code
 * names, missing links) only while a kept note still links to them, so filtering never leaves orphans floating.
 */
export function filterSnapshot(
  snap: GraphSnapshot,
  f: GraphFilter,
  now = Date.now(),
  scope: GraphScope | null = null,
): GraphView {
  const hidden = new Set(f.hiddenKinds);
  const sources = f.sources.length ? new Set(f.sources) : null;
  const since = now - WINDOW_MS[f.time];
  const keepNote = (n: GraphNode) =>
    (!scope || (n.sourceId !== undefined && scope.sourceIds.has(n.sourceId))) &&
    (!sources || (n.sourceId !== undefined && sources.has(n.sourceId))) &&
    (!f.tag || !!n.tags?.includes(f.tag)) &&
    (f.time === 'any' || (n.mtime ?? 0) >= since);

  const kept = new Map<string, GraphNode>();
  const others = new Map<string, GraphNode>();
  for (const n of snap.nodes) {
    if (hidden.has(n.kind)) continue;
    if (n.kind === 'note') {
      if (keepNote(n)) kept.set(n.id, n);
    } else if (!scope || !n.projects || n.projects.includes(scope.projectId)) others.set(n.id, n);
  }
  const candidates: GraphEdge[] = [];
  const adjacent = new Map<string, string[]>();
  for (const e of snap.edges) {
    if (e.strength < f.minStrength) continue;
    if (!(kept.has(e.source) || others.has(e.source)) || !(kept.has(e.target) || others.has(e.target)))
      continue;
    candidates.push(e);
    (adjacent.get(e.source) ?? adjacent.set(e.source, []).get(e.source)!).push(e.target);
    (adjacent.get(e.target) ?? adjacent.set(e.target, []).get(e.target)!).push(e.source);
  }
  // A non-note joins through a path from a kept note (note → session → changed file), or from a trend / apply
  // decision (T70: trend → apply → session), which stand on their own.
  const reached = new Set<string>(kept.keys());
  // In a project, its own sessions / files / code / applies stand on their own too (a project with no notes still
  // shows its work); trends only through the project's apply decisions.
  for (const n of others.values())
    if (scope ? !!n.projects : ROOT_KINDS.has(n.kind)) reached.add(n.id);
  const queue = [...reached];
  while (queue.length) {
    for (const next of adjacent.get(queue.pop()!) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  const edges = candidates.filter((e) => reached.has(e.source) && reached.has(e.target));
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
