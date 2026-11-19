// Apps opened from Finder get launchd's minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so `claude`, `codex`
// and Homebrew/fnm tools are missing for anything main runs directly (git panel, CLI checks).
// Read the PATH a login + interactive shell would have, once at startup. Sessions already start a login shell.
import { execFile } from 'node:child_process';
import os from 'node:os';

const MARK = '__AQUILA_PATH__';

export function userShell(): string {
  return process.env.SHELL || os.userInfo().shell || '/bin/zsh';
}

/** Pull the PATH out of shell output that may contain rc-file noise around it. */
export function parseShellPath(output: string): string | null {
  const start = output.indexOf(MARK);
  const end = output.indexOf(MARK, start + MARK.length);
  if (start < 0 || end < 0) return null;
  const value = output.slice(start + MARK.length, end).trim();
  return value.includes('/') ? value : null;
}

/** Merge the shell's PATH in front of the current one, keeping order and dropping duplicates. */
export function mergePath(shellPath: string, current: string | undefined): string {
  const seen = new Set<string>();
  return [...shellPath.split(':'), ...(current ?? '').split(':')]
    .filter((p) => p && !seen.has(p) && seen.add(p))
    .join(':');
}

/** Resolves when done; never rejects (keeps the current PATH on timeout or error). */
export function restoreShellPath(timeoutMs = 5000): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve();
  const shell = userShell();
  process.env.SHELL ??= shell;
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-l', '-i', '-c', `printf '${MARK}%s${MARK}' "$PATH"`],
      { timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' } },
      (_err, stdout) => {
        const shellPath = parseShellPath(String(stdout ?? ''));
        if (shellPath) process.env.PATH = mergePath(shellPath, process.env.PATH);
        resolve();
      },
    );
  });
}
