import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/shared/api';
import {
  HERE,
  MAP_MAX,
  MAX_GROUPS,
  MORE,
  bubbleLayout,
  groupLevel,
  groupPath,
  mapView,
  ruleMatches,
  type GroupContext,
  type GroupSeg,
} from './groups';
import type { GraphView } from './view';

const note = (rel: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id: `note:s1:${rel}`,
  kind: 'note',
  label: rel.split('/').pop()!.replace(/\.md$/, ''),
  sourceId: 's1',
  ...extra,
});
const edge = (a: string, b: string): GraphEdge => ({
  id: `${a}→${b}`,
  source: a,
  target: b,
  kind: 'explicit',
  strength: 1,
  reasons: [],
});
const ctx: GroupContext = { rules: [], sourceName: () => 'requirements', multiSource: false };
const pathsOf = (view: GraphView, c = ctx) => new Map(view.nodes.map((n) => [n.id, groupPath(n, c)]));
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => note(`${prefix}/n${i}.md`));

describe('groupPath', () => {
  it('puts notes in their folders and the rest by kind', () => {
    expect(groupPath(note('reports/retrospects/a.md'), ctx).map((s) => s.key)).toEqual([
      'dir:reports',
      'dir:retrospects',
    ]);
    expect(groupPath({ id: 'session:claude:1', kind: 'session', label: 's' }, ctx)).toEqual([
      { key: 'kind:session', label: 'session', kind: 'session' },
    ]);
  });

  it('names loose notes after their source, and groups by source when there are several', () => {
    expect(groupPath(note('README.md'), ctx)).toEqual([{ key: 'src:s1', label: 'requirements' }]);
    const multi = { ...ctx, multiSource: true };
    expect(groupPath(note('specs/a.md'), multi).map((s) => s.key)).toEqual(['src:s1', 'dir:specs']);
  });

  it('a matching rule comes first, the first rule wins', () => {
    const rules = [
      { id: 'r1', name: 'Auth', query: 'tag:auth' },
      { id: 'r2', name: 'Specs', query: 'path:specs' },
    ];
    const n = note('specs/done/a.md', { tags: ['auth'] });
    expect(groupPath(n, { ...ctx, rules }).map((s) => s.key)).toEqual(['rule:r1', 'dir:specs', 'dir:done']);
  });
});

describe('groupPath: code and files', () => {
  const projects = [
    { id: 'home', name: 'Home', path: '~' },
    { id: 'salt', name: 'SALT', path: '~/Desktop/SALT' },
  ];
  const code: GraphNode = {
    id: 'code:AssetType',
    kind: 'code',
    label: 'AssetType',
    path: '/Users/me/Desktop/SALT/salt-server/src/shared/AssetType.ts',
    projects: ['salt'],
  };
  it('go by folder inside the most specific project', () => {
    expect(groupPath(code, { ...ctx, projects }).map((s) => s.key)).toEqual([
      'kind:code',
      'dir:salt-server',
      'dir:src',
      'dir:shared',
    ]);
  });
  it('go by project first when several are in view', () => {
    expect(groupPath(code, { ...ctx, projects, multiProject: true }).map((s) => s.key)).toEqual([
      'kind:code',
      'project:salt',
      'dir:salt-server',
      'dir:src',
      'dir:shared',
    ]);
  });
  it('stay in their kind group outside every project', () => {
    expect(groupPath({ ...code, path: '/opt/x.ts', projects: [] }, { ...ctx, projects })).toHaveLength(1);
  });
});

describe('ruleMatches', () => {
  const n = note('specs/done/login.md', { tags: ['auth'] });
  it('needs every term', () => {
    expect(ruleMatches(n, 'path:specs tag:#auth')).toBe(true);
    expect(ruleMatches(n, 'path:specs tag:db')).toBe(false);
    expect(ruleMatches(n, 'login')).toBe(true);
    expect(ruleMatches(n, 'kind:session')).toBe(false);
    expect(ruleMatches(n, '  ')).toBe(false);
  });
});

