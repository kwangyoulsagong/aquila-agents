import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMeta,
  ClaudeParser,
  CodexParser,
  displayTitle,
  HistoryIndex,
  mapCodexRows,
  maskSecrets,
  matchProject,
  mentionsOf,
  patchFiles,
  parseCodexIndex,
  parseMeta,
  parseText,
  readClaudeCommands,
  resumeWorktree,
  snippet,
  toMarkdown,
} from './history';
import type { Config } from '../src/shared/api/types';

const FIXTURES = path.join(__dirname, 'fixtures', 'history');
const CLAUDE_DIR = path.join(FIXTURES, 'claude');
const AUTH = '11111111-1111-4111-8111-111111111111';
const WT = '33333333-3333-4333-8333-333333333333';
const CODEX_A = '01a1ebf4-1ccd-7221-a7f6-a2d6f4af3b20';
const CODEX_ARCHIVED = '01a1ebf4-1ccd-7221-a7f6-a2d6f4af3b21';
const CODEX_DB_ONLY = '01a1ebf4-1ccd-7221-a7f6-a2d6f4af3b22';

const tmp: string[] = [];
afterEach(() => tmp.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-history-'));
  tmp.push(d);
  return d;
};

const lines = (file: string) => fs.readFileSync(file, 'utf8').split('\n');
const identity = (p: string) => p;

const config = (claudeDir = CLAUDE_DIR): Config => ({
  language: 'en',
  accounts: {
    shared: { claudeConfigDir: claudeDir },
    personal: { claudeConfigDir: '/nonexistent/.claude-x' },
  },
  groups: [{ id: 'work' }],
  projects: [
    { id: 'app', name: 'App', group: 'work', account: 'shared', path: '/work/app' },
    { id: 'apps', name: 'Apps root', group: 'work', account: 'shared', path: '/work' },
  ],
});

/** Every file under `dir` with its mtime and size: proves nothing was written. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else {
        const st = fs.statSync(p);
        out.push(`${p} ${st.mtimeMs} ${st.size}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** A codex home: the fixture rollouts + a `state_5.sqlite` like codex's (one archived, one without a rollout). */
