import type {
  ApplyProposal,
  NodeChangeKind,
  RepoColumn,
  RepoEdge,
  RepoNode,
  RepoSkeleton,
} from '@/shared/api';

/** Now = the repo as it is; After = with the proposal's marks (same layout, so toggling doesn't move a box). */
export type GraphMode = 'now' | 'after';

// Geometry on the 4px grid (SVG user units).
export const NODE_W = 160;
export const NODE_H = 44;
const ROW_GAP = 8;
const COL_GAP = 56;
const PAD = 8;
const HEAD = 24;
/** A code column holds this many boxes before the next one starts. */
export const ROWS_PER_COLUMN = 8;

export interface PlacedNode {
  node: RepoNode;
  x: number;
  y: number;
}

export interface GraphLayout {
  nodes: PlacedNode[];
  width: number;
  height: number;
  /** Heading per column group. */
  columns: { column: RepoColumn; x: number }[];
}

/**
 * Every node either view shows: the repo's present nodes, plus — when there's a proposal — the missing slots it adds
 * and its new nodes (new harness boxes join the harness column, new code boxes the code columns).
 */
export function graphNodes(skeleton: RepoSkeleton, proposal: ApplyProposal | null): RepoNode[] {
  const adds = new Set(proposal?.changes.filter((c) => c.kind === 'add').map((c) => c.node));
  const base = skeleton.nodes.filter((n) => n.present || adds.has(n.id));
  const added = proposal?.added ?? [];
  return [
    ...base.filter((n) => n.column === 'harness'),
    ...added.filter((n) => n.column === 'harness'),
    ...base.filter((n) => n.column === 'code'),
    ...added.filter((n) => n.column === 'code'),
  ];
}

/** Harness on the left, code on the right; each group wraps into columns of ROWS_PER_COLUMN boxes. */
export function layoutGraph(nodes: RepoNode[]): GraphLayout {
  const groups = (['harness', 'code'] as const)
    .map((column) => ({ column, list: nodes.filter((n) => n.column === column) }))
    .filter((g) => g.list.length);
  const placed: PlacedNode[] = [];
  const columns: GraphLayout['columns'] = [];
  const y = (row: number) => PAD + HEAD + row * (NODE_H + ROW_GAP);
  const inner = COL_GAP / 2;
  let x = PAD;
  let rows = 1;
  groups.forEach((g, gi) => {
    if (gi) x += COL_GAP - inner;
    columns.push({ column: g.column, x });
    const cols = Math.ceil(g.list.length / ROWS_PER_COLUMN);
    g.list.forEach((node, i) =>
      placed.push({ node, x: x + Math.floor(i / ROWS_PER_COLUMN) * (NODE_W + inner), y: y(i % ROWS_PER_COLUMN) }),
    );
    rows = Math.max(rows, Math.min(g.list.length, ROWS_PER_COLUMN));
    x += cols * (NODE_W + inner);
  });
  const width = Math.max(x - inner + PAD, PAD * 2 + NODE_W);
  return { nodes: placed, width, height: y(rows) - ROW_GAP + PAD, columns };
}

/** A curve from one box to another: right edge → left edge across columns, a loop on the right within one column. */
export function edgePath(a: PlacedNode, b: PlacedNode): string {
  const ay = a.y + NODE_H / 2;
  const by = b.y + NODE_H / 2;
  if (Math.abs(a.x - b.x) < NODE_W) {
    const x = Math.max(a.x, b.x) + NODE_W;
    const bend = 24 + Math.min(Math.abs(ay - by) / 8, 24);
    return `M${x} ${ay} C${x + bend} ${ay} ${x + bend} ${by} ${x} ${by}`;
  }
  const [l, r, ly, ry] = a.x < b.x ? [a, b, ay, by] : [b, a, by, ay];
  const x1 = l.x + NODE_W;
  const x2 = r.x;
  const mid = (x1 + x2) / 2;
  return `M${x1} ${ly} C${mid} ${ly} ${mid} ${ry} ${x2} ${ry}`;
}

/** Marks shown in After: the proposal's change per node. */
export function marksOf(proposal: ApplyProposal | null): Map<string, NodeChangeKind> {
  return new Map((proposal?.changes ?? []).map((c) => [c.node, c.kind]));
}

/** Which nodes a view draws: Now hides what the proposal would add (their place stays empty). */
export function visibleIn(mode: GraphMode, node: RepoNode): boolean {
  return mode === 'after' || node.present;
}

/** Edges between drawn nodes only. */
export function visibleEdges(edges: RepoEdge[], shown: Set<string>): RepoEdge[] {
  return edges.filter((e) => shown.has(e.from) && shown.has(e.to));
}

/** Labels wider than a box are cut with an ellipsis (SVG text doesn't wrap). */
export function fit(label: string, max = 20): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