describe('groupLevel', () => {
  const reports = [...many('reports/retrospects', 40), ...many('reports/checklists', 40)];
  const specs = many('specs/done', 30);
  const session: GraphNode = { id: 'session:claude:1', kind: 'session', label: 's' };
  const view: GraphView = {
    nodes: [...reports, ...specs, session],
    edges: [
      edge(specs[0]!.id, reports[0]!.id),
      edge(specs[1]!.id, reports[1]!.id),
      edge(session.id, specs[0]!.id),
    ],
  };
  const paths = pathsOf(view);

  it('starts with the top folders and kinds, biggest first, with the links between them', () => {
    const level = groupLevel(view, paths, []);
    expect(level.kind).toBe('groups');
    if (level.kind !== 'groups') return;
    expect(level.items.map((i) => [i.key, i.ids.length, i.colour])).toEqual([
      ['dir:reports', 80, 1],
      ['dir:specs', 30, 2],
      ['kind:session', 1, 3],
    ]);
    expect(level.links).toContainEqual({ a: 'dir:reports', b: 'dir:specs', count: 2 });
    expect(level.links).toContainEqual({ a: 'dir:specs', b: 'kind:session', count: 1 });
  });

  it('opens a big folder into its sub-folders, a small one into dots', () => {
    const r = groupLevel(view, paths, ['dir:reports']);
    expect(r.kind === 'groups' && r.items.map((i) => i.key)).toEqual(['dir:checklists', 'dir:retrospects']);
    const s = groupLevel(view, paths, ['dir:specs']);
    expect(s.kind).toBe('map');
    expect(s.kind === 'map' && s.ids.size).toBe(30);
  });

  it('skips a level with a single group', () => {
    const big = many('only/deep', MAP_MAX + 5).concat(many('only/deeper/x', 5));
    const v: GraphView = { nodes: big, edges: [] };
    const level = groupLevel(v, pathsOf(v), []);
    expect(level.at).toEqual(['dir:only']);
    expect(level.kind === 'groups' && level.items.map((i) => i.key)).toEqual(['dir:deep', 'dir:deeper']);
  });

  it('notes directly in a split folder get a group of their own, last', () => {
    const v: GraphView = { nodes: [...many('a/b', MAP_MAX), ...many('a', 3), ...many('c', 1)], edges: [] };
    const level = groupLevel(v, pathsOf(v), ['dir:a']);
    expect(level.kind === 'groups' && level.items.map((i) => i.key)).toEqual(['dir:b', HERE]);
    const here = groupLevel(v, pathsOf(v), ['dir:a', HERE]);
    expect(here.kind === 'map' && here.ids.size).toBe(3);
  });

  it('folds groups past the limit into "N more", which opens into them', () => {
    const nodes = Array.from({ length: MAX_GROUPS + 3 }, (_, i) =>
      many(`f${String(i).padStart(2, '0')}`, 5),
    ).flat();
    const v: GraphView = { nodes, edges: [] };
    const top = groupLevel(v, pathsOf(v), []);
    if (top.kind !== 'groups') throw new Error('groups expected');
    expect(top.items).toHaveLength(MAX_GROUPS);
    expect(top.items.at(-1)).toMatchObject({ key: MORE, folded: 4 });
    const more = groupLevel(v, pathsOf(v), [MORE]);
    expect(more.at).toEqual([MORE]);
    expect(more.kind).toBe('map');
  });

  it('a path the filters emptied stops where it still holds', () => {
    expect(groupLevel(view, paths, ['dir:gone', 'dir:x']).at).toEqual([]);
  });

  it('a small graph is dots right away', () => {
    const v: GraphView = { nodes: many('x', 5), edges: [] };
    expect(groupLevel(v, pathsOf(v), []).kind).toBe('map');
  });
});

describe('mapView', () => {
  const a = note('a/1.md');
  const b = note('b/2.md');
  const c = note('b/3.md');
  const s: GraphNode = { id: 'session:claude:1', kind: 'session', label: 's' };
  const view: GraphView = { nodes: [a, b, c, s], edges: [edge(s.id, a.id), edge(b.id, c.id)] };
  it('keeps members, and their neighbours when asked', () => {
    expect(mapView(view, new Set([s.id]), false).nodes.map((n) => n.id)).toEqual([s.id]);
    const wide = mapView(view, new Set([s.id]), true);
    expect(wide.nodes.map((n) => n.id)).toEqual([a.id, s.id]);
    expect(wide.edges).toHaveLength(1);
  });
});

describe('bubbleLayout', () => {
  const item = (key: string, n: number) => ({
    key,
    seg: { key, label: key } as GroupSeg,
    ids: Array.from({ length: n }, (_, i) => `${key}${i}`),
    colour: 1,
  });
  const opts = { min: 10, max: 40, pad: 20 };
  it('one bubble sits in the middle at full size', () => {
    expect(bubbleLayout([item('a', 9)], [], 400, 300, opts)).toEqual([{ key: 'a', x: 200, y: 150, r: 40 }]);
  });
  it('puts the most linked group next to the previous one, inside the box', () => {
    const items = [item('a', 50), item('b', 10), item('c', 10)];
    const boxes = bubbleLayout(items, [{ a: 'a', b: 'c', count: 9 }], 400, 300, opts);
    expect(boxes.map((b) => b.key)).toEqual(['a', 'c', 'b']);
    for (const b of boxes) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(0);
      expect(b.x + b.r).toBeLessThanOrEqual(400);
    }
  });
});
