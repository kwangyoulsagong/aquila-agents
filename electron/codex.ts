// Which codex session a tab is running (T21), so two codex tabs in one folder each resume their own session.
// Codex writes `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl` (local date) whose first line is
// `session_meta` with the session `id` and `cwd`. We read only that first line. Read-only: nothing under ~/.codex is
// ever written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_SESSIONS_DIR = path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  'sessions',
);

export interface Rollout {
  id: string;
  cwd: string;
  /** session_meta timestamp (ms). */
  startedAt: number;
}

/** The first line carries codex's base instructions, so it can be long; the fields we need come before them. */
const HEAD_BYTES = 64 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** id, cwd and start time from the head of a rollout file; null when it isn't a session_meta line. */
export function parseRolloutHead(head: string): Rollout | null {
  const line = head.split('\n', 1)[0];
  if (!line.includes('"type":"session_meta"')) return null;
  const meta = line.slice(line.indexOf('"payload"'));
  const id = new RegExp(`[{,]"id":"(${UUID})"`, 'i').exec(meta)?.[1];
  const cwdLit = /"cwd":("(?:[^"\\]|\\.)*")/.exec(meta)?.[1];
  const ts = /"timestamp":"([^"]+)"/.exec(meta)?.[1];
  if (!id || !cwdLit || !ts) return null;
  let cwd: string;
  try {
    cwd = JSON.parse(cwdLit) as string;
  } catch {
    return null;
  }
  const startedAt = Date.parse(ts);
  return Number.isFinite(startedAt) ? { id: id.toLowerCase(), cwd, startedAt } : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Rollouts started at or after `since`, oldest first. Only the day folders from `since` to now are read. */
export function findRollouts(since: number, root = CODEX_SESSIONS_DIR, now = Date.now()): Rollout[] {
  const out: Rollout[] = [];
  const day = new Date(since);
  day.setHours(0, 0, 0, 0);
  for (let i = 0; day.getTime() <= now && i < 31; i++, day.setDate(day.getDate() + 1)) {
    const dir = path.join(root, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      try {
        if (fs.statSync(file).mtimeMs < since) continue;
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(HEAD_BYTES);
        const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
        fs.closeSync(fd);
        const r = parseRolloutHead(buf.subarray(0, n).toString('utf8'));
        if (r && r.startedAt >= since) out.push(r);
      } catch {
        // unreadable: skip
      }
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export interface CodexTab {
  id: string;
  cwd: string;
  /** When the pty was spawned (ms). */
  spawnedAt: number;
  /** Last time Enter was typed in it (ms), if ever. */
  lastSubmit?: number;
}

/** Codex may take a moment between Enter and writing session_meta (and clocks are coarse). */
const SUBMIT_SLACK_MS = 2000;

/**
 * Matches new rollouts to codex tabs that don't know their session yet: same cwd, started after the tab spawned;
 * among several such tabs, the one where Enter was typed closest to when the rollout started (codex creates the rollout
 * on the first prompt), else the oldest. `claimed` = session ids other tabs already own. Returns tab id → session id.
 */
export function assignRollouts(
  tabs: CodexTab[],
  rollouts: Rollout[],
  claimed: Set<string>,
): Map<string, string> {
  const result = new Map<string, string>();
  const free = new Set(tabs.map((t) => t.id));
  for (const r of rollouts) {
    if (claimed.has(r.id)) continue;
    const candidates = tabs.filter((t) => free.has(t.id) && t.cwd === r.cwd && t.spawnedAt <= r.startedAt);
    if (!candidates.length) continue;
    const submitted = candidates
      .filter((t) => t.lastSubmit !== undefined && t.lastSubmit <= r.startedAt + SUBMIT_SLACK_MS)
      .sort(
        (a, b) => Math.abs(r.startedAt - (a.lastSubmit ?? 0)) - Math.abs(r.startedAt - (b.lastSubmit ?? 0)),
      );
    const tab = submitted[0] ?? [...candidates].sort((a, b) => a.spawnedAt - b.spawnedAt)[0];
    result.set(tab.id, r.id);
    free.delete(tab.id);
    claimed.add(r.id);
  }
  return result;
}
