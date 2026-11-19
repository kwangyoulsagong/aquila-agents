// Context gauge per tab (T31). The injected `--settings` gives Claude a statusline command that drops the statusline
// JSON into `~/.aquila/context/<tab id>.json` (prints nothing, so the status line stays empty). We watch that folder
// and push `context_window` per tab. A user who has their own `statusLine` keeps it: we don't inject ours then
// (flag settings would replace it), and that tab simply has no gauge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_DIR } from './config';
import type { ContextUpdate, ContextUsage } from '../src/shared/api/types';

export const CONTEXT_DIR = path.join(APP_DIR, 'context');

const TAB_FILE = /^([\w-]+)\.json$/;
/** Statusline updates come in bursts (every streamed message); read a file once per burst. */
const READ_DEBOUNCE_MS = 250;

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Writes stdin to `<dir>/$AQUILA_TAB_ID.json` via a temp file (no half-written JSON); prints nothing. */
export function statusLineCommand(dir = CONTEXT_DIR): string {
  const d = shellQuote(dir);
  return (
    `[ -n "$AQUILA_TAB_ID" ] && mkdir -p ${d} && cat > ${d}/"$AQUILA_TAB_ID.tmp" && ` +
    `mv -f ${d}/"$AQUILA_TAB_ID.tmp" ${d}/"$AQUILA_TAB_ID.json"; true`
  );
}

export function statusLineSettings(dir = CONTEXT_DIR): { statusLine: Record<string, unknown> } {
  return { statusLine: { type: 'command', command: statusLineCommand(dir), padding: 0 } };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** `context_window` of a statusline JSON → percent and tokens; null when it has none (older Claude). */
export function readContextWindow(body: string): ContextUsage | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const cw = (json as { context_window?: unknown } | null)?.context_window;
  if (!cw || typeof cw !== 'object') return null;
  const c = cw as Record<string, unknown>;
  const windowTokens = num(c.context_window_size);
  const cur =
    c.current_usage && typeof c.current_usage === 'object'
      ? (c.current_usage as Record<string, unknown>)
      : null;
  const used = cur
    ? (num(cur.input_tokens) ?? 0) +
      (num(cur.cache_creation_input_tokens) ?? 0) +
      (num(cur.cache_read_input_tokens) ?? 0)
    : undefined;
  let percent = num(c.used_percentage);
  if (percent === undefined && used !== undefined && windowTokens) percent = (used / windowTokens) * 100;
  // No message yet in this session (`current_usage: null`, no percentage): nothing to show.
  if (percent === undefined) return null;
  const clamped = Math.min(100, Math.max(0, percent));
  return {
    percent: clamped,
    usedTokens: used ?? (windowTokens ? Math.round((clamped / 100) * windowTokens) : 0),
    windowTokens: windowTokens ?? 0,
  };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Managed settings outrank `--settings`, user and project ones are outranked by it (ours would replace theirs). */
const MANAGED_SETTINGS = '/Library/Application Support/ClaudeCode/managed-settings.json';

/**
 * Settings files whose `statusLine` we would replace (or that would win anyway), for a Claude started in `cwd` with
 * `configDir` (CLAUDE_CONFIG_DIR, or undefined for `~/.claude`). Read-only.
 */
export function statusLineSources(cwd: string, configDir: string | undefined, home = os.homedir()): string[] {
  return [
    path.join(configDir ?? path.join(home, '.claude'), 'settings.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
    MANAGED_SETTINGS,
  ];
}

/** True when the user already has a status line there: then we don't inject ours. */
export function userHasStatusLine(files: string[]): boolean {
  return files.some((f) => {
    const s = readJson(f)?.statusLine;
    return !!s && typeof s === 'object';
  });
}

/** Watches `CONTEXT_DIR` and reports each tab's context use. Files from a previous run are removed at start. */
export class ContextWatcher {
  private latest = new Map<string, ContextUsage>();
  private timers = new Map<string, NodeJS.Timeout>();
  private watcher: fs.FSWatcher | null = null;

  constructor(
    private onChange: (u: ContextUpdate) => void,
    private dir = CONTEXT_DIR,
  ) {}

  start(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.watcher = fs.watch(this.dir, (_e, name) => {
      const m = typeof name === 'string' ? TAB_FILE.exec(name) : null;
      if (m) this.schedule(m[1]);
    });
    this.watcher.on('error', (err) => console.error('[context] watch', err));
  }

  stop(): void {
    this.watcher?.close();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  all(): ContextUpdate[] {
    return [...this.latest].map(([id, usage]) => ({ id, usage }));
  }

  /** The tab closed or Claude in it ended: forget it, drop its file and clear the gauge. */
  remove(id: string): void {
    const had = this.latest.delete(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    fs.rmSync(path.join(this.dir, `${id}.json`), { force: true });
    if (had) this.onChange({ id, usage: null });
  }

  private schedule(id: string): void {
    if (this.timers.has(id)) return;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.read(id);
      }, READ_DEBOUNCE_MS),
    );
  }

  /** Read one tab's file now (also used by tests). */
  read(id: string): void {
    let body: string;
    try {
      body = fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8');
    } catch {
      return; // removed meanwhile
    }
    const u = readContextWindow(body);
    if (!u) return;
    const prev = this.latest.get(id);
    if (prev && Math.round(prev.percent) === Math.round(u.percent) && prev.usedTokens === u.usedTokens)
      return;
    this.latest.set(id, u);
    this.onChange({ id, usage: u });
  }
}
