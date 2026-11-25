import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/shared/api';
import { clustersOf, louvain } from './clusters';

const node = (id: string): GraphNode => ({ id, kind: 'note', label: id });
const edge = (source: string, target: string): GraphEdge => ({
  id: `${source}→${target}`,
  source,
  target,
  kind: 'explicit',
  strength: 1,
  reasons: [],
});

/** k cliques of `size`, each joined to the next by one edge. */
function cliques(k: number, size: number) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let c = 0; c < k; c++) {
    for (let i = 0; i < size; i++) nodes.push(node(`c${c}n${i}`));
    for (let i = 0; i < size; i++)
      for (let j = i + 1; j < size; j++) edges.push(edge(`c${c}n${i}`, `c${c}n${j}`));
    if (c) edges.push(edge(`c${c - 1}n0`, `c${c}n0`));
  }
  return { nodes, edges };
}

describe('louvain', () => {
  it('finds two triangles joined by a bridge', () => {
    const c = louvain(6, [
      [0, 1, 1],
      [1, 2, 1],
      [2, 0, 1],
      [3, 4, 1],
      [4, 5, 1],
      [5, 3, 1],
      [2, 3, 1],
    ]);
    expect(c[0]).toBe(c[1]);
    expect(c[1]).toBe(c[2]);
    expect(c[3]).toBe(c[4]);
    expect(c[0]).not.toBe(c[3]);
  });

  it('keeps isolated nodes apart and handles no edges', () => {
    expect([...louvain(3, [])]).toEqual([0, 1, 2]);
  });
});

describe('clustersOf', () => {
  it('one group per clique, biggest first, named, deterministic', () => {
    const view = cliques(5, 6);
    const a = clustersOf(view);
    expect(a.list).toHaveLength(5);
    for (let c = 0; c < 5; c++) {
      const groups = new Set(view.nodes.filter((n) => n.id.startsWith(`c${c}n`)).map((n) => a.of.get(n.id)));
      expect(groups.size).toBe(1);
    }
    expect(a.list.every((g) => g.size === 6 && g.name.length > 0)).toBe(true);
    expect(clustersOf(view)).toEqual(a);
  });
});
