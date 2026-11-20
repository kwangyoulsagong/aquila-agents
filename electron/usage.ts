// Usage gauge (T30): how much of the 5-hour and weekly limits each local Claude account has used — an estimate.
//
// Per account config dir, never per session (Claude's statusline `rate_limits` is shared across accounts). Usage comes
// from the account's own transcripts (`<configDir>/projects/**/*.jsonl`, subagents included), read incrementally from
// the last offset. Tokens are weighted like their price (input-token equivalents) so one number tracks the limit across
// cache-heavy and output-heavy turns.
//
// Anthropic publishes no token limit per plan, so the 100% mark is learned: when a session of this account fails with
// `StopFailure: rate_limit`, what was used then becomes the limit (`~/.aquila/usage-limits.json`). The hook doesn't say
// which window ran out: it counts as the 5-hour one, unless a 5-hour limit is known and the block is well below it —
// then it's the weekly one. A change of the account's rate-limit tier (plan) drops what was learned.
//
// Read-only under ~/.claude*. No secrets, no network. claude.ai and other machines are not in the transcripts — the UI
// says "estimated".
//
// T30b: when the CLI tells us the real share (`claude -p /usage` per account, Codex's session files — see
// usage-live.ts), that wins: `percent` + the real reset time. The estimate stays underneath as the fallback.
import fs from 'node:fs';
import path from 'node:path';
import { accountPaths, isLoggedIn } from './accounts';
import { APP_DIR } from './config';
import { probeClaudeUsage, readCodexLive, type ClaudeLive, type CodexLive, type LiveWindow } from './usage-live';
import type { AccountUsage, Config, UsageWindow } from '../src/shared/api/types';

export const USAGE_LIMITS_PATH = path.join(APP_DIR, 'usage-limits.json');

const HOUR_MS = 3_600_000;
export const FIVE_HOURS_MS = 5 * HOUR_MS;
export const WEEK_MS = 7 * 24 * HOUR_MS;
/** "Near the limit": notice and the "other account" button. */
export const NEAR = 0.9;
/** A rate limit with the 5h block below this share of its known limit is counted as the weekly limit. */
const WEEKLY_HIT_BELOW = 0.8;
/** Bytes read per chunk when catching up on a transcript. */
const CHUNK = 4 * 1024 * 1024;

// ── Parsing ────────────────────────────────────────────────────────────────────

/** One API response, as recorded in a transcript. */
export interface UsageEntry {
  at: number;
  /** Dedup key: Claude writes one line per content block, all with the same message id and usage. */
  key: string;
  weight: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Input-token equivalents, by the ratios of Claude's prices (the same for every current model). */
export function weigh(usage: Record<string, unknown>): number {
  return Math.round(
    num(usage.input_tokens) +
      num(usage.output_tokens) * 5 +
      num(usage.cache_creation_input_tokens) * 1.25 +
      num(usage.cache_read_input_tokens) * 0.1,
  );
}

/** An assistant line with `message.usage` → entry; anything else → null. */
export function parseUsageLine(line: string): UsageEntry | null {
  if (!line.includes('"usage"')) return null; // most lines; skips JSON.parse
  let json: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') return null;
    json = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (json.type !== 'assistant') return null;
  const msg = json.message as Record<string, unknown> | undefined;
  const usage = msg?.usage;
  if (!msg || !usage || typeof usage !== 'object') return null;
  if (msg.model === '<synthetic>') return null; // Claude's own error placeholders, no API call
  const at = typeof json.timestamp === 'string' ? Date.parse(json.timestamp) : NaN;
  if (!Number.isFinite(at)) return null;
  const weight = weigh(usage as Record<string, unknown>);
  if (weight === 0) return null;
  const id = typeof msg.id === 'string' ? msg.id : '';
  const req = typeof json.requestId === 'string' ? json.requestId : '';
  return { at, key: id || req ? `${id}:${req}` : `${at}:${weight}`, weight };
}

// ── Windows ────────────────────────────────────────────────────────────────────

type Point = Pick<UsageEntry, 'at' | 'weight'>;

/**
 * The running 5-hour block: it starts at the hour of the first message after the previous block ended and lasts
 * 5 hours (the same rule ccusage uses). null when the last block is over.
 */
export function currentBlock(points: Point[], now: number): { start: number; used: number } | null {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  let start: number | null = null;
  let used = 0;
  for (const p of sorted) {
    if (p.at > now) continue;
    if (start === null || p.at >= start + FIVE_HOURS_MS) {
      start = Math.floor(p.at / HOUR_MS) * HOUR_MS;
      used = 0;
    }
    used += p.weight;
  }
  return start !== null && now < start + FIVE_HOURS_MS ? { start, used } : null;
}

/** Weighted tokens in the last 7 days. */
export function weekUsed(points: Point[], now: number): number {
  return points.reduce((sum, p) => (p.at > now - WEEK_MS && p.at <= now ? sum + p.weight : sum), 0);
}

// ── Learned limits ─────────────────────────────────────────────────────────────

export interface LearnedLimits {
  /** `oauthAccount.userRateLimitTier` (or the organization's) when learned; a different tier drops the limits. */
  tier: string | null;
  fiveHour?: number;
  weekly?: number;
  at?: number;
}

/** The account's rate-limit tier from its `.claude.json`; null if unknown. */
export function readTier(claudeJson: string | null): string | null {
  if (!claudeJson) return null;
  try {
    const a = (JSON.parse(claudeJson) as { oauthAccount?: Record<string, unknown> }).oauthAccount;
    const tier = a?.userRateLimitTier ?? a?.organizationRateLimitTier;
    return typeof tier === 'string' ? tier : null;
  } catch {
    return null;
  }
}

/** Limits valid for this tier (none when the plan changed). */
export function limitsFor(learned: LearnedLimits | undefined, tier: string | null): LearnedLimits {
  return learned && learned.tier === tier ? learned : { tier };
}

/** What a rate limit hit right now teaches. */
export function learn(
  learned: LearnedLimits | undefined,
  tier: string | null,
  used5h: number,
  usedWeek: number,
  now: number,
): LearnedLimits {
  const base = limitsFor(learned, tier);
  if (base.fiveHour && used5h < base.fiveHour * WEEKLY_HIT_BELOW) {
    return usedWeek > 0 ? { ...base, weekly: usedWeek, at: now } : base;
  }
  return used5h > 0 ? { ...base, fiveHour: used5h, at: now } : base;
}

function readLimits(file: string): Record<string, LearnedLimits> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, LearnedLimits>) : {};
  } catch {
    return {};
  }
}

