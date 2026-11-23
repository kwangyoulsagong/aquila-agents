import { describe, expect, it } from 'vitest';
import type { ApplyRecord, GraphNode, HistoryEntry } from '../../src/shared/api/types';
import type { SessionWork } from '../history';
import {
  AppNodes,
  MAX_FILES_PER_SESSION,
  appGraph,
  resolveIn,
  sessionLabel,
  type AppData,
} from './app-nodes';

const HOME = '/Users/me';
const NOTE = 'note:notes:specs/DB-12 login.md';
const index: GraphNode[] = [
  {
    id: NOTE,
    kind: 'note',
    label: 'DB-12 login',
    path: '/Users/me/notes/specs/DB-12 login.md',
    sourceId: 'notes',
  },
  {
    id: 'note:notes:memo.md',
    kind: 'note',
    label: 'memo',
    path: '/Users/me/notes/memo.md',
    sourceId: 'notes',
  },
  { id: 'code:LoginForm.tsx', kind: 'code', label: 'LoginForm.tsx' },
];

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  agent: 'claude',
  id: 's1',
  cwd: '/Users/me/app',
  firstMessage: 'Handle this note',
  startedAt: 1,
  updatedAt: 100,
  messages: 4,
  favorite: false,
  projectId: 'app',
  ...over,
});

const work = (over: Partial<HistoryEntry>, files: string[], mentions: string[]): SessionWork => ({
  entry: entry(over),
  files,
  mentions,
});

const record = (over: Partial<ApplyRecord>): ApplyRecord =>
  ({
    id: 'a1',
    projectId: 'app',
    article: {
      itemId: 'gn-1',
      title: 'Graphify',
      url: 'https://news.hada.io/topic?id=1',
      source: 'geeknews',
    },
    createdAt: 10,
    rounds: 1,
    skeleton: { nodes: [], edges: [] },
    proposal: {},
    decision: 'pending',
    ...over,
  }) as ApplyRecord;

const data = (over: Partial<AppData>): AppData => ({
  sessions: [],
  applies: [],
  projects: [{ id: 'app', root: '/Users/me/app' }],
  ...over,
});

const edge = (g: ReturnType<typeof appGraph>, source: string, target: string) =>
  g.edges.find((e) => e.source === source && e.target === target);

