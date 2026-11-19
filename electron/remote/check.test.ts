import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installHint, parseProbe, probeScript, sshError } from './check';

describe('remote check', () => {
  it('parses the probe: system, tools with versions, login, KillUserProcesses', () => {
    const r = parseProbe(
      [
        'system=Linux x86_64',
        'tool.claude=/home/me/.local/bin/claude',
        'tool.codex=',
        'tool.tmux=/usr/bin/tmux',
        'tool.git=/usr/bin/git',
        'version.claude=2.3.1 (Claude Code)',
        'version.codex=',
        'version.tmux=tmux 3.4',
        'version.git=git version 2.43.0',
        'login=no',
        'pm=apt-get',
        'kill=b true',
        'linger=no',
      ].join('\n'),
    );
    expect(r.reachable).toBe(true);
    expect(r.system).toBe('Linux x86_64');
    expect(r.tools.map((t) => [t.tool, !!t.path])).toEqual([
      ['claude', true],
      ['codex', false],
      ['tmux', true],
      ['git', true],
    ]);
    expect(r.tools[0].version).toBe('2.3.1 (Claude Code)');
    expect(r.tools[1].install).toBe('npm install -g @openai/codex');
    expect(r.claudeLoggedIn).toBe(false);
    expect(r.killUserProcesses).toBe(true);
  });

  it('no login line without claude; lingering users are not warned', () => {
    const r = parseProbe('system=Linux aarch64\nkill=b true\nlinger=yes\n');
    expect(r.claudeLoggedIn).toBeUndefined();
    expect(r.killUserProcesses).toBeUndefined();
  });

  it('install hints follow the package manager', () => {
    expect(installHint('tmux', 'apt-get')).toBe('sudo apt-get install -y tmux');
    expect(installHint('git', 'dnf')).toBe('sudo dnf install -y git');
    expect(installHint('tmux', 'brew')).toBe('brew install tmux');
    expect(installHint('claude', 'brew')).toContain('claude.ai/install.sh');
  });

  it('shows the last line of ssh stderr', () => {
    expect(
      sshError(
        "Warning: Permanently added 'x' to the list of known hosts.\nme@x: Permission denied (publickey).\n",
        'f',
      ),
    ).toBe('me@x: Permission denied (publickey).');
    expect(sshError('', 'fallback')).toBe('fallback');
  });

  it('the probe runs in a plain sh and reports a custom Claude dir login', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-probe-'));
    try {
      fs.mkdirSync(path.join(home, '.claude-w'));
      fs.writeFileSync(path.join(home, '.claude-w', '.credentials.json'), '{"x":1}');
      const out = execFileSync('/bin/sh', ['-c', probeScript('~/.claude-w')], {
        env: { HOME: home, SHELL: '/bin/sh', PATH: '/usr/bin:/bin' },
        encoding: 'utf8',
      });
      const r = parseProbe(out);
      expect(r.system).toMatch(/\S+ \S+/);
      expect(out).toContain('login=yes');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
