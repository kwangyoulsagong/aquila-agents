import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, GraphSnapshot } from '@/shared/api';
import {
  DEFAULT_FILTER,
  filterSnapshot,
  kindsOf,
  lineStyle,
  localView,
  neighbourhood,
  searchMatches,
  tagsOf,
} from './view';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const note = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id: `note:s1:${id}.md`,
  kind: 'note',
  label: id,
  sourceId: 's1',
  mtime: NOW,
  ...extra,
});
const edge = (a: string, b: string, kind: GraphEdge['kind'] = 'explicit', strength = 1): GraphEdge => ({
  id: `${a}→${b}`,
  source: a,
  target: b,
  kind,
  strength,
  reasons: [],
});

const a = note('meeting', { tags: ['db'] });
const b = note('spec', { sourceId: 's2', id: 'note:s2:spec.md', mtime: NOW - 40 * DAY });
const c = note('memo');
const tag: GraphNode = { id: 'tag:db', kind: 'tag', label: 'db' };
const code: GraphNode = { id: 'code:restore.ts', kind: 'code', label: 'restore.ts' };
const snap: GraphSnapshot = {
  nodes: [a, b, c, tag, code],
  edges: [
    edge(a.id, b.id, 'mention', 0.6),
    edge(a.id, tag.id),
    edge(b.id, code.id, 'mention', 0.5),
    edge(c.id, a.id, 'suggested', 0.3),
  ],
  idGroups: [],
  version: 1,
};

describe('filterSnapshot', () => {
  it('keeps everything by default', () => {
    const v = filterSnapshot(snap, DEFAULT_FILTER, NOW);
    expect(v.nodes).toHaveLength(5);
    expect(v.edges).toHaveLength(4);
  });

  it('drops the non-notes only a filtered-out note linked to', () => {
    const v = filterSnapshot(snap, { ...DEFAULT_FILTER, sources: ['s1'] }, NOW);
    expect(v.nodes.map((n) => n.id).sort()).toEqual([a.id, c.id, tag.id].sort());
  });

  it('filters by time, tag and strength', () => {
    expect(
      filterSnapshot(snap, { ...DEFAULT_FILTER, time: '30d' }, NOW).nodes.map((n) => n.id),
    ).not.toContain(b.id);
    const tagged = filterSnapshot(snap, { ...DEFAULT_FILTER, tag: 'db' }, NOW);
    expect(tagged.nodes.map((n) => n.id).sort()).toEqual([a.id, tag.id].sort());
    const strong = filterSnapshot(snap, { ...DEFAULT_FILTER, minStrength: 0.55 }, NOW);
    expect(strong.edges.map((e) => e.kind).sort()).toEqual(['explicit', 'mention']);
    expect(strong.nodes.map((n) => n.id)).not.toContain(code.id);
  });

  it('hides a kind', () => {
    const v = filterSnapshot(snap, { ...DEFAULT_FILTER, hiddenKinds: ['tag'] }, NOW);
    expect(v.nodes.map((n) => n.kind)).not.toContain('tag');
    expect(v.edges.every((e) => e.target !== tag.id)).toBe(true);
  });
});

describe('local view', () => {
  it('walks links both ways to the given depth', () => {
    expect([...neighbourhood(snap.edges, c.id, 1)].sort()).toEqual([a.id, c.id].sort());
    expect(neighbourhood(snap.edges, c.id, 2).size).toBe(4);
    const v = localView(filterSnapshot(snap, DEFAULT_FILTER, NOW), b.id, 1);
    expect(v.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id, code.id].sort());
    expect(v.edges).toHaveLength(2);
  });

  it('shows the whole view when the center is gone', () => {
    const v = filterSnapshot(snap, DEFAULT_FILTER, NOW);
    expect(localView(v, 'note:s9:nope.md', 2)).toBe(v);
  });
});

describe('helpers', () => {
  it('maps edge kinds to line styles', () => {
    expect(
      ['explicit', 'action', 'mention', 'suggested'].map((k) => lineStyle(k as GraphEdge['kind'])),
    ).toEqual(['solid', 'solid', 'dashed', 'dotted']);
  });

  it('searches every word in label and path', () => {
    expect([...searchMatches(snap.nodes, 'MEET')]).toEqual([a.id]);
    expect(searchMatches(snap.nodes, '  ').size).toBe(0);
    expect(searchMatches(snap.nodes, 'meet spec').size).toBe(0);
  });

  it('lists tags and kinds', () => {
    expect(tagsOf(snap.nodes)).toEqual(['db']);
    expect(kindsOf(snap.nodes)).toEqual(['note', 'tag', 'code']);
  });
});

describe('app nodes (T70)', () => {
  const session: GraphNode = { id: 'session:claude:s', kind: 'session', label: 's' };
  const file: GraphNode = { id: 'file:/r/a.ts', kind: 'file', label: 'a.ts' };
  const trend: GraphNode = { id: 'trend:t', kind: 'trend', label: 't' };
  const apply: GraphNode = { id: 'apply:x', kind: 'apply', label: 'x' };
  const orphan: GraphNode = { id: 'session:claude:o', kind: 'session', label: 'o' };
  const orphanFile: GraphNode = { id: 'file:/r/o.ts', kind: 'file', label: 'o.ts' };
  const app: GraphSnapshot = {
    nodes: [a, session, file, trend, apply, orphan, orphanFile],
    edges: [
      edge(a.id, session.id, 'action'),
      edge(session.id, file.id, 'action'),
      edge(trend.id, apply.id, 'action'),
      edge(orphan.id, orphanFile.id, 'action'),
    ],
    idGroups: [],
    version: 1,
  };

  it('keeps note → session → file, and trend → apply; drops what reaches neither', () => {
    const v = filterSnapshot(app, DEFAULT_FILTER, NOW);
    expect(v.nodes.map((n) => n.id).sort()).toEqual([a.id, apply.id, file.id, session.id, trend.id].sort());
    expect(v.edges).toHaveLength(3);
  });

  it('hiding sessions cuts the path to their files', () => {
    const v = filterSnapshot(app, { ...DEFAULT_FILTER, hiddenKinds: ['session'] }, NOW);
    expect(v.nodes.some((n) => n.kind === 'file')).toBe(false);
  });
});
