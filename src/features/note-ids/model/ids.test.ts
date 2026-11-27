import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/shared/api';
import { checklist, definesOf, idIndex, idIssues, idsWithNoWork, markable, referencedIn } from './ids';

const note = (id: string, label: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind: 'note',
  label,
  path: `/v/${label}.md`,
  ...extra,
});
const node = (id: string, kind: GraphNode['kind'], label = id): GraphNode => ({ id, kind, label });
const edge = (source: string, target: string): GraphEdge => ({
  id: `${source}→${target}`,
  source,
  target,
  kind: 'action',
  strength: 1,
  reasons: [],
});

describe('definesOf', () => {
  it('frontmatter id, file name or title starting with the ID; not a longer number', () => {
    expect(definesOf(note('a', 'Login', { fmId: 'FE-REQ-030' }))).toEqual(['FE-REQ-030']);
    expect(definesOf(note('b', 'x', { path: '/v/SRV-REQ-040-auth.md' }))).toEqual(['SRV-REQ-040']);
    expect(definesOf(note('c', 'DB-6891 index'))).toEqual(['DB-6891']);
    expect(definesOf(note('d', 'about DB-6891'))).toEqual([]);
    expect(definesOf(note('e', 'DB-6891a'))).toEqual([]);
    expect(definesOf(node('s', 'session', 'FE-REQ-030 work'))).toEqual([]);
  });
});

describe('idIndex', () => {
  const nodes: GraphNode[] = [
    note('n:spec', 'Login spec', { fmId: 'FE-REQ-030', status: 'draft', refIds: ['FE-REQ-030', 'DB-12'] }),
    note('n:a', 'Sprint notes', { refIds: ['FE-REQ-030', 'FE-REQ-099', 'JIRA-7'] }),
    note('n:b', 'Retro', { refIds: ['FE-REQ-030', 'JIRA-7'] }),
    note('n:dup1', 'SRV-REQ-040 auth'),
    note('n:dup2', 'SRV-REQ-040 auth copy'),
    note('n:idle', 'FE-REQ-031 export'),
    node('s:1', 'session', 'login work'),
    node('s:2', 'session', 'fix FE-REQ-030 bug'),
    node('f:1', 'file', 'src/login.ts'),
    node('f:2', 'file', 'src/auth.ts'),
  ];
  const edges = [edge('n:spec', 's:1'), edge('s:1', 'f:1'), edge('s:2', 'f:2'), edge('n:a', 's:2')];
  const ix = idIndex(nodes, edges);

  it('is memoized per nodes array', () => {
    expect(idIndex(nodes, edges)).toBe(ix);
  });

  it('defined: the defining note, mentions, sessions (edge or title) and their files', () => {
    const i = ix.info('FE-REQ-030');
    expect(i.state).toBe('defined');
    expect(i.defs.map((n) => n.id)).toEqual(['n:spec']);
    expect(i.notes.map((n) => n.id)).toEqual(['n:a', 'n:b']);
    expect(i.sessions.map((n) => n.id).sort()).toEqual(['s:1', 's:2']);
    expect(i.files.map((n) => n.id).sort()).toEqual(['f:1', 'f:2']);
  });

  it('duplicate, unknown (prefix defined elsewhere) and loose (prefix nobody defines)', () => {
    expect(ix.info('SRV-REQ-040').state).toBe('duplicate');
    expect(ix.info('SRV-REQ-040').defs).toHaveLength(2);
    expect(ix.info('FE-REQ-099').state).toBe('unknown');
    expect(ix.info('JIRA-7').state).toBe('loose');
  });

  it('marks only prefixes the index knows', () => {
    expect(markable(ix, 'FE-REQ-123')).toBe(true);
    expect(markable(ix, 'JIRA-7')).toBe(true); // in 2 notes
    expect(markable(ix, 'DB-12')).toBe(false); // once, nobody defines DB-
    expect(markable(ix, 'COVID-19')).toBe(false);
  });

  it('lenses: requirement notes with no work, duplicate / unknown IDs', () => {
    expect([...idsWithNoWork(ix)].sort()).toEqual(['n:dup1', 'n:dup2', 'n:idle']);
    expect([...idIssues(ix)].sort()).toEqual(['n:a', 'n:dup1', 'n:dup2']);
  });

  it('referencedIn merges the note’s own IDs', () => {
    const r = referencedIn(ix, 'n:spec');
    expect(r.ids).toEqual(['FE-REQ-030']);
    expect(r.notes.map((n) => n.label)).toEqual(['Retro', 'Sprint notes']);
    expect(r.sessions).toHaveLength(2);
    expect(r.files).toHaveLength(2);
    expect(r.duplicates).toEqual([]);
    expect(referencedIn(ix, 'n:dup1').duplicates.map((n) => n.id)).toEqual(['n:dup2']);
    expect(referencedIn(ix, 'n:b').ids).toEqual([]);
  });
});

describe('checklist', () => {
  it('counts done / total task items, skipping fenced code', () => {
    const text = [
      '- [x] one',
      '- [ ] two',
      '  * [X] nested',
      '1. [ ] numbered',
      '```',
      '- [x] in code',
      '```',
      '- not a task',
    ].join('\r\n');
    expect(checklist(text)).toEqual({ done: 2, total: 4 });
    expect(checklist('')).toEqual({ done: 0, total: 0 });
  });
});
