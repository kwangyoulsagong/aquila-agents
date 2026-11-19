import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  innerCommand,
  killArgs,
  NO_TMUX,
  remotePath,
  remoteBody,
  remoteScript,
  sessionArgs,
  shq,
  TMUX_CONF_LINES,
  tmuxSession,
  validAlias,
  type RemoteSpawn,
} from './ssh';

const spec = (over: Partial<RemoteSpawn> = {}): RemoteSpawn => ({
  host: { alias: 'devbox' },
  path: '~/code/app',
  tabKey: 'k1a2b3',
  kind: 'claude',
  claudeSessionId: '0b1c2d3e-0000-4000-8000-000000000001',
  ...over,
});

describe('quoting helpers', () => {
  it('quotes for sh and maps ~ to the remote home', () => {
    expect(shq("it's")).toBe(`'it'\\''s'`);
    expect(remotePath('~')).toBe('"$HOME"');
    expect(remotePath('~/a b')).toBe(`"$HOME"/'a b'`);
    expect(remotePath('/srv/$x')).toBe(`'/srv/$x'`);
  });

  it('accepts ssh config aliases and user@host, rejects option-looking or odd names', () => {
    expect(validAlias('devbox')).toBe(true);
    expect(validAlias('me@10.0.0.2')).toBe(true);
    expect(validAlias('-oProxyCommand=x')).toBe(false);
    expect(validAlias('a b')).toBe(false);
    expect(validAlias('a;b')).toBe(false);
    expect(validAlias('')).toBe(false);
  });

  it('names one tmux session per tab key', () => {
    expect(tmuxSession('k1a2b3')).toBe('aq-k1a2b3');
    expect(tmuxSession('x;rm')).toBe('aq-xrm');
  });
});

describe('command lines', () => {
  it('ssh gets -t, keepalive, the alias, -- and one script argument', () => {
    const args = sessionArgs(spec());
    expect(args[0]).toBe('-t');
    expect(args).toContain('ServerAliveInterval=20');
    const at = args.indexOf('devbox');
    expect(args[at + 1]).toBe('--');
    expect(args.length).toBe(at + 3);
    expect(() => sessionArgs(spec({ host: { alias: '-x' } }))).toThrow();
  });

  it('runs our own tmux server and attaches to the tab session if it exists', () => {
    const script = remoteBody(spec());
    expect(script).toContain(
      'tmux -L aquila -f "$HOME"/.aquila/tmux.conf new-session -A -s aq-k1a2b3 -c "$PWD"',
    );
    expect(script).toContain(`cd "$HOME"/'code/app' || exit 1`);
  });

  it('starts claude with our session id, or resumes; codex resumes by id; a shell runs nothing', () => {
    expect(innerCommand('claude', { claudeSessionId: 'abc' })).toContain('claude --session-id abc');
    expect(innerCommand('claude', { claudeSessionId: 'abc', resumeClaude: true })).toContain('--resume abc');
    expect(innerCommand('codex', { resumeCodexId: 'id1' })).toContain('codex resume id1');
    expect(innerCommand('shell', {})).toBe('exec "$SHELL" -l -i');
    expect(innerCommand('claude', { claudeSessionId: 'abc', claudeConfigDir: '~/.claude-work' })).toMatch(
      /^export CLAUDE_CONFIG_DIR="\$HOME"\/'\.claude-work'; /,
    );
    // The config dir is only for Claude.
    expect(innerCommand('codex', { claudeConfigDir: '~/.c' })).not.toContain('CLAUDE_CONFIG_DIR');
  });

  it('closing a tab kills its session without prompting', () => {
    const args = killArgs('devbox', 'k1');
    expect(args).toContain('BatchMode=yes');
    expect(args.at(-1)).toBe(`exec "$SHELL" -l -c 'tmux -L aquila kill-session -t aq-k1 2>/dev/null; true'`);
  });

  it('runs everything in a login shell (ssh commands get no ~/.profile PATH)', () => {
    expect(remoteScript(spec())).toMatch(/^exec "\$SHELL" -l -c '/);
  });
});

// Runs the generated script through real shells with a fake `tmux`, so every quoting layer is exercised.
describe('remote script under sh', () => {
  let dir: string;
  let bin: string;
  let home: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-remote-'));
    bin = path.join(dir, 'bin');
    home = path.join(dir, 'home dir');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(home, 'code', "it's here"), { recursive: true });
    // Fake tmux: records its argv (one per line), then runs the shell command like tmux would (`$SHELL -c`).
    fs.writeFileSync(
      path.join(bin, 'tmux'),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "$HOME/tmux-args"\npwd > "$HOME/tmux-pwd"\neval "last=\\\${$#}"\nexec "$SHELL" -c "$last"\n`,
      { mode: 0o755 },
    );
    // Login shell stand-in: drops -l/-i (a real login sh resets PATH from /etc/profile).
    fs.writeFileSync(
      path.join(bin, 'fakesh'),
      '#!/bin/sh\nwhile [ "$1" = -l ] || [ "$1" = -i ]; do shift; done\nexec /bin/sh "$@"\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(bin, 'claude'),
      `#!/bin/sh\nprintf '%s\\n' "$*" > "$HOME/claude-args"\nprintf '%s\\n' "$CLAUDE_CONFIG_DIR" > "$HOME/claude-env"\n`,
      { mode: 0o755 },
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (script: string, withTmux = true) =>
    execFileSync('/bin/sh', ['-c', script], {
      env: {
        HOME: home,
        SHELL: path.join(bin, 'fakesh'),
        PATH: `${withTmux ? `${bin}:` : `${path.join(bin, 'none')}:`}/usr/bin:/bin`,
      },
      input: '',
      encoding: 'utf8',
    });

  it('writes the tmux config, cds into the folder and starts the agent with its env', () => {
    const script = remoteScript(
      spec({ path: "~/code/it's here", host: { alias: 'devbox', claudeConfigDir: '~/.claude-work' } }),
    );
    run(script);
    const conf = fs.readFileSync(path.join(home, '.aquila', 'tmux.conf'), 'utf8');
    expect(conf.trim().split('\n')).toEqual(TMUX_CONF_LINES);
    const args = fs.readFileSync(path.join(home, 'tmux-args'), 'utf8').trim().split('\n');
    expect(args.slice(0, 8)).toEqual([
      '-L',
      'aquila',
      '-f',
      `${home}/.aquila/tmux.conf`,
      'new-session',
      '-A',
      '-s',
      'aq-k1a2b3',
    ]);
    expect(args[9]).toBe(path.join(home, 'code', "it's here"));
    expect(fs.readFileSync(path.join(home, 'claude-args'), 'utf8').trim()).toBe(
      '--session-id 0b1c2d3e-0000-4000-8000-000000000001',
    );
    expect(fs.readFileSync(path.join(home, 'claude-env'), 'utf8').trim()).toBe(`${home}/.claude-work`);
  });

  it('exits 127 with a message when the host has no tmux', () => {
    let code = 0;
    let out = '';
    try {
      run(remoteScript(spec()), false);
    } catch (err) {
      code = (err as { status: number }).status;
      out = String((err as { stdout: string }).stdout);
    }
    expect(code).toBe(NO_TMUX);
    expect(out).toContain('tmux not found');
  });
});
