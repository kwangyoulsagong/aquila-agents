// The platform layer (T19): everything that differs between macOS and Windows about starting a session
// lives behind `PlatformLayer`, so sessions.ts never branches on `process.platform` itself.

/** A shell a local session can run in. `posix` = the user's login shell on macOS. */
export type ShellKind = 'posix' | 'pwsh' | 'powershell' | 'gitbash' | 'cmd' | 'wsl';

export interface ShellProfile {
  kind: ShellKind;
  /** Executable to spawn (`wsl.exe` for every WSL distro). */
  file: string;
  /** Shown to the user: `PowerShell 7`, `Ubuntu (WSL)`. */
  label: string;
  /** WSL distro name (kind `wsl` only). */
  distro?: string;
}

/** What a session runs, before it is written in a shell's own syntax. */
export interface SessionCommand {
  /** Program and its arguments, unquoted. null = just the shell. */
  argv: string[] | null;
  /** Printed as `ESC ] 7501 ; <payload> BEL` when the program exits non-zero (a failed resume). */
  onFail?: string;
  /** The project's setup script (in that shell's language), run once before the program with a dim banner. */
  setup?: { banner: string; script: string };
}

export interface SpawnSpec {
  file: string;
  /** A string is a ready Windows command line (node-pty passes it as is). */
  args: string[] | string;
  cwd: string;
  /** Added to the session's environment. */
  env?: Record<string, string>;
}

/** Runs `git` for a tree: plain git, or git inside the WSL distro that holds the folder. */
export interface GitInvocation {
  file: string;
  args: string[];
  cwd: string;
}

export interface PlatformLayer {
  /** Shells found on this machine, best first (Windows: WSL distros once `refreshShells` has run). */
  shells(): ShellProfile[];
  /** Detects shells again (Windows: re-reads the WSL distro list). Never polled; at startup and on request. */
  refreshShells(): Promise<ShellProfile[]>;
  /** The shell a local session in `cwd` runs in (a `\\wsl.localhost\<distro>\…` folder runs in that distro). */
  shellFor(cwd: string): ShellProfile;
  /** How to spawn `cmd` in `shell`, ending in an interactive shell when the program exits. */
  spawnSpec(shell: ShellProfile, cmd: SessionCommand, cwd: string): SpawnSpec;
  /** How to run `git <args>` in `cwd`. */
  git(cwd: string, args: string[]): GitInvocation;
}
