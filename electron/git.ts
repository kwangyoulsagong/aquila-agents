// Changes panel data: branch + changed files (`git status --porcelain=v1 -b -z`) and the unified diff
// (`git diff --no-color HEAD`, plus untracked files as new-file diffs), capped at 400 KB.
// T25: a debounced fs.watch of the tree, a diff cache keyed on a cheap fingerprint (status + mtimes), a diff
// against the commit a session started at, and stage/unstage/revert of files and hunks (reverts back up first).
import { execFile, spawn } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { expand } from './config';
import type {
  Config,
  GitAction,
  GitActionResult,
  GitChanges,
  GitFileChange,
} from '../src/shared/api/types';

export const DIFF_CAP = 400 * 1024;
const MAX_UNTRACKED_DIFFS = 20;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };

/** Run git with `input` on stdin (`git apply -`). */
function gitInput(cwd: string, args: string[], input: string): Promise<Run> {
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd, env: GIT_ENV });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('error', (e) => resolve({ code: 1, stdout, stderr: e.message }));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    p.stdin.end(input);
  });
}

function git(cwd: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      { cwd, maxBuffer: DIFF_CAP * 4, env: GIT_ENV },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** `## main...origin/main [ahead 1, behind 2]` → branch + ahead/behind. */
export function parseBranchLine(line: string): Pick<GitChanges, 'branch' | 'ahead' | 'behind'> {
  const head = line.replace(/^## /, '');
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
  let branch = head.replace(/ \[.*\]$/, '');
  if (branch.startsWith('No commits yet on ')) branch = branch.slice('No commits yet on '.length);
  else if (branch.startsWith('HEAD (no branch)')) branch = 'HEAD';
  else branch = branch.split('...')[0];
  return { branch, ahead, behind };
}

/** Parse `git status --porcelain=v1 -b -z`. Renames/copies carry the original path in the next NUL field. */
export function parseStatus(out: string): Pick<GitChanges, 'branch' | 'ahead' | 'behind' | 'files'> {
  const fields = out.split('\0');
  let info: Pick<GitChanges, 'branch' | 'ahead' | 'behind'> = { branch: '', ahead: 0, behind: 0 };
  const files: GitFileChange[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    if (f.startsWith('## ')) {
      info = parseBranchLine(f);
      continue;
    }
    const index = f[0];
    const worktree = f[1];
    const file: GitFileChange = { path: f.slice(3), index, worktree, status: statusLetter(index, worktree) };
    if (index === 'R' || index === 'C') file.origPath = fields[++i];
    files.push(file);
  }
  return { ...info, files };
}

/** One letter for the list: ? untracked, U conflict, otherwise the worktree change, else the staged one. */
export function statusLetter(index: string, worktree: string): string {
  if (index === '?' && worktree === '?') return '?';
  if (
    index === 'U' ||
    worktree === 'U' ||
    (index === 'A' && worktree === 'A') ||
    (index === 'D' && worktree === 'D')
  )
    return 'U';
  if (index === 'R' || index === 'C') return index;
  if (worktree !== ' ') return worktree;
  return index;
}

/** Keep the first `cap` bytes, cut at a line end. */
export function capText(text: string, cap = DIFF_CAP): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= cap) return { text, truncated: false };
  const cut = Buffer.from(text).subarray(0, cap).toString('utf8');
  const nl = cut.lastIndexOf('\n');
  return { text: nl > 0 ? cut.slice(0, nl + 1) : cut, truncated: true };
}

/** Parse `git diff --name-status -z`: `M\0path`, `R100\0old\0new`. */
export function parseNameStatus(out: string): GitFileChange[] {
  const fields = out.split('\0');
  const files: GitFileChange[] = [];
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i];
    if (!code) continue;
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const origPath = fields[++i];
      files.push({ path: fields[++i], origPath, index: letter, worktree: ' ', status: letter });
    } else {
      files.push({ path: fields[++i], index: letter, worktree: ' ', status: letter });
    }
  }
  return files.filter((f) => f.path);
}

/** Commit sha of HEAD in `cwd`; '' when there is none (fresh repo, not a repo). */
export async function headSha(cwd: string): Promise<string> {
  const r = await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : '';
}

