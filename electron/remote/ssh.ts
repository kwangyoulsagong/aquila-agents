// SSH + tmux command lines for remote sessions (T29). Pure: no I/O, so every quoting layer is unit-tested.
//
// A remote session is `ssh -t <alias> -- <script>`. The script runs in the user's login shell on the host:
//   1. writes our tmux config to ~/.aquila/tmux.conf (the only thing we ever write remotely),
//   2. cd's into the project folder,
//   3. `exec tmux -L aquila … new-session -A -s aq-<tab key> …` — our own tmux server, one session per tab.
// `-A` attaches when the session already exists, so a dropped connection or an app relaunch reattaches to the
// running agent instead of starting a new one (the command and folder are then ignored by tmux).
import type { RemoteHost, SessionKind } from '../../src/shared/api/types';

/** Our own tmux server socket name (`tmux -L aquila`): never touches the user's default server. */
export const TMUX_SOCKET = 'aquila';
/** Remote config, relative to the remote home. */
export const TMUX_CONF = '.aquila/tmux.conf';
/** Exit code ssh uses for its own errors (connect failed, connection lost). Anything else is the session ending. */
export const SSH_FAILED = 255;
/** Exit code of our script when the host has no tmux (not retried). */
export const NO_TMUX = 127;

/**
 * Our tmux config. No status bar (the app has its own UI), no alternate screen so output scrolls into xterm's own
 * scrollback, passthrough for programs that wrap escape sequences, and OSC 52 clipboard. `-q` silences options an
 * older tmux doesn't know (allow-passthrough is 3.3+).
 */
export const TMUX_CONF_LINES = [
  'set -g status off',
  'set -g escape-time 10',
  'set -g history-limit 50000',
  'set -g default-terminal screen-256color',
  'set -ga terminal-overrides ",xterm-256color:RGB,xterm*:smcup@:rmcup@"',
  'set -g set-clipboard on',
  'set -g focus-events on',
  'set -gq allow-passthrough on',
  'set -g window-size latest',
  'setw -g aggressive-resize on',
];

/** `'…'` for sh, with embedded quotes escaped. */
export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** A plain word (uuids, ids) as is; anything else quoted. */
const word = (s: string): string => (/^[A-Za-z0-9._-]+$/.test(s) ? s : shq(s));

/**
 * A path on the host as a shell word: `~` / `~/x` become `"$HOME"/'x'` (the remote home), anything else is quoted.
 * `~user/…` is not supported (quoted as a literal name).
 */
export function remotePath(p: string): string {
  const v = p.trim();
  if (v === '~') return '"$HOME"';
  if (v.startsWith('~/')) return v.length > 2 ? `"$HOME"/${shq(v.slice(2))}` : '"$HOME"';
  return shq(v);
}

/**
 * Host alias from `~/.ssh/config` or `[user@]host[:port]`-free target. Rejects anything ssh could read as an option
 * (leading `-`) or that needs quoting — it's passed as one argv entry, but a sane alias is also what the UI shows.
 */
export function validAlias(alias: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.@%+-]*$/.test(alias) && alias.length <= 255;
}

