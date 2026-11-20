// POSIX shell syntax for session commands: macOS login shells, Git Bash and bash inside WSL.
import type { SessionCommand } from './types';

/** `'…'` for sh, with embedded quotes escaped. */
export const posixQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Bare when safe, so `claude` stays a bare word and the user's aliases and functions keep working. */
export const posixWord = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : posixQuote(s));

/**
 * The part of a `-c` script that runs before `exec <shell> -l -i`: setup (own line), then the program with its
 * failure marker. '' when there is nothing to run.
 */
export function posixPrelude(cmd: SessionCommand): string {
  const pre = cmd.setup?.script.trim()
    ? `printf '\\033[2m%s\\033[0m\\n' ${posixQuote(cmd.setup.banner)}; ${cmd.setup.script.trim()}\n`
    : '';
  if (!cmd.argv) return pre;
  let line = cmd.argv.map(posixWord).join(' ');
  if (cmd.onFail) line += ` || printf '\\033]7501;${cmd.onFail}\\007'`;
  return `${pre}${line}; `;
}
