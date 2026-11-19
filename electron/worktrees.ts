// Worktree sessions (T7): "New Claude in worktree" puts the session in `../<repo>-wt/<branch>`, a git worktree of the
// project's repo, so parallel agents don't edit the same checkout. Existing worktrees of a branch are reused.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expand } from './config';
import type { Config, Worktree, WorktreeInfo } from '../src/shared/api/types';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** One entry of `git worktree list --porcelain`; `branch` is empty when detached or bare. */
export interface ListedWorktree {
  path: string;
  branch: string;
}

/** Parse `git worktree list --porcelain`: blocks of `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<b>`. */
export function parseWorktreeList(out: string): ListedWorktree[] {
  const list: ListedWorktree[] = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) list.push({ path: line.slice('worktree '.length), branch: '' });
    else if (line.startsWith('branch ') && list.length)
      list[list.length - 1].branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
  }
  return list;
}

/** `/a/repo` → `/a/repo-wt`: where new worktrees of that repo go (`<root>/<branch>`). */
export const worktreeRoot = (repoRoot: string): string =>
  path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-wt`);

/** The path a new worktree for `branch` gets. Slashes in the branch make nested dirs, like git refs. */
export const worktreePathFor = (repoRoot: string, branch: string): string =>
  path.join(worktreeRoot(repoRoot), ...branch.split('/'));

function projectDir(config: Config, projectId: string): string {
  const project = config.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);
  return expand(project.path);
}

async function listWorktrees(cwd: string): Promise<ListedWorktree[] | null> {
  const r = await git(cwd, ['worktree', 'list', '--porcelain']);
  return r.code === 0 ? parseWorktreeList(r.stdout) : null;
}

/** What the "New Claude in worktree" dialog needs: repo root, current branch, local branches, existing worktrees. */
export async function worktreeInfo(config: Config, projectId: string): Promise<WorktreeInfo> {
  const cwd = projectDir(config, projectId);
  const list = await listWorktrees(cwd);
  // The first entry is the main worktree, also when the project dir is itself a linked worktree.
  if (!list?.length)
    return { isRepo: false, repoRoot: '', root: '', current: '', branches: [], worktrees: [] };
  const repoRoot = list[0].path;
  const [current, refs] = await Promise.all([
    git(cwd, ['branch', '--show-current']),
    git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
  ]);
  return {
    isRepo: true,
    repoRoot,
    root: worktreeRoot(repoRoot),
    current: current.stdout.trim(),
    branches: refs.stdout.split('\n').filter(Boolean),
    worktrees: list.filter((w) => w.branch).map((w) => ({ path: w.path, branch: w.branch })),
  };
}

/**
 * The worktree to run a session for `branch` in. Reuses the worktree that already has the branch checked out;
 * otherwise `git worktree add` at `<repo>-wt/<branch>` — checking out the branch if it exists, else creating it
 * from the project's current HEAD. Git's own message is thrown on failure.
 */
export async function ensureWorktree(
  config: Config,
  projectId: string,
  branchInput: string,
): Promise<Worktree> {
  const cwd = projectDir(config, projectId);
  const branch = branchInput.trim();
  // check-ref-format also rules out `..`, spaces and other path tricks; a leading `-` would read as an option.
  const valid =
    branch && !branch.startsWith('-') && (await git(cwd, ['check-ref-format', '--branch', branch]));
  if (!valid || valid.code !== 0) throw new Error(`Invalid branch name: ${branch || '(empty)'}`);

  const list = await listWorktrees(cwd);
  if (!list?.length) throw new Error(`Not a git repository: ${cwd}`);
  const existing = list.find((w) => w.branch === branch);
  if (existing) return { path: existing.path, branch };

  const target = worktreePathFor(list[0].path, branch);
  if (fs.existsSync(target)) throw new Error(`Folder already exists: ${target}`);
  const hasBranch = (await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0;
  const r = await git(
    cwd,
    hasBranch ? ['worktree', 'add', target, branch] : ['worktree', 'add', '-b', branch, target],
  );
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git worktree add failed (${r.code})`);
  return { path: target, branch };
}
