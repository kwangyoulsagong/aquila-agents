import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureWorktree,
  parseWorktreeList,
  worktreeInfo,
  worktreePathFor,
  worktreeRoot,
  worktreeSlot,
} from './worktrees';
import type { Config } from '../src/shared/api/types';

describe('parseWorktreeList', () => {
  it('reads paths and branches, leaves detached ones without a branch', () => {
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
    ].join('\n');
    expect(parseWorktreeList(out)).toEqual([
      { path: '/a/repo', branch: 'main' },
      { path: '/a/repo-wt/feat/x', branch: 'feat/x' },
      { path: '/a/repo-wt/tmp', branch: '' },
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
      created: true
    });
    expect(fs.existsSync(path.join(wt.path, '.git'))).toBe(true);
    expect(run('branch', '--list', 'feat/new').trim()).toContain('feat/new');
    expect(await ensureWorktree(config, 'r', 'feat/new')).toEqual({ worktree: wt, created: false });
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
});
