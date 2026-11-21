// Remote folder picker (T56): the folders in one directory on an SSH host, over the shared connection. Read-only:
// `cd` + a glob, nothing is created or changed. Hidden folders are left out.
import type { RemoteDirList, RemoteHost } from '../../src/shared/api/types';
import { execError, sshExec, type RemoteExec } from './exec';
import { remotePath } from './ssh';

/** Most folders shown for one directory (a home with thousands of entries stays usable). */
export const MAX_DIRS = 500;

/** Prints `pwd=<dir>`, then `dir=<name>` (and `repo=<name>` for git repos), or `missing` when it can't `cd` there. */
export function listScript(dir: string): string {
  const target = dir.trim() ? remotePath(dir) : '"$HOME"';
  return [
    `cd -- ${target} 2>/dev/null || { echo missing; exit 0; }`,
    'printf "pwd=%s\\n" "$PWD"',
    `n=0; for d in */; do [ -d "$d" ] || continue; n=$((n+1)); [ $n -gt ${MAX_DIRS} ] && break; d=\${d%/}; printf "dir=%s\\n" "$d"; if [ -e "$d/.git" ]; then printf "repo=%s\\n" "$d"; fi; done; exit 0`,
  ].join('\n');
}

/** Script output → list (names sorted; `path` is the host's absolute path). */
export function parseList(stdout: string, asked: string): RemoteDirList {
  const lines = stdout.split('\n');
  if (lines.some((l) => l.trim() === 'missing')) return { path: asked, exists: false, dirs: [] };
  let path = asked;
  const dirs: string[] = [];
  const repos = new Set<string>();
  for (const line of lines) {
    if (line.startsWith('pwd=')) path = line.slice(4);
    else if (line.startsWith('dir=')) dirs.push(line.slice(4));
    else if (line.startsWith('repo=')) repos.add(line.slice(5));
  }
  dirs.sort((a, b) => a.localeCompare(b));
  return { path, exists: true, dirs: dirs.map((name) => ({ name, repo: repos.has(name) })) };
}

/** Folders in `dir` on the host (`~` or blank = home). Throws ssh's message when the host can't be reached. */
export async function listRemoteDirs(
  host: RemoteHost,
  dir: string,
  exec: RemoteExec = sshExec,
): Promise<RemoteDirList> {
  const r = await exec(host, listScript(dir), { timeoutMs: 20_000, maxBytes: 1024 * 1024 });
  if (r.code !== 0) throw new Error(execError(r, `ssh exited with ${r.code}`));
  return parseList(r.stdout.toString('utf8'), dir);
}
