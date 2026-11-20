// Split layout: a binary tree of panes. Pure functions only — every change returns a new Layout.
// A pane shows one session (or none → empty state). The layout is global, so panes may mix projects.
import type { SavedLayout, SavedPane } from '@/shared/api';

export const MAX_PANES = 4;
/** A pane never gets less than this share of its split (drag and keyboard resize clamp to it). */
export const MIN_RATIO = 0.15;
/** One keyboard resize step. */
export const RESIZE_STEP = 0.05;

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
  /** Share of the split that `a` takes (0–1); missing = half. */
  ratio?: number;
}
export type PaneNode = Leaf | Branch;

export interface Layout {
  root: PaneNode;
  focusedId: string;
  /** A pane filling the whole stage (the others stay in the tree, hidden); null = not zoomed. */
  zoomedId?: string | null;
}

/** Fractions (0–1) of the stage. */
export interface PaneRect {
  leaf: Leaf;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A draggable divider between the two halves of a split. `path` = a/b steps from the root to that split. */
export interface Divider {
  path: string;
  dir: SplitDir;
  ratio: number;
  /** The split's own box (fractions of the stage); the line sits at `ratio` across it. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;

const clampRatio = (r: number) => Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, r));
const ratioOf = (b: Branch) => b.ratio ?? 0.5;

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

/** Focusing another pane leaves zoom (the focused pane is the one on screen). */
export function focus(layout: Layout, paneId: string): Layout {
  if (layout.focusedId === paneId || !leaves(layout.root).some((l) => l.id === paneId)) return layout;
  return { ...layout, focusedId: paneId, zoomedId: null };
}

/** Zoom the focused pane to fill the stage, or back. A single pane can't zoom. */
export function toggleZoom(layout: Layout): Layout {
  if (layout.zoomedId) return { ...layout, zoomedId: null };
  if (layout.root.kind === 'leaf') return layout;
  return { ...layout, zoomedId: focusedLeaf(layout).id };
}

/**
 * Full window (T37): a view of the layout with only the focused pane — no head, no dividers. Display only: the
 * tree itself (and its zoom) is untouched, so leaving full window brings the split back as it was.
 */
export function focusedOnly(layout: Layout): Layout {
  const leaf = focusedLeaf(layout);
  return { root: leaf, focusedId: leaf.id, zoomedId: null };
}

/** The zoomed pane, if it still exists. */
export function zoomed(layout: Layout): Leaf | null {
  return (layout.zoomedId && leaves(layout.root).find((l) => l.id === layout.zoomedId)) || null;
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
  return { root, focusedId: paneId, zoomedId: layout.zoomedId === paneId ? paneId : null };
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
  const zoomedId = layout.zoomedId === paneId || root.kind === 'leaf' ? null : (layout.zoomedId ?? null);
  return { root, focusedId, zoomedId };
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
  // A new pane has to be seen: splitting leaves zoom.
  return found ? { root, focusedId: newLeaf.id, zoomedId: null } : layout;
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
  const r = ratioOf(node);
  if (node.dir === 'row')
    return [...rects(node.a, x, y, w * r, h), ...rects(node.b, x + w * r, y, w * (1 - r), h)];
  return [...rects(node.a, x, y, w, h * r), ...rects(node.b, x, y + h * r, w, h * (1 - r))];
}

/** What's on screen: every pane, or only the zoomed one filling the stage. */
export function visibleRects(layout: Layout): PaneRect[] {
  const z = zoomed(layout);
  return z ? [{ leaf: z, x: 0, y: 0, w: 1, h: 1 }] : rects(layout.root);
}

/** Every split's divider (none while zoomed). */
export function dividers(layout: Layout): Divider[] {
  if (zoomed(layout)) return [];
  const out: Divider[] = [];
  const walk = (node: PaneNode, path: string, x: number, y: number, w: number, h: number) => {
    if (node.kind === 'leaf') return;
    const r = ratioOf(node);
    out.push({ path, dir: node.dir, ratio: r, x, y, w, h });
    if (node.dir === 'row') {
      walk(node.a, path + 'a', x, y, w * r, h);
      walk(node.b, path + 'b', x + w * r, y, w * (1 - r), h);
    } else {
      walk(node.a, path + 'a', x, y, w, h * r);
      walk(node.b, path + 'b', x, y + h * r, w, h * (1 - r));
    }
  };
  walk(layout.root, '', 0, 0, 1, 1);
  return out;
}

/** Set the ratio of the split at `path` (clamped so neither side gets too small). */
export function resize(layout: Layout, path: string, ratio: number): Layout {
  const next = clampRatio(ratio);
  const walk = (node: PaneNode, rest: string): PaneNode => {
    if (node.kind === 'leaf') return node;
    if (!rest) return Math.abs(ratioOf(node) - next) < EPS ? node : { ...node, ratio: next };
    const side = rest[0] === 'a' ? 'a' : 'b';
    const child = walk(node[side], rest.slice(1));
    return child === node[side] ? node : { ...node, [side]: child };
  };
  const root = walk(layout.root, path);
  return root === layout.root ? layout : { ...layout, root };
}

/**
 * Keyboard resize: move the nearest divider around the focused pane that runs across `edge`'s axis one step toward
 * `edge` (← / → move a side-by-side divider, ↑ / ↓ a stacked one). No such divider → unchanged.
 */
export function nudge(layout: Layout, edge: Edge, step = RESIZE_STEP): Layout {
  if (zoomed(layout)) return layout;
  const dir: SplitDir = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const sign = edge === 'left' || edge === 'top' ? -1 : 1;
  let found: { path: string; ratio: number } | null = null;
  const walk = (node: PaneNode, path: string): boolean => {
    if (node.kind === 'leaf') return node.id === layout.focusedId;
    const inA = walk(node.a, path + 'a');
    const inside = inA || walk(node.b, path + 'b');
    if (inside && !found && node.dir === dir) found = { path, ratio: ratioOf(node) };
    return inside;
  };
  walk(layout.root, '');
  const hit = found as { path: string; ratio: number } | null;
  return hit ? resize(layout, hit.path, hit.ratio + sign * step) : layout;
}

/** The pane next to the focused one in a direction (most overlap, then nearest), or null. Zoom is ignored. */
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

/** The layout as saved across launches (T21): pane ids dropped, focus as a leaf index. */
export function toSaved(layout: Layout): SavedLayout {
  const strip = (node: PaneNode): SavedPane =>
    node.kind === 'leaf'
      ? { kind: 'leaf', sessionId: node.sessionId }
      : {
          kind: 'split',
          dir: node.dir,
          a: strip(node.a),
          b: strip(node.b),
          ...(node.ratio !== undefined && { ratio: node.ratio }),
        };
  const focused = leaves(layout.root).findIndex((l) => l.id === layout.focusedId);
  return { root: strip(layout.root), focused: Math.max(0, focused) };
}

/**
 * A saved layout back as a Layout. Sessions not in `known` leave their pane empty; a session shown twice keeps only
 * its first pane. More than MAX_PANES panes → null.
 */
export function fromSaved(saved: SavedLayout, known: Set<string>): Layout | null {
  let n = 0;
  const shown = new Set<string>();
  const build = (node: SavedPane): PaneNode => {
    if (node.kind === 'leaf') {
      const id =
        node.sessionId && known.has(node.sessionId) && !shown.has(node.sessionId) ? node.sessionId : null;
      if (id) shown.add(id);
      return { kind: 'leaf', id: `p${++n}`, sessionId: id };
    }
    const ratio =
      typeof node.ratio === 'number' && Number.isFinite(node.ratio) ? clampRatio(node.ratio) : undefined;
    return {
      kind: 'split',
      dir: node.dir,
      a: build(node.a),
      b: build(node.b),
      ...(ratio !== undefined && { ratio }),
    };
  };
  const root = build(saved.root);
  const all = leaves(root);
  if (all.length > MAX_PANES) return null;
  return { root, focusedId: (all[saved.focused] ?? all[0]).id };
}
