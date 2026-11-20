// Changes panel for remote projects (T36): the same data as `git.ts`, read over the shared SSH connection.
//
// A refresh is one round trip: a single script prints status, HEAD, (since a base) name-status, the diff and the
// untracked files' diffs as named sections, each capped on the host so a huge diff never crosses the link whole.
// No fs.watch on a host: the panel polls instead. Stage / revert reuse `gitAction` with an SSH runner; an untracked
// file is "trashed" into ~/.aquila/trash/<time>/ on the host (there is no Trash to move it to).
import type { GitChanges, RemoteHost } from '../../src/shared/api/types';
import { capText, DIFF_CAP, parseNameStatus, parseStatus, type GitRun, type TrashFile } from '../git';
import { boundary, execError, parseSections, sectionLine, type RemoteExec } from './exec';
import { remotePath, shq } from './ssh';

const MAX_UNTRACKED_DIFFS = 20;
/** Bytes per section read on the host: one more than the cap, so "truncated" is still known here. */
const READ_CAP = DIFF_CAP + 1;
/** Exit code of our scripts when the project folder is missing on the host. */
export const NO_FOLDER = 3;

/** A commit id from our own records (a session's start); anything else is dropped rather than quoted into a script. */
const sha = (s: string | undefined): string => (s && /^[0-9a-f]{4,64}$/.test(s) ? s : '');

/** `git` with the options the local runner uses. */
const GIT = 'git -c core.quotepath=off';

/** The refresh script. `path` is the folder on the host (`~/…` = the remote home). */
export function changesScript(path: string, b: string, base?: string): string {
  const since = sha(base);
  return [
    `cd ${remotePath(path)} 2>/dev/null || { echo 'aquila: folder not found on the host' >&2; exit ${NO_FOLDER}; }`,
    'export GIT_OPTIONAL_LOCKS=0',
    sectionLine(b, 'status'),
    `${GIT} status --porcelain=v1 -b -z --untracked-files=all 2>/dev/null || { ${sectionLine(b, 'norepo')}; exit 0; }`,
    'h=$(git rev-parse --verify -q HEAD 2>/dev/null)',
    sectionLine(b, 'head'),
    `printf '%s' "$h"`,
    `base=${since ? shq(since) : "''"}`,
    'a=${base:-$h}',
    `if [ -n "$base" ] && [ "$base" != "$h" ]; then ${sectionLine(b, 'names')}; ${GIT} diff --name-status -z "$base"; fi`,
    sectionLine(b, 'diff'),
    `{ if [ -n "$a" ]; then ${GIT} diff --no-color "$a" 2>/dev/null || ${GIT} diff --no-color; else ${GIT} diff --no-color; fi; } | head -c ${READ_CAP}`,
    sectionLine(b, 'untracked'),
    // Names git had to quote (newlines, quotes) are skipped: `git diff` wouldn't find them as written.
    `${GIT} ls-files --others --exclude-standard | head -n ${MAX_UNTRACKED_DIFFS} | while IFS= read -r f; do ` +
      `case "$f" in '"'*) continue;; esac; ${GIT} diff --no-color --no-index -- /dev/null "$f"; done | head -c ${READ_CAP}`,
    sectionLine(b, 'end'),
  ].join('\n');
}

const empty = (): GitChanges => ({
  isRepo: false,
  branch: '',
  ahead: 0,
  behind: 0,
  files: [],
  diff: '',
  truncated: false,
  checkedAt: Date.now(),
});

/** Script output → what the panel shows (pure; exported for tests). */
export function parseChanges(out: string, b: string, base?: string): GitChanges {
  const sec = parseSections(out, b);
  if (sec.has('norepo') || !sec.has('status')) return empty();
  const parsed = parseStatus(sec.get('status') ?? '');
  const head = (sec.get('head') ?? '').trim();
  const since = sha(base);
  let files = parsed.files;
  if (sec.has('names'))
    files = [...parseNameStatus(sec.get('names') ?? ''), ...parsed.files.filter((f) => f.status === '?')];
  const diff = sec.get('diff') ?? '';
  const untracked = sec.get('untracked') ?? '';
  const capped = capText(diff + untracked);
  return {
    isRepo: true,
    ...parsed,
    files,
    diff: capped.text,
    truncated:
      capped.truncated || Buffer.byteLength(diff) >= READ_CAP || Buffer.byteLength(untracked) >= READ_CAP,
    base: since || head,
    checkedAt: Date.now(),
  };
}

export async function remoteGitChanges(
  exec: RemoteExec,
  host: RemoteHost,
  path: string,
  base?: string,
): Promise<GitChanges> {
  const b = boundary();
  const r = await exec(host, changesScript(path, b, base), { timeoutMs: 30_000 });
  const out = r.stdout.toString('utf8');
  if (!out.includes(`${b} end`) && !out.includes(`${b} norepo`)) throw new Error(execError(r, `ssh ${host.alias} failed`));
  return { ...parseChanges(out, b, base), latencyMs: r.ms };
}

/** One git command in the project folder on the host; stdin carries patches. Output starts after our marker. */
export function remoteGit(exec: RemoteExec, host: RemoteHost, path: string): GitRun {
  return async (args, input) => {
    const b = boundary();
    const script = [
      `cd ${remotePath(path)} || exit ${NO_FOLDER}`,
      sectionLine(b, 'out'),
      `GIT_OPTIONAL_LOCKS=0 exec ${GIT} ${args.map(shq).join(' ')}`,
    ].join('\n');
    const r = await exec(host, script, { input, timeoutMs: 30_000 });
    const out = parseSections(r.stdout.toString('utf8'), b).get('out');
    if (out === undefined) return { code: r.code || 1, stdout: '', stderr: execError(r, `ssh ${host.alias} failed`) };
    return { code: r.code, stdout: out, stderr: r.stderr };
  };
}

/** A path relative to the tree that stays inside it (no absolute paths, no `..`). */
export function safeRelative(rel: string): boolean {
  return (
    !!rel &&
    !rel.startsWith('/') &&
    !rel.split('/').some((p) => p === '..' || p === '') &&
    !rel.includes('\n')
  );
}

/** Moves an untracked file to `~/.aquila/trash/<stamp>/<rel>` on the host (keeping its folders) and says where. */
export function remoteTrash(exec: RemoteExec, host: RemoteHost, path: string, now = Date.now): TrashFile {
  return async (rel) => {
    if (!safeRelative(rel)) throw new Error('Path outside the tree');
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const dir = `.aquila/trash/${stamp}`;
    const parent = rel.includes('/') ? `/${rel.slice(0, rel.lastIndexOf('/'))}` : '';
    const script = [
      `cd ${remotePath(path)} || exit ${NO_FOLDER}`,
      `t="$HOME"/${shq(dir + parent)}`,
      `mkdir -p "$t" && mv -- ${shq(rel)} "$t"/`,
    ].join(' && ');
    const r = await exec(host, script, { timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error(execError(r, 'mv failed'));
    return `~/${dir}/${rel}`;
  };
}

/** HEAD in the project folder on the host ('' when there is none or the host can't be reached). */
export async function remoteHeadSha(exec: RemoteExec, host: RemoteHost, path: string): Promise<string> {
  const r = await remoteGit(exec, host, path)(['rev-parse', '--verify', '-q', 'HEAD']);
  const out = r.stdout.trim();
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(out) ? out : '';
}
