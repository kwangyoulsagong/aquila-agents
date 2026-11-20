import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryIndex, refKey } from '../history';
import type { Config } from '../../src/shared/api/types';
import { fakeHost as makeFakeHost, type FakeHost } from './fakeHost';
import { fetchScript, hostPath, listScript, matchRemoteProject, parseFetched, remoteHosts } from './history';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'history');
const AUTH = '11111111-1111-4111-8111-111111111111';
const CODEX_A = '01a1ebf4-1ccd-7221-a7f6-a2d6f4af3b20';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

/** A host whose home has the fixture transcripts in ~/.claude and ~/.codex. */
function host(): FakeHost {
  const h = makeFakeHost();
  cleanup.push(h.dispose);
  fs.cpSync(path.join(FIXTURES, 'claude'), path.join(h.home, '.claude'), { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'codex'), path.join(h.home, '.codex'), { recursive: true });
  return h;
}

function local(): { codexHome: string; metaFile: string } {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-rhist-'));
  cleanup.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return { codexHome: path.join(d, 'codex'), metaFile: path.join(d, 'meta.json') };
}

const config: Config = {
  language: 'en',
  accounts: { shared: { claudeConfigDir: '/nonexistent/.claude' } },
  groups: [{ id: 'work' }],
  projects: [
    { id: 'rapp', name: 'App', group: 'work', account: 'shared', path: '/work/app', remote: { alias: 'devbox' } },
    { id: 'rapi', name: 'API', group: 'work', account: 'shared', path: '~/api', remote: { alias: 'devbox' } },
  ],
};

describe('remote history', () => {
  it('lists the host’s Claude and Codex sessions, keyed by host, matched to remote projects', async () => {
    const h = host();
    const index = new HistoryIndex(local(), h.exec);
    expect((await index.list(config)).entries).toEqual([]); // list() never contacts a host
    expect(h.scripts).toHaveLength(0);

    const list = await index.refreshRemote(config);
    expect(list.hosts).toEqual([expect.objectContaining({ alias: 'devbox' })]);
    expect(list.hosts?.[0].error).toBeUndefined();
    const claude = list.entries.find((e) => e.id === AUTH);
    expect(claude).toMatchObject({ agent: 'claude', host: 'devbox', cwd: '/work/app', projectId: 'rapp' });
    // settings.json on the host says 14 days.
    expect(claude?.expiresAt).toBeGreaterThan(0);
    const codex = list.entries.find((e) => e.id === CODEX_A);
    expect(codex).toMatchObject({ agent: 'codex', host: 'devbox', title: 'Upload rate limit' }); // session_index.jsonl
    expect(refKey(codex!)).toBe(`codex:${CODEX_A}@devbox`);

    expect(index.search('login').length).toBeGreaterThan(0);
    expect(index.transcript({ agent: 'claude', id: AUTH, host: 'devbox' }).messages.length).toBeGreaterThan(0);
    const full = await index.fullTranscript({ agent: 'claude', id: AUTH, host: 'devbox' });
    expect(full.length).toBe(index.transcript({ agent: 'claude', id: AUTH, host: 'devbox' }).messages.length);
    expect(index.remoteOf({ agent: 'claude', id: AUTH, host: 'devbox' })?.home).toBe(h.home);
  });

  it('fetches only new or changed files on the next scan', async () => {
    const h = host();
    const index = new HistoryIndex(local(), h.exec);
    await index.refreshRemote(config);
    const fetches = () => h.scripts.filter((s) => s.includes('gzip')).length;
    expect(fetches()).toBe(1);
    await index.refreshRemote(config);
    expect(fetches()).toBe(1);
    const f = path.join(h.home, '.claude', 'projects', '-work-app', `${AUTH}.jsonl`);
    fs.appendFileSync(f, '\n');
    await index.refreshRemote(config);
    expect(fetches()).toBe(2);
  });

  it('a host that fails keeps its last entries and reports the error', async () => {
    const h = host();
    const index = new HistoryIndex(local(), h.exec);
    const first = await index.refreshRemote(config);
    h.down = true;
    const again = await index.refreshRemote(config);
    expect(again.hosts?.[0].error).toMatch(/Connection refused/);
    expect(again.entries.length).toBe(first.entries.length);
  });

  it('never writes on the host', async () => {
    const h = host();
    const before = JSON.stringify(walk(h.home));
    await new HistoryIndex(local(), h.exec).refreshRemote(config);
    expect(JSON.stringify(walk(h.home))).toBe(before);
  });
});

describe('scripts', () => {
  it('fetches heads, files with odd names, and survives login noise', async () => {
    const h = host();
    const dir = path.join(h.home, 'x');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "it's a.jsonl"), 'a'.repeat(100));
    fs.writeFileSync(path.join(dir, 'b.jsonl'), 'bbb');
    const b = 'BND';
    const r = await h.exec({ alias: 'devbox' }, fetchScript(b, 10), {
      input: `${path.join(dir, "it's a.jsonl")}\n${path.join(dir, 'missing')}\n${path.join(dir, 'b.jsonl')}\n`,
    });
    const out = parseFetched(r.stdout, b);
    expect(out?.get(0)).toBe('a'.repeat(10));
    expect(out?.get(1)).toBe('');
    expect(out?.get(2)).toBe('bbb');
  });

  it('quotes config dirs as remote paths', () => {
    expect(listScript('B', ['~/.claude-work'])).toContain(`d="$HOME"/'.claude-work'`);
  });
});

describe('projects on a host', () => {
  it('resolves ~ and relative paths against the remote home', () => {
    expect(hostPath('~', '/home/u')).toBe('/home/u');
    expect(hostPath('~/api', '/home/u')).toBe('/home/u/api');
    expect(hostPath('api', '/home/u')).toBe('/home/u/api');
    expect(hostPath('/srv/app/', '/home/u')).toBe('/srv/app/');
  });

  it('matches the deepest remote project on the same host only', () => {
    expect(matchRemoteProject(config, 'devbox', '/home/u', '/home/u/api/src')).toBe('rapi');
    expect(matchRemoteProject(config, 'devbox', '/home/u', '/work/app')).toBe('rapp');
    expect(matchRemoteProject(config, 'devbox', '/home/u', '/work/apps')).toBeUndefined();
    expect(matchRemoteProject(config, 'other', '/home/u', '/work/app')).toBeUndefined();
  });

  it('scans each host once, with every Claude config dir used on it', () => {
    const c: Config = {
      ...config,
      projects: [
        ...config.projects,
        { id: 'p3', name: 'x', group: 'work', account: 'shared', path: '/x', remote: { alias: 'devbox', claudeConfigDir: '~/.c2' } },
      ],
    };
    expect(remoteHosts(c)).toEqual([{ host: { alias: 'devbox' }, claudeDirs: ['~/.claude', '~/.c2'] }]);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(p));
    else {
      const st = fs.statSync(p);
      out.push(`${p}:${st.mtimeMs}:${st.size}`);
    }
  }
  return out;
}