function codexHome(): string {
  const home = tmpDir();
  fs.cpSync(path.join(FIXTURES, 'codex'), home, { recursive: true });
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    git_branch TEXT, first_user_message TEXT NOT NULL DEFAULT '', created_at_ms INTEGER, updated_at_ms INTEGER, name TEXT)`);
  const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const day = path.join(home, 'sessions', '2026', '11', '18');
  insert.run(
    CODEX_A,
    path.join(day, `rollout-2026-11-18T09-00-00-${CODEX_A}.jsonl`),
    1795046400,
    1795046420,
    '/work/api',
    'Add rate limiting to the upload endpoint',
    0,
    'develop',
    'Add rate limiting to the upload endpoint',
    1795046400000,
    1795046420000,
    null,
  );
  insert.run(
    CODEX_ARCHIVED,
    path.join(day, `rollout-2026-11-18T10-00-00-${CODEX_ARCHIVED}.jsonl`),
    1795050000,
    1795050002,
    '/work/api',
    'archived',
    1,
    null,
    'archived thread message',
    null,
    null,
    null,
  );
  insert.run(
    CODEX_DB_ONLY,
    '/gone/rollout.jsonl',
    1790000000,
    1790000100,
    '/elsewhere/tool',
    'db only thread',
    0,
    null,
    'db only thread',
    null,
    null,
    'Named in codex',
  );
  db.close();
  return home;
}

describe('ClaudeParser', () => {
  it("keeps the user's words and the answers; skips commands, meta, tool results, thinking and sidechains", () => {
    const p = new ClaudeParser();
    lines(path.join(CLAUDE_DIR, 'projects', '-work-app', `${AUTH}.jsonl`)).forEach((l) => p.line(l));
    const r = p.result(0)!;
    expect(r.cwd).toBe('/work/app');
    expect(r.branch).toBe('fix/redirect');
    expect(r.title).toBe('auth bug');
    expect(r.autoTitle).toBe('Login redirect fix');
    expect(r.firstMessage).toBe('Fix the login redirect bug');
    expect(r.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Fix the login redirect bug'],
      ['assistant', 'Looking at the auth middleware.'],
      ['assistant', 'The redirect used a stale returnTo cookie. Fixed.'],
      ['user', 'Thanks'],
    ]);
    expect(r.count).toBe(4);
    expect(r.startedAt).toBe(Date.parse('2026-11-10T09:00:00.000Z'));
    expect(r.updatedAt).toBe(Date.parse('2026-11-10T09:02:00.000Z'));
  });

  it('returns null without a conversation', () => {
    const p = new ClaudeParser();
    lines(
      path.join(CLAUDE_DIR, 'projects', '-work-app', '22222222-2222-4222-8222-222222222222.jsonl'),
    ).forEach((l) => p.line(l));
    expect(p.result(0)).toBeNull();
  });

  it('caps what it keeps but counts everything; full mode keeps all', () => {
    const big = 'x'.repeat(9000);
    const line = (i: number) =>
      JSON.stringify({
        type: 'user',
        cwd: '/a',
        timestamp: '2026-11-10T09:00:00Z',
        message: { content: `${i}${big}` },
      });
    const capped = new ClaudeParser();
    const full = new ClaudeParser(true);
    for (let i = 0; i < 40; i++) {
      capped.line(line(i));
      full.line(line(i));
    }
    const c = capped.result(0)!;
    expect(c.count).toBe(40);
    expect(c.truncated).toBe(true);
    expect(c.messages.length).toBeLessThan(40);
    expect(c.messages[0].text.length).toBeLessThanOrEqual(8001);
    expect(full.result(0)!.messages).toHaveLength(40);
    expect(full.result(0)!.messages[0].text.length).toBe(9001);
  });
});

describe('CodexParser', () => {
  it('reads id, cwd and branch from session_meta and skips injected context', () => {
    const p = new CodexParser();
    lines(
      path.join(
        FIXTURES,
        'codex',
        'sessions',
        '2026',
        '11',
        '18',
        `rollout-2026-11-18T09-00-00-${CODEX_A}.jsonl`,
      ),
    ).forEach((l) => p.line(l));
    const r = p.result(0)!;
    expect(r).toMatchObject({ id: CODEX_A, cwd: '/work/api', branch: 'develop' });
    expect(r.firstMessage).toBe('Add rate limiting to the upload endpoint');
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('codex database rows and index', () => {
  it('maps rows of any schema version', () => {
    expect(
      mapCodexRows([
        { id: 'A', cwd: '/x', created_at: 10, updated_at: 20, title: 't', archived: 0 },
        {
          id: 'b',
          cwd: '/y',
          created_at_ms: 5,
          updated_at_ms: 6,
          archived: 1,
          first_user_message: 'hi',
          name: 'N',
        },
        { id: 'c' },
      ]),
    ).toEqual([
      expect.objectContaining({ id: 'a', cwd: '/x', startedAt: 10_000, updatedAt: 20_000, archived: false }),
      expect.objectContaining({
        id: 'b',
        startedAt: 5,
        updatedAt: 6,
        archived: true,
        firstMessage: 'hi',
        name: 'N',
      }),
    ]);
  });
  it('reads thread names, skipping broken lines', () => {
    expect(
      parseCodexIndex(fs.readFileSync(path.join(FIXTURES, 'codex', 'session_index.jsonl'), 'utf8')),
    ).toEqual(new Map([[CODEX_A, 'Upload rate limit']]));
  });
});

describe('HistoryIndex', () => {
  it('lists Claude and Codex sessions by their recorded cwd, read-only', async () => {
    const home = codexHome();
    const metaFile = path.join(tmpDir(), 'history.json');
    const before = snapshot(CLAUDE_DIR);
    const codexBefore = snapshot(home);
    const index = new HistoryIndex({ codexHome: home, metaFile });
    const { entries, cleanupDays } = await index.list(config());

    expect(cleanupDays).toEqual({ shared: 14, personal: 30 });
    expect(entries.map((e) => `${e.agent}:${e.id}`)).toEqual([
      `codex:${CODEX_A}`,
      `claude:${WT}`,
      `claude:${AUTH}`,
      `codex:${CODEX_DB_ONLY}`,
    ]);
    const auth = entries.find((e) => e.id === AUTH)!;
    expect(auth).toMatchObject({
      agent: 'claude',
      account: 'shared',
      cwd: '/work/app',
      branch: 'fix/redirect',
      title: 'auth bug',
      projectId: 'app',
      messages: 4,
      favorite: false,
    });
    expect(auth.expiresAt).toBe(
      fs.statSync(path.join(CLAUDE_DIR, 'projects', '-work-app', `${AUTH}.jsonl`)).mtimeMs + 14 * 86_400_000,
    );
    // A worktree next to the project belongs to it; the deepest project wins otherwise.
    expect(entries.find((e) => e.id === WT)).toMatchObject({ projectId: 'app', branch: 'feature' });
    expect(entries.find((e) => e.id === CODEX_A)).toMatchObject({
      agent: 'codex',
      title: 'Upload rate limit',
      branch: 'develop',
      projectId: 'apps',
      messages: 2,
    });
    expect(entries.find((e) => e.id === CODEX_DB_ONLY)).toMatchObject({
      title: 'Named in codex',
      firstMessage: 'db only thread',
      messages: 0,
    });
    expect(entries.find((e) => e.id === CODEX_DB_ONLY)?.projectId).toBeUndefined();

    expect(snapshot(CLAUDE_DIR)).toEqual(before);
    expect(snapshot(home).filter((f) => !/state_5\.sqlite-(wal|shm)/.test(f))).toEqual(
      codexBefore.filter((f) => !/state_5\.sqlite-(wal|shm)/.test(f)),
    );
    expect(fs.existsSync(metaFile)).toBe(false);
  });

  it('falls back to rollout files without a database', async () => {
    const home = tmpDir();
    fs.cpSync(path.join(FIXTURES, 'codex'), home, { recursive: true });
    const index = new HistoryIndex({ codexHome: home, metaFile: path.join(home, 'meta.json') });
    const ids = (await index.list(config('/nonexistent'))).entries.map((e) => e.id);
    expect(ids).toEqual([CODEX_ARCHIVED, CODEX_A]);
  });

  it('searches names, first messages and the conversation text', async () => {
    const index = new HistoryIndex({ codexHome: codexHome(), metaFile: path.join(tmpDir(), 'm.json') });
    await index.list(config());
    expect(index.search('RETURNTO cookie')).toEqual([
      { agent: 'claude', id: AUTH, snippet: expect.stringContaining('stale returnTo cookie') },
    ]);
    expect(index.search('token bucket').map((m) => m.id)).toEqual([CODEX_A]);
    expect(index.search('secret thoughts')).toEqual([]);
    expect(index.search('tool_output_only')).toEqual([]);
    expect(index.search('  ')).toEqual([]);
  });

  it('keeps names and favorites in its own file', async () => {
    const metaFile = path.join(tmpDir(), 'history.json');
    const index = new HistoryIndex({ codexHome: codexHome(), metaFile });
    await index.list(config());
    const ref = { agent: 'claude' as const, id: AUTH };
    expect(index.setMeta(ref, { name: '  Auth  ', favorite: true })).toMatchObject({
      name: 'Auth',
      favorite: true,
    });
    expect(index.search('auth').map((m) => m.id)).toContain(AUTH);
    expect(parseMeta(fs.readFileSync(metaFile, 'utf8'))).toEqual({
      names: { [`claude:${AUTH}`]: 'Auth' },
      favorites: [`claude:${AUTH}`],
    });
    expect(index.setMeta(ref, { name: '' })?.name).toBeUndefined();
    const again = new HistoryIndex({ codexHome: codexHome(), metaFile });
    const e = (await again.list(config())).entries.find((x) => x.id === AUTH)!;
    expect(e.favorite).toBe(true);
    expect(e.name).toBeUndefined();
  });

  it('re-reads the whole transcript for export', async () => {
    const index = new HistoryIndex({ codexHome: codexHome(), metaFile: path.join(tmpDir(), 'm.json') });
    await index.list(config());
    const all = await index.fullTranscript({ agent: 'claude', id: AUTH });
    expect(all.map((m) => m.text)).toEqual(
      index.transcript({ agent: 'claude', id: AUTH }).messages.map((m) => m.text),
    );
    expect(index.transcript({ agent: 'claude', id: 'nope' })).toEqual({ messages: [], truncated: false });
  });
});

describe('projects', () => {
  const c = config();
  it('matches the deepest project, a subfolder, or a worktree next to it', () => {
    expect(matchProject(c, '/work/app', identity)).toBe('app');
    expect(matchProject(c, '/work/app/src', identity)).toBe('app');
    expect(matchProject(c, '/work/app-wt/feature', identity)).toBe('app');
    expect(matchProject(c, '/work/other', identity)).toBe('apps');
    expect(matchProject(c, '/workshop', identity)).toBeUndefined();
  });
  it('resumes in the project dir, or in the folder as a worktree', () => {
    expect(resumeWorktree('/work/app', '/work/app', 'main', identity)).toBeUndefined();
    expect(resumeWorktree('/work/app', '/work/app-wt/feature', 'feature', identity)).toEqual({
      path: '/work/app-wt/feature',
      branch: 'feature',
    });
    expect(resumeWorktree('/work/app', '/work/app/web', undefined, identity)).toEqual({
      path: '/work/app/web',
      branch: 'web',
    });
  });
});

describe('meta, markdown, snippet', () => {
  it('applies names and favorites', () => {
    const ref = { agent: 'codex' as const, id: 'x' };
    let m = applyMeta({ names: {}, favorites: [] }, ref, { favorite: true, name: 'N' });
    expect(m).toEqual({ names: { 'codex:x': 'N' }, favorites: ['codex:x'] });
    m = applyMeta(m, ref, { name: null });
    expect(m).toEqual({ names: {}, favorites: ['codex:x'] });
    expect(applyMeta(m, ref, { favorite: false }).favorites).toEqual([]);
    expect(parseMeta('nope')).toEqual({ names: {}, favorites: [] });
  });
  it('writes a readable Markdown transcript', () => {
    const md = toMarkdown(
      {
        agent: 'claude',
        id: AUTH,
        cwd: '/work/app',
        branch: 'main',
        account: 'shared',
        startedAt: Date.parse('2026-11-10T09:00:00Z'),
        updatedAt: Date.parse('2026-11-10T09:02:00Z'),
        title: 'auth\nbug',
      },
      [
        { role: 'user', text: 'Fix it', at: Date.parse('2026-11-10T09:00:00Z') },
        { role: 'assistant', text: 'Done.' },
      ],
    );
    expect(md).toBe(
      [
        '# auth bug',
        '',
        `- Claude session \`${AUTH}\``,
        '- Folder: `/work/app` · branch `main`',
        '- Account: shared',
        '- 2026-11-10 09:00 → 2026-11-10 09:02 UTC',
        '',
        '## User · 2026-11-10 09:00',
        '',
        'Fix it',
        '',
        '## Claude',
        '',
        'Done.',
        '',
      ].join('\n'),
    );
  });
  it('cuts a one-line snippet around the match', () => {
    const text = `${'a'.repeat(200)}\nneedle here\n${'b'.repeat(200)}`;
    const s = snippet(text, 201, 6, 40);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('needle here');
    expect(s).not.toContain('\n');
  });
  it('picks the display title', () => {
    expect(displayTitle({ id: 'i', firstMessage: 'first', autoTitle: 'auto' })).toBe('auto');
    expect(displayTitle({ id: 'i', firstMessage: 'first', title: 'cli', name: 'ours' })).toBe('ours');
    expect(displayTitle({ id: 'i', firstMessage: '' })).toBe('i');
  });
});