const MAX_FINGERPRINT_FILES = 500;
const MAX_CACHED = 8;
/** Last diff per tree + base, reused while the fingerprint is the same ("lazy diff"). */
const diffCache = new Map<string, { fingerprint: string; diff: string; truncated: boolean }>();

/** Status output + HEAD + mtime/size of each changed file: equal fingerprints mean an equal diff. */
async function fingerprint(cwd: string, statusOut: string, head: string, files: GitFileChange[]) {
  const stats = await Promise.all(
    files.slice(0, MAX_FINGERPRINT_FILES).map((f) =>
      stat(path.join(cwd, f.path)).then(
        (s) => `${s.mtimeMs}:${s.size}`,
        () => '-',
      ),
    ),
  );
  return [statusOut, head, files.length, ...stats].join('\n');
}

/** The project dir, or `worktree` (a worktree session's dir, resolved by main from a live session). */
export function treeOf(config: Config, projectId: string, worktree?: string): string {
  const project = config.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);
  return worktree ?? expand(project.path);
}

/**
 * `worktree` = a worktree session's dir (T7), resolved by main from a live session; default is the project dir.
 * `base` = diff against that commit (a session's start, T25) instead of HEAD; files then include committed ones.
 */
export async function gitChanges(
  config: Config,
  projectId: string,
  worktree?: string,
  base?: string,
): Promise<GitChanges> {
  const cwd = treeOf(config, projectId, worktree);
  const empty: GitChanges = {
    isRepo: false,
    branch: '',
    ahead: 0,
    behind: 0,
    files: [],
    diff: '',
    truncated: false,
    checkedAt: Date.now(),
  };

  const status = await git(cwd, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
  if (status.code !== 0) return empty;
  const parsed = parseStatus(status.stdout);
  const head = await headSha(cwd);
  const against = base || head;

  let files = parsed.files;
  let nameStatus = '';
  if (base && base !== head) {
    const r = await git(cwd, ['diff', '--name-status', '-z', base]);
    nameStatus = r.stdout;
    files = [...parseNameStatus(r.stdout), ...parsed.files.filter((f) => f.status === '?')];
  }

  const key = `${cwd}\n${against}`;
  const fp = await fingerprint(cwd, status.stdout + nameStatus, head, files);
  const cached = diffCache.get(key);
  if (cached?.fingerprint === fp) {
    return { isRepo: true, ...parsed, files, diff: cached.diff, truncated: cached.truncated, base: against, checkedAt: Date.now() };
  }

  // Staged + unstaged against the base; a repo without commits has no HEAD, fall back to the worktree diff.
  let diff = against ? await git(cwd, ['diff', '--no-color', against]) : null;
  if (!diff || diff.code !== 0) diff = await git(cwd, ['diff', '--no-color']);
  let text = diff.stdout;

  for (const f of files.filter((x) => x.status === '?').slice(0, MAX_UNTRACKED_DIFFS)) {
    if (Buffer.byteLength(text) > DIFF_CAP) break;
    // --no-index exits 1 when the files differ, which is always here.
    const r = await git(cwd, ['diff', '--no-color', '--no-index', '--', '/dev/null', f.path]);
    text += r.stdout;
  }

  const capped = capText(text);
  diffCache.delete(key);
  diffCache.set(key, { fingerprint: fp, diff: capped.text, truncated: capped.truncated });
  while (diffCache.size > MAX_CACHED) diffCache.delete(diffCache.keys().next().value as string);
  return { isRepo: true, ...parsed, files, diff: capped.text, truncated: capped.truncated, base: against, checkedAt: Date.now() };
}

/** Paths under the tree whose changes can't change the panel: git internals (except index/HEAD/refs), node_modules. */
export function ignoredPath(rel: string): boolean {
  const p = rel.split(path.sep).join('/');
  if (p === '.git' || p.startsWith('.git/')) {
    return !(p === '.git/index' || p === '.git/HEAD' || p.startsWith('.git/refs/'));
  }
  return /(^|\/)node_modules(\/|$)/.test(p) || p.endsWith('.DS_Store');
}

/**
 * One recursive fs.watch on a tree; `onChange` fires `debounceMs` after the last event, at most `maxWaitMs` after the
 * first (a build writing for minutes still refreshes). A failed watch just stops: the panel's slow poll covers it.
 */
export class TreeWatcher {
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstAt = 0;
  cwd: string | null = null;

  constructor(
    private readonly onChange: () => void,
    private readonly debounceMs = 400,
    private readonly maxWaitMs = 2000,
  ) {}

  watch(cwd: string | null): void {
    if (cwd === this.cwd) return;
    this.close();
    this.cwd = cwd;
    if (!cwd) return;
    try {
      this.watcher = watch(cwd, { recursive: true }, (_event, file) => this.event(file));
      this.watcher.on('error', () => this.stopWatching());
    } catch {
      this.watcher = null;
    }
  }

  /** A raw fs event (exposed for tests). `file` is relative to the tree; null when the OS didn't say. */
  event(file: string | Buffer | null): void {
    if (file && ignoredPath(String(file))) return;
    const now = Date.now();
    if (!this.timer) this.firstAt = now;
    else clearTimeout(this.timer);
    const wait = Math.min(this.debounceMs, Math.max(0, this.firstAt + this.maxWaitMs - now));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange();
    }, wait);
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  close(): void {
    this.stopWatching();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.cwd = null;
  }
}

