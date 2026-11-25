import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, GraphNodeKind } from '@/shared/api';
import { COLUMN_STEP, defaultCenter, focusLayout, pathTo, sideOfKind } from './focus';
import { countCrossings } from './ordering';

const node = (id: string, kind: GraphNodeKind = 'note', mtime?: number): GraphNode => ({
  id,
  kind,
  label: id,
  ...(mtime !== undefined ? { mtime } : {}),
});
const edge = (source: string, target: string, strength = 1): GraphEdge => ({
  id: `${source}→${target}`,
  source,
  target,
  kind: strength >= 1 ? 'explicit' : 'mention',
  strength,
  reasons: [],
});

describe('focusLayout', () => {
  it('puts knowledge left and work right, one and two links away', () => {
    const view = {
      nodes: [
        node('spec'),
        node('adr'),
        node('tag', 'tag'),
        node('s1', 'session'),
        node('f1', 'file'),
        node('far'),
      ],
      edges: [
        edge('spec', 'adr'),
        edge('spec', 'tag'),
        edge('spec', 's1'),
        edge('s1', 'f1'),
        edge('adr', 'far'),
      ],
    };
    const l = focusLayout(view, 'spec')!;
    const ids = (k: string) => l.columns.find((c) => c.key === k)!.items.map((i) => i.node.id);
    expect(ids('l1').sort()).toEqual(['adr', 'tag']);
    expect(ids('r1')).toEqual(['s1']);
    expect(ids('r2')).toEqual(['f1']);
    expect(ids('l2')).toEqual(['far']);
    expect(l.edges.map((e) => e.id).sort()).toEqual(['adr|far', 's1|f1', 'spec|adr', 'spec|s1', 'spec|tag']);
    expect(sideOfKind('todo')).toBe('right');
    expect(focusLayout(view, 'nope')).toBeNull();
  });

  it('shows the most interesting first and counts the rest', () => {
    const now = Date.now();
    const many = Array.from({ length: 20 }, (_, i) => node(`n${i}`, 'note', now - i * 86_400_000));
    const view = {
      nodes: [node('c'), ...many],
      edges: many.map((n, i) => edge('c', n.id, i === 19 ? 1 : 0.5)),
    };
    const l = focusLayout(view, 'c', { now })!;
    const l1 = l.columns.find((c) => c.key === 'l1')!;
    expect(l1.items).toHaveLength(COLUMN_STEP[1]);
    expect(l1.hidden).toBe(20 - COLUMN_STEP[1]);
    // The one explicit link outranks fresher mentions.
    expect(l1.items.map((i) => i.node.id)).toContain('n19');
    const more = focusLayout(view, 'c', { now, shown: { l1: 14 } })!;
    expect(more.columns.find((c) => c.key === 'l1')!.items).toHaveLength(14);
  });

  it('only pulls the outer column from shown inner items, never the centre’s own neighbours', () => {
    const view = {
      nodes: [node('c'), node('a'), node('b'), node('x')],
      edges: [edge('c', 'a'), edge('c', 'b'), edge('a', 'b'), edge('a', 'x')],
    };
    const l = focusLayout(view, 'c', { shown: { l1: 1 } })!;
    const l1 = l.columns.find((c) => c.key === 'l1')!;
    const l2 = l.columns.find((c) => c.key === 'l2')!;
    expect(l1.items).toHaveLength(1);
    expect(l2.items.map((i) => i.node.id)).not.toContain('b');
  });

  it('keeps rows apart, outer items next to their parent, and crossings at the minimum', () => {
    // Three hubs with two children each, tangled by rank.
    const hubs = ['h0', 'h1', 'h2'];
    const kids = hubs.flatMap((h, i) => [`${h}a`, `${h}b`].map((k) => ({ k, h, i })));
    const view = {
      nodes: [node('c'), ...hubs.map((h) => node(h)), ...kids.map(({ k }) => node(k))],
      edges: [...hubs.map((h) => edge('c', h)), ...kids.map(({ k, h }) => edge(h, k))],
    };
    const l = focusLayout(view, 'c')!;
    const l1 = l.columns.find((c) => c.key === 'l1')!;
    const l2 = l.columns.find((c) => c.key === 'l2')!;
    for (const col of [l1, l2])
      for (let i = 1; i < col.items.length; i++)
        expect(col.items[i]!.row - col.items[i - 1]!.row).toBeGreaterThanOrEqual(1 - 1e-9);
    const pos1 = new Map(l1.items.map((it, i) => [it.node.id, i]));
    const pairs = l2.items.flatMap((it, j) => it.parents.map((p) => [pos1.get(p)!, j] as const));
    expect(countCrossings(pairs, l2.items.length)).toBe(0);
    expect(pathTo(l, l2.items[0]!.node.id).has(l2.items[0]!.parents[0]!)).toBe(true);
  });

  it('is the same picture every time', () => {
    const view = {
      nodes: Array.from({ length: 30 }, (_, i) => node(`n${i}`, i % 3 ? 'note' : 'session')),
      edges: Array.from({ length: 60 }, (_, i) => edge(`n${(i * 7) % 30}`, `n${(i * 11 + 3) % 30}`)),
    };
    expect(focusLayout(view, 'n0', { now: 1 })).toEqual(focusLayout(view, 'n0', { now: 1 }));
  });
});

describe('defaultCenter', () => {
  it('is the most recently changed note', () => {
    expect(
      defaultCenter({ nodes: [node('a', 'note', 1), node('b', 'note', 5), node('t', 'tag')], edges: [] }),
    ).toBe('b');
    expect(defaultCenter({ nodes: [], edges: [] })).toBeNull();
  });
});
