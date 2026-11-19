// Changes panel data: branch + changed files (`git status --porcelain=v1 -b -z`) and the unified diff
// (`git diff --no-color HEAD`, plus untracked files as new-file diffs). Read-only; output capped at 400 KB.
import { execFile } from 'node:child_process';
import { expand } from './config';
import type { Config, GitChanges, GitFileChange } from '../src/shared/api/types';

export const DIFF_CAP = 400 * 1024;
const MAX_UNTRACKED_DIFFS = 20;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      { cwd, maxBuffer: DIFF_CAP * 4, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
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

/** `worktree` = a worktree session's dir (T7), resolved by main from a live session; default is the project dir. */
export async function gitChanges(config: Config, projectId: string, worktree?: string): Promise<GitChanges> {
  const project = config.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);
  const cwd = worktree ?? expand(project.path);
  const empty: GitChanges = {
    isRepo: false,
    branch: '',
    ahead: 0,
    behind: 0,
    files: [],
    diff: '',
    truncated: false,
  };

  const status = await git(cwd, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
  if (status.code !== 0) return empty;
  const parsed = parseStatus(status.stdout);

  // Staged + unstaged against HEAD; a repo without commits has no HEAD, fall back to the worktree diff.
  let diff = await git(cwd, ['diff', '--no-color', 'HEAD']);
  if (diff.code !== 0) diff = await git(cwd, ['diff', '--no-color']);
  let text = diff.stdout;

  for (const f of parsed.files.filter((x) => x.status === '?').slice(0, MAX_UNTRACKED_DIFFS)) {
    if (Buffer.byteLength(text) > DIFF_CAP) break;
    // --no-index exits 1 when the files differ, which is always here.
    const r = await git(cwd, ['diff', '--no-color', '--no-index', '--', '/dev/null', f.path]);
    text += r.stdout;
  }

  const capped = capText(text);
  return { isRepo: true, ...parsed, diff: capped.text, truncated: capped.truncated };
}
