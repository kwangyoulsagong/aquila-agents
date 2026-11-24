/**
 * Files a Claude turn changed by any means — shell commands included (T70). Edit-tool calls are in the transcript;
 * `sed -i`, codegen, `git mv`, a formatter are not. So at `UserPromptSubmit` the turn's folder is looked at once
 * (`git status` + each listed file's mtime) and again at `Stop`: a file that appeared, disappeared or whose mtime
 * moved in between was changed by the turn. Kept per Claude session id in `~/.aquila/graph/turns.json`.
 *
 * Two git calls per turn, only while a note source is enabled (the caller checks). Two sessions working in the same
 * folder at the same time can claim each other's files; nothing here can tell them apart.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Paths in one folder's `git status` read (more is a huge untracked tree: ignored). */
export const MAX_STATUS = 2000;
/** Files kept per session. */
export const MAX_TURN_FILES = 200;
/** Sessions kept (the most recently changed). */
export const MAX_SESSIONS = 500;
const SAVE_DELAY_MS = 2000;

/** Absolute paths `git status` lists under `cwd` (modified, added, deleted, untracked), or null outside a repo. */
export type StatusOf = (cwd: string) => Promise<string[] | null>;
/** mtime (ms) of a file, or null when it's gone. */
export type MtimeOf = (abs: string) => number | null | Promise<number | null>;

/** `git status --porcelain=v1 -z` → paths (renames: the new one), relative to the repo root. */
export function parsePorcelainZ(out: string): string[] {
  const parts = out.split('\0');
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.length < 4) continue;
    const xy = p.slice(0, 2);
    files.push(p.slice(3));
    // A rename / copy is followed by its old path.
    if (xy[0] === 'R' || xy[0] === 'C') i++;
  }
  return files;
}

export const gitStatusOf: StatusOf = (cwd) =>
  new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', 'rev-parse', '--show-toplevel'],
      { cwd, timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, top) => {
        if (err) return resolve(null);
        const root = top.trim();
        execFile(
          'git',
          ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
          {
            cwd: root,
            timeout: 10_000,
            maxBuffer: 8 * 1024 * 1024,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
          },
          (e, out) => {
            if (e) return resolve(null);
            const files = parsePorcelainZ(out);
            resolve(files.length > MAX_STATUS ? null : files.map((f) => path.join(root, f)));
          },
        );
      },
    );
  });

/** Async: up to MAX_STATUS files per turn edge, which must not block the main process. */
export const fsMtimeOf: MtimeOf = (abs) =>
  fs.promises.stat(abs).then(
    (st) => st.mtimeMs,
    () => null,
  );

type Snapshot = Map<string, number | null>;

/** What changed between two looks at a folder: new, gone, or a different mtime. */
export function changedBetween(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  for (const [f, m] of after) if (!before.has(f) || before.get(f) !== m) out.push(f);
  for (const f of before.keys()) if (!after.has(f)) out.push(f);
  return out;
}

export interface TurnFilesOptions {
  file: string;
  status?: StatusOf;
  mtime?: MtimeOf;
  /** A session's files changed (the graph refetches). */
  onChange?: () => void;
}

export class TurnFiles {
  private open = new Map<string, Promise<{ cwd: string; snap: Snapshot } | null>>();
  private data: Record<string, string[]> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly status: StatusOf;
  private readonly mtime: MtimeOf;

  constructor(private opts: TurnFilesOptions) {
    this.status = opts.status ?? gitStatusOf;
    this.mtime = opts.mtime ?? fsMtimeOf;
  }

  private async look(cwd: string): Promise<Snapshot | null> {
    const files = await this.status(cwd);
    if (!files) return null;
    const mtimes = await Promise.all(files.map((f) => this.mtime(f)));
    return new Map(files.map((f, i) => [f, mtimes[i] ?? null]));
  }

  /** `UserPromptSubmit`: remember the folder as it is now. */
  start(sessionId: string, cwd: string): void {
    this.open.set(
      sessionId,
      this.look(cwd).then((snap) => snap && { cwd, snap }),
    );
  }

  /** `Stop`: what the turn changed is added to the session's files. */
  async stop(sessionId: string): Promise<string[]> {
    const pending = this.open.get(sessionId);
    const begun = await pending;
    // The next prompt may have started a new turn while this one's snapshot was still being taken: keep that one.
    if (this.open.get(sessionId) === pending) this.open.delete(sessionId);
    if (!begun) return [];
    const after = await this.look(begun.cwd);
    if (!after) return [];
    const changed = changedBetween(begun.snap, after);
    if (changed.length) this.add(sessionId, changed);
    return changed;
  }

  /** Every session's files (read once from disk). */
  all(): Record<string, string[]> {
    if (!this.data) {
      try {
        const v: unknown = JSON.parse(fs.readFileSync(this.opts.file, 'utf8'));
        this.data = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string[]>) : {};
      } catch {
        this.data = {};
      }
    }
    return this.data;
  }

  private add(sessionId: string, files: string[]): void {
    const all = this.all();
    // At the cap the newest files stay (a long session keeps what it touched last).
    const merged = [...new Set([...(all[sessionId] ?? []), ...files])].slice(-MAX_TURN_FILES);
    // Most recent last, so the oldest sessions are the first dropped.
    delete all[sessionId];
    all[sessionId] = merged;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SESSIONS))) delete all[k];
    this.opts.onChange?.();
    this.timer ??= setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.data) return;
    fs.mkdirSync(path.dirname(this.opts.file), { recursive: true });
    fs.writeFileSync(`${this.opts.file}.tmp`, JSON.stringify(this.data));
    fs.renameSync(`${this.opts.file}.tmp`, this.opts.file);
  }
}
