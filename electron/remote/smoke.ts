// Smoke step for remote sessions (T29). There is no SSH server or tmux on a dev Mac, so `ssh` and `tmux` are
// stand-ins on PATH that run the real remote script locally (HOME = a temp dir):
//   1st ssh -t: "Connection refused", exit 255     → reconnecting, retried after 3 s
//   2nd ssh: the remote script → fake tmux → shell → connected; we type a marker and see it
//   `exit 77` in that shell makes the fake ssh exit 255 (link dropped) → reconnecting → connected again
//   closing the tab sends `tmux kill-session` for its session over ssh
// Returns an error or null. Nothing outside the temp dir is touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionManager } from '../sessions';
import type { Config, ConnectionState } from '../../src/shared/api/types';
import { STABLE_MS } from './reconnect';

const FAKE_SSH = `#!/bin/sh
# smoke stand-in for ssh: skip options up to "--", run the remote script locally.
dir=$(cd "$(dirname "$0")" && pwd)
# Only the tab's interactive ssh (-t) is refused once: the session's own BatchMode calls (git HEAD at start) run
# alongside it and must not use up the refusal, or the tab connects first try and never shows "reconnecting".
tty=
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do [ "$1" = -t ] && tty=1; shift; done
shift
if [ -n "$tty" ] && [ ! -f "$dir/refused" ]; then : > "$dir/refused"; echo "ssh: connect to host smoke port 22: Connection refused" >&2; exit 255; fi
HOME="$dir/home" /bin/sh -c "$1"
code=$?
[ "$code" = 77 ] && exit 255
exit "$code"
`;

const FAKE_TMUX = `#!/bin/sh
# smoke stand-in for tmux: records kill-session, otherwise runs the session command like tmux would.
case " $* " in *" kill-session "*) printf '%s\\n' "$*" > "$HOME/killed"; exit 0;; esac
printf '%s\\n' "$*" > "$HOME/tmux-args"
eval "last=\\\${$#}"
exec /bin/sh -c "$last"
`;

/** Stand-in for the remote login shell: drops -l/-i (a real login sh on macOS resets PATH from /etc/profile). */
const FAKE_SHELL = `#!/bin/sh
while [ "$1" = -l ] || [ "$1" = -i ]; do shift; done
exec /bin/sh "$@"
`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function checkRemoteSession(
  sessions: SessionManager,
  config: Config,
  output: { buffer: string; connections: { id: string; state: ConnectionState }[] },
): Promise<string | null> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-smoke-ssh-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ssh'), FAKE_SSH, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'tmux'), FAKE_TMUX, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'fakesh'), FAKE_SHELL, { mode: 0o755 });
  const oldPath = process.env.PATH;
  const oldShell = process.env.SHELL;
  // The script and the inner command run "$SHELL" -l: a plain sh keeps the user's rc files out of it.
  process.env.PATH = `${dir}:${oldPath ?? ''}`;
  process.env.SHELL = path.join(dir, 'fakesh');
  const project = {
    id: 'smoke-remote',
    name: 'smoke-remote',
    group: 'remote',
    account: 'shared',
    path: '~/proj',
    remote: { alias: 'smoke' },
  };
  const remoteConfig: Config = { ...config, projects: [...config.projects, project] };
  const states = (id: string) => output.connections.filter((c) => c.id === id).map((c) => c.state);
  const until = async (what: string, ok: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > end) throw new Error(what);
      await wait(100);
    }
  };
  let id: string | null = null;
  try {
    id = sessions.create(remoteConfig, project.id, 'shell').id;
    const sid = id;
    const connectedCount = () => states(sid).filter((s) => s === 'connected').length;
    await until(
      'remote: never connected after a refused first attempt',
      () => connectedCount() >= 1,
      3000 + STABLE_MS + 4000,
    );
    if (!states(sid).includes('reconnecting'))
      return `remote: refused connection did not show reconnecting (${states(sid)})`;
    const args = fs.readFileSync(path.join(home, 'tmux-args'), 'utf8');
    if (!args.includes('-L aquila') || !args.includes('new-session -A -s aq-'))
      return `remote: unexpected tmux command: ${args}`;
    if (!fs.existsSync(path.join(home, '.aquila', 'tmux.conf'))) return 'remote: tmux.conf not written';
    // Computed so the echoed command line never matches.
    sessions.write(sid, 'echo AQUILA_REMOTE_$((40+1))\r');
    await until('remote: no output through ssh', () => output.buffer.includes('AQUILA_REMOTE_41'), 4000);
    // Drop the link: the fake ssh turns exit 77 into 255.
    sessions.write(sid, 'exit 77\r');
    await until(
      'remote: no reconnect after the link dropped',
      () => connectedCount() >= 2,
      3000 + STABLE_MS + 4000,
    );
    sessions.write(sid, 'echo AQUILA_REMOTE_$((40+2))\r');
    await until(
      'remote: no output after reconnecting',
      () => output.buffer.includes('AQUILA_REMOTE_42'),
      4000,
    );
    sessions.kill(sid);
    id = null;
    await until(
      'remote: closing the tab did not kill its tmux session',
      () => fs.existsSync(path.join(home, 'killed')),
      5000,
    );
    console.log(`[smoke] remote: ${states(sid).join(' → ')}; reattached through tmux, kill-session on close`);
    return null;
  } catch (err) {
    return (err as Error).message;
  } finally {
    if (id) sessions.kill(id);
    process.env.PATH = oldPath;
    process.env.SHELL = oldShell;
    // Give the kill-session ssh a moment before removing its HOME.
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 3000);
  }
}