// ── Report ─────────────────────────────────────────────────────────────────────

/** Share of the limit, 0–1: the live percent, else used / learned limit, else 0. */
export const ratio = (w: UsageWindow): number =>
  typeof w.percent === 'number' ? w.percent / 100 : w.limit ? w.used / w.limit : 0;

/** A live window over an estimated one: the CLI's percent and reset time. A reset already past reads 0%. */
export function withLive(w: UsageWindow, live: LiveWindow | null, now: number): UsageWindow {
  if (!live) return w;
  const over = live.resetsAt !== null && live.resetsAt <= now;
  return {
    ...w,
    percent: over ? 0 : live.percent,
    resetsAt: over ? null : (live.resetsAt ?? w.resetsAt),
    span: live.span,
  };
}

/** The estimate with what `/usage` said merged in. */
export function mergeClaudeLive(u: AccountUsage, live: ClaudeLive | null, now: number): AccountUsage {
  if (!live) return u;
  const fiveHour = withLive(u.fiveHour, live.session, now);
  const weekly = withLive(u.weekly, live.week, now);
  return { ...u, fiveHour, weekly, live: true, near: ratio(fiveHour) >= NEAR || ratio(weekly) >= NEAR };
}

const empty: UsageWindow = { used: 0, limit: null, resetsAt: null, percent: null };

/** The Codex row: its primary window first (usually 5 hours), the secondary (weekly) second when it has one. */
export function codexReport(live: CodexLive, now: number): AccountUsage {
  const fiveHour = withLive(empty, live.primary, now);
  const weekly = withLive(empty, live.secondary, now);
  return {
    account: 'codex',
    kind: 'codex',
    fiveHour,
    weekly,
    live: true,
    near: ratio(fiveHour) >= NEAR || ratio(weekly) >= NEAR,
  };
}

export function usageReport(
  account: string,
  points: Point[],
  limits: LearnedLimits,
  now: number,
): AccountUsage & { blockStart: number | null } {
  const block = currentBlock(points, now);
  const fiveHour: UsageWindow = {
    used: block?.used ?? 0,
    limit: limits.fiveHour ?? null,
    resetsAt: block ? block.start + FIVE_HOURS_MS : null,
  };
  const weekly: UsageWindow = { used: weekUsed(points, now), limit: limits.weekly ?? null, resetsAt: null };
  return {
    account,
    fiveHour,
    weekly,
    near: ratio(fiveHour) >= NEAR || ratio(weekly) >= NEAR,
    blockStart: block?.start ?? null,
  };
}

