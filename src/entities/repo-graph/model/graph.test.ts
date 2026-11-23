import { describe, expect, it } from 'vitest';
import type { ApplyProposal, RepoNode, RepoSkeleton } from '@/shared/api';
import {
  edgePath,
  fit,
  graphNodes,
  layoutGraph,
  marksOf,
  NODE_W,
  ROWS_PER_COLUMN,
  visibleEdges,
  visibleIn,
} from './graph';

const h = (id: string, present = true): RepoNode => ({
  id: `h:${id}`,
  label: id,
  column: 'harness',
  present,
});
const c = (id: string): RepoNode => ({ id: `c:${id}`, label: id, column: 'code', present: true });

const skeleton: RepoSkeleton = {
  nodes: [h('agents-md'), h('skills', false), h('ci', false), c('src/app'), c('src/shared')],
  edges: [{ from: 'c:src/app', to: 'c:src/shared', weight: 3 }],
};
const proposal: ApplyProposal = {
  verdict: 'partial',
  summary: '',
  benefits: [],
  changes: [
    { node: 'h:skills', kind: 'add', why: 'no skills yet' },
    { node: 'new:map', kind: 'add', why: 'a map' },
    { node: 'h:agents-md', kind: 'change', why: 'one line' },
  ],
  added: [{ id: 'new:map', label: 'Repo map', column: 'harness', present: false }],
  steps: [],
  unfit: [],
};

describe('repo graph', () => {
  it('draws present nodes, plus the slots and new nodes a proposal adds', () => {
    expect(graphNodes(skeleton, null).map((n) => n.id)).toEqual(['h:agents-md', 'c:src/app', 'c:src/shared']);
    expect(graphNodes(skeleton, proposal).map((n) => n.id)).toEqual([
      'h:agents-md',
      'h:skills',
      'new:map',
      'c:src/app',
      'c:src/shared',
    ]);
  });

  it('Now and After share one layout; Now hides what is added', () => {
    const layout = layoutGraph(graphNodes(skeleton, proposal));
    const pos = Object.fromEntries(layout.nodes.map((p) => [p.node.id, [p.x, p.y]]));
    expect(pos['c:src/app'][0]).toBeGreaterThan(pos['h:agents-md'][0] + NODE_W);
    const now = layout.nodes.filter((p) => visibleIn('now', p.node)).map((p) => p.node.id);
    const after = layout.nodes.filter((p) => visibleIn('after', p.node)).map((p) => p.node.id);
    expect(now).toEqual(['h:agents-md', 'c:src/app', 'c:src/shared']);
    expect(after).toHaveLength(5);
    expect(marksOf(proposal).get('h:agents-md')).toBe('change');
    expect(visibleEdges(skeleton.edges, new Set(now))).toHaveLength(1);
    expect(visibleEdges(skeleton.edges, new Set(['c:src/app']))).toHaveLength(0);
  });

  it('splits code into columns and sizes the canvas', () => {
    const many = Array.from({ length: ROWS_PER_COLUMN + 2 }, (_, i) => c(`d${i}`));
    const layout = layoutGraph([h('a'), ...many]);
    const xs = new Set(layout.nodes.filter((p) => p.node.column === 'code').map((p) => p.x));
    expect(xs.size).toBe(2);
    const right = Math.max(...layout.nodes.map((p) => p.x + NODE_W));
    expect(layout.width).toBeGreaterThan(right);
    for (const p of layout.nodes) expect([p.x % 4, p.y % 4]).toEqual([0, 0]);
  });

  it('edges: across columns edge to edge, a loop within one', () => {
    const a = { node: c('a'), x: 8, y: 32 };
    const b = { node: c('b'), x: 216, y: 76 };
    expect(edgePath(a, b)).toMatch(/^M160 50 C/);
    expect(edgePath(b, a)).toMatch(/^M160 50 C/);
    expect(edgePath(a, { ...a, y: 120 })).toMatch(/^M160 50 C\d+/);
  });

  it('cuts long labels', () => {
    expect(fit('a'.repeat(30))).toHaveLength(20);
    expect(fit('short')).toBe('short');
  });
});
