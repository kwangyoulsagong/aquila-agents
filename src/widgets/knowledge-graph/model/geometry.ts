import type { GraphEdgeKind, GraphNode } from '@/shared/api';
import type { FocusColumnKey, FocusLayout } from './focus';

// Pixels for the focus view. Three arrangements by width: all four columns (wide, full window), the inner two
// (a wide panel), or one list under the centre card (a narrow panel — a list reads better than a drawing there
// anyway). Links attach where a label actually starts or ends (labels are measured), so a line never runs into
// empty space or through text.

export interface FocusMetrics {
  /** One item's height (`--size-focus-row`). */
  row: number;
  /** The centre card's width (`--size-focus-center`). */
  center: number;
  /** Between two columns, for the links (`--size-focus-gap`). */
  gap: number;
  /** Around the plane (`--space-inset-md`). */
  pad: number;
  /** Swatch + the space after it (`--space-inline-sm` × 2). */
  dot: number;
  /** A heading's height (`--space-stack-lg`). */
  head: number;
}

export type FocusArrangement = 'wide' | 'medium' | 'narrow';
/** Narrowest useful column. */
const MIN_COL = 128;
/** Widest column: longer labels are cut, the picture doesn't sprawl. */
const MAX_COL = 280;

export function arrangementFor(width: number, m: FocusMetrics): FocusArrangement {
  if (width >= 4 * MIN_COL + m.center + 4 * m.gap + 2 * m.pad) return 'wide';
  if (width >= 2 * MIN_COL + m.center + 2 * m.gap + 2 * m.pad) return 'medium';
  return 'narrow';
}

export interface PlacedNode {
  node: GraphNode;
  x: number;
  y: number;
  width: number;
  height?: number;
  align: 'start' | 'end' | 'center';
  depth: 0 | 1 | 2;
  column: FocusColumnKey | 'center';
}
export interface PlacedBox {
  key: string;
  x: number;
  y: number;
  width: number;
  align: 'start' | 'end' | 'center';
}
export interface PlacedLink {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  d: string;
}
export interface FocusGeometry {
  arrangement: FocusArrangement;
  width: number;
  height: number;
  nodes: PlacedNode[];
  heads: (PlacedBox & { column: FocusColumnKey })[];
  mores: (PlacedBox & { column: FocusColumnKey; count: number })[];
  links: PlacedLink[];
  /** Keyboard order: columns left → right, each top → bottom (narrow: one list). */
  lanes: string[][];
}

/** `measure(text, 'label' | 'meta')` → px. */
export type Measure = (text: string, role: 'label' | 'meta') => number;

export function focusGeometry(
  layout: FocusLayout,
  width: number,
  m: FocusMetrics,
  measure: Measure,
  metaOf: (n: GraphNode) => string,
  labelOf: (n: GraphNode) => string = (n) => n.label,
  /** Stage height: a shorter picture is centred in it. */
  minHeight = 0,
): FocusGeometry {
  const g = place(layout, width, m, measure, metaOf, labelOf, 0);
  const shift = Math.floor((minHeight - g.height) / 2);
  return shift > 0 ? { ...place(layout, width, m, measure, metaOf, labelOf, shift), height: minHeight } : g;
}