describe('commands (T59)', () => {
  const FILE = path.join(__dirname, 'fixtures', 'history-commands', 'commands.jsonl');

  it('lists Bash commands with how they ended, never their output', async () => {
    const runs = await readClaudeCommands(FILE);
    expect(runs.map((r) => [r.command, r.state])).toEqual([
      ['npm test', 'ok'],
      ['rm -rf dist', 'error'],
      ['GITHUB_TOKEN=••• npx prisma migrate dev --name init', 'interrupted'],
      ['npm run dev', 'pending'],
    ]);
    expect(runs[0].at).toBe(Date.parse('2026-11-20T10:00:05.000Z'));
    expect(JSON.stringify(runs)).not.toContain('SECRET OUTPUT');
  });

  it('come with the indexed transcript', () => {
    const parsed = parseText(fs.readFileSync(FILE, 'utf8'), new ClaudeParser()).result(0);
    expect(parsed?.commands).toHaveLength(4);
  });

  it.each([
    ['API_KEY=sk-123 node x.js', 'API_KEY=••• node x.js'],
    ['export DB_PASSWORD="hunter 2"', 'export DB_PASSWORD=•••'],
    ['gh auth login --with-token abc', 'gh auth login --with-token •••'],
    ['vercel --token=abc123 deploy', 'vercel --token=••• deploy'],
    ["curl -H 'Authorization: Bearer xyz' https://api", "curl -H 'Authorization: Bearer •••' https://api"],
    ['git clone https://me:pat123@github.com/x/y', 'git clone https://me:•••@github.com/x/y'],
    ['NODE_ENV=test PORT=3000 npm test', 'NODE_ENV=test PORT=3000 npm test'],
    ['npm run build -- --keep-names', 'npm run build -- --keep-names'],
  ])('masks %s', (input, expected) => {
    expect(maskSecrets(input)).toBe(expected);
  });
});

