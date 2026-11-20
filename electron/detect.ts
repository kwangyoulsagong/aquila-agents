// First-run checks (T17): which of `claude` / `codex` / `git` are installed and which version, binary paths the
// user picked instead of PATH, and whether the checklist was finished. State in ~/.aquila/first-run.json.
// Read-only towards the CLIs: we only run `<bin> --version`.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './config';
import type { FirstRunReport, ToolCheck, ToolId } from '../src/shared/api/types';

export const FIRST_RUN_PATH = path.join(APP_DIR, 'first-run.json');
export const TOOLS: readonly ToolId[] = ['claude', 'codex', 'git'];

/** Copyable install command per tool (macOS; PowerShell on Windows). */
export const INSTALL: Record<ToolId, string> =
  process.platform === 'win32'
    ? {
        claude: 'irm https://claude.ai/install.ps1 | iex',
        codex: 'npm install -g @openai/codex',
        git: 'winget install --id Git.Git -e',
      }
    : {
        claude: 'curl -fsSL https://claude.ai/install.sh | bash',
        codex: 'npm install -g @openai/codex',
        git: 'xcode-select --install',
      };

export interface FirstRunState {
  /** The checklist was closed once (done or skipped): don't open it at launch again. */
  finished?: boolean;
  /** Absolute binary paths picked in the checklist, used instead of PATH. */
  paths?: Partial<Record<ToolId, string>>;
}

/** Defensive parse: anything unexpected is dropped, never thrown. */
export function parseFirstRunState(text: string): FirstRunState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const state: FirstRunState = {};
  if (r.finished === true) state.finished = true;
  if (r.paths && typeof r.paths === 'object') {
    const paths: Partial<Record<ToolId, string>> = {};
    for (const tool of TOOLS) {
      const p = (r.paths as Record<string, unknown>)[tool];
      if (typeof p === 'string' && path.isAbsolute(p)) paths[tool] = p;
    }
    if (Object.keys(paths).length) state.paths = paths;
  }
  return state;
}

export function readFirstRunState(file = FIRST_RUN_PATH): FirstRunState {
  try {
    return parseFirstRunState(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Temp file + rename, so a crash never leaves half a file. */
export function writeFirstRunState(state: FirstRunState, file = FIRST_RUN_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

export function isExecutable(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Extensions tried after the bare name: Windows' PATHEXT (`git` → `git.exe`, `claude` → `claude.cmd`). */
export function pathExts(platform: string = process.platform, pathExt = process.env.PATHEXT): string[] {
  if (platform !== 'win32') return [''];
  const exts = (pathExt || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  return ['', ...exts.map((e) => e.toLowerCase())];
}

/** First executable `bin` in PATH, like `command -v` (no aliases or functions: main can't run those). */
export function findOnPath(
  bin: string,
  pathEnv = process.env.PATH ?? process.env.Path ?? '',
  exts = pathExts(),
): string | null {
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir, bin.toLowerCase().endsWith(ext) ? bin : bin + ext);
      if (isExecutable(file)) return file;
    }
  }
  return null;
}

/** `2.1.328 (Claude Code)`, `codex-cli 0.170.0`, `git version 2.39.5 (Apple Git-154)` → the version. */
export function parseVersion(out: string): string | null {
  return /(\d+\.\d+(?:\.\d+)?)/.exec(out)?.[1] ?? null;
}

/** `<bin> --version`: null if it can't be run or fails, else its parsed version ('' when unparseable). */
function runVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 10_000, env: process.env }, (err, stdout, stderr) =>
      resolve(err ? null : (parseVersion(`${stdout}\n${stderr}`) ?? '')),
    );
  });
}

/**
 * On macOS without the Command Line Tools, /usr/bin/git is a stub that pops the installer when run.
 * `xcode-select -p` tells without running it.
 */
function hasCommandLineTools(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('/usr/bin/xcode-select', ['-p'], { timeout: 5_000 }, (err) => resolve(!err));
  });
}

export async function checkTool(tool: ToolId, override?: string): Promise<ToolCheck> {
  const base: ToolCheck = { tool, found: false, install: INSTALL[tool], ...(override ? { override } : {}) };
  const bin = override ?? findOnPath(tool);
  if (!bin) return base;
  if (!isExecutable(bin)) return { ...base, path: bin };
  if (
    tool === 'git' &&
    bin === '/usr/bin/git' &&
    process.platform === 'darwin' &&
    !(await hasCommandLineTools())
  )
    return base;
  const version = await runVersion(bin);
  if (version === null) return { ...base, path: bin };
  return { ...base, found: true, path: bin, ...(version ? { version } : {}) };
}

/** Binary paths the user picked; read at startup, changed from the checklist. */
let overrides: Partial<Record<ToolId, string>> = {};

export function loadOverrides(state = readFirstRunState()): void {
  overrides = { ...state.paths };
  applyGitOverride();
}

/** What main runs directly (execFile), and what a session runs (the platform layer quotes it). */
export function binaryFor(tool: ToolId): string {
  return overrides[tool] ?? tool;
}

/** git.ts / worktrees.ts run plain `git`: put the picked git's folder first in PATH. */
function applyGitOverride(): void {
  const p = overrides.git;
  if (!p) return;
  const dir = path.dirname(p);
  const rest = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d && d !== dir);
  process.env.PATH = [dir, ...rest].join(path.delimiter);
}

export async function firstRunReport(
  pathRestored: boolean,
  state = readFirstRunState(),
): Promise<FirstRunReport> {
  const tools = await Promise.all(TOOLS.map((tool) => checkTool(tool, state.paths?.[tool])));
  return { pending: !state.finished, pathRestored, tools };
}

export function finishFirstRun(file = FIRST_RUN_PATH): void {
  writeFirstRunState({ ...readFirstRunState(file), finished: true }, file);
}

/**
 * Use `file` for `tool` instead of PATH (null = back to PATH). Saved only if it runs `--version`;
 * otherwise the returned check has `rejected` and nothing changes.
 */
export async function setBinaryPath(
  tool: ToolId,
  file: string | null,
  stateFile = FIRST_RUN_PATH,
): Promise<ToolCheck> {
  const state = readFirstRunState(stateFile);
  const paths = { ...state.paths };
  if (file === null) {
    delete paths[tool];
  } else {
    const check = await checkTool(tool, file);
    if (!check.found) {
      const current = await checkTool(tool, paths[tool]);
      return { ...current, rejected: file };
    }
    paths[tool] = file;
  }
  const next: FirstRunState = { ...state, paths };
  if (!Object.keys(paths).length) delete next.paths;
  writeFirstRunState(next, stateFile);
  loadOverrides(next);
  return checkTool(tool, paths[tool]);
}
