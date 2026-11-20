// Worktree sessions (T7, T38): a session can run in `../<repo>-wt/<branch>`, a git worktree of the project's repo, so
// parallel agents don't edit the same checkout. Existing worktrees of a branch are reused. New worktrees get the
// gitignored files listed in `.worktreeinclude` (e.g. `.env`). Cleanup suggests merged + clean worktrees and removes
// them with plain `git worktree remove` (never `--force`).
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expand } from './config';
import type {
  Config,
  Project,
  Worktree,
  WorktreeCandidate,
  WorktreeInfo,
} from '../src/shared/api/types';

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
  /** `git worktree lock`ed: git won't remove it without `--force`, so we leave it alone. */
  locked?: true;
  /** Its folder is gone (`git worktree prune` would drop it). */
  prunable?: true;
}

/** Parse `git worktree list --porcelain`: blocks of `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<b>`. */
export function parseWorktreeList(out: string): ListedWorktree[] {
  const list: ListedWorktree[] = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) list.push({ path: line.slice('worktree '.length), branch: '' });
    else if (line.startsWith('branch ') && list.length)
      list[list.length - 1].branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    else if ((line === 'locked' || line.startsWith('locked ')) && list.length) list[list.length - 1].locked = true;
    else if ((line === 'prunable' || line.startsWith('prunable ')) && list.length)
      list[list.length - 1].prunable = true;
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
  /** Paths (relative to the repo) copied from `.worktreeinclude` into a new worktree. */
  copied?: string[];
}

/** Lines of a git `-z` output. */
const zList = (out: string): string[] => out.split('\0').filter(Boolean);

/**
 * Copies the gitignored files listed in the repo's `.worktreeinclude` (gitignore syntax) from the main worktree
 * into a new one — e.g. `.env`, which a fresh checkout lacks. Only files that match a pattern **and** are ignored by
 * git are copied; tracked files come with the checkout and untracked-but-not-ignored ones are left out. Never
 * overwrites. Returns the copied paths (a matched folder is one entry).
 */
export async function copyWorktreeInclude(repoRoot: string, target: string): Promise<string[]> {
  const includeFile = path.join(repoRoot, '.worktreeinclude');
  if (!fs.existsSync(includeFile)) return [];
  // Untracked entries matching the include patterns (a matched folder collapses to `dir/`).
  const matched = await git(repoRoot, [
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    '--directory',
    `--exclude-from=${includeFile}`,
  ]);
  const candidates = matched.code === 0 ? zList(matched.stdout) : [];
  if (!candidates.length) return [];
  // …of those, the ones git ignores. check-ignore exits 1 when none are; the output is still right.
  const ignored = await new Promise<string[]>((resolve) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=off', 'check-ignore', '-z', '--stdin'],
      { cwd: repoRoot },
      (_err, stdout) => resolve(zList(String(stdout))),
    );
    child.stdin?.end(candidates.join('\0') + '\0');
  });
  const keep = new Set(ignored);
  const copied: string[] = [];
  const root = path.resolve(target);
  for (const rel of candidates) {
    if (!keep.has(rel)) continue;
    const from = path.resolve(repoRoot, rel);
    const to = path.resolve(root, rel);
    // Paths come from git, but stay inside both trees whatever happens.
    if (!from.startsWith(path.resolve(repoRoot) + path.sep) || !to.startsWith(root + path.sep)) continue;
    if (fs.existsSync(to)) continue;
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
      copied.push(rel);
    } catch {
      // A file that vanished or can't be read: skip it, the worktree is still usable.
    }
  }
  return copied;
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
  const copied = await copyWorktreeInclude(list[0].path, target);
  return { worktree: { path: target, branch }, created: true, copied };
}

/** Real path when it exists, else the path as is (macOS /var → /private/var and the like). */
function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * The project's linked worktrees (not the main one) with what cleanup needs to know: merged into the base branch,
 * clean, open in a tab. `openPaths` = worktree paths of the open tabs (live and dormant). Locked worktrees, detached
 * ones and ones whose folder is gone are left out.
 */
export async function worktreeCandidates(
  config: Config,
  projectId: string,
  openPaths: string[],
): Promise<WorktreeCandidate[]> {
  const project = projectOf(config, projectId);
  const cwd = expand(project.path);
  const list = await listWorktrees(cwd);
  if (!list?.length) return [];
  const main = list[0].path;
  const base = (await baseRef(cwd, project.defaultBranch)) ?? 'HEAD';
  // `HEAD` of the project dir; resolved in the main worktree when the project dir is a linked one.
  const baseCwd = base === 'HEAD' ? cwd : main;
  const open = new Set(openPaths.map(real));
  const linked = list.slice(1).filter((w) => w.branch && !w.locked && !w.prunable && fs.existsSync(w.path));
  return Promise.all(
    linked.map(async (w): Promise<WorktreeCandidate> => {
      const [merged, status] = await Promise.all([
        git(baseCwd, ['merge-base', '--is-ancestor', `refs/heads/${w.branch}`, base]),
        git(w.path, ['status', '--porcelain']),
      ]);
      return {
        path: w.path,
        branch: w.branch,
        merged: merged.code === 0,
        clean: status.code === 0 && status.stdout.trim() === '',
        open: open.has(real(w.path)),
      };
    }),
  );
}

/**
 * `git worktree remove <path>` for one of the project's linked worktrees — never `--force`, so git refuses (and its
 * message is thrown) when the worktree has changes. Refuses the main worktree, unknown paths and worktrees open in a
 * tab. The branch is kept.
 */
export async function removeWorktree(
  config: Config,
  projectId: string,
  target: string,
  openPaths: string[],
): Promise<void> {
  const project = projectOf(config, projectId);
  const cwd = expand(project.path);
  const list = await listWorktrees(cwd);
  if (!list?.length) throw new Error(`Not a git repository: ${cwd}`);
  const want = real(target);
  const entry = list.slice(1).find((w) => real(w.path) === want);
  if (!entry) throw new Error(`Not a worktree of ${project.name}: ${target}`);
  if (openPaths.some((p) => real(p) === want)) throw new Error(`Worktree is open in a tab: ${entry.path}`);
  const r = await git(list[0].path, ['worktree', 'remove', entry.path]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git worktree remove failed (${r.code})`);
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
    const target = real(dir);
    return Math.max(0, parseWorktreeList(out.toString()).findIndex((w) => real(w.path) === target));
  } catch {
    return 0;
  }
}