/** tmux session name for a tab (`aq-<tab key>`; tab keys are [a-z0-9-]). */
export function tmuxSession(tabKey: string): string {
  return `aq-${tabKey.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

/** What runs inside tmux: the agent (or nothing for a shell) in a login shell, then the login shell. */
export function innerCommand(
  kind: SessionKind,
  opts: {
    claudeSessionId?: string;
    resumeClaude?: boolean;
    resumeCodexId?: string;
    claudeConfigDir?: string;
  },
): string {
  let agent: string | null = null;
  if (kind === 'claude' && opts.claudeSessionId)
    agent = `claude ${opts.resumeClaude ? '--resume' : '--session-id'} ${word(opts.claudeSessionId)}`;
  else if (kind === 'codex')
    agent = opts.resumeCodexId ? `codex resume ${word(opts.resumeCodexId)}` : 'codex';
  const env =
    kind === 'claude' && opts.claudeConfigDir?.trim()
      ? `export CLAUDE_CONFIG_DIR=${remotePath(opts.claudeConfigDir)}; `
      : '';
  // Inside tmux this string is run by `sh -c`: $SHELL is the remote user's shell.
  return agent
    ? `${env}exec "$SHELL" -l -i -c ${shq(`${agent}; exec "$SHELL" -l -i`)}`
    : `${env}exec "$SHELL" -l -i`;
}

export interface RemoteSpawn {
  host: RemoteHost;
  /** Project folder on the host. */
  path: string;
  tabKey: string;
  kind: SessionKind;
  claudeSessionId?: string;
  resumeClaude?: boolean;
  resumeCodexId?: string;
}

/**
 * ssh hands its command to the user's shell *without* a login, so PATH set in ~/.profile (e.g. ~/.local/bin, where a
 * user-installed tmux lives) is missing. Everything runs in a login shell instead, like the probe and local sessions.
 */
export const inLoginShell = (body: string): string => `exec "$SHELL" -l -c ${shq(body)}`;

/** The script ssh runs on the host, in a login shell (see `remoteBody`). */
export function remoteScript(spec: RemoteSpawn): string {
  return inLoginShell(remoteBody(spec));
}

/** What the login shell runs: check tmux, write our config, cd, exec tmux. */
export function remoteBody(spec: RemoteSpawn): string {
  const conf = TMUX_CONF_LINES.map(shq).join(' ');
  const tmux = `tmux -L ${TMUX_SOCKET} -f "$HOME"/${TMUX_CONF}`;
  const inner = innerCommand(spec.kind, { ...spec, claudeConfigDir: spec.host.claudeConfigDir });
  return [
    `command -v tmux >/dev/null 2>&1 || { echo 'aquila: tmux not found on this host'; exit ${NO_TMUX}; }`,
    `umask 077; mkdir -p "$HOME"/.aquila && printf '%s\\n' ${conf} > "$HOME"/${TMUX_CONF}`,
    `cd ${remotePath(spec.path)} || exit 1`,
    `exec ${tmux} new-session -A -s ${tmuxSession(spec.tabKey)} -c "$PWD" ${shq(inner)}`,
  ].join('; ');
}

/** ssh options for every connection: keepalive (a dead link is noticed in ~60 s), no X/agent forwarding. */
export const SSH_OPTIONS = [
  '-o',
  'ServerAliveInterval=20',
  '-o',
  'ServerAliveCountMax=3',
  '-o',
  'ConnectTimeout=15',
];

/**
 * Connection sharing (T36): every ssh to a host — tabs, panels, kill — rides one master connection, so the changes
 * panel and history don't pay a new handshake (or ask for a password a tab already gave). ssh expands `~` itself and
 * `%C` is a 40-char hash, which keeps the socket path well under the 104-byte limit. The master lingers 2 min after
 * the last client.
 */
export const CONTROL_DIR = '~/.aquila/ssh';
export const MUX_OPTIONS = [
  '-o',
  'ControlMaster=auto',
  '-o',
  `ControlPath=${CONTROL_DIR}/%C`,
  '-o',
  'ControlPersist=120',
];

/** argv for the interactive session (pty). */
export function sessionArgs(spec: RemoteSpawn): string[] {
  if (!validAlias(spec.host.alias)) throw new Error(`Invalid SSH host: ${spec.host.alias}`);
  return ['-t', ...SSH_OPTIONS, ...MUX_OPTIONS, spec.host.alias, '--', remoteScript(spec)];
}

/** argv to end a tab's tmux session when its tab is closed (non-interactive, never prompts). */
export function killArgs(alias: string, tabKey: string): string[] {
  if (!validAlias(alias)) throw new Error(`Invalid SSH host: ${alias}`);
  return [
    '-o',
    'BatchMode=yes',
    ...SSH_OPTIONS,
    ...MUX_OPTIONS,
    alias,
    '--',
    inLoginShell(`tmux -L ${TMUX_SOCKET} kill-session -t ${tmuxSession(tabKey)} 2>/dev/null; true`),
  ];
}
