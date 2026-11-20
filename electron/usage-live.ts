// Real usage (T30b): the share of each limit as the CLIs themselves report it, instead of the transcript estimate.
//
// Claude: `claude -p /usage` prints "Current session: 8% used · resets Nov 20 at 1:30pm (Asia/Seoul)" and the same for
// the week. It's a local command (no model call, no quota), run hidden per account with that account's config dir.
// The text isn't an API: anything we can't read → null, and the gauge falls back to the estimate.
//
// Codex: every session file (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`) records the account's `rate_limits`
// (used_percent, window_minutes, resets_at) on each turn; the newest one is the latest we know. Read-only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { binaryFor } from './detect';

export interface LiveWindow {
  /** 0–100, as the CLI said. */
  percent: number;
  /** Epoch ms; null when the CLI gave no (readable) reset time. */
  resetsAt: number | null;
  /** Window length in minutes (Codex says it; Claude's are 300 and 10080). */
  span: number;
}

export interface ClaudeLive {
  session: LiveWindow | null;
  week: LiveWindow | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Offset of `timeZone` from UTC at `at` (ms; Seoul → +9h). Unknown zone → null. */
function zoneOffset(timeZone: string, at: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const wall = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return wall - Math.floor(at / 1000) * 1000;
  } catch {
    return null;
  }
}

/** Epoch ms of a wall-clock time in a zone (two passes, so a DST edge lands right). */
function fromWall(timeZone: string, y: number, mo: number, d: number, h: number, mi: number): number | null {
  const guess = Date.UTC(y, mo, d, h, mi);
  const first = zoneOffset(timeZone, guess);
  if (first === null) return null;
  const second = zoneOffset(timeZone, guess - first);
  return guess - (second ?? first);
}

/**
 * "Nov 20 at 1:30pm (Asia/Seoul)", "1:30pm (Asia/Seoul)" (today), "Nov 24 at 11am" (local zone) → epoch ms. The year
 * isn't printed: the next such date from `now` (a reset is never far in the past).
 */
export function parseReset(
  text: string,
  now: number,
  localZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const m =
    /^(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*\d{4})?\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?:\s*\(([^)]+)\))?/i.exec(
      text.trim(),
    );
  if (!m) return null;
  const zone = m[6]?.trim() || localZone;
  let hour = Number(m[3]) % 12;
  if (m[5].toLowerCase() === 'p') hour += 12;
  const minute = Number(m[4] ?? 0);
  const offset = zoneOffset(zone, now);
  if (offset === null) return null;
  const today = new Date(now + offset); // wall clock in the zone, read with UTC getters
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth();
  let day = today.getUTCDate();
  if (m[1]) {
    const idx = MONTHS.indexOf(m[1].toLowerCase());
    if (idx === -1) return null;
    month = idx;
    day = Number(m[2]);
  }
  let at = fromWall(zone, year, month, day, hour, minute);
  if (at === null) return null;
  // A time alone that has passed is tomorrow's; a date more than a day back (Dec read in Jan) is next year's.
  if (m[1] ? at < now - 24 * 3_600_000 : at < now) {
    if (m[1]) year += 1;
    else day += 1;
    at = fromWall(zone, year, month, day, hour, minute);
  }
  return at;
}

const line = (text: string, label: RegExp, span: number, now: number): LiveWindow | null => {
  const m = new RegExp(
    `^\\s*${label.source}\\s*:\\s*(\\d+(?:\\.\\d+)?)%\\s*used(?:\\s*[·•-]\\s*resets\\s+(.+))?$`,
    'im',
  ).exec(text);
  if (!m) return null;
  const percent = Math.min(100, Number(m[1]));
  return { percent, resetsAt: m[2] ? parseReset(m[2], now) : null, span };
};

/** The two windows from `/usage` output; null when neither is there (API key, logged out, a new format). */
export function parseClaudeUsage(text: string, now: number): ClaudeLive | null {
  const session = line(text, /Current session/, 300, now);
  const week = line(text, /Current week \(all models\)/, 10_080, now);
  return session || week ? { session, week } : null;
}

const PROBE_TIMEOUT_MS = 30_000;

