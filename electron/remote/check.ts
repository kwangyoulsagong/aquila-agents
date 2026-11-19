// First-connect check of an SSH host (T29): OS, claude / codex / tmux / git, Claude login, KillUserProcesses.
// Read-only on the host; install commands are only *shown*. BatchMode: a host that needs a password or a new host
// key fails here with ssh's message — the interactive session (a real pty) can still ask.
import { execFile } from 'node:child_process';
import type { RemoteCheck, RemoteHost, RemoteToolId } from '../../src/shared/api/types';
import { remotePath, shq, SSH_OPTIONS, validAlias } from './ssh';

const TOOLS: RemoteToolId[] = ['claude', 'codex', 'tmux', 'git'];
const TIMEOUT_MS = 25_000;

/** Probe run in the remote login shell (so PATH matches what sessions get). Prints `key=value` lines. */
export function probeScript(claudeConfigDir?: string): string {
  const dir = claudeConfigDir?.trim() ? remotePath(claudeConfigDir) : '"$HOME"/.claude';
  // The default account keeps its login in ~/.claude.json; a custom dir in <dir>/.claude.json.
  const json = claudeConfigDir?.trim() ? `${dir}/.claude.json` : '"$HOME"/.claude.json';
  const body = [
    'echo "system=$(uname -sm)"',
    'for t in claude codex tmux git; do echo "tool.$t=$(command -v $t 2>/dev/null)"; done',
    'echo "version.claude=$(claude --version 2>/dev/null | head -n 1)"',
    'echo "version.codex=$(codex --version 2>/dev/null | head -n 1)"',
    'echo "version.tmux=$(tmux -V 2>/dev/null)"',
    'echo "version.git=$(git --version 2>/dev/null)"',
    `if [ -s ${dir}/.credentials.json ] || grep -qs oauthAccount ${json}; then echo login=yes; else echo login=no; fi`,
    'for m in apt-get dnf yum pacman apk zypper brew; do command -v $m >/dev/null 2>&1 && { echo "pm=$m"; break; }; done',
    'k=$(busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager KillUserProcesses 2>/dev/null)',
    'echo "kill=$k"',
    'echo "linger=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)"',
  ].join('; ');
  return `exec "$SHELL" -l -c ${shq(body)} </dev/null`;
}

/** Install command shown for a missing tool, by the host's package manager. */
export function installHint(tool: RemoteToolId, pm: string | undefined): string {
  if (tool === 'claude') return 'curl -fsSL https://claude.ai/install.sh | bash';
  if (tool === 'codex') return 'npm install -g @openai/codex';
  switch (pm) {
    case 'brew':
      return `brew install ${tool}`;
    case 'dnf':
    case 'yum':
      return `sudo ${pm} install -y ${tool}`;
    case 'pacman':
      return `sudo pacman -S ${tool}`;
    case 'apk':
      return `sudo apk add ${tool}`;
    case 'zypper':
      return `sudo zypper install ${tool}`;
    default:
      return `sudo apt-get install -y ${tool}`;
  }
}

/** Probe output → report. Unknown lines are ignored. */
export function parseProbe(stdout: string): RemoteCheck {
  const kv = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const pm = kv.get('pm') || undefined;
  const tools = TOOLS.map((tool) => {
    const path = kv.get(`tool.${tool}`) || undefined;
    const version = kv.get(`version.${tool}`) || undefined;
    return {
      tool,
      ...(path ? { path } : {}),
      ...(path && version ? { version } : {}),
      install: installHint(tool, pm),
    };
  });
  const hasClaude = tools.some((t) => t.tool === 'claude' && t.path);
  // busctl prints `b true`; lingering users keep their processes anyway.
  const kill = /\btrue\b/.test(kv.get('kill') ?? '') && kv.get('linger') !== 'yes';
  return {
    reachable: true,
    ...(kv.get('system') ? { system: kv.get('system') } : {}),
    tools,
    ...(hasClaude ? { claudeLoggedIn: kv.get('login') === 'yes' } : {}),
    ...(kill ? { killUserProcesses: true } : {}),
  };
}

/** Last meaningful line of ssh's stderr ("Permission denied (publickey).", "Could not resolve hostname …"). */
export function sshError(stderr: string, fallback: string): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('Warning: Permanently added'));
  return lines.at(-1) ?? fallback;
}

export function checkRemote(host: RemoteHost): Promise<RemoteCheck> {
  if (!validAlias(host.alias))
    return Promise.resolve({ reachable: false, error: `Invalid SSH host: ${host.alias}`, tools: [] });
  const args = ['-o', 'BatchMode=yes', ...SSH_OPTIONS, host.alias, '--', probeScript(host.claudeConfigDir)];
  return new Promise((resolve) =>
    execFile('ssh', args, { timeout: TIMEOUT_MS, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout);
      // The probe always prints `system=`; without it ssh itself failed.
      if (!out.includes('system=')) {
        const fallback = err ? (err.killed ? 'Timed out' : err.message) : 'No answer';
        return resolve({ reachable: false, error: sshError(String(stderr), fallback), tools: [] });
      }
      resolve(parseProbe(out));
    }),
  );
}
