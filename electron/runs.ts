// Run slot (T60): a dev server or test watcher started apart from the agent, per project dir / worktree.
// Each run is `$SHELL -l -c <command>` in its own process group (detached), so Stop and quit kill the whole tree
// (npm → vite → esbuild). Output is kept as a tail for the log pane and scanned for errors and a local address.
// Pure parts (defaults, error / address scan, ids) are tested; the manager is tested with real processes.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RunCommand, RunInfo, RunList } from '../src/shared/api/types';
import { findDevUrls } from './devUrls';

/** Output kept per run for a log pane opened later. */
const LOG_TAIL = 256 * 1024;
/** Unfinished line kept for the error / address scan when a chunk ends mid-line. */
const LINE_TAIL = 1024;
/** Output is sent at most this often per run (a flood must not become one IPC message per chunk). */
const FLUSH_MS = 50;
/** SIGTERM, then SIGKILL for whatever is still in the group after this. */
const KILL_GRACE_MS = 2000;
const NAME_MAX = 40;
const COMMAND_MAX = 2000;
const READY_MAX = 200;
const MAX_COMMANDS = 12;

// eslint-disable-next-line no-control-regex -- terminal escapes are control characters
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
/**
 * Lines that mean the run is in trouble: `Error` / `TypeError:` (case-sensitive, so "0 errors" and `errorHandler`
 * don't count), a taken port, out of memory, a `NaN` that leaked into output.
 */
const ERROR_LINE = /Error\b|EADDRINUSE|\bOOM\b|out of memory|\bNaN\b/;

/** Project + worktree + command name → the run's id. */
export const runId = (projectId: string, worktree: string | undefined, name: string): string =>
  JSON.stringify([projectId, worktree ?? '', name]);

/** Valid commands from config / the settings form: trimmed, named, unique names, capped. */
export function cleanRunCommands(list: unknown): RunCommand[] {
  if (!Array.isArray(list)) return [];
  const out: RunCommand[] = [];
  for (const item of list as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const { name, command, ready } = item as { name?: unknown; command?: unknown; ready?: unknown };
    if (typeof command !== 'string' || !command.trim() || command.length > COMMAND_MAX) continue;
    const cmd = command.trim();
    const n = (typeof name === 'string' && name.trim() ? name.trim() : cmd).slice(0, NAME_MAX);
    if (out.some((c) => c.name === n)) continue;
    const r = typeof ready === 'string' ? ready.trim().slice(0, READY_MAX) : '';
    out.push({ name: n, command: cmd, ...(r ? { ready: r } : {}) });
    if (out.length >= MAX_COMMANDS) break;
  }
  return out;
}

/** How to run a package.json script in `dir`: the package manager its lockfile (or `packageManager`) names. */
export function scriptCommand(dir: string, script: string, packageManager?: unknown): string {
  const pm = typeof packageManager === 'string' ? packageManager.split('@')[0] : '';
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  if (pm === 'pnpm' || (!pm && has('pnpm-lock.yaml'))) return `pnpm ${script}`;
  if (pm === 'yarn' || (!pm && has('yarn.lock'))) return `yarn ${script}`;
  if (pm === 'bun' || (!pm && (has('bun.lockb') || has('bun.lock')))) return `bun run ${script}`;
  return `npm run ${script}`;
}

/** No commands configured: the `dev` script when the folder's package.json has one (`npm run dev`, `pnpm dev`, …). */
export function defaultRunCommands(dir: string): RunCommand[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
      packageManager?: unknown;
    };
    return typeof pkg.scripts?.dev === 'string'
      ? [{ name: 'dev', command: scriptCommand(dir, 'dev', pkg.packageManager) }]
      : [];
  } catch {
    return [];
  }
}

/** Splits output into complete lines (colors stripped) and the unfinished rest. */
export function splitLines(pending: string, data: string): { lines: string[]; rest: string } {
  const text = (pending + data).replace(/\r\n?/g, '\n');
  const parts = text.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.map((l) => l.replace(ANSI, '')), rest: rest.slice(-LINE_TAIL) };
}

/**
 * Lines a watcher prints when it's healthy again after an error (a fixed compile error, a passing re-run). Not
 * "compiled" alone: `webpack compiled with 1 error` is still broken.
 */
const RECOVERED_LINE =
  /compiled successfully|Found 0 errors|No errors found|\bready in \d|hmr update|page reload|✓ (?:Compiled|Ready)|Watching for file changes/i;

/** The first line that means trouble, trimmed for display; null when none. */
export function findRunError(lines: readonly string[]): string | null {
  const hit = lines.find((l) => ERROR_LINE.test(l));
  return hit === undefined ? null : hit.trim().slice(0, 200);
}

/**
 * What the latest telling line says: trouble (with the line), healthy again, or nothing either way. `ready` is the
 * command's own "healthy" text (case-insensitive substring), checked before the error pattern so a ready line that
 * happens to contain "Error" (`0 Errors`) still counts as healthy.
 */
