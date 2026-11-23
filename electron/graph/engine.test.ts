import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '../../src/shared/api/types';
import type { CodeName } from './build';
import { GraphEngine, walkMarkdown, type EngineStatus } from './engine';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'graph');
const tmp: string[] = [];
const mkTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-graph-'));
  tmp.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const CODE = new Map<string, CodeName>([
  ['useWorkspace', { path: '/p/src/pages/workspace/model/useWorkspace.ts', projects: ['aquila'] }],
  ['planRestore', { path: '/p/electron/state.ts', projects: ['aquila'] }],
]);
const codeNames = async () => new Map(CODE);

/** Connected components over all edges. */
function connected(g: GraphSnapshot, a: string, b: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of g.edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }
  const seen = new Set([a]);
  const queue = [a];
  while (queue.length)
    for (const n of adj.get(queue.shift()!) ?? [])
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
  return seen.has(b);
}

describe('GraphEngine', () => {
  it('three notes in different folders and formats connect through a shared ID and a code name (T65 done)', async () => {
    const engine = new GraphEngine({ watch: false, codeNames });
    await engine.setSources(
      ['meetings', 'specs', 'memos'].map((id) => ({ id, root: path.join(FIXTURES, id) })),
      [{ id: 'aquila', root: '/p' }],
    );
    await engine.idle();
    const g = engine.snapshot();
    const meeting = 'note:meetings:2026-11-20 주간 싱크.md';
    const spec = 'note:specs:session-restore.md';
    const memo = 'note:memos:refactor ideas.md';
    expect(g.nodes.filter((n) => n.kind === 'note').map((n) => n.label)).toEqual(
      expect.arrayContaining(['2026-11-20 주간 싱크', 'Session restore', 'Refactor ideas']),
    );
    // No links are written in any of them.
    expect(g.edges.some((e) => e.reasons.some((r) => r.via === 'link'))).toBe(false);
    const byId = g.edges.find((e) => [e.source, e.target].sort().join() === [meeting, spec].sort().join());
    expect(byId?.reasons).toContainEqual({ via: 'id', label: 'DB-12' });
    expect(g.edges.find((e) => e.source === memo && e.target === 'code:planRestore')).toBeDefined();
    expect(g.edges.find((e) => e.source === spec && e.target === 'code:planRestore')).toBeDefined();
    expect(connected(g, meeting, memo)).toBe(true);
    expect(g.idGroups).toEqual([{ prefix: 'DB', ids: ['DB-12'], notes: 2 }]);
    expect(engine.status().sources.every((s) => s.state === 'ready' && s.notes === 1)).toBe(true);
  });

  it('re-reads changed files only, forgets deleted ones, and never writes to the source', async () => {
    const root = mkTmp();
    fs.writeFileSync(path.join(root, 'a.md'), '# A\nDB-1');
    fs.writeFileSync(path.join(root, 'b.md'), '# B');
    const statuses: EngineStatus[] = [];
    const engine = new GraphEngine({ watch: false, codeNames, onStatus: (s) => statuses.push(s) });
    await engine.setSources([{ id: 's', root }]);
    await engine.idle();
    expect(engine.snapshot().edges).toHaveLength(0);
    const before = fs.readdirSync(root).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]);

    fs.writeFileSync(path.join(root, 'b.md'), '# B\nsee DB-1 here');
    const v = engine.status().version;
    await engine.refresh('s', ['b.md']);
    expect(engine.status().version).toBe(v + 1);
    expect(engine.snapshot().edges).toHaveLength(1);
    await engine.refresh('s', ['a.md']); // unchanged: no new version
    expect(engine.status().version).toBe(v + 1);

    fs.rmSync(path.join(root, 'a.md'));
    await engine.refresh('s', ['a.md']);
    expect(engine.status().notes).toBe(1);
    expect(fs.readdirSync(root)).toEqual(['b.md']);
    expect(before.find(([f]) => f === 'b.md')).toBeDefined();
    engine.close();
  });

  it('keeps the index on disk and only re-parses what changed while closed', async () => {
    const root = mkTmp();
    const indexFile = path.join(mkTmp(), 'graph', 'index.json');
    fs.writeFileSync(path.join(root, 'a.md'), '# A');
    fs.writeFileSync(path.join(root, 'b.md'), '# B');
    const first = new GraphEngine({ watch: false, codeNames, indexFile });
    await first.setSources([{ id: 's', root }]);
    await first.idle();
    first.close(); // flushes the pending save
    expect(JSON.parse(fs.readFileSync(indexFile, 'utf8')).notes).toHaveLength(2);

    fs.writeFileSync(path.join(root, 'c.md'), '# C');
    fs.rmSync(path.join(root, 'a.md'));
    const second = new GraphEngine({ watch: false, codeNames, indexFile });
    await second.setSources([{ id: 's', root }]);
    await second.idle();
    expect(
      second
        .snapshot()
        .nodes.map((n) => n.label)
        .sort(),
    ).toEqual(['B', 'C']);
    second.close();
  });

  it('pauses a large first index in power saver until "Index now"', async () => {
    const root = mkTmp();
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(root, `n${i}.md`), `# N${i}`);
    const engine = new GraphEngine({ watch: false, codeNames, saver: true, largeSource: 5, batch: 2 });
    await engine.setSources([{ id: 's', root }]);
    await engine.idle();
    expect(engine.status().sources[0]).toMatchObject({ state: 'paused', notes: 0, total: 6 });
    engine.indexNow('s');
    await engine.idle();
    expect(engine.status().sources[0]).toMatchObject({ state: 'ready', notes: 6 });
  });

  it('dropping a source drops its notes; a missing folder is reported', async () => {
    const root = mkTmp();
    fs.writeFileSync(path.join(root, 'a.md'), '# A');
    const engine = new GraphEngine({ watch: false, codeNames });
    await engine.setSources([
      { id: 's', root },
      { id: 'gone', root: path.join(root, 'nope') },
    ]);
    await engine.idle();
    expect(engine.status().sources.find((s) => s.id === 'gone')?.state).toBe('missing');
    await engine.setSources([]);
    expect(engine.status()).toMatchObject({ notes: 0, sources: [] });
  });
});

describe('walkMarkdown', () => {
  it('skips hidden and build folders', async () => {
    const root = mkTmp();
    for (const d of ['a', '.obsidian', 'node_modules/x', 'dist'])
      fs.mkdirSync(path.join(root, d), { recursive: true });
    for (const f of ['top.md', 'a/in.MD', 'a/no.txt', '.obsidian/w.md', 'node_modules/x/r.md', 'dist/d.md'])
      fs.writeFileSync(path.join(root, f), '');
    expect((await walkMarkdown(root)).sort()).toEqual(['a/in.MD', 'top.md']);
  });
});