describe('work (T70)', () => {
  const claudeLine = (type: 'user' | 'assistant', content: unknown) =>
    JSON.stringify({ type, cwd: '/repo', timestamp: '2026-11-20T10:00:00.000Z', message: { content } });

  it('finds @note.md mentions', () => {
    expect(
      mentionsOf('Handle this\n\n@/Users/me/notes/DB-12 spec.md and @docs/a.md, not a@b or @x.mdx'),
    ).toEqual(['/Users/me/notes/DB-12 spec.md', 'docs/a.md']);
    expect(mentionsOf('@"/Users/me/My Notes/plan.md" please')).toEqual(['/Users/me/My Notes/plan.md']);
    expect(mentionsOf('@/n/with\\ space.md')).toEqual(['/n/with space.md']);
  });

  it('reads apply_patch headers', () => {
    expect(
      patchFiles('*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** Add File: b.md\n*** End Patch'),
    ).toEqual(['src/a.ts', 'b.md']);
  });

  it('Claude: edited files and mentions come with the transcript', () => {
    const text = [
      claudeLine('user', 'Handle this note\n\n@/notes/plan.md'),
      claudeLine('assistant', [
        { type: 'text', text: 'ok' },
        { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/src/a.ts' } },
        { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: '/repo/src/a.ts' } },
        { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: '/repo/src/b.ts' } },
        { type: 'tool_use', id: 't4', name: 'NotebookEdit', input: { notebook_path: '/repo/n.ipynb' } },
      ]),
    ].join('\n');
    const parsed = parseText(text, new ClaudeParser()).result(0);
    expect(parsed?.files).toEqual(['/repo/src/a.ts', '/repo/n.ipynb']);
    expect(parsed?.mentions).toEqual(['/notes/plan.md']);
  });

  it('Codex: apply_patch files (custom tool or shell arguments) and mentions', () => {
    const line = (type: string, payload: unknown) =>
      JSON.stringify({ type, timestamp: '2026-11-20T10:00:00.000Z', payload });
    const text = [
      line('session_meta', { id: 'ABC', cwd: '/repo' }),
      line('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'do @n/a.md' }],
      }),
      line('response_item', {
        type: 'custom_tool_call',
        name: 'apply_patch',
        input: '*** Begin Patch\n*** Update File: src/x.ts\n*** End Patch',
      }),
      line('response_item', {
        type: 'function_call',
        name: 'shell',
        arguments: JSON.stringify({
          command: ['apply_patch', '*** Begin Patch\n*** Add File: y.ts\n*** End Patch'],
        }),
      }),
    ].join('\n');
    const parsed = parseText(text, new CodexParser()).result(0);
    expect(parsed?.files).toEqual(['src/x.ts', 'y.ts']);
    expect(parsed?.mentions).toEqual(['n/a.md']);
  });
});

