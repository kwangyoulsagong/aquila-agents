// Windows: PowerShell 7 > Windows PowerShell 5.1 > Git Bash > CMD for native folders; a folder under
// `\\wsl.localhost\<distro>\…` runs in that distro. Command rendering and detection are pure (deps passed in) so
// they're tested on macOS too; only `win32` at the bottom touches the machine.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath } from '../detect';
import { posixPrelude } from './posix';
import { parseWslList, parseWslUnc, toWslPath } from './wsl';
import type { GitInvocation, PlatformLayer, SessionCommand, ShellProfile, SpawnSpec } from './types';

const win = path.win32;

// ── PowerShell ──

/** `'…'` for PowerShell (a quote is doubled). */
export const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The script after `-EncodedCommand`; '' when there is nothing to run. */
export function psScript(cmd: SessionCommand): string {
  const parts: string[] = [];
  if (cmd.setup?.script.trim())
    parts.push(`Write-Host ${psQuote(cmd.setup.banner)} -ForegroundColor DarkGray`, cmd.setup.script.trim());
  if (cmd.argv) {
    // The call operator still resolves the user's functions and aliases by name.
    parts.push(`& ${cmd.argv.map(psQuote).join(' ')}`);
    if (cmd.onFail)
      parts.push(
        `if ($LASTEXITCODE -ne 0) { [Console]::Write([string][char]27 + ${psQuote(`]7501;${cmd.onFail}`)} + [char]7) }`,
      );
  }
  return parts.join('\n');
}

/** UTF-16LE base64, so no quoting survives Windows command-line parsing differently in pwsh 7 and 5.1. */
export const encodePs = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

// ── CMD ──

export const cmdWord = (s: string) => (/^[\w@+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);
const cmdEscape = (s: string) => s.replace(/[&|<>^()%!]/g, '^$&');

/** The line after `/S /K` (wrapped in one more pair of quotes, which `/S` strips); null = just the shell. */
export function cmdLine(cmd: SessionCommand): string | null {
  const parts: string[] = [];
  if (cmd.setup?.script.trim()) parts.push(`echo ${cmdEscape(cmd.setup.banner)}`, cmd.setup.script.trim());
  if (cmd.argv) {
    let line = cmd.argv.map(cmdWord).join(' ');
    if (cmd.onFail) line += ` || echo \x1b]7501;${cmd.onFail}\x07`;
    parts.push(line);
  }
  return parts.length ? parts.join(' & ') : null;
}

// ── Spawn ──

/** Variables our sessions set that WSL should pass through into the distro. */
const WSL_PASS = ['AQUILA_TAB_ID', 'AQUILA_PORT', 'PORT', 'AQUILA_PORT_BASE'];

export function winSpawnSpec(
  shell: ShellProfile,
  cmd: SessionCommand,
  cwd: string,
  home = os.homedir(),
): SpawnSpec {
  switch (shell.kind) {
    case 'pwsh':
    case 'powershell': {
      const script = psScript(cmd);
      return {
        file: shell.file,
        args: script ? ['-NoLogo', '-NoExit', '-EncodedCommand', encodePs(script)] : ['-NoLogo'],
        cwd,
      };
    }
    case 'cmd': {
      const line = cmdLine(cmd);
      return { file: shell.file, args: line ? `/S /K "${line}"` : [], cwd };
    }
    case 'gitbash': {
      const prelude = posixPrelude(cmd);
      return {
        file: shell.file,
        args: prelude ? ['-l', '-i', '-c', `${prelude}exec bash -l -i`] : ['-l', '-i'],
        cwd,
        // Git Bash's /etc/profile would otherwise cd to $HOME.
        env: { CHERE_INVOKING: '1' },
      };
    }
    case 'wsl':
    case 'posix': {
      const prelude = posixPrelude(cmd);
      const at = ['-d', shell.distro ?? '', '--cd', toWslPath(cwd)];
      return {
        file: shell.file,
        // No command: the distro's own login shell.
        args: prelude ? [...at, '--', 'bash', '-lic', `${prelude}exec bash -l -i`] : at,
        // CreateProcess can't start in a UNC folder; wsl.exe changes into the project itself.
        cwd: home,
        env: { WSLENV: [process.env.WSLENV, ...WSL_PASS].filter(Boolean).join(':') },
      };
    }
  }
}

export function winGit(cwd: string, args: string[], home = os.homedir()): GitInvocation {
  const unc = parseWslUnc(cwd);
  if (!unc) return { file: 'git', args, cwd };
  return { file: 'wsl.exe', args: ['-d', unc.distro, '--cd', unc.path, '-e', 'git', ...args], cwd: home };
}

// ── Detection ──

export interface DetectDeps {
  env: NodeJS.ProcessEnv;
  exists: (file: string) => boolean;
  /** Full path of `bin` on PATH (PATHEXT applied), or null. */
  which: (bin: string) => string | null;
}

/** Native shells, best first. CMD is always there. */
export function detectNativeShells({ env, exists, which }: DetectDeps): ShellProfile[] {
  const root = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(
    (d): d is string => !!d,
  );
  const first = (candidates: (string | null | undefined)[]) =>
    candidates.find((c): c is string => !!c && exists(c));
  const out: ShellProfile[] = [];
  const pwsh = first([
    which('pwsh.exe'),
    ...programFiles.map((d) => win.join(d, 'PowerShell', '7', 'pwsh.exe')),
  ]);
  if (pwsh) out.push({ kind: 'pwsh', file: pwsh, label: 'PowerShell 7' });
  const ps = first([win.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]);
  if (ps) out.push({ kind: 'powershell', file: ps, label: 'Windows PowerShell' });
  const bash = first([
    ...programFiles.map((d) => win.join(d, 'Git', 'bin', 'bash.exe')),
    env.LOCALAPPDATA && win.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ]);
  if (bash) out.push({ kind: 'gitbash', file: bash, label: 'Git Bash' });
  out.push({
    kind: 'cmd',
    file: env.ComSpec ?? win.join(root, 'System32', 'cmd.exe'),
    label: 'Command Prompt',
  });
  return out;
}

export const wslProfile = (distro: string): ShellProfile => ({
  kind: 'wsl',
  file: 'wsl.exe',
  label: `${distro} (WSL)`,
  distro,
});

function listDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-l', '-q'],
      { encoding: 'buffer', timeout: 5_000, windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } },
      (err, stdout) => resolve(err ? [] : parseWslList(stdout)),
    );
  });
}

const machine: DetectDeps = {
  env: process.env,
  exists: (f) => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  },
  which: (bin) => findOnPath(bin),
};

let native: ShellProfile[] | null = null;
let distros: ShellProfile[] = [];
const nativeShells = () => (native ??= detectNativeShells(machine));

export const win32: PlatformLayer = {
  shells: () => [...nativeShells(), ...distros],
  async refreshShells() {
    native = detectNativeShells(machine);
    distros = (await listDistros()).map(wslProfile);
    return [...native, ...distros];
  },
  shellFor(cwd) {
    const unc = parseWslUnc(cwd);
    return unc ? wslProfile(unc.distro) : nativeShells()[0]!;
  },
  spawnSpec: (shell, cmd, cwd) => winSpawnSpec(shell, cmd, cwd),
  git: (cwd, args) => winGit(cwd, args),
};