/** Runs `claude -p /usage` with the account's config dir (null = the default `~/.claude`). */
export function probeClaudeUsage(
  configDir: string | null,
  now: () => number = Date.now,
): Promise<ClaudeLive | null> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Inherited from a terminal (or a Claude session that launched us) these would point the probe at another account.
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  return new Promise((resolve) => {
    // stdin closed: with a pipe, `claude -p` waits 3 s for piped input first.
    const child = spawn(binaryFor('claude'), ['-p', '/usage', '--no-session-persistence'], {
      cwd: os.homedir(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const timer = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);
    let settled = false;
    const done = (why: string | null) => {
      if (settled) return; // 'error' can be followed by 'close'
      settled = true;
      clearTimeout(timer);
      const live = parseClaudeUsage(out, now());
      if (!live) console.error(`[usage] /usage unreadable (${configDir ?? 'default'}): ${why ?? (err.trim().split('\n')[0] || out.trim().split('\n')[0] || 'empty')}`);
      resolve(live);
    };
    child.on('error', (e) => done(e.message));
    child.on('close', () => done(null));
  });
}

// ── Codex ──────────────────────────────────────────────────────────────────────

export interface CodexLive {
  primary: LiveWindow | null;
  secondary: LiveWindow | null;
  plan: string | null;
  /** When the snapshot was recorded (epoch ms). */
  at: number;
}

const codexWindow = (v: unknown, now: number): LiveWindow | null => {
  if (!v || typeof v !== 'object') return null;
  const w = v as Record<string, unknown>;
  if (typeof w.used_percent !== 'number' || typeof w.window_minutes !== 'number') return null;
  const resetsAt = typeof w.resets_at === 'number' ? w.resets_at * 1000 : null;
  // The window rolled over since the snapshot: nothing used in the new one yet, as far as we know.
  if (resetsAt !== null && resetsAt <= now) return { percent: 0, resetsAt: null, span: w.window_minutes };
  return { percent: Math.min(100, Math.max(0, w.used_percent)), resetsAt, span: w.window_minutes };
};

/** The `rate_limits` of one rollout line, wherever it sits in the event. */
function findRateLimits(v: unknown, depth = 0): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || depth > 4) return null;
  const o = v as Record<string, unknown>;
  if (o.rate_limits && typeof o.rate_limits === 'object') return o.rate_limits as Record<string, unknown>;
  for (const child of Object.values(o)) {
    const found = findRateLimits(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The last `rate_limits` in a rollout's text; null if none. */
export function parseCodexRollout(text: string, now: number): CodexLive | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.includes('"rate_limits"')) continue;
    let json: unknown;
    try {
      json = JSON.parse(l);
    } catch {
      continue; // the first line of a tail read can be cut
    }
    const rl = findRateLimits(json);
    if (!rl) continue;
    const primary = codexWindow(rl.primary, now);
    const secondary = codexWindow(rl.secondary, now);
    if (!primary && !secondary) continue;
    const ts = (json as { timestamp?: unknown }).timestamp;
    const at = typeof ts === 'string' && Number.isFinite(Date.parse(ts)) ? Date.parse(ts) : now;
    return { primary, secondary, plan: typeof rl.plan_type === 'string' ? rl.plan_type : null, at };
  }
  return null;
}

const TAIL_BYTES = 512 * 1024;

const sortedDirs = async (dir: string): Promise<string[]> => {
  try {
    const list = await fs.promises.readdir(dir, { withFileTypes: true });
    return list
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
};

/** The newest rollout files (newest first), from the last few days with any. */
export async function recentRollouts(sessionsDir: string, max = 5): Promise<string[]> {
  const files: { file: string; mtime: number }[] = [];
  for (const y of await sortedDirs(sessionsDir))
    for (const m of await sortedDirs(path.join(sessionsDir, y)))
      for (const d of await sortedDirs(path.join(sessionsDir, y, m))) {
        const dir = path.join(sessionsDir, y, m, d);
        for (const name of await fs.promises.readdir(dir).catch(() => [] as string[])) {
          if (!name.endsWith('.jsonl')) continue;
          const st = await fs.promises.stat(path.join(dir, name)).catch(() => null);
          if (st) files.push({ file: path.join(dir, name), mtime: st.mtimeMs });
        }
        if (files.length >= max) return files.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
      }
  return files.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
}

async function tail(file: string): Promise<string> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

export const codexHome = (): string => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

/** Latest Codex limits from its session files; null when Codex never recorded any. */
export async function readCodexLive(home = codexHome(), now = Date.now()): Promise<CodexLive | null> {
  for (const file of await recentRollouts(path.join(home, 'sessions'))) {
    try {
      const live = parseCodexRollout(await tail(file), now);
      if (live) return live;
    } catch {
      // unreadable: try the next one
    }
  }
  return null;
}