describe('appGraph', () => {
  it('a note sent to Claude: solid path note → session → changed file', () => {
    const g = appGraph(
      index,
      data({
        sessions: [
          work(
            {},
            ['/Users/me/app/src/LoginForm.tsx', 'src/api.ts'],
            ['/Users/me/notes/specs/DB-12 login.md'],
          ),
        ],
      }),
      HOME,
    );
    const session = g.nodes.find((n) => n.id === 'session:claude:s1');
    expect(session).toMatchObject({
      kind: 'session',
      label: 'Handle this note',
      projects: ['app'],
      mtime: 100,
    });
    expect(edge(g, NOTE, 'session:claude:s1')).toMatchObject({ kind: 'action', strength: 1 });
    const file = g.nodes.find((n) => n.id === 'file:/Users/me/app/src/LoginForm.tsx');
    expect(file).toMatchObject({ kind: 'file', label: 'src/LoginForm.tsx', projects: ['app'] });
    expect(edge(g, 'session:claude:s1', file!.id)).toMatchObject({
      kind: 'action',
      reasons: [{ via: 'changed' }],
    });
    // A relative path from the transcript is under the session's folder.
    expect(edge(g, 'session:claude:s1', 'file:/Users/me/app/src/api.ts')).toBeDefined();
    // The changed file is the code name a note mentions.
    expect(edge(g, file!.id, 'code:LoginForm.tsx')).toMatchObject({ kind: 'action', strength: 0.7 });
  });

  it('leaves out sessions that touched no note and ran no applied trend', () => {
    const g = appGraph(
      index,
      data({ sessions: [work({}, ['/Users/me/app/x.ts'], ['/elsewhere/a.md'])] }),
      HOME,
    );
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it('a session that edits a note links to it, not to a file node', () => {
    const g = appGraph(
      index,
      data({ sessions: [work({}, ['/Users/me/notes/memo.md'], ['~/notes/specs/DB-12 login.md'])] }),
      HOME,
    );
    expect(edge(g, NOTE, 'session:claude:s1')).toBeDefined();
    expect(edge(g, 'session:claude:s1', 'note:notes:memo.md')).toBeDefined();
    expect(g.nodes.some((n) => n.kind === 'file')).toBe(false);
  });

  it('trends and decisions; an applied one finds its session by worktree branch', () => {
    const g = appGraph(
      index,
      data({
        applies: [
          record({ decision: 'applied', branch: 'trend/graphify-a1', decidedAt: 20 }),
          record({
            id: 'a2',
            decision: 'dropped',
            article: { ...record({}).article, itemId: 'gn-2', title: 'Other' },
          }),
        ],
        sessions: [
          work(
            { id: 's2', branch: 'trend/graphify-a1', cwd: '/Users/me/app-wt' },
            ['/Users/me/app-wt/AGENTS.md'],
            [],
          ),
        ],
      }),
      HOME,
    );
    expect(g.nodes.find((n) => n.id === 'trend:gn-1')).toMatchObject({
      kind: 'trend',
      label: 'Graphify',
      url: 'https://news.hada.io/topic?id=1',
    });
    expect(g.nodes.find((n) => n.id === 'apply:a1')).toMatchObject({
      kind: 'apply',
      label: 'trend/graphify-a1',
    });
    expect(edge(g, 'trend:gn-1', 'apply:a1')).toMatchObject({
      reasons: [{ via: 'apply', label: 'applied' }],
    });
    expect(edge(g, 'trend:gn-2', 'apply:a2')).toMatchObject({
      reasons: [{ via: 'apply', label: 'dropped' }],
    });
    expect(edge(g, 'apply:a1', 'session:claude:s2')).toBeDefined();
    // Outside every project: labelled under the session's folder.
    expect(g.nodes.find((n) => n.id === 'file:/Users/me/app-wt/AGENTS.md')?.label).toBe('AGENTS.md');
  });

  it('caps files per session, skips remote sessions, never duplicates index nodes', () => {
    const files = Array.from({ length: MAX_FILES_PER_SESSION + 10 }, (_, i) => `/Users/me/app/f${i}.ts`);
    const g = appGraph(
      index,
      data({
        sessions: [
          work({}, files, ['/Users/me/notes/memo.md']),
          work({ id: 'r', host: 'box' }, [], ['/Users/me/notes/memo.md']),
        ],
      }),
      HOME,
    );
    expect(g.nodes.filter((n) => n.kind === 'file')).toHaveLength(MAX_FILES_PER_SESSION);
    expect(g.nodes.some((n) => n.id === 'session:claude:r')).toBe(false);
    expect(g.nodes.some((n) => n.kind === 'note')).toBe(false);
  });

  it('labels a session without its pasted @paths', () => {
    expect(sessionLabel('Handle this note. @"/n/a b.md" @/n/c.md')).toBe('Handle this note.');
    expect(sessionLabel('@/n/c.md')).toBe('@/n/c.md');
  });

  it('resolves ~ and relative paths', () => {
    expect(resolveIn('/a/b', '~/x.md', HOME)).toBe('/Users/me/x.md');
    expect(resolveIn('/a/b', '../c.md', HOME)).toBe('/a/c.md');
  });
});

describe('AppNodes', () => {
  it('loads once until invalidated', async () => {
    let loads = 0;
    const nodes = new AppNodes(async () => {
      loads++;
      return data({});
    }, HOME);
    await nodes.graph(index);
    await nodes.graph(index);
    expect(loads).toBe(1);
    nodes.invalidate();
    await nodes.graph(index);
    expect(loads).toBe(2);
  });
});
