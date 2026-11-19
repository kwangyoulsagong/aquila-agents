// Worktree sessions (T7): "New Claude in worktree" puts the session in `../<repo>-wt/<branch>`, a git worktree of the
// project's repo, so parallel agents don't edit the same checkout. Existing worktrees of a branch are reused.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expand } from './config';
import type { Config, Project, Worktree, WorktreeInfo } from '../src/shared/api/types';

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

function projectOf(config: Config, projectId: string): Project {
  const project = config.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);
  return project;
}

/** The project's default branch if it names a commit here (`main`, `origin/main`), else null (= current HEAD). */
async function baseRef(cwd: string, defaultBranch: string | undefined): Promise<string | null> {
  const ref = defaultBranch?.trim();
  if (!ref || ref.startsWith('-')) return null;
  const r = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.code === 0 ? ref : null;
}

/** A worktree to run a session in, and what the session should do about it. */
export interface EnsuredWorktree {
  worktree: Worktree;
  /** Made by this call (the project's setup script runs once, in it). */
  created: boolean;
}

async function listWorktrees(cwd: string): Promise<ListedWorktree[] | null> {
  const r = await git(cwd, ['worktree', 'list', '--porcelain']);
  return r.code === 0 ? parseWorktreeList(r.stdout) : null;
}

/** What the "New Claude in worktree" dialog needs: repo root, current branch, local branches, existing worktrees. */
export async function worktreeInfo(config: Config, projectId: string): Promise<WorktreeInfo> {
  const project = projectOf(config, projectId);
  const cwd = expand(project.path);
  const list = await listWorktrees(cwd);
  // The first entry is the main worktree, also when the project dir is itself a linked worktree.
  if (!list?.length)
    return { isRepo: false, repoRoot: '', root: '', current: '', base: '', branches: [], worktrees: [] };
  const repoRoot = list[0].path;
  const [current, refs, base] = await Promise.all([
    git(cwd, ['branch', '--show-current']),
    git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    baseRef(cwd, project.defaultBranch),
  ]);
  return {
    isRepo: true,
    repoRoot,
    root: worktreeRoot(repoRoot),
    current: current.stdout.trim(),
    base: base ?? current.stdout.trim(),
    branches: refs.stdout.split('\n').filter(Boolean),
    worktrees: list.filter((w) => w.branch).map((w) => ({ path: w.path, branch: w.branch })),
  };
}

/**
 * The worktree to run a session for `branch` in. Reuses the worktree that already has the branch checked out;
 * otherwise `git worktree add` at `<repo>-wt/<branch>` — checking out the branch if it exists, else creating it
 * from the project's default branch (or its current HEAD). Git's own message is thrown on failure.
 */
export async function ensureWorktree(
  config: Config,
  projectId: string,
  branchInput: string,
): Promise<EnsuredWorktree> {
  const project = projectOf(config, projectId);
  const cwd = expand(project.path);
  const branch = branchInput.trim();
  // check-ref-format also rules out `..`, spaces and other path tricks; a leading `-` would read as an option.
  const valid =
    branch && !branch.startsWith('-') && (await git(cwd, ['check-ref-format', '--branch', branch]));
  if (!valid || valid.code !== 0) throw new Error(`Invalid branch name: ${branch || '(empty)'}`);

  const list = await listWorktrees(cwd);
  if (!list?.length) throw new Error(`Not a git repository: ${cwd}`);
  const index = list.findIndex((w) => w.branch === branch);
  if (index >= 0) return { worktree: { path: list[index].path, branch }, created: false };

  const target = worktreePathFor(list[0].path, branch);
  if (fs.existsSync(target)) throw new Error(`Folder already exists: ${target}`);
  const hasBranch = (await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0;
  const base = hasBranch ? null : await baseRef(cwd, project.defaultBranch);
  const r = await git(
    cwd,
    hasBranch
      ? ['worktree', 'add', target, branch]
      : ['worktree', 'add', '--no-track', '-b', branch, target, ...(base ? [base] : [])],
  );
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git worktree add failed (${r.code})`);
  return { worktree: { path: target, branch }, created: true };
}

/** Ports a worktree gets on top of the project's port base: 10 per worktree, so each can run a few servers. */
export const PORT_STEP = 10;

/**
 * Position of `dir` in `git worktree list` (main = 0; not a listed worktree = 0). Sync: called while spawning a
 * session, and the list is a local file read. The port of a session is `portBase + PORT_STEP * slot`.
 */
export function worktreeSlot(dir: string): number {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, stdio: 'pipe', timeout: 2000 });
    const real = (p: string) => {
      try {
        return fs.realpathSync(p);
      } catch {
        return p;
      }
    };
    const target = real(dir);
    return Math.max(0, parseWorktreeList(out.toString()).findIndex((w) => real(w.path) === target));
  } catch {
    return 0;
  }
}