/** How often to re-read: every minute while focused, every 5 when not; twice as long in power saver. */
export function refreshDue(sinceLast: number, focused: boolean, saver: boolean): boolean {
  const every = (focused ? 60_000 : 300_000) * (saver ? 2 : 1);
  return sinceLast >= every - 1_000; // timer jitter
}

// ── Transcript reading ─────────────────────────────────────────────────────────

interface Cursor {
  /** Bytes consumed (up to the last full line). */
  offset: number;
  size: number;
  mtimeMs: number;
}

/** Everything read from one config dir. */
class DirScan {
  readonly cursors = new Map<string, Cursor>();
  readonly entries = new Map<string, Point>();

  async scan(dir: string, now: number): Promise<void> {
    const files = await transcriptFiles(path.join(dir, 'projects'));
    const seen = new Set<string>();
    for (const file of files) {
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < now - WEEK_MS - HOUR_MS) continue; // nothing in it can count
      seen.add(file);
      const cur = this.cursors.get(file);
      if (cur && cur.size === st.size && cur.mtimeMs === st.mtimeMs) continue;
      const from = cur && st.size >= cur.offset ? cur.offset : 0; // shrank = rewritten: start over
      const offset = await this.read(file, from, st.size);
      this.cursors.set(file, { offset, size: st.size, mtimeMs: st.mtimeMs });
    }
    for (const file of this.cursors.keys()) if (!seen.has(file)) this.cursors.delete(file);
    for (const [key, p] of this.entries) if (p.at <= now - WEEK_MS) this.entries.delete(key);
  }

  /** Reads complete lines in [from, size); returns the offset after the last one. */
  private async read(file: string, from: number, size: number): Promise<number> {
    let fh: fs.promises.FileHandle;
    try {
      fh = await fs.promises.open(file, 'r');
    } catch {
      return from;
    }
    let offset = from;
    // Split on the newline byte, so a UTF-8 character cut by a chunk boundary is never decoded half.
    let carry = Buffer.alloc(0);
    try {
      const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, size - from)));
      let pos = from;
      while (pos < size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - pos), pos);
        if (bytesRead === 0) break;
        pos += bytesRead;
        const chunk = Buffer.concat([carry, buf.subarray(0, bytesRead)]); // copies: buf is reused
        const lastNl = chunk.lastIndexOf(0x0a);
        if (lastNl === -1) {
          carry = chunk;
          continue;
        }
        for (const line of chunk.toString('utf8', 0, lastNl).split('\n')) {
          const e = parseUsageLine(line);
          if (e) this.entries.set(e.key, { at: e.at, weight: e.weight });
        }
        carry = chunk.subarray(lastNl + 1);
        offset = pos - carry.length;
      }
    } finally {
      await fh.close();
    }
    return offset;
  }
}

/** `<projects>/*\/*.jsonl` and `<projects>/*\/<session>/subagents/*.jsonl`. */
export async function transcriptFiles(projectsDir: string): Promise<string[]> {
  const out: string[] = [];
  const list = async (dir: string) => {
    try {
      return await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const proj of await list(projectsDir)) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(projectsDir, proj.name);
    for (const e of await list(projDir)) {
      const p = path.join(projDir, e.name);
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
      else if (e.isDirectory()) {
        for (const s of await list(path.join(p, 'subagents')))
          if (s.isFile() && s.name.endsWith('.jsonl')) out.push(path.join(p, 'subagents', s.name));
      }
    }
  }
  return out;
}

// ── Tracker ────────────────────────────────────────────────────────────────────

export interface UsageDeps {
  config: () => Config;
  /** Crossed NEAR in a window (once per 5h block / per day for weekly). */
  onNear?: (u: AccountUsage, window: 'fiveHour' | 'weekly') => void;
  now?: () => number;
  limitsPath?: string;
  /** Ask the CLIs for the real share (T30b). Off in tests / smoke unless injected. */
  live?: {
    claude: (configDir: string | null) => Promise<ClaudeLive | null>;
    codex: () => Promise<CodexLive | null>;
  };
  /** A background live probe finished: here is the list with it. */
  onUpdate?: (list: AccountUsage[]) => void;
}

/** Real CLI probes. */
export const LIVE_SOURCES = { claude: probeClaudeUsage, codex: () => readCodexLive() };

/** Re-ask the CLIs at most this often (a probe is a hidden `claude` start, ~2 s of CPU). */
export const LIVE_EVERY_MS = 3 * 60_000;

export class UsageTracker {
  private readonly scans = new Map<string, DirScan>();
  private limits: Record<string, LearnedLimits>;
  private readonly notified = new Set<string>();
  private running: Promise<AccountUsage[]> | null = null;
  private latest: AccountUsage[] = [];
  lastRefresh = 0;
  /** Last `/usage` per account id (null = asked, unreadable) and when. */
  private readonly claudeLive = new Map<string, { at: number; value: ClaudeLive | null }>();
  private codexLive: { at: number; value: CodexLive | null } | null = null;
  private probing = false;