describe('lite parse (T70)', () => {
  it('keeps what the graph needs and no message text', () => {
    const line = (type: 'user' | 'assistant', content: unknown, ts: string, extra = {}) =>
      JSON.stringify({
        type,
        cwd: '/repo',
        gitBranch: 'main',
        timestamp: ts,
        ...extra,
        message: { content },
      });
    const text = [
      JSON.stringify({ type: 'custom-title', customTitle: 'Mine' }),
      line('user', 'First question', '2026-11-20T10:00:00.000Z'),
      line('assistant', [{ type: 'text', text: 'long answer' }], '2026-11-20T10:00:01.000Z'),
      line('user', 'see @notes/a.md', '2026-11-20T10:00:02.000Z'),
      line(
        'assistant',
        [{ type: 'tool_use', id: 't', name: 'Write', input: { file_path: '/repo/x.ts' } }],
        '2026-11-20T10:00:03.000Z',
      ),
      line('assistant', [{ type: 'text', text: 'side' }], '2026-11-20T10:09:00.000Z', { isSidechain: true }),
      line('assistant', [{ type: 'text', text: 'done' }], '2026-11-20T10:00:04.000Z'),
    ].join('\n');
    const full = parseText(text, new ClaudeParser()).result(0)!;
    const lite = parseText(text, new ClaudeParser(false, true)).result(0)!;
    for (const k of [
      'cwd',
      'branch',
      'title',
      'firstMessage',
      'startedAt',
      'updatedAt',
      'files',
      'mentions',
    ] as const)
      expect(lite[k]).toEqual(full[k]);
    expect(lite.messages).toEqual([]);
    expect(lite.commands).toBeUndefined();
  });
});
