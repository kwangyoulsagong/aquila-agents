import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureWorktree,
  parseWorktreeList,
  removeWorktree,
  worktreeCandidates,
  worktreeInfo,
  worktreePathFor,
  worktreeRoot,
  worktreeSlot,
} from './worktrees';
import type { Config } from '../src/shared/api/types';

describe('parseWorktreeList', () => {
  it('reads paths and branches; a detached one has no branch and its short commit', () => {
    const out = [
      'worktree /a/repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /a/repo-wt/feat/x',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feat/x',
      '',
      'worktree /a/repo-wt/tmp',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      '',
      'worktree /a/repo-wt/kept',
      'HEAD 4444444444444444444444444444444444444444',
      'branch refs/heads/kept',
      'locked on a usb disk',
      '',
      'worktree /a/repo-wt/gone',
      'HEAD 5555555555555555555555555555555555555555',
      'branch refs/heads/gone',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    expect(parseWorktreeList(out)).toEqual([
      { path: '/a/repo', branch: 'main' },
      { path: '/a/repo-wt/feat/x', branch: 'feat/x' },
      { path: '/a/repo-wt/tmp', branch: '', detached: '3333333' },
      { path: '/a/repo-wt/kept', branch: 'kept', locked: true },
      { path: '/a/repo-wt/gone', branch: 'gone', prunable: true },
    ]);
  });
});

describe('worktree paths', () => {
  it('puts worktrees next to the repo in <repo>-wt/<branch>', () => {
    expect(worktreeRoot('/a/repo')).toBe('/a/repo-wt');
    expect(worktreePathFor('/a/repo', 'feat/x')).toBe('/a/repo-wt/feat/x');
  });
});

// Real git in a temp dir: create, reuse, check out an existing branch, reject bad names.
describe('ensureWorktree', () => {
  const tmp: string[] = [];
  afterEach(() => tmp.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const setup = () => {
    // realpath: on macOS os.tmpdir() is a symlink and git reports the resolved path.
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-wt-')));
    tmp.push(base);
    const repo = path.join(base, 'repo');
    fs.mkdirSync(repo);
    const run = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
    run('init', '-q', '-b', 'main');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    run('branch', 'existing');
    const config: Config = {
      language: 'en',
      accounts: {},
      groups: [],
      projects: [{ id: 'r', name: 'R', group: 'g', account: 'shared', path: repo }],
    };
    return { base, repo, config, run };
  };

  it('creates a new branch worktree, then reuses it', async () => {
    const { base, config, run } = setup();
    const made = await ensureWorktree(config, 'r', ' feat/new ');
    const wt = made.worktree;
    expect(made).toEqual({
      worktree: { path: path.join(base, 'repo-wt', 'feat', 'new'), branch: 'feat/new' },
      created: true,
      copied: [],
    });
    expect(fs.existsSync(path.join(wt.path, '.git'))).toBe(true);
    expect(run('branch', '--list', 'feat/new').trim()).toContain('feat/new');
    expect(await ensureWorktree(config, 'r', 'feat/new')).toEqual({ worktree: wt, created: false });
  });

  it('lists a detached worktree by its commit and opens it by path, never as a branch', async () => {
    const { base, config, run } = setup();
    const dir = path.join(base, 'repo-wt', 'detached');
    run('worktree', 'add', '-q', '--detach', dir);
    const commit = run('rev-parse', '--short=7', 'HEAD').trim();
    const info = await worktreeInfo(config, 'r');
    expect(info.worktrees).toContainEqual({ path: dir, branch: commit, detached: true });
    expect(await ensureWorktree(config, 'r', dir)).toEqual({
      worktree: { path: dir, branch: commit, detached: true },
      created: false,
    });
    await expect(ensureWorktree(config, 'r', path.join(base, 'elsewhere'))).rejects.toThrow('Not a worktree');
    expect(run('branch', '--list', commit).trim()).toBe('');
  });

  it('checks out an existing branch and reuses the main worktree for its own branch', async () => {
    const { base, repo, config } = setup();
    const { worktree: wt } = await ensureWorktree(config, 'r', 'existing');
    expect(wt.path).toBe(path.join(base, 'repo-wt', 'existing'));
    expect(await ensureWorktree(config, 'r', 'main')).toEqual({
      worktree: { path: repo, branch: 'main' },
      created: false
    });

    const info = await worktreeInfo(config, 'r');
    expect(info).toMatchObject({
      isRepo: true,
      repoRoot: repo,
      root: path.join(base, 'repo-wt'),
      current: 'main',
      base: 'main',
    });
    expect(info.branches.sort()).toEqual(['existing', 'main']);
    expect(info.worktrees.map((w) => w.branch)).toEqual(['main', 'existing']);
    expect(worktreeSlot(repo)).toBe(0);
    expect(worktreeSlot(wt.path)).toBe(1);
  });

  it("starts new branches from the project's default branch when it exists", async () => {
    const { config, run } = setup();
    run('checkout', '-q', '-b', 'develop');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'dev');
    const mainSha = run('rev-parse', 'main').trim();
    const withBase: Config = { ...config, projects: [{ ...config.projects[0], defaultBranch: 'main' }] };
    expect((await worktreeInfo(withBase, 'r')).base).toBe('main');
    const { worktree } = await ensureWorktree(withBase, 'r', 'feat/from-main');
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree.path }).toString().trim()).toBe(mainSha);
    // A default branch that doesn't exist falls back to the current HEAD.
    const missing: Config = { ...config, projects: [{ ...config.projects[0], defaultBranch: 'nope' }] };
    expect((await worktreeInfo(missing, 'r')).base).toBe('develop');
  });

  it('rejects bad branch names and non-repos', async () => {
    const { base, config } = setup();
    await expect(ensureWorktree(config, 'r', '../escape')).rejects.toThrow(/Invalid branch/);
    await expect(ensureWorktree(config, 'r', '-b')).rejects.toThrow(/Invalid branch/);
    await expect(ensureWorktree(config, 'r', '')).rejects.toThrow(/Invalid branch/);
    const plain = path.join(base, 'plain');
    fs.mkdirSync(plain);
    const notRepo: Config = { ...config, projects: [{ ...config.projects[0], path: plain }] };
    expect((await worktreeInfo(notRepo, 'r')).isRepo).toBe(false);
  });

  it('copies only the gitignored files listed in .worktreeinclude into a new worktree', async () => {
    const { repo, config, run } = setup();
    fs.writeFileSync(path.join(repo, '.gitignore'), '.env*\nsecrets/\nbuild/\n');
    fs.writeFileSync(path.join(repo, '.worktreeinclude'), '.env\nsecrets/\nnotes.txt\n');
    run('add', '.gitignore', '.worktreeinclude');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'ignore');
    fs.writeFileSync(path.join(repo, '.env'), 'KEY=1');
    fs.writeFileSync(path.join(repo, '.env.local'), 'not listed');
    fs.mkdirSync(path.join(repo, 'secrets'));
    fs.writeFileSync(path.join(repo, 'secrets', 'a.pem'), 'pem');
    fs.mkdirSync(path.join(repo, 'build'));
    fs.writeFileSync(path.join(repo, 'build', 'out.js'), 'ignored but not listed');
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'listed but not ignored');

    const made = await ensureWorktree(config, 'r', 'feat/env');
    const wt = made.worktree.path;
    expect(made.copied?.sort()).toEqual(['.env', 'secrets/']);
    expect(fs.readFileSync(path.join(wt, '.env'), 'utf8')).toBe('KEY=1');
    expect(fs.readFileSync(path.join(wt, 'secrets', 'a.pem'), 'utf8')).toBe('pem');
    expect(fs.existsSync(path.join(wt, '.env.local'))).toBe(false);
    expect(fs.existsSync(path.join(wt, 'build'))).toBe(false);
    expect(fs.existsSync(path.join(wt, 'notes.txt'))).toBe(false);
    // Reusing a worktree copies nothing.
    expect((await ensureWorktree(config, 'r', 'feat/env')).copied).toBeUndefined();
  });

  it('suggests merged + clean worktrees and removes them without --force', async () => {
    const { config, run } = setup();
    const merged = (await ensureWorktree(config, 'r', 'done')).worktree.path;
    const ahead = (await ensureWorktree(config, 'r', 'wip')).worktree.path;
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'w'], {
      cwd: ahead,
    });
    const dirty = (await ensureWorktree(config, 'r', 'dirty')).worktree.path;
    fs.writeFileSync(path.join(dirty, 'new.txt'), 'x');
    const open = (await ensureWorktree(config, 'r', 'open')).worktree.path;

    const list = await worktreeCandidates(config, 'r', [open]);
    const by = Object.fromEntries(list.map((c) => [c.branch, c]));
    expect(Object.keys(by).sort()).toEqual(['dirty', 'done', 'open', 'wip']);
    expect(by.done).toMatchObject({ merged: true, clean: true, open: false });
    expect(by.wip).toMatchObject({ merged: false, clean: true });
    expect(by.dirty).toMatchObject({ merged: true, clean: false });
    expect(by.open).toMatchObject({ open: true });

    await expect(removeWorktree(config, 'r', open, [open])).rejects.toThrow(/open in a tab/);
    await expect(removeWorktree(config, 'r', dirty, [])).rejects.toThrow();
    expect(fs.existsSync(dirty)).toBe(true);
    await expect(removeWorktree(config, 'r', config.projects[0].path, [])).rejects.toThrow(/Not a worktree/);
    await removeWorktree(config, 'r', merged, []);
    expect(fs.existsSync(merged)).toBe(false);
    // The branch stays.
    expect(run('branch', '--list', 'done').trim()).toContain('done');
  });

  it('leaves locked worktrees out of cleanup', async () => {
    const { config, run } = setup();
    const wt = (await ensureWorktree(config, 'r', 'kept')).worktree.path;
    run('worktree', 'lock', wt);
    expect(await worktreeCandidates(config, 'r', [])).toEqual([]);
  });
});
