import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, GraphNodeKind } from '@/shared/api';
import { focusLayout } from './focus';
import { arrangementFor, focusGeometry, type FocusMetrics } from './geometry';

const m: FocusMetrics = { row: 40, center: 208, gap: 48, pad: 12, dot: 16, head: 24 };
const measure = (s: string) => s.length * 7;
const node = (id: string, kind: GraphNodeKind = 'note'): GraphNode => ({ id, kind, label: id });
const edge = (source: string, target: string): GraphEdge => ({
  id: `${source}→${target}`,
  source,
  target,
  kind: 'explicit',
  strength: 1,
  reasons: [],
});
const view = {
  nodes: [node('c'), node('a'), node('b'), node('far'), node('s', 'session'), node('f', 'file')],
  edges: [edge('c', 'a'), edge('c', 'b'), edge('a', 'far'), edge('c', 's'), edge('s', 'f')],
};
const layout = focusLayout(view, 'c', { now: 0 })!;

/** Boxes of placed items overlap when they share a column and their rows overlap. */
const overlaps = (g: ReturnType<typeof focusGeometry>) => {
  for (const a of g.nodes)
    for (const b of g.nodes) {
      if (a === b || a.x !== b.x) continue;
      const ha = a.height ?? m.row;
      const hb = b.height ?? m.row;
      if (a.y < b.y + hb - 1e-6 && b.y < a.y + ha - 1e-6) return true;
    }
  return false;
};

describe('focusGeometry', () => {
  it('picks the arrangement by width', () => {
    expect(arrangementFor(1400, m)).toBe('wide');
    expect(arrangementFor(700, m)).toBe('medium');
    expect(arrangementFor(400, m)).toBe('narrow');
  });

  it('wide: four columns either side of the centre, a link per edge, nothing overlapping', () => {
    const g = focusGeometry(layout, 1400, m, measure, () => '');
    expect(g.arrangement).toBe('wide');
    const xs = (col: string) => g.nodes.filter((p) => p.column === col).map((p) => p.x);
    const center = g.nodes.find((p) => p.column === 'center')!;
    expect(Math.max(...xs('l1'))).toBeLessThan(center.x);
    expect(Math.min(...xs('r1'))).toBeGreaterThan(center.x);
    expect(Math.max(...xs('l2'))).toBeLessThan(Math.min(...xs('l1')));
    expect(g.links).toHaveLength(layout.edges.length);
    expect(overlaps(g)).toBe(false);
    expect(g.width).toBeLessThanOrEqual(1400);
    expect(g.lanes.map((l) => l.length)).toEqual([1, 2, 1, 1, 1]);
  });

  it('medium: only the inner columns; narrow: one list, no links', () => {
    const med = focusGeometry(layout, 700, m, measure, () => '');
    expect(new Set(med.nodes.map((p) => p.column))).toEqual(new Set(['center', 'l1', 'r1']));
    expect(med.links.every((l) => l.from === 'c')).toBe(true);
    const narrow = focusGeometry(layout, 360, m, measure, () => '');
    expect(narrow.links).toHaveLength(0);
    expect(narrow.lanes).toEqual([['c', ...narrow.nodes.slice(1).map((p) => p.node.id)]]);
    expect(overlaps(narrow)).toBe(false);
  });
});