  constructor(private readonly deps: UsageDeps) {
    this.limits = readLimits(this.limitsPath);
  }

  private get limitsPath(): string {
    return this.deps.limitsPath ?? USAGE_LIMITS_PATH;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  current(): AccountUsage[] {
    return this.latest;
  }

  /** Re-read new transcript lines of every logged-in account. Concurrent calls share one run. */
  refresh(): Promise<AccountUsage[]> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  /** A session of `account` hit a rate limit: learn the limit from what is used right now. */
  async rateLimited(account: string): Promise<AccountUsage[]> {
    await this.refresh();
    const u = this.latest.find((x) => x.account === account);
    const a = this.deps.config().accounts[account];
    if (!u || !a) return this.latest;
    const tier = readTier(readOrNull(accountPaths(a.claudeConfigDir).claudeJson));
    this.claudeLive.delete(account); // ask the CLI again: it knows which window ran out
    this.limits[account] = learn(this.limits[account], tier, u.fiveHour.used, u.weekly.used, this.now());
    try {
      fs.mkdirSync(path.dirname(this.limitsPath), { recursive: true });
      fs.writeFileSync(this.limitsPath, JSON.stringify(this.limits, null, 2));
    } catch (err) {
      console.error('[usage] could not save limits', err);
    }
    return this.refresh();
  }

  private async run(): Promise<AccountUsage[]> {
    const config = this.deps.config();
    const now = this.now();
    const out: AccountUsage[] = [];
    for (const [id, a] of Object.entries(config.accounts)) {
      const p = accountPaths(a.claudeConfigDir);
      const claudeJson = readOrNull(p.claudeJson);
      if (!isLoggedIn(claudeJson)) continue;
      let scan = this.scans.get(p.dir);
      if (!scan) this.scans.set(p.dir, (scan = new DirScan()));
      await scan.scan(p.dir, now);
      const limits = limitsFor(this.limits[id], readTier(claudeJson));
      const { blockStart, ...estimate } = usageReport(id, [...scan.entries.values()], limits, now);
      const report = mergeClaudeLive(estimate, this.claudeLive.get(id)?.value ?? null, now);
      this.checkNear(report, blockStart ?? report.fiveHour.resetsAt, now);
      out.push(report);
    }
    const codex = this.codexLive?.value;
    if (codex) out.push(codexReport(codex, now));
    this.latest = out;
    this.lastRefresh = now;
    this.probeLive(config, now);
    return out;
  }

  /** Asks the CLIs in the background when due; a finished round re-reports through `onUpdate`. */
  private probeLive(config: Config, now: number): void {
    const live = this.deps.live;
    if (!live || this.probing) return;
    const due = (at: number | undefined) => at === undefined || now - at >= LIVE_EVERY_MS;
    const accounts = Object.entries(config.accounts).filter(
      ([id, a]) => due(this.claudeLive.get(id)?.at) && isLoggedIn(readOrNull(accountPaths(a.claudeConfigDir).claudeJson)),
    );
    const codex = due(this.codexLive?.at);
    if (!accounts.length && !codex) return;
    this.probing = true;
    void (async () => {
      try {
        await Promise.all([
          ...accounts.map(async ([id, a]) => {
            const value = await live.claude(a.claudeConfigDir ? accountPaths(a.claudeConfigDir).dir : null).catch(() => null);
            this.claudeLive.set(id, { at: this.now(), value });
          }),
          codex
            ? live
                .codex()
                .catch(() => null)
                .then((value) => (this.codexLive = { at: this.now(), value }))
            : null,
        ]);
      } finally {
        this.probing = false;
      }
      const list = await this.refresh();
      this.deps.onUpdate?.(list);
    })();
  }

  private checkNear(u: AccountUsage, blockStart: number | null, now: number): void {
    if (!this.deps.onNear) return;
    if (blockStart !== null && ratio(u.fiveHour) >= NEAR) {
      const key = `${u.account}:5h:${blockStart}`;
      if (!this.notified.has(key)) {
        this.notified.add(key);
        this.deps.onNear(u, 'fiveHour');
      }
    }
    if (ratio(u.weekly) >= NEAR) {
      const key = `${u.account}:7d:${Math.floor(now / (24 * HOUR_MS))}`;
      if (!this.notified.has(key)) {
        this.notified.add(key);
        this.deps.onNear(u, 'weekly');
      }
    }
  }
}

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
