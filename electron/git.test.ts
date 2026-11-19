import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capText,
  gitAction,
  gitChanges,
  headSha,
  ignoredPath,
  parseBranchLine,
  parseNameStatus,
  parseStatus,
  statusLetter,
  TreeWatcher,
} from './git';
import type { Config } from '../src/shared/api/types';

describe('parseBranchLine', () => {
  it('reads branch, upstream and ahead/behind', () => {
    expect(parseBranchLine('## main...origin/main [ahead 2, behind 1]')).toEqual({
      branch: 'main',
      ahead: 2,
      behind: 1,
    });
    expect(parseBranchLine('## task/T3...origin/task/T3')).toEqual({
      branch: 'task/T3',
      ahead: 0,
      behind: 0,
    });
    expect(parseBranchLine('## feature')).toEqual({ branch: 'feature', ahead: 0, behind: 0 });
  });

  it('handles a fresh repo and a detached HEAD', () => {
    expect(parseBranchLine('## No commits yet on main').branch).toBe('main');
    expect(parseBranchLine('## HEAD (no branch)').branch).toBe('HEAD');
  });
});

describe('parseStatus', () => {
  it('parses -z output with renames and paths with spaces', () => {
    const out = [
      '## main...origin/main [ahead 1]',
      ' M src/app.ts',
      'M  staged.ts',
      'R  new name.ts',
      'old name.ts',
      '?? notes/todo.md',
      'UU conflict.ts',
      '',
    ].join('\0');
    const r = parseStatus(out);
    expect(r.branch).toBe('main');
    expect(r.ahead).toBe(1);
    expect(r.files.map((f) => [f.status, f.path, f.origPath])).toEqual([
      ['M', 'src/app.ts', undefined],
      ['M', 'staged.ts', undefined],
      ['R', 'new name.ts', 'old name.ts'],
      ['?', 'notes/todo.md', undefined],
      ['U', 'conflict.ts', undefined],
    ]);
  });
});

describe('statusLetter', () => {
  it('prefers the worktree change, then the staged one', () => {
    expect(statusLetter('A', 'M')).toBe('M');
    expect(statusLetter('A', ' ')).toBe('A');
    expect(statusLetter(' ', 'D')).toBe('D');
    expect(statusLetter('?', '?')).toBe('?');
  });
});

describe('capText', () => {
  it('cuts at a line end when over the cap', () => {
    const r = capText('aaaa\nbbbb\ncccc\n', 12);
    expect(r).toEqual({ text: 'aaaa\nbbbb\n', truncated: true });
    expect(capText('short\n', 12)).toEqual({ text: 'short\n', truncated: false });
  });
});

describe('parseNameStatus', () => {
  it('reads modified, added and renamed entries', () => {
    const out = ['M', 'a.ts', 'A', 'b.ts', 'R087', 'old.ts', 'new.ts', ''].join('\0');
    expect(parseNameStatus(out).map((f) => [f.status, f.path, f.origPath])).toEqual([
      ['M', 'a.ts', undefined],
      ['A', 'b.ts', undefined],
      ['R', 'new.ts', 'old.ts'],
    ]);
  });
});

describe('ignoredPath', () => {
  it('ignores git internals except index/HEAD/refs, and node_modules', () => {
    expect(ignoredPath('.git/objects/ab/cdef')).toBe(true);
    expect(ignoredPath('.git/index')).toBe(false);
    expect(ignoredPath('.git/HEAD')).toBe(false);
    expect(ignoredPath('.git/refs/heads/main')).toBe(false);
    expect(ignoredPath('web/node_modules/x/index.js')).toBe(true);
    expect(ignoredPath('src/app.ts')).toBe(false);
  });
});

describe('TreeWatcher', () => {
  afterEach(() => vi.useRealTimers());
  it('debounces events and still fires within maxWait', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const w = new TreeWatcher(onChange, 400, 1000);
    w.event('a.ts');
    vi.advanceTimersByTime(300);
    w.event('b.ts');
    vi.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    // A steady stream: fires at maxWait.
    for (let i = 0; i < 12; i++) {
      w.event('dist/x.js');
      vi.advanceTimersByTime(100);
    }
    expect(onChange).toHaveBeenCalledTimes(2);
    w.event('.git/objects/aa/bb');
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenCalledTimes(3);
    w.close();
  });
});

describe('git tree actions (real repo)', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const repo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-git-'));
    dirs.push(dir);
    const run = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    run('init', '-q');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'test');
    run('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', ''].join('\n'));
    run('add', '.');
    run('commit', '-qm', 'init');
    const config = { projects: [{ id: 'p', path: dir }] } as unknown as Config;
    return { dir, run, config };
  };
  const noTrash = async () => {};

  it('diffs since a base commit, including committed changes', async () => {
    const { dir, run, config } = repo();
    const base = await headSha(dir);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    run('add', 'b.txt');
    run('commit', '-qm', 'b');
    fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
    const now = await gitChanges(config, 'p');
    expect(now.files.map((f) => f.path)).toEqual(['c.txt']);
    const since = await gitChanges(config, 'p', undefined, base);
    expect(since.base).toBe(base);
    expect(since.files.map((f) => [f.status, f.path])).toEqual([
      ['A', 'b.txt'],
      ['?', 'c.txt'],
    ]);
    expect(since.diff).toContain('+++ b/b.txt');
  });

  it('stages and reverts a hunk, backing up to a stash entry', async () => {
    const { dir, run } = repo();
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('2\n', 'two\n'));
    const patch = run('diff', '--no-color', 'HEAD');

    await gitAction(dir, { action: 'stage-hunk', path: 'a.txt', patch }, noTrash);
    expect(run('diff', '--cached', '--name-only').trim()).toBe('a.txt');
    await gitAction(dir, { action: 'unstage-file', path: 'a.txt' }, noTrash);
    expect(run('diff', '--cached', '--name-only').trim()).toBe('');

    const r = await gitAction(dir, { action: 'revert-hunk', path: 'a.txt', patch }, noTrash);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('two');
    expect(r.stash).toMatch(/^[0-9a-f]{40}$/);
    expect(run('stash', 'list')).toContain('aquila: before revert a.txt');
  });

  it('reverts a tracked file with a backup and trashes an untracked one', async () => {
    const { dir, run } = repo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    const r = await gitAction(dir, { action: 'revert-file', path: 'a.txt' }, noTrash);
    expect(r.stash).toBeTruthy();
    expect(run('status', '--porcelain').trim()).toBe('');

    fs.writeFileSync(path.join(dir, 'new.txt'), 'n\n');
    const trash = vi.fn(async () => {});
    const t = await gitAction(dir, { action: 'revert-file', path: 'new.txt' }, trash);
    expect(t.trashed).toEqual(['new.txt']);
    expect(trash).toHaveBeenCalledWith(path.join(dir, 'new.txt'));
  });

  it('refuses a hunk that no longer applies', async () => {
    const { dir } = repo();
    const patch = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-nope\n+x\n';
    await expect(gitAction(dir, { action: 'revert-hunk', path: 'a.txt', patch }, noTrash)).rejects.toThrow();
  });
});
