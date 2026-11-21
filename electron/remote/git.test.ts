import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitAction } from '../git';
import { boundary, parseSections, sectionLine, type RemoteExec } from './exec';
import { fakeHost as makeFakeHost, type FakeHost } from './fakeHost';
import {
  changesScript,
  parseChanges,
  remoteGit,
  remoteGitChanges,
  remoteHeadSha,
  remoteTrash,
  safeRelative,
} from './git';

const hosts: FakeHost[] = [];
afterEach(() => hosts.splice(0).forEach((h) => h.dispose()));
function fakeHost() {
  const h = makeFakeHost();
  hosts.push(h);
  return h;
}

function repo(home: string) {
  const dir = path.join(home, 'code', 'app');
  fs.mkdirSync(dir, { recursive: true });
  const run = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    }).toString();
  run('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n2\n3\n');
  run('add', '.');
  run('commit', '-qm', 'init');
  return { dir, run };
}

const host = { alias: 'devbox' };

describe('sections', () => {
  it('splits output on the boundary and drops what came before', () => {
    const b = boundary();
    const out = spawnSync('sh', [
      '-c',
      `echo motd; ${sectionLine(b, 'one')}; printf 'a\\nb'; ${sectionLine(b, 'two')}`,
    ]);
    const sec = parseSections(String(out.stdout), b);
    expect([...sec.keys()]).toEqual(['one', 'two']);
    expect(sec.get('one')).toBe('a\nb');
  });
});

describe('remote changes', () => {
  it('reads status, diff and untracked files in one round trip (~ = remote home)', async () => {
    const { home, exec } = fakeHost();
    const { dir } = repo(home);
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\ntwo\n3\n');
    fs.writeFileSync(path.join(dir, 'new file.txt'), 'n\n');
    let calls = 0;
    const counted: RemoteExec = (...a) => (calls++, exec(...a));
    const c = await remoteGitChanges(counted, host, '~/code/app');
    expect(calls).toBe(1);
    expect(c.isRepo).toBe(true);
    expect(c.branch).toBe('main');
    expect(c.files.map((f) => [f.status, f.path])).toEqual([
      ['M', 'a.txt'],
      ['?', 'new file.txt'],
    ]);
    expect(c.diff).toContain('+two');
    expect(c.diff).toContain('+++ b/new file.txt');
    expect(c.base).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof c.latencyMs).toBe('number');
  });

  it('diffs since a base commit, including committed files', async () => {
    const { home, exec } = fakeHost();
    const { dir, run } = repo(home);
    const base = await remoteHeadSha(exec, host, dir);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    run('add', 'b.txt');
    run('commit', '-qm', 'b');
    const c = await remoteGitChanges(exec, host, dir, base);
    expect(c.base).toBe(base);
    expect(c.files.map((f) => [f.status, f.path])).toEqual([['A', 'b.txt']]);
    expect(c.diff).toContain('+++ b/b.txt');
  });

  it('a folder that is not a repo is not an error; a missing one is', async () => {
    const { home, exec } = fakeHost();
    fs.mkdirSync(path.join(home, 'plain'));
    expect((await remoteGitChanges(exec, host, '~/plain')).isRepo).toBe(false);
    await expect(remoteGitChanges(exec, host, '~/nope')).rejects.toThrow(/folder not found/);
  });

  it('never quotes anything but a sha into the script as base', () => {
    expect(changesScript('~/x', 'B', "'; rm -rf / #")).toContain("base=''");
  });

  it('marks a diff cut on the host as truncated', () => {
    const b = 'B';
    const big = 'x'.repeat(400 * 1024 + 1);
    const out = `\n${b} status\n## main\0\n${b} head\nabc\n${b} diff\n${big}\n${b} untracked\n\n${b} end\n`;
    expect(parseChanges(out, b).truncated).toBe(true);
  });
});

describe('remote actions', () => {
  it('stages and reverts a hunk over the runner (patch on stdin), backed up in the stash', async () => {
    const { home, exec } = fakeHost();
    const { dir, run } = repo(home);
    fs.writeFileSync(path.join(dir, 'a.txt'), '1\ntwo\n3\n');
    const patch = run('diff', '--no-color', 'HEAD');
    const g = remoteGit(exec, host, '~/code/app');
    const trash = remoteTrash(exec, host, '~/code/app');
    await gitAction(g, { action: 'stage-hunk', path: 'a.txt', patch }, trash);
    expect(run('diff', '--cached', '--name-only').trim()).toBe('a.txt');
    await gitAction(g, { action: 'unstage-file', path: 'a.txt' }, trash);
    const r = await gitAction(g, { action: 'revert-hunk', path: 'a.txt', patch }, trash);
    expect(r.stash).toMatch(/^[0-9a-f]{40}$/);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('1\n2\n3\n');
  });

  it('moves a reverted untracked file to ~/.aquila/trash on the host', async () => {
    const { home, exec } = fakeHost();
    const { dir } = repo(home);
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', "it's.txt"), 'n\n');
    const r = await gitAction(
      remoteGit(exec, host, dir),
      { action: 'revert-file', path: "sub/it's.txt" },
      remoteTrash(exec, host, dir, () => Date.UTC(2026, 0, 2, 3, 4, 5)),
    );
    expect(r.trashed).toEqual(["sub/it's.txt"]);
    expect(r.trashedTo).toBe("~/.aquila/trash/2026-01-02T03-04-05-000Z/sub/it's.txt");
    expect(fs.existsSync(path.join(dir, 'sub', "it's.txt"))).toBe(false);
    expect(fs.existsSync(path.join(home, '.aquila/trash/2026-01-02T03-04-05-000Z/sub', "it's.txt"))).toBe(
      true,
    );
  });

  it('refuses paths that leave the tree', () => {
    expect(safeRelative('a/b.txt')).toBe(true);
    expect(safeRelative('../x')).toBe(false);
    expect(safeRelative('/etc/passwd')).toBe(false);
    expect(safeRelative('a/../../x')).toBe(false);
  });
});
