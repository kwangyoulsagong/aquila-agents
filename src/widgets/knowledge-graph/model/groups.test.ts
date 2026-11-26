import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/shared/api';
import {
  HERE,
  LABEL_ROOM,
  MAP_MAX,
  MAX_GROUPS,
  MORE,
  bubbleLayout,
  crumbStops,
  groupLevel,
  groupPath,
  mapView,
  unionKey,
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
  it('notes go by folder inside their project, whichever source indexed them', () => {
    const n = note('specs/a.md', {
      id: 'note:requirements:specs/a.md',
      sourceId: 'requirements',
      path: '/Users/me/Desktop/SALT/requirements/specs/a.md',
    });
    const c = { ...ctx, projects, multiSource: true };
    expect(groupPath(n, c).map((s) => s.key)).toEqual(['dir:requirements', 'dir:specs']);
    expect(groupPath(n, { ...c, multiProject: true }).map((s) => s.key)).toEqual([
      'project:salt',
      'dir:requirements',
      'dir:specs',
    ]);
    const loose = note('README.md', { path: '/Users/me/Desktop/SALT/README.md' });
    expect(groupPath(loose, c).map((s) => s.key)).toEqual(['project:salt']);
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

  it('a skipped single-group level is no stop for crumbs or Back', () => {
    const big = many('only/deep', MAP_MAX + 5).concat(many('only/deeper/x', 5));
    const v: GraphView = { nodes: big, edges: [] };
    const p = pathsOf(v);
    // Opened at the top, the map is already in `only`: nothing to go back to.
    expect(crumbStops(v, p, ['dir:only'])).toEqual([1]);
    // One level further in: Back goes to `only` (1), never to 0 (which opens `only` again).
    expect(crumbStops(v, p, ['dir:only', 'dir:deep'])).toEqual([1, 2]);
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

  it('several groups of one level open together as dots', () => {
    const both = groupLevel(view, paths, [unionKey(['dir:specs', 'kind:session'])]);
    expect(both.kind).toBe('map');
    expect(both.kind === 'map' && both.ids.size).toBe(31);
    expect(both.at).toEqual([unionKey(['dir:specs', 'kind:session'])]);
  });

  it('big groups opened together merge their sub-folders by name', () => {
    const v: GraphView = {
      nodes: [
        ...many('server/requirements', 50),
        ...many('front/requirements', 40),
        ...many('front/docs', 20),
      ],
      edges: [],
    };
    const both = groupLevel(v, pathsOf(v), [unionKey(['dir:server', 'dir:front'])]);
    expect(both.kind === 'groups' && both.items.map((i) => [i.key, i.ids.length])).toEqual([
      ['dir:requirements', 90],
      ['dir:docs', 20],
    ]);
    const req = groupLevel(v, pathsOf(v), [unionKey(['dir:server', 'dir:front']), 'dir:requirements']);
    expect(req.kind === 'map' && req.ids.size).toBe(90);
  });

  it('a path the filters emptied stops where it still holds', () => {
    expect(groupLevel(view, paths, ['dir:gone', 'dir:x']).at).toEqual([]);
  });

  it('a small graph is dots right away', () => {
    const v: GraphView = { nodes: many('x', 5), edges: [] };
    expect(groupLevel(v, pathsOf(v), []).kind).toBe('map');
  });
});

describe('groupLevel: a big folder with no sub-folders (T75)', () => {
  // 70 notes in one folder: two linked sets with their own words, a few loose ones.
  const titled = (rel: string, label: string) => note(rel, { label });
  const pay = Array.from({ length: 35 }, (_, i) => titled(`flat/p${i}.md`, `결제 쿠폰 ${i}`));
  const auth = Array.from({ length: 32 }, (_, i) => titled(`flat/a${i}.md`, `login token ${i}`));
  const loose = Array.from({ length: 3 }, (_, i) => titled(`flat/x${i}.md`, `idea ${i}`));
  const chain = (ns: GraphNode[]) => ns.slice(1).map((n, i) => edge(ns[i]!.id, n.id));
  const v: GraphView = { nodes: [...pay, ...auth, ...loose], edges: [...chain(pay), ...chain(auth)] };
  const p = pathsOf(v);

  it('is split by links and title words, named by them', () => {
    const level = groupLevel(v, p, []);
    expect(level.at).toEqual(['dir:flat']);
    if (level.kind !== 'groups') throw new Error('groups expected');
    // The loose ones link to nothing but share a word: a group of their own.
    expect(level.items.map((i) => i.key)).toEqual(['topic:결제·쿠폰', 'topic:login·token', 'topic:idea']);
  });

  it('a topic opens into its dots; crumbs / Back still work', () => {
    const level = groupLevel(v, p, ['dir:flat', 'topic:결제·쿠폰']);
    expect(level.kind === 'map' && level.ids.size).toBe(35);
    expect(crumbStops(v, p, level.at)).toEqual([1, 2]);
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
  it('many groups in a narrow box: no two bubbles overlap', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`g${i}`, 100 - i * 7));
    for (const [w, h] of [
      [360, 600],
      [990, 860],
    ] as const) {
      const boxes = bubbleLayout(items, [], w, h, { min: 24, max: 51, pad: 24 });
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          // Apart, with room for the name under the upper one when they stack.
          const stacked = Math.abs(a.y - b.y) > Math.abs(a.x - b.x);
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
            a.r + b.r + (stacked ? LABEL_ROOM : 0) - 1,
          );
        }
    }
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