function place(
  layout: FocusLayout,
  width: number,
  m: FocusMetrics,
  measure: Measure,
  metaOf: (n: GraphNode) => string,
  labelOf: (n: GraphNode) => string,
  shift: number,
): FocusGeometry {
  const arrangement = arrangementFor(width, m);
  const col = (k: FocusColumnKey) => layout.columns.find((c) => c.key === k)!;
  const nodes: PlacedNode[] = [];
  const heads: FocusGeometry['heads'] = [];
  const mores: FocusGeometry['mores'] = [];
  const links: PlacedLink[] = [];
  const lanes: string[][] = [];

  if (arrangement === 'narrow') {
    const w = Math.max(0, width - 2 * m.pad);
    let y = m.pad + shift;
    nodes.push({
      node: layout.center,
      x: m.pad,
      y,
      width: w,
      height: 2 * m.row,
      align: 'center',
      depth: 0,
      column: 'center',
    });
    const lane = [layout.center.id];
    y += 2 * m.row + m.pad;
    for (const k of ['l1', 'r1'] as const) {
      const c = col(k);
      if (!c.items.length) continue;
      heads.push({ key: `head:${k}`, column: k, x: m.pad, y, width: w, align: 'start' });
      y += m.head;
      for (const it of c.items) {
        nodes.push({ node: it.node, x: m.pad, y, width: w, align: 'start', depth: 1, column: k });
        lane.push(it.node.id);
        y += m.row;
      }
      if (c.hidden) {
        mores.push({ key: `more:${k}`, column: k, count: c.hidden, x: m.pad, y, width: w, align: 'start' });
        y += m.head;
      }
      y += m.pad;
    }
    lanes.push(lane);
    return { arrangement, width, height: y + m.pad - shift, nodes, heads, mores, links, lanes };
  }

  const keys: FocusColumnKey[] = arrangement === 'wide' ? ['l2', 'l1', 'r1', 'r2'] : ['l1', 'r1'];
  const n = keys.length;
  const colW = Math.min(MAX_COL, Math.floor((width - m.center - n * m.gap - 2 * m.pad) / n));
  const planeW = n * colW + m.center + n * m.gap + 2 * m.pad;
  const xOf: Record<string, number> = {};
  let x = m.pad;
  for (const k of keys.slice(0, n / 2)) {
    xOf[k] = x;
    x += colW + m.gap;
  }
  const cx = x;
  x += m.center + m.gap;
  for (const k of keys.slice(n / 2)) {
    xOf[k] = x;
    x += colW + m.gap;
  }

  // Rows → px. Row 0 is level with the centre; the card is two rows tall.
  let lo = -1;
  let hi = 1;
  for (const k of keys)
    for (const it of col(k).items) {
      lo = Math.min(lo, it.row - 0.5);
      hi = Math.max(hi, it.row + 0.5 + (col(k).hidden ? 0.6 : 0));
    }
  const top = m.pad + m.head + shift;
  const mid = (row: number) => top + (row - lo) * m.row;
  const cy = mid(0);
  nodes.push({
    node: layout.center,
    x: cx,
    y: cy - m.row,
    width: m.center,
    height: 2 * m.row,
    align: 'center',
    depth: 0,
    column: 'center',
  });
  heads.push({ key: 'head:center', column: 'l1', x: cx, y: m.pad + shift, width: m.center, align: 'center' });

  /** Where a placed item's text starts / ends (for links coming from the outer column). */
  const textW = (nd: GraphNode) =>
    Math.min(colW - m.dot, Math.max(measure(labelOf(nd), 'label'), measure(metaOf(nd), 'meta')));
  const anchor = new Map<string, { inner: number; outer: number; y: number }>();
  anchor.set(layout.center.id, { inner: 0, outer: 0, y: cy });

  for (const k of keys) {
    const c = col(k);
    const left = k[0] === 'l';
    const align = left ? 'end' : 'start';
    const x0 = xOf[k]!;
    heads.push({ key: `head:${k}`, column: k, x: x0, y: m.pad + shift, width: colW, align });
    const lane: string[] = [];
    for (const it of c.items) {
      const y = mid(it.row);
      nodes.push({ node: it.node, x: x0, y: y - m.row / 2, width: colW, align, depth: c.depth, column: k });
      lane.push(it.node.id);
      const tw = textW(it.node);
      anchor.set(
        it.node.id,
        left
          ? { inner: x0 + colW, outer: x0 + colW - m.dot - tw, y }
          : { inner: x0, outer: x0 + m.dot + tw, y },
      );
    }
    if (c.hidden && c.items.length) {
      const last = c.items[c.items.length - 1]!;
      mores.push({
        key: `more:${k}`,
        column: k,
        count: c.hidden,
        x: x0,
        y: mid(last.row) + m.row / 2,
        width: colW,
        align,
      });
    }
    lanes.push(lane);
  }
  lanes.splice(n / 2, 0, [layout.center.id]);

  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = (x2 - x1) / 2;
    return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };
  for (const e of layout.edges) {
    const b = anchor.get(e.to);
    if (!b) continue;
    let d: string;
    if (e.from === layout.center.id) {
      const left = nodes.find((p) => p.node.id === e.to)?.align === 'end';
      d = left ? curve(cx, cy, b.inner, b.y) : curve(cx + m.center, cy, b.inner, b.y);
    } else {
      const a = anchor.get(e.from);
      if (!a) continue;
      d = curve(a.outer, a.y, b.inner, b.y);
    }
    links.push({ id: e.id, from: e.from, to: e.to, kind: e.kind, d });
  }
  const bottom = Math.max(top + (hi - lo) * m.row, ...mores.map((b) => b.y + m.head));
  return { arrangement, width: planeW, height: bottom + m.pad - shift, nodes, heads, mores, links, lanes };
}
