import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '../../src/shared/api/types';
import { buildGraph, idGroups, noteId, type CodeName, type IndexedNote } from './build';
import { parseNote } from './parse';

const note = (sourceId: string, rel: string, src: string): IndexedNote => ({
  sourceId,
  rel,
  abs: `/${sourceId}/${rel}`,
  mtime: 1,
  size: src.length,
  note: parseNote(rel.split('/').pop()!, src),
});

const edge = (g: GraphSnapshot, a: string, b: string) =>
  g.edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));

describe('buildGraph', () => {
  it('resolves [[Name]], folder/Name, relative links; unknown targets become missing nodes', () => {
    const g = buildGraph(
      [
        note('s', 'a.md', 'See [[Beta]], [[deep/Gamma#Plan]], [x](sub/beta.md) and [[Nowhere]].'),
        note('s', 'sub/beta.md', '# Beta'),
        note('s', 'deep/Gamma.md', 'text'),
      ],
      new Map(),
    );
    const a = noteId('s', 'a.md');
    expect(edge(g, a, noteId('s', 'sub/beta.md'))).toMatchObject({
      kind: 'explicit',
      strength: 1,
      source: a,
    });
    expect(edge(g, a, noteId('s', 'deep/Gamma.md'))?.reasons).toContainEqual({ via: 'link', label: 'Plan' });
    expect(g.nodes.find((n) => n.id === 'missing:nowhere')).toMatchObject({
      kind: 'missing',
      label: 'Nowhere',
    });
  });

  it('prefers a note of the same source when names clash', () => {
    const g = buildGraph(
      [note('a', 'x.md', '[[Spec]]'), note('a', 'Spec.md', ''), note('b', 'Spec.md', '')],
      new Map(),
    );
    expect(edge(g, noteId('a', 'x.md'), noteId('a', 'Spec.md'))).toBeDefined();
    expect(edge(g, noteId('a', 'x.md'), noteId('b', 'Spec.md'))).toBeUndefined();
  });

  it('tags become shared tag nodes; frontmatter values that name a note are explicit', () => {
    const g = buildGraph(
      [
        note('s', 'a.md', '---\nspec: Login\n---\n#auth'),
        note('s', 'b.md', '#Auth'),
        note('s', 'login.md', ''),
      ],
      new Map(),
    );
    expect(edge(g, noteId('s', 'a.md'), 'tag:auth')?.kind).toBe('explicit');
    expect(edge(g, noteId('s', 'b.md'), 'tag:auth')).toBeDefined();
    expect(edge(g, noteId('s', 'a.md'), noteId('s', 'login.md'))).toMatchObject({
      kind: 'explicit',
      reasons: [{ via: 'frontmatter', label: 'spec' }],
    });
  });

  it('finds another note by title: whole words in English, with particles in Korean', () => {
    const g = buildGraph(
      [
        note('s', 'roadmap.md', '# Release Plan'),
        note('s', 'b.md', 'We follow the release plan. Not: release planner.'),
        note('s', 'c.md', 'Our release planning is late.'),
        note('s', '주간 회의.md', '# 주간 회의'),
        note('s', 'd.md', '지난 주간 회의에서 정했어요'),
        note('s', 'readme.md', '# README'),
        note('s', 'e.md', 'see the readme'),
      ],
      new Map(),
    );
    expect(edge(g, noteId('s', 'b.md'), noteId('s', 'roadmap.md'))).toMatchObject({
      kind: 'mention',
      reasons: [{ via: 'title', label: 'Release Plan' }],
    });
    expect(edge(g, noteId('s', 'c.md'), noteId('s', 'roadmap.md'))).toBeUndefined();
    expect(edge(g, noteId('s', 'd.md'), noteId('s', '주간 회의.md'))).toBeDefined();
    expect(edge(g, noteId('s', 'e.md'), noteId('s', 'readme.md'))).toBeUndefined();
  });

  it('a repeated ID or URL links the notes; one in too many notes is noise', () => {
    const many = Array.from({ length: 21 }, (_, i) => note('s', `n${i}.md`, 'footer OPS-1'));
    const g = buildGraph(
      [
        note('s', 'a.md', 'DB-12 https://x.com/a'),
        note('s', 'b.md', 'about DB-12'),
        note('s', 'c.md', 'https://x.com/a/'),
        ...many,
      ],
      new Map(),
    );
    expect(edge(g, noteId('s', 'a.md'), noteId('s', 'b.md'))?.reasons).toEqual([
      { via: 'id', label: 'DB-12' },
    ]);
    expect(edge(g, noteId('s', 'a.md'), noteId('s', 'c.md'))?.reasons).toEqual([
      { via: 'url', label: 'https://x.com/a' },
    ]);
    expect(g.edges.some((e) => e.reasons.some((r) => r.label === 'OPS-1'))).toBe(false);
  });

  it('code names that exist in a project become code nodes', () => {
    const code = new Map<string, CodeName>([
      ['useWorkspace', { path: '/p/useWorkspace.ts', projects: ['p'] }],
    ]);
    const g = buildGraph([note('s', 'a.md', 'the `useWorkspace` hook, not useNothing')], code);
    expect(g.nodes.find((n) => n.kind === 'code')).toMatchObject({
      id: 'code:useWorkspace',
      projects: ['p'],
    });
    expect(g.nodes.some((n) => n.label === 'useNothing')).toBe(false);
    expect(edge(g, noteId('s', 'a.md'), 'code:useWorkspace')?.kind).toBe('mention');
  });

  it('one edge per pair: the strongest kind wins and a written link sets the direction', () => {
    const g = buildGraph(
      [note('s', 'b.md', '# Beta Notes\nDB-1'), note('s', 'a.md', 'DB-1 [[b]]')],
      new Map(),
    );
    const e = g.edges.filter((x) => x.source.startsWith('note:') && x.target.startsWith('note:'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: 'explicit', source: noteId('s', 'a.md'), strength: 1 });
    expect(e[0].reasons.map((r) => r.via).sort()).toEqual(['id', 'link']);
  });
});

describe('idGroups', () => {
  it('groups IDs seen in 2+ notes by prefix, most notes first', () => {
    const groups = idGroups(
      new Map([
        ['DB-1', ['a', 'b']],
        ['DB-2', ['b', 'c', 'd']],
        ['DB-3', ['a']],
        ['FE-9', ['a', 'b']],
      ]),
    );
    expect(groups).toEqual([
      { prefix: 'DB', ids: ['DB-2', 'DB-1'], notes: 4 },
      { prefix: 'FE', ids: ['FE-9'], notes: 2 },
    ]);
  });
});
