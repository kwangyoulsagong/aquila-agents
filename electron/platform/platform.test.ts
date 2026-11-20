import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { darwin } from './darwin';
import { windowsBuild } from './os';
import { KillQueue } from './killQueue';
import { posixPrelude, posixWord } from './posix';
import { cmdLine, detectNativeShells, encodePs, psScript, winGit, winSpawnSpec, wslProfile } from './win32';
import { parseWslList, parseWslUnc, toWslPath, wslUncPath } from './wsl';
import type { SessionCommand, ShellProfile } from './types';

const claude: SessionCommand = {
  argv: ['claude', '--settings', "C:\\Users\\me\\it's\\hooks.json", '--resume', 'abc'],
  onFail: 'aquila-resume-failed',
};

describe('posix', () => {
  it('keeps safe words bare so aliases still apply', () => {
    expect(posixWord('claude')).toBe('claude');
    expect(posixWord('/Users/me/.aquila/claude-hooks.json')).toBe('/Users/me/.aquila/claude-hooks.json');
    expect(posixWord("/a b/it's")).toBe(`'/a b/it'\\''s'`);
  });

  it('writes setup, the program and its failure marker', () => {
    expect(posixPrelude({ argv: null })).toBe('');
    expect(posixPrelude({ argv: ['claude', '--resume', 'x'], onFail: 'm' })).toBe(
      `claude --resume x || printf '\\033]7501;m\\007'; `,
    );
    expect(posixPrelude({ argv: null, setup: { banner: 'Setup', script: ' npm i ' } })).toBe(
      `printf '\\033[2m%s\\033[0m\\n' 'Setup'; npm i\n`,
    );
  });

  it.skipIf(process.platform === 'win32')('runs as real sh: quoted args arrive intact and the marker prints on failure', () => {
    const out = execFileSync('/bin/sh', [
      '-c',
      `${posixPrelude({ argv: ['printf', '%s|', "it's", 'a b'] })}${posixPrelude({ argv: ['false'], onFail: 'm' })}true`,
    ]).toString();
    expect(out).toBe("it's|a b|\x1b]7501;m\x07");
  });
});

describe('darwin', () => {
  const zsh: ShellProfile = { kind: 'posix', file: '/bin/zsh', label: 'zsh' };
  it('starts a login shell and drops to it after the program', () => {
    expect(darwin.spawnSpec(zsh, { argv: null }, '/p')).toEqual({
      file: '/bin/zsh',
      args: ['-l', '-i'],
      cwd: '/p',
    });
    expect(darwin.spawnSpec(zsh, { argv: ['codex'] }, '/p').args).toEqual([
      '-l',
      '-i',
      '-c',
      'codex; exec /bin/zsh -l -i',
    ]);
  });
});

describe('PowerShell', () => {
  it('uses the call operator, doubled quotes and an exit-code check', () => {
    expect(psScript(claude)).toBe(
      [
        `& 'claude' '--settings' 'C:\\Users\\me\\it''s\\hooks.json' '--resume' 'abc'`,
        `if ($LASTEXITCODE -ne 0) { [Console]::Write([string][char]27 + ']7501;aquila-resume-failed' + [char]7) }`,
      ].join('\n'),
    );
  });

  it('spawns -NoExit with an encoded command, or a bare shell', () => {
    const pwsh: ShellProfile = { kind: 'pwsh', file: 'pwsh.exe', label: 'PowerShell 7' };
    const spec = winSpawnSpec(pwsh, claude, 'C:\\p');
    expect(spec.args).toEqual(['-NoLogo', '-NoExit', '-EncodedCommand', encodePs(psScript(claude))]);
    expect(Buffer.from((spec.args as string[])[3]!, 'base64').toString('utf16le')).toBe(psScript(claude));
    expect(winSpawnSpec(pwsh, { argv: null }, 'C:\\p').args).toEqual(['-NoLogo']);
  });
});

describe('CMD', () => {
  it('builds one /S /K line with the marker after ||', () => {
    expect(cmdLine({ argv: null })).toBeNull();
    expect(cmdLine({ argv: ['codex', 'resume', '--last'] })).toBe('codex resume --last');
    expect(cmdLine({ argv: ['C:\\Program Files\\claude.exe', '-x'], onFail: 'm' })).toBe(
      `"C:\\Program Files\\claude.exe" -x || echo \x1b]7501;m\x07`,
    );
    expect(cmdLine({ argv: ['codex'], setup: { banner: 'Setup (1)', script: 'npm i' } })).toBe(
      'echo Setup ^(1^) & npm i & codex',
    );
    const cmd: ShellProfile = {
      kind: 'cmd',
      file: 'C:\\Windows\\System32\\cmd.exe',
      label: 'Command Prompt',
    };
    expect(winSpawnSpec(cmd, { argv: ['codex'] }, 'C:\\p').args).toBe('/S /K "codex"');
  });
});

