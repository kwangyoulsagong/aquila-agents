// Split layout: a binary tree of panes. Pure functions only — every change returns a new Layout.
// A pane shows one session (or none → empty state). The layout is global, so panes may mix projects.

export const MAX_PANES = 4;

/** `row` = side by side (split right), `column` = stacked (split down). */
export type SplitDir = 'row' | 'column';
export type Edge = 'left' | 'right' | 'top' | 'bottom';
/** Where a dragged session lands: an edge splits the pane, `center` replaces its session. */
export type DropZone = Edge | 'center';

export interface Leaf {
  kind: 'leaf';
  id: string;
  sessionId: string | null;
}
export interface Branch {
  kind: 'split';
  dir: SplitDir;
  a: PaneNode;
  b: PaneNode;
}
export type PaneNode = Leaf | Branch;

export interface Layout {
  root: PaneNode;
  focusedId: string;
}

/** Fractions (0–1) of the stage. */
export interface PaneRect {
  leaf: Leaf;
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;

export function createLayout(sessionId: string | null = null): Layout {
  return { root: { kind: 'leaf', id: 'p1', sessionId }, focusedId: 'p1' };
}

export function leaves(node: PaneNode): Leaf[] {
  return node.kind === 'leaf' ? [node] : [...leaves(node.a), ...leaves(node.b)];
}

export function focusedLeaf(layout: Layout): Leaf {
  return leaves(layout.root).find((l) => l.id === layout.focusedId) ?? leaves(layout.root)[0];
}

export function paneOf(layout: Layout, sessionId: string): Leaf | undefined {
  return leaves(layout.root).find((l) => l.sessionId === sessionId);
}

export function paneCount(layout: Layout): number {
  return leaves(layout.root).length;
}

export function focus(layout: Layout, paneId: string): Layout {
  if (layout.focusedId === paneId || !leaves(layout.root).some((l) => l.id === paneId)) return layout;
  return { ...layout, focusedId: paneId };
}

function mapLeaves(node: PaneNode, fn: (leaf: Leaf) => PaneNode): PaneNode {
  if (node.kind === 'leaf') return fn(node);
  const a = mapLeaves(node.a, fn);
  const b = mapLeaves(node.b, fn);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function nextPaneId(root: PaneNode): string {
  const max = Math.max(0, ...leaves(root).map((l) => Number(l.id.slice(1)) || 0));
  return `p${max + 1}`;
}

/**
 * Put a session into a pane. If it is already shown in another pane, the two panes swap sessions,
 * so a session is never on screen twice.
 */
export function place(layout: Layout, paneId: string, sessionId: string | null): Layout {
  const target = leaves(layout.root).find((l) => l.id === paneId);
  if (!target) return layout;
  const source = sessionId ? paneOf(layout, sessionId) : undefined;
  const root = mapLeaves(layout.root, (l) => {
    if (l.id === paneId) return l.sessionId === sessionId ? l : { ...l, sessionId };
    if (source && l.id === source.id) return { ...l, sessionId: target.sessionId };
    return l;
  });
  return { root, focusedId: paneId };
}

/** Tab click: focus the pane already showing the session, otherwise show it in the focused pane. */
export function show(layout: Layout, sessionId: string): Layout {
  const pane = paneOf(layout, sessionId);
  return pane ? focus(layout, pane.id) : place(layout, layout.focusedId, sessionId);
}

/** Remove a pane; its sibling takes the parent's space. The last pane is never removed. */
export function closePane(layout: Layout, paneId: string): Layout {
  if (layout.root.kind === 'leaf') return layout;
  let sibling = null as PaneNode | null;
  const prune = (node: PaneNode): PaneNode => {
    if (node.kind === 'leaf') return node;
    if (node.a.kind === 'leaf' && node.a.id === paneId) return (sibling = node.b);
    if (node.b.kind === 'leaf' && node.b.id === paneId) return (sibling = node.a);
    const a = prune(node.a);
    const b = prune(node.b);
    return a === node.a && b === node.b ? node : { ...node, a, b };
  };
  const root = prune(layout.root);
  if (!sibling) return layout;
  const focusedId = layout.focusedId === paneId ? leaves(sibling)[0].id : layout.focusedId;
  return { root, focusedId };
}

/**
 * Split a pane at an edge and put `sessionId` in the new pane (focused). A session already on screen
 * moves (its old pane closes). No-op at MAX_PANES or when splitting a pane with its own session.
 */
export function split(layout: Layout, paneId: string, edge: Edge, sessionId: string | null): Layout {
  let base = layout;
  const source = sessionId ? paneOf(layout, sessionId) : undefined;
  if (source) {
    if (source.id === paneId) return layout;
    base = closePane(layout, source.id);
  }
  if (paneCount(base) >= MAX_PANES) return layout;
  const newLeaf: Leaf = { kind: 'leaf', id: nextPaneId(layout.root), sessionId };
  const dir: SplitDir = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const first = edge === 'left' || edge === 'top';
  let found = false;
  const root = mapLeaves(base.root, (l) => {
    if (l.id !== paneId) return l;
    found = true;
    return first ? { kind: 'split', dir, a: newLeaf, b: l } : { kind: 'split', dir, a: l, b: newLeaf };
  });
  return found ? { root, focusedId: newLeaf.id } : layout;
}

/** Drop a dragged session on a pane. */
export function drop(layout: Layout, paneId: string, zone: DropZone, sessionId: string): Layout {
  return zone === 'center' ? place(layout, paneId, sessionId) : split(layout, paneId, zone, sessionId);
}

/**
 * A session went away. Its pane collapses — unless it is the only pane, which then shows `fallback`.
 */
export function removeSession(layout: Layout, sessionId: string, fallback: string | null): Layout {
  const pane = paneOf(layout, sessionId);
  if (!pane) return layout;
  if (paneCount(layout) > 1) return closePane(layout, pane.id);
  return place(layout, pane.id, fallback);
}

export function rects(node: PaneNode, x = 0, y = 0, w = 1, h = 1): PaneRect[] {
  if (node.kind === 'leaf') return [{ leaf: node, x, y, w, h }];
  if (node.dir === 'row') return [...rects(node.a, x, y, w / 2, h), ...rects(node.b, x + w / 2, y, w / 2, h)];
  return [...rects(node.a, x, y, w, h / 2), ...rects(node.b, x, y + h / 2, w, h / 2)];
}

/** The pane next to the focused one in a direction (most overlap, then nearest), or null. */
export function neighbor(layout: Layout, edge: Edge): string | null {
  const all = rects(layout.root);
  const cur = all.find((r) => r.leaf.id === layout.focusedId);
  if (!cur) return null;
  const horizontal = edge === 'left' || edge === 'right';
  const overlap = (r: PaneRect) =>
    horizontal
      ? Math.min(r.y + r.h, cur.y + cur.h) - Math.max(r.y, cur.y)
      : Math.min(r.x + r.w, cur.x + cur.w) - Math.max(r.x, cur.x);
  const gap = (r: PaneRect) => {
    switch (edge) {
      case 'left':
        return cur.x - (r.x + r.w);
      case 'right':
        return r.x - (cur.x + cur.w);
      case 'top':
        return cur.y - (r.y + r.h);
      case 'bottom':
        return r.y - (cur.y + cur.h);
    }
  };
  const candidates = all
    .filter((r) => r !== cur && gap(r) > -EPS && overlap(r) > EPS)
    .sort((a, b) => gap(a) - gap(b) || overlap(b) - overlap(a));
  return candidates[0]?.leaf.id ?? null;
}

/** Which drop zone a point (fractions inside a pane) falls in: outer quarter = edge, middle = center. */
export function zoneAt(px: number, py: number): DropZone {
  const d = { left: px, right: 1 - px, top: py, bottom: 1 - py };
  const [edge, dist] = (Object.entries(d) as [Edge, number][]).sort((a, b) => a[1] - b[1])[0];
  return dist < 0.25 ? edge : 'center';
}

/** The area a drop zone would occupy inside a pane rect (for the drop indicator). */
export function zoneRect(r: PaneRect, zone: DropZone): Omit<PaneRect, 'leaf'> {
  switch (zone) {
    case 'left':
      return { x: r.x, y: r.y, w: r.w / 2, h: r.h };
    case 'right':
      return { x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h };
    case 'top':
      return { x: r.x, y: r.y, w: r.w, h: r.h / 2 };
    case 'bottom':
      return { x: r.x, y: r.y + r.h / 2, w: r.w, h: r.h / 2 };
    case 'center':
      return { x: r.x, y: r.y, w: r.w, h: r.h };
  }
}
