// macOS: every local session is the user's login + interactive shell (their PATH, fnm, aliases).
import path from 'node:path';
import { posixPrelude } from './posix';
import type { PlatformLayer, ShellProfile } from './types';

function loginShell(): ShellProfile {
  const file = process.env.SHELL || '/bin/zsh';
  return { kind: 'posix', file, label: path.basename(file) };
}

export const darwin: PlatformLayer = {
  shells: () => [loginShell()],
  refreshShells: () => Promise.resolve([loginShell()]),
  shellFor: () => loginShell(),
  spawnSpec(shell, cmd, cwd) {
    const prelude = posixPrelude(cmd);
    return {
      file: shell.file,
      args: prelude ? ['-l', '-i', '-c', `${prelude}exec ${shell.file} -l -i`] : ['-l', '-i'],
      cwd,
    };
  },
  git: (cwd, args) => ({ file: 'git', args, cwd }),
};