describe('Git Bash and WSL', () => {
  it('Git Bash stays in the folder and ends in bash', () => {
    const bash: ShellProfile = { kind: 'gitbash', file: 'C:\\Git\\bin\\bash.exe', label: 'Git Bash' };
    const spec = winSpawnSpec(bash, { argv: ['codex'] }, 'C:\\p');
    expect(spec.args).toEqual(['-l', '-i', '-c', 'codex; exec bash -l -i']);
    expect(spec.env).toEqual({ CHERE_INVOKING: '1' });
  });

  it('WSL runs wsl.exe from home, cds into the Linux path and passes our variables', () => {
    const spec = winSpawnSpec(
      wslProfile('Ubuntu'),
      { argv: ['claude', '--session-id', 'x'] },
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\app',
      'C:\\Users\\me',
    );
    expect(spec.file).toBe('wsl.exe');
    expect(spec.cwd).toBe('C:\\Users\\me');
    expect(spec.args).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/me/app',
      '--',
      'bash',
      '-lic',
      'claude --session-id x; exec bash -l -i',
    ]);
    expect(spec.env?.WSLENV).toContain('AQUILA_TAB_ID');
    expect(winSpawnSpec(wslProfile('Ubuntu'), { argv: null }, 'C:\\src\\app', 'C:\\Users\\me').args).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/mnt/c/src/app',
    ]);
  });

  it('runs git inside the distro for a WSL folder', () => {
    expect(winGit('C:\\src\\app', ['status'])).toEqual({
      file: 'git',
      args: ['status'],
      cwd: 'C:\\src\\app',
    });
    expect(winGit('\\\\wsl$\\Debian\\srv\\x', ['status'], 'C:\\Users\\me')).toEqual({
      file: 'wsl.exe',
      args: ['-d', 'Debian', '--cd', '/srv/x', '-e', 'git', 'status'],
      cwd: 'C:\\Users\\me',
    });
  });
});

describe('WSL paths', () => {
  it('converts between UNC, Linux and drive paths', () => {
    expect(parseWslUnc('\\\\wsl.localhost\\Ubuntu-22.04\\home\\me\\')).toEqual({
      distro: 'Ubuntu-22.04',
      path: '/home/me',
    });
    expect(parseWslUnc('\\\\wsl.localhost\\Ubuntu')).toEqual({ distro: 'Ubuntu', path: '/' });
    expect(parseWslUnc('C:\\Users')).toBeNull();
    expect(wslUncPath('Ubuntu', '/home/me')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me');
    expect(toWslPath('C:\\Users\\me\\')).toBe('/mnt/c/Users/me');
    expect(toWslPath('D:')).toBe('/mnt/d');
  });

  it('reads the distro list in UTF-16 or UTF-8 and skips Docker’s', () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Ubuntu\r\ndocker-desktop\r\nDebian\r\n', 'utf16le'),
    ]);
    expect(parseWslList(utf16)).toEqual(['Ubuntu', 'Debian']);
    expect(parseWslList(Buffer.from('Ubuntu\nkali-linux\n'))).toEqual(['Ubuntu', 'kali-linux']);
    expect(parseWslList(Buffer.alloc(0))).toEqual([]);
  });
});

describe('detectNativeShells', () => {
  const env = {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
  };
  it('orders pwsh 7 > PowerShell 5.1 > Git Bash > CMD', () => {
    const files = new Set([
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
    ]);
    const shells = detectNativeShells({ env, exists: (f) => files.has(f), which: () => null });
    expect(shells.map((s) => s.kind)).toEqual(['pwsh', 'powershell', 'gitbash', 'cmd']);
    expect(shells[3]!.file).toBe('C:\\Windows\\system32\\cmd.exe');
  });

  it('prefers pwsh on PATH and always has CMD', () => {
    const shells = detectNativeShells({
      env,
      exists: (f) => f === 'D:\\tools\\pwsh.exe',
      which: (b) => (b === 'pwsh.exe' ? 'D:\\tools\\pwsh.exe' : null),
    });
    expect(shells.map((s) => [s.kind, s.file])).toEqual([
      ['pwsh', 'D:\\tools\\pwsh.exe'],
      ['cmd', 'C:\\Windows\\system32\\cmd.exe'],
    ]);
  });
});

describe('KillQueue', () => {
  it('kills right away without a gap, never an exited pty', () => {
    const q = new KillQueue(0);
    const killed: string[] = [];
    q.kill({ kill: () => killed.push('a') }, () => false);
    q.kill({ kill: () => killed.push('b') }, () => true);
    q.kill(
      {
        kill: () => {
          throw new Error('gone');
        },
      },
      () => false,
    );
    expect(killed).toEqual(['a']);
  });

  it('serializes kills a gap apart and re-checks exit before each', () => {
    const timers: (() => void)[] = [];
    const q = new KillQueue(50, (fn) => timers.push(fn));
    const killed: string[] = [];
    let bExited = false;
    q.kill({ kill: () => killed.push('a') }, () => false);
    q.kill({ kill: () => killed.push('b') }, () => bExited);
    q.kill({ kill: () => killed.push('c') }, () => false);
    expect(killed).toEqual(['a']);
    bExited = true;
    timers.shift()!();
    expect(killed).toEqual(['a']);
    timers.shift()!();
    expect(killed).toEqual(['a', 'c']);
    timers.shift()!();
    expect(q.pending).toBe(0);
    q.kill({ kill: () => killed.push('d') }, () => false);
    expect(killed).toEqual(['a', 'c', 'd']);
  });
});

describe('windowsBuild', () => {
  it('reads the build from os.release on Windows only', () => {
    expect(windowsBuild('10.0.22631', 'win32')).toBe(22631);
    expect(windowsBuild('10.0.17763', 'win32')).toBe(17763);
    expect(windowsBuild('24.0.0', 'darwin')).toBeUndefined();
    expect(windowsBuild('garbage', 'win32')).toBeUndefined();
  });
});