export function lastVerdict(lines: readonly string[], ready?: string): { error: string } | 'ok' | null {
  const mine = ready?.trim().toLowerCase();
  for (let i = lines.length - 1; i >= 0; i--) {
    if (mine && lines[i].toLowerCase().includes(mine)) return 'ok';
    if (ERROR_LINE.test(lines[i])) return { error: lines[i].trim().slice(0, 200) };
    if (RECOVERED_LINE.test(lines[i])) return 'ok';
  }
  return null;
}

/** A run that was up when the app quit, started again on the next launch. */
export interface SavedRun {
  projectId: string;
  worktree?: string;
  name: string;
}

/** `~/.aquila/runs.json` → the runs to start again; anything malformed is dropped. */
export function parseSavedRuns(text: string): SavedRun[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (data as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(list)) return [];
  const out: SavedRun[] = [];
  for (const r of list as unknown[]) {
    const { projectId, worktree, name } = (r ?? {}) as Record<string, unknown>;
    if (typeof projectId !== 'string' || typeof name !== 'string' || !projectId || !name) continue;
    out.push({ projectId, name, ...(typeof worktree === 'string' && worktree ? { worktree } : {}) });
  }
  return out;
}

export function readSavedRuns(file: string): SavedRun[] {
  try {
    return parseSavedRuns(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

export function writeSavedRuns(file: string, runs: readonly SavedRun[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ runs }, null, 2) + '\n');
}

/** The `PORT` env of a run: the project's base + 10 per worktree (same as its tabs, T26). */
export const runEnv = (port: number | undefined): Record<string, string> =>
  port ? { PORT: String(port), AQUILA_PORT_BASE: String(port) } : {};

interface Run {
  id: string;
  projectId: string;
  worktree?: string;
  name: string;
  command: string;
  /** The command's own "healthy again" text (settings `# ready:`). */
  ready?: string;
  info: RunInfo;
  child: ChildProcess | null;
  /** Process group id (= the shell's pid). */
  pgid?: number;
  log: string;
  pending: string;
  outbox: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  stopping: Promise<void> | null;
}

export interface RunDeps {
  /** A run's state changed (started, error seen, address seen, exited). */
  onChange: (projectId: string, worktree: string | undefined) => void;
  /** Batched output. */
  onData: (id: string, data: string) => void;
  /** Raw output for the preview's address tracker. */
  onOutput?: (projectId: string, worktree: string | undefined, id: string, data: string) => void;
  /** Ports never offered as the run's address (the hook server). */
  ignorePorts?: readonly number[];
  shell?: string;
  windows?: boolean;
}

/** Is any process left in group `pgid`? */
const groupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const killGroup = (pgid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pgid, signal);
  } catch {
    /* already gone */
  }
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RunManager {
  private runs = new Map<string, Run>();

  constructor(private deps: RunDeps) {}

  /** Commands of a dir with their runs; a running command that left the config is still listed. */
  list(projectId: string, worktree: string | undefined, commands: readonly RunCommand[]): RunList {
    const runs: RunInfo[] = commands.map((c) => {
      const run = this.runs.get(runId(projectId, worktree, c.name));
      return run && run.command === c.command
        ? { ...run.info }
        : {
            id: runId(projectId, worktree, c.name),
            name: c.name,
            command: c.command,
            state: 'idle',
            alive: false,
          };
    });
    for (const run of this.runs.values()) {
      if (run.projectId !== projectId || run.worktree !== worktree || !run.info.alive) continue;
      if (!runs.some((r) => r.id === run.id && r.command === run.command)) runs.push({ ...run.info });
    }
    return { projectId, ...(worktree ? { worktree } : {}), runs };
  }

  /** Runs that are up now (saved at quit, started again on the next launch). */
  active(): SavedRun[] {
    return [...this.runs.values()]
      .filter((r) => r.info.alive && !r.stopping)
      .map((r) => ({
        projectId: r.projectId,
        name: r.name,
        ...(r.worktree ? { worktree: r.worktree } : {}),
      }));
  }

  log(id: string): string {
    return this.runs.get(id)?.log ?? '';
  }

  /** Starts `command` in `cwd` (stopping the previous run of the same name first). */
  async start(opts: {
    projectId: string;
    worktree?: string;
    name: string;
    command: string;
    ready?: string;
    cwd: string;
    port?: number;
  }): Promise<void> {
    const id = runId(opts.projectId, opts.worktree, opts.name);
    const prev = this.runs.get(id);
    if (prev?.info.alive) await this.stop(id);
    const run: Run = {
      id,
      projectId: opts.projectId,
      worktree: opts.worktree,
      name: opts.name,
      command: opts.command,
      ready: opts.ready,
      info: {
        id,
        name: opts.name,
        command: opts.command,
        state: 'running',
        alive: true,
        startedAt: Date.now(),
        ...(opts.port ? { port: opts.port } : {}),
      },
      child: null,
      log: '',
      pending: '',
      outbox: '',
      flushTimer: null,
      stopping: null,
    };
    this.runs.set(id, run);
    const env = { ...process.env, ...runEnv(opts.port), FORCE_COLOR: '1', AQUILA_RUN: '1' };
    let child: ChildProcess;
    try {
      child = this.deps.windows
        ? spawn('cmd.exe', ['/d', '/s', '/c', opts.command], { cwd: opts.cwd, env, windowsHide: true })
        : spawn(this.deps.shell ?? process.env.SHELL ?? '/bin/zsh', ['-l', '-c', opts.command], {
            cwd: opts.cwd,
            env,
            detached: true, // its own process group: Stop kills the tree
            stdio: ['ignore', 'pipe', 'pipe'],
          });
    } catch (e) {
      this.fail(run, (e as Error).message);
      return;
    }
    run.child = child;
    run.pgid = child.pid;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => this.output(run, d));
    child.stderr?.on('data', (d: string) => this.output(run, d));
    child.on('error', (e) => this.fail(run, e.message));
    child.on('exit', (code) => {
      if (this.runs.get(id) !== run) return;
      this.flush(run);
      // The shell is gone; tools it started in the background may not be. A run that ended leaves nothing behind.
      if (run.pgid && !this.deps.windows) killGroup(run.pgid, 'SIGKILL');
      const failed = code !== 0 && code !== null && !run.stopping;
      run.info = {
        ...run.info,
        alive: false,
        exitCode: code,
        // Stopped by the user: ended, whatever it printed before.
        state: failed || (run.info.state === 'error' && !run.stopping) ? 'error' : 'exited',
        ...(failed && !run.info.reason ? { reason: `exit ${code}` } : {}),
      };
      run.child = null;
      this.deps.onChange(run.projectId, run.worktree);
    });
    this.deps.onChange(run.projectId, run.worktree);
  }

  /** SIGTERM to the group, SIGKILL after a grace period; resolves when nothing of it is left. */
  stop(id: string): Promise<void> {
    const run = this.runs.get(id);
    if (!run?.info.alive) return Promise.resolve();
    if (run.stopping) return run.stopping;
    run.stopping = this.killTree(run);
    return run.stopping;
  }

  /** Stops every run (app quit). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }

  /** Last resort on process exit: SIGKILL every group now (synchronous). */
  killAllNow(): void {
    for (const run of this.runs.values()) {
      if (!run.pgid) continue;
      if (this.deps.windows) run.child?.kill();
      else killGroup(run.pgid, 'SIGKILL');
    }
  }

  /** The project's runs are no longer listed (project removed): stop them. */
  async stopProject(projectId: string): Promise<void> {
    await Promise.all(
      [...this.runs.values()].filter((r) => r.projectId === projectId).map((r) => this.stop(r.id)),
    );
  }

  private async killTree(run: Run): Promise<void> {
    const pgid = run.pgid;
    if (!pgid) return;
    if (this.deps.windows) {
      await new Promise<void>((resolve) =>
        execFile('taskkill', ['/T', '/F', '/PID', String(pgid)], () => resolve()),
      );
    } else {
      killGroup(pgid, 'SIGTERM');
      const until = Date.now() + KILL_GRACE_MS;
      while (groupAlive(pgid) && Date.now() < until) await wait(50);
      if (groupAlive(pgid)) killGroup(pgid, 'SIGKILL');
      while (groupAlive(pgid) && Date.now() < until + 1000) await wait(20);
    }
    // The shell's exit event may come after the group is gone.
    if (run.info.alive && run.child) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        run.child?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  private output(run: Run, data: string): void {
    if (this.runs.get(run.id) !== run) return;
    run.log = (run.log + data).slice(-LOG_TAIL);
    run.outbox += data;
    run.flushTimer ??= setTimeout(() => this.flush(run), FLUSH_MS);
    this.deps.onOutput?.(run.projectId, run.worktree, run.id, data);
    const { lines, rest } = splitLines(run.pending, data);
    run.pending = rest;
    if (!lines.length) return;
    let changed = false;
    // An error line turns it red; a watcher that's healthy again afterwards (fixed compile error) turns it back.
    const verdict = lastVerdict(lines, run.ready);
    if (verdict && verdict !== 'ok' && run.info.state === 'running') {
      run.info = { ...run.info, state: 'error', reason: verdict.error };
      changed = true;
    } else if (verdict === 'ok' && run.info.state === 'error' && run.info.alive) {
      const { reason: _reason, ...rest } = run.info;
      void _reason;
      run.info = { ...rest, state: 'running' };
      changed = true;
    }
    if (data.includes('://')) {
      const urls = findDevUrls(lines.join('\n'), this.deps.ignorePorts);
      const url = urls.at(-1);
      if (url && url !== run.info.url) {
        run.info = { ...run.info, url };
        changed = true;
      }
    }
    if (changed) this.deps.onChange(run.projectId, run.worktree);
  }

  private flush(run: Run): void {
    if (run.flushTimer) clearTimeout(run.flushTimer);
    run.flushTimer = null;
    if (!run.outbox) return;
    const data = run.outbox;
    run.outbox = '';
    this.deps.onData(run.id, data);
  }

  private fail(run: Run, message: string): void {
    if (this.runs.get(run.id) !== run) return;
    run.info = { ...run.info, state: 'error', alive: false, reason: message.slice(0, 200) };
    run.child = null;
    this.deps.onChange(run.projectId, run.worktree);
  }
}