function fail(r: Run, what: string): never {
  throw new Error(r.stderr.trim().split('\n')[0] || `git ${what} failed`);
}

/** Save the tracked state (index + worktree) as a stash entry without touching the tree; '' when clean. */
export async function stashBackup(cwd: string, label: string): Promise<string> {
  const created = await git(cwd, ['stash', 'create']);
  const sha = created.stdout.trim();
  if (created.code !== 0 || !sha) return '';
  const stored = await git(cwd, ['stash', 'store', '-m', `aquila: before revert ${label}`, sha]);
  if (stored.code !== 0) fail(stored, 'stash store');
  return sha;
}

/**
 * Stage / unstage / revert in `cwd`. Reverts back up first: tracked state to a stash entry, an untracked file to the
 * Trash (`trash` = Electron's shell.trashItem, injected so tests can stub it).
 */
export async function gitAction(
  cwd: string,
  a: Pick<GitAction, 'action' | 'path' | 'origPath' | 'patch'>,
  trash: (absPath: string) => Promise<void>,
): Promise<GitActionResult> {
  const paths = a.origPath ? [a.path, a.origPath] : [a.path];
  switch (a.action) {
    case 'stage-file': {
      const r = await git(cwd, ['add', '-A', '--', ...paths]);
      if (r.code !== 0) fail(r, 'add');
      return {};
    }
    case 'unstage-file': {
      let r = await git(cwd, ['reset', '-q', 'HEAD', '--', ...paths]);
      if (r.code !== 0) r = await git(cwd, ['rm', '-q', '--cached', '--', ...paths]); // no HEAD yet
      if (r.code !== 0) fail(r, 'reset');
      return {};
    }
    case 'stage-hunk': {
      if (!a.patch) throw new Error('No hunk');
      const r = await gitInput(cwd, ['apply', '--cached', '--whitespace=nowarn', '-'], a.patch);
      if (r.code !== 0) fail(r, 'apply');
      return {};
    }
    case 'revert-hunk': {
      if (!a.patch) throw new Error('No hunk');
      const check = await gitInput(cwd, ['apply', '-R', '--check', '--whitespace=nowarn', '-'], a.patch);
      if (check.code !== 0) fail(check, 'apply');
      const stash = await stashBackup(cwd, a.path);
      const r = await gitInput(cwd, ['apply', '-R', '--whitespace=nowarn', '-'], a.patch);
      if (r.code !== 0) fail(r, 'apply');
      return stash ? { stash } : {};
    }
    case 'revert-file': {
      const st = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', a.path]);
      if (st.stdout.startsWith('??')) {
        const abs = path.resolve(cwd, a.path);
        if (!abs.startsWith(path.resolve(cwd) + path.sep)) throw new Error('Path outside the tree');
        await trash(abs);
        return { trashed: [a.path] };
      }
      if (!(await headSha(cwd))) throw new Error('No commits yet');
      const stash = await stashBackup(cwd, a.path);
      const r = await git(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths]);
      if (r.code !== 0) fail(r, 'restore');
      return stash ? { stash } : {};
    }
  }
}
