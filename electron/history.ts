// Session history (T11): a read-only index of past Claude and Codex sessions, for the ⌘Y panel.
//
// Claude: `<configDir>/projects/*/<session-id>.jsonl` for every account (subagent transcripts in deeper folders are
// skipped). Codex: the `threads` table of `~/.codex/state_<n>.sqlite` (opened read-only), plus rollout files under
// `~/.codex/sessions/YYYY/MM/DD/` for sessions the database doesn't know, plus thread names in `session_index.jsonl`.
// Sessions are grouped by the `cwd` recorded inside the transcript, never by Claude's encoded folder name.
//
// Nothing under ~/.claude* or ~/.codex is ever written, renamed or deleted. Names and favorites given in the panel
// live in ~/.aquila/history.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { APP_DIR, expand } from './config';
import { claudeConfigDir } from './state';
import type { RemoteExec } from './remote/exec';
import {
  fetchFiles,
  listRemote,
  REMOTE_HEAD as REMOTE_HEAD_BYTES,
  matchRemoteProject,
  remoteHosts,
  type RemoteFile,
} from './remote/history';
import type {
  Config,
  HistoryHost,
  HistoryEntry,
  HistoryList,
  HistoryMatch,
  HistoryRef,
  HistoryTranscript,
  RemoteHost,
  TranscriptMessage,
  Worktree,
  CommandRun,
} from '../src/shared/api/types';

export const HISTORY_META_PATH = path.join(APP_DIR, 'history.json');
export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

/** Claude's default for `cleanupPeriodDays` (transcripts older than this are deleted at startup). */
export const DEFAULT_CLEANUP_DAYS = 30;
/** Text kept per session in memory for search and the preview (export re-reads the whole file). */
const INDEX_CHARS = 200_000;
/** One message in the preview / index is cut here. */
const MESSAGE_CHARS = 8_000;
/** A JSON line this long is a blob (API request dump, big tool result), never a message worth indexing. */
const MAX_LINE = 2_000_000;
const PARSE_CONCURRENCY = 8;
const DAY_MS = 86_400_000;

// ── Parsing ────────────────────────────────────────────────────────────────────

/** What a transcript says about itself. */
export interface ParsedSession {
  cwd: string;
  branch?: string;
  /** The CLI's own name for it: Claude `/rename` (custom-title), codex thread name. */
  title?: string;
  /** Auto-generated title (Claude ai-title / summary). */
  autoTitle?: string;
  firstMessage: string;
  startedAt: number;
  updatedAt: number;
  /** User + assistant messages (all of them, even past the index cap). */
  count: number;
  messages: TranscriptMessage[];
  /** `messages` stopped at the cap. */
  truncated: boolean;
  /** Bash commands (Claude, T59): the last MAX_COMMANDS, oldest first. */
  commands?: CommandRun[];
  /** Files the agent edited or wrote (T70): as written in the tool call (absolute, or relative to `cwd`). */
  files?: string[];
  /** `@path.md` mentions in the user's messages (T70): a note sent to the session. */
  mentions?: string[];
}

// ── Commands (T59) ─────────────────────────────────────────────────────────────

/** Kept per session (the latest ones). */
export const MAX_COMMANDS = 500;
const COMMAND_CHARS = 2_000;
const MASK = '•••';
const SECRET_NAME = /(?:token|secret|key|passw(?:or)?d|pass|pwd|auth|credential|cookie|session)/i;

/**
 * Masks what looks like a secret in a command: `NAME=value` when NAME sounds secret (TOKEN, API_KEY, PASSWORD…),
 * `--token x` / `--password=x` style flags, `Authorization: Bearer x` headers, and `user:pass@` in URLs.
 */
export function maskSecrets(command: string): string {
  return command
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, (m, name: string) =>
      SECRET_NAME.test(name) ? `${name}=${MASK}` : m,
    )
    .replace(
      /(--?[A-Za-z0-9-]*(?:token|secret|key|password|passwd|auth|credential)[A-Za-z0-9-]*)(=|\s+)("[^"]*"|'[^']*'|[^\s-]\S*)/gi,
      (_m, flag: string, sep: string) => `${flag}${sep}${MASK}`,
    )
    .replace(/(authorization:\s*(?:bearer|basic|token)?\s*)[^\s'"]+/gi, `$1${MASK}`)
    .replace(/(\/\/[^/\s:@]+):[^@\s/]+@/g, `$1:${MASK}@`);
}

type ToolBlock = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: { command?: unknown };
  tool_use_id?: unknown;
  is_error?: unknown;
};

/** Bash `tool_use` blocks and their `tool_result`s, in order. Only the command and how it ended are kept. */
class CommandCollector {
  commands: (CommandRun & { id?: string })[] = [];

  assistant(content: unknown, at: number | undefined): void {
    if (!Array.isArray(content)) return;
    for (const b of content as ToolBlock[]) {
      if (b?.type !== 'tool_use' || b.name !== 'Bash' || typeof b.input?.command !== 'string') continue;
      const command = cut(maskSecrets(b.input.command.trim()), COMMAND_CHARS);
      if (!command) continue;
      this.commands.push({
        command,
        state: 'pending',
        ...(typeof b.id === 'string' ? { id: b.id } : {}),
        ...(at !== undefined ? { at } : {}),
      });
      if (this.commands.length > MAX_COMMANDS) this.commands.shift();
    }
  }

  user(content: unknown, interrupted: boolean): void {
    if (!Array.isArray(content)) return;
    for (const b of content as ToolBlock[]) {
      if (b?.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
      const run = [...this.commands].reverse().find((c) => c.id === b.tool_use_id);
      if (!run) continue;
      run.state = interrupted ? 'interrupted' : b.is_error === true ? 'error' : 'ok';
    }
  }

  result(): CommandRun[] {
    return this.commands.map((c): CommandRun => ({
      command: c.command,
      state: c.state,
      ...(c.at !== undefined ? { at: c.at } : {}),
    }));
  }
}

// ── Work (T70) ─────────────────────────────────────────────────────────────────

export const MAX_WORK_FILES = 200;
export const MAX_MENTIONS = 50;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/**
 * `@/abs/note.md`, `@rel/note.md`, `@"/path with spaces/note.md"`, and an unquoted path with spaces up to the first
 * `.md` on the line (how an `@path` is often pasted).
 */
const MENTION_RE = /@"([^"\n]+\.md)"|@([^\s"'`<>@][^\n"'`<>@]*?\.md)(?![\w.-])/gi;
/** apply_patch headers (codex). */
const PATCH_FILE_RE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

/** `@note.md` mentions in a user message. */
export function mentionsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const p = (m[1] ?? m[2] ?? '').replace(/\\ /g, ' ').trim();
    if (p) out.push(p);
  }
  return out;
}

/** Files named in an apply_patch body. */
export function patchFiles(text: string): string[] {
  return [...text.matchAll(PATCH_FILE_RE)].map((m) => m[1]!.trim()).filter(Boolean);
}

/** Edited files and note mentions, deduplicated in first-seen order, capped. */
class WorkCollector {
  private files = new Set<string>();
  private mentions = new Set<string>();

  file(p: unknown): void {
    if (typeof p === 'string' && p && this.files.size < MAX_WORK_FILES) this.files.add(p);
  }

  text(t: string): void {
    if (!t.includes('@')) return;
    for (const m of mentionsOf(t)) if (this.mentions.size < MAX_MENTIONS) this.mentions.add(m);
  }

  /** Claude assistant content: Edit / Write / MultiEdit / NotebookEdit tool calls. */
  claudeTools(content: unknown): void {
    if (!Array.isArray(content)) return;
    for (const b of content as { type?: unknown; name?: unknown; input?: Record<string, unknown> }[]) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string' || !EDIT_TOOLS.has(b.name)) continue;
      this.file(b.input?.file_path ?? b.input?.notebook_path);
    }
  }

  result(): Pick<ParsedSession, 'files' | 'mentions'> {
    return {
      ...(this.files.size ? { files: [...this.files] } : {}),
      ...(this.mentions.size ? { mentions: [...this.mentions] } : {}),
    };
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

type Block = { type?: unknown; text?: unknown };

/** Text blocks of a message's content (string or array); tool calls, results and thinking are left out. */
function textOf(content: unknown, types: readonly string[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Block[])
    .filter((b) => b && typeof b.type === 'string' && types.includes(b.type) && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** Claude wraps slash commands, their output and injected context in tags; those aren't the user's words. */
function isClaudeNoise(text: string): boolean {
  const t = text.trimStart();
  return (
    !t ||
    t.startsWith('<command-') ||
    t.startsWith('<local-command') ||
    t.startsWith('<system-reminder>') ||
    t.startsWith('<bash-') ||
    t.startsWith('<user-prompt-submit-hook>') ||
    t.startsWith('Caveat: The messages below were generated by the user while running local commands') ||
    t.startsWith('[Request interrupted by user')
  );
}

const time = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Collects messages up to the index cap. */
class Collector {
  constructor(
    private cap = INDEX_CHARS,
    private perMessage = MESSAGE_CHARS,
  ) {}
  messages: TranscriptMessage[] = [];
  count = 0;
  chars = 0;
  truncated = false;
  first = '';

  add(role: TranscriptMessage['role'], raw: string, at: number | undefined): void {
    const text = raw.trim();
    if (!text) return;
    this.count++;
    if (role === 'user' && !this.first) this.first = cut(oneLine(text), 400);
    if (this.chars >= this.cap) {
      this.truncated = true;
      return;
    }
    const kept = cut(text, this.perMessage);
    this.chars += kept.length;
    this.messages.push(at === undefined ? { role, text: kept } : { role, text: kept, at });
  }
}

/** Line-by-line parser of a Claude transcript (`<id>.jsonl`). */
export class ClaudeParser {
  private c: Collector;
  private runs = new CommandCollector();
  private work = new WorkCollector();
  /** `full`: no caps (Markdown export). */
  constructor(full = false) {
    this.c = full ? new Collector(Infinity, Infinity) : new Collector();
  }
  private cwd = '';
  private branch?: string;
  private title?: string;
  private autoTitle?: string;
  private startedAt?: number;
  private updatedAt?: number;

  line(line: string): void {
    if (!line || line.length > MAX_LINE || line.startsWith('{"type":"api-request')) return;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // a line being written right now
    }
    if (!o || typeof o !== 'object') return;
    const type = o.type;
    if (type === 'custom-title' && typeof o.customTitle === 'string')
      this.title = o.customTitle.trim() || undefined;
    if (type === 'ai-title' && typeof o.aiTitle === 'string') this.autoTitle = o.aiTitle;
    if (type === 'summary' && typeof o.summary === 'string' && !this.autoTitle) this.autoTitle = o.summary;
    if (type !== 'user' && type !== 'assistant') return;
    if (o.isSidechain === true) return;
    if (typeof o.cwd === 'string' && !this.cwd) this.cwd = o.cwd;
    if (typeof o.gitBranch === 'string' && o.gitBranch) this.branch = o.gitBranch;
    const at = time(o.timestamp);
    if (at !== undefined) {
      this.startedAt ??= at;
      this.updatedAt = at;
    }
    if (o.isMeta === true || o.isCompactSummary === true) return;
    const message = o.message as { content?: unknown } | undefined;
    if (!message) return;
    if (type === 'assistant') {
      this.runs.assistant(message.content, at);
      this.work.claudeTools(message.content);
    } else {
      const r = o.toolUseResult as { interrupted?: unknown } | undefined;
      this.runs.user(message.content, !!r && typeof r === 'object' && r.interrupted === true);
    }
    if (type === 'user') {
      const text = textOf(message.content, ['text']);
      if (!isClaudeNoise(text)) {
        this.c.add('user', text, at);
        this.work.text(text);
      }
    } else {
      this.c.add('assistant', textOf(message.content, ['text']), at);
    }
  }

  /** null when there was no conversation (or no cwd to group it by). */
  result(fallbackTime: number): ParsedSession | null {
    if (!this.c.count || !this.cwd) return null;
    return {
      cwd: this.cwd,
      ...(this.branch ? { branch: this.branch } : {}),
      ...(this.title ? { title: this.title } : {}),
      ...(this.autoTitle ? { autoTitle: this.autoTitle } : {}),
      firstMessage: this.c.first,
      startedAt: this.startedAt ?? fallbackTime,
      updatedAt: this.updatedAt ?? fallbackTime,
      count: this.c.count,
      messages: this.c.messages,
      truncated: this.c.truncated,
      commands: this.runs.result(),
      ...this.work.result(),
    };
  }

  /** The Bash commands alone, even when there's no conversation to index yet. */
  commands(): CommandRun[] {
    return this.runs.result();
  }
}

/** Bash commands of one Claude transcript, read whole (a live tab's ⌘K list, T59). */
export async function readClaudeCommands(file: string): Promise<CommandRun[]> {
  return (await parseFile(file, new ClaudeParser(true))).commands();
}

/** Line-by-line parser of a codex rollout (`rollout-<time>-<id>.jsonl`). */
export class CodexParser {
  private c: Collector;
  constructor(full = false) {
    this.c = full ? new Collector(Infinity, Infinity) : new Collector();
  }
  id = '';
  private cwd = '';
  private branch?: string;
  private startedAt?: number;
  private updatedAt?: number;
  private work = new WorkCollector();

  line(line: string): void {
    if (!line || line.length > MAX_LINE) return;
    let o: { type?: unknown; timestamp?: unknown; payload?: Record<string, unknown> };
    try {
      o = JSON.parse(line) as typeof o;
    } catch {
      return;
    }
    const p = o?.payload;
    if (!p || typeof p !== 'object') return;
    const at = time(o.timestamp);
    if (at !== undefined) {
      this.startedAt ??= at;
      this.updatedAt = at;
    }
    if (o.type === 'session_meta') {
      if (typeof p.id === 'string') this.id = p.id.toLowerCase();
      if (typeof p.cwd === 'string') this.cwd = p.cwd;
      const git = p.git as { branch?: unknown } | undefined;
      if (git && typeof git.branch === 'string') this.branch = git.branch;
      return;
    }
    if (o.type !== 'response_item') return;
    // apply_patch: a custom tool call (`input`) or a function call (`arguments`, maybe a shell command).
    if (p.type === 'custom_tool_call' || p.type === 'function_call') {
      const body = typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : '';
      if (body.includes('*** ')) for (const f of patchFiles(body.replace(/\\n/g, '\n'))) this.work.file(f);
      return;
    }
    if (p.type !== 'message') return;
    if (p.role === 'user') {
      const text = textOf(p.content, ['input_text']);
      // Environment context, AGENTS.md and other injected instructions come as tagged user messages.
      if (!text.trimStart().startsWith('<') && !text.trimStart().startsWith('# AGENTS.md')) {
        this.c.add('user', text, at);
        this.work.text(text);
      }
    } else if (p.role === 'assistant') {
      this.c.add('assistant', textOf(p.content, ['output_text']), at);
    }
  }

  result(fallbackTime: number): (ParsedSession & { id: string }) | null {
    if (!this.id || !this.cwd) return null;
    return {
      id: this.id,
      cwd: this.cwd,
      ...(this.branch ? { branch: this.branch } : {}),
      firstMessage: this.c.first,
      startedAt: this.startedAt ?? fallbackTime,
      updatedAt: this.updatedAt ?? fallbackTime,
      count: this.c.count,
      messages: this.c.messages,
      truncated: this.c.truncated,
      ...this.work.result(),
    };
  }
}

/** Feeds text (a fetched remote transcript, T36) to a parser line by line. */
export function parseText<P extends { line(l: string): void }>(text: string, parser: P): P {
  for (const line of text.split('\n')) parser.line(line.endsWith('\r') ? line.slice(0, -1) : line);
  return parser;
}

async function parseFile<P extends { line(l: string): void }>(file: string, parser: P): Promise<P> {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) parser.line(line);
  } finally {
    rl.close();
    stream.destroy();
  }
  return parser;
}

// ── Codex database (read-only) ─────────────────────────────────────────────────

/** A row of codex's `threads` table, as far as we use it. */
export interface CodexThread {
  id: string;
  rolloutPath?: string;
  cwd: string;
  title?: string;
  name?: string;
  firstMessage?: string;
  branch?: string;
  startedAt: number;
  updatedAt: number;
  archived: boolean;
}

/** The newest `state_<n>.sqlite` in the codex home, if any. */
export function codexStateDb(home = CODEX_HOME): string | null {
  let files: string[];
  try {
    files = fs.readdirSync(home);
  } catch {
    return null;
  }
  const best = files
    .map((f) => ({ f, n: Number(/^state_(\d+)\.sqlite$/.exec(f)?.[1] ?? NaN) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => b.n - a.n)[0];
  return best ? path.join(home, best.f) : null;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'bigint' ? Number(v) : undefined;

/** Maps raw rows (any schema version: missing columns are fine) to threads. */
export function mapCodexRows(rows: Record<string, unknown>[]): CodexThread[] {
  return rows.flatMap((r): CodexThread[] => {
    const id = str(r.id)?.toLowerCase();
    const cwd = str(r.cwd);
    if (!id || !cwd) return [];
    const created = num(r.created_at_ms) ?? (num(r.created_at) ?? 0) * 1000;
    const updated = num(r.updated_at_ms) ?? (num(r.updated_at) ?? 0) * 1000;
    return [
      {
        id,
        cwd,
        rolloutPath: str(r.rollout_path),
        title: str(r.title),
        name: str(r.name),
        firstMessage: str(r.first_user_message) ?? str(r.preview),
        branch: str(r.git_branch),
        startedAt: created,
        updatedAt: updated || created,
        archived: num(r.archived) === 1,
      },
    ];
  });
}

/**
 * Codex threads from its database, opened read-only (`node:sqlite`; codex may be writing it, WAL mode). null when
 * there is no database or it can't be read — then rollout files are the only source.
 */
export async function readCodexThreads(db = codexStateDb()): Promise<CodexThread[] | null> {
  if (!db) return null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const conn = new DatabaseSync(db, { readOnly: true });
    try {
      const rows = conn.prepare('SELECT * FROM threads').all() as Record<string, unknown>[];
      return mapCodexRows(rows);
    } finally {
      conn.close();
    }
  } catch (err) {
    console.error('[history] codex database unreadable', err);
    return null;
  }
}

/** `session_index.jsonl`: thread id → name (last one wins). */
export function parseCodexIndex(text: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const line of text.split('\n')) {
    try {
      const o = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
      if (typeof o.id === 'string' && typeof o.thread_name === 'string' && o.thread_name)
        names.set(o.id.toLowerCase(), o.thread_name);
    } catch {
      // partial line
    }
  }
  return names;
}

/** Every rollout file under `sessions/YYYY/MM/DD/`. */
export function listRollouts(root = path.join(CODEX_HOME, 'sessions')): string[] {
  const out: string[] = [];
  const dirs = (d: string) => {
    try {
      return fs.readdirSync(d).filter((x) => /^\d+$/.test(x));
    } catch {
      return [];
    }
  };
  for (const y of dirs(root))
    for (const m of dirs(path.join(root, y)))
      for (const d of dirs(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        try {
          for (const f of fs.readdirSync(dir))
            if (f.startsWith('rollout-') && f.endsWith('.jsonl')) out.push(path.join(dir, f));
        } catch {
          // gone
        }
      }
  return out;
}

export const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

// ── Claude settings ────────────────────────────────────────────────────────────

/** `cleanupPeriodDays` from Claude's settings.json in that config dir (read-only); 30 when unset. */
export function cleanupDays(configDir: string): number {
  try {
    return parseCleanupDays(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
  } catch {
    return DEFAULT_CLEANUP_DAYS;
  }
}

/** `cleanupPeriodDays` from settings.json text; 30 when unset or unreadable. */
export function parseCleanupDays(text: string): number {
  try {
    const n = (JSON.parse(text) as { cleanupPeriodDays?: unknown }).cleanupPeriodDays;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : DEFAULT_CLEANUP_DAYS;
  } catch {
    return DEFAULT_CLEANUP_DAYS;
  }
}

// ── Names and favorites (~/.aquila/history.json) ───────────────────────────────

export interface HistoryMeta {
  names: Record<string, string>;
  favorites: string[];
}

/** `agent:id`, plus `@host` for a session on an SSH host (T36). Also the key for names and favorites. */
export const refKey = (r: HistoryRef) => `${r.agent}:${r.id}${r.host ? `@${r.host}` : ''}`;

export function parseMeta(text: string): HistoryMeta {
  try {
    const raw = JSON.parse(text) as { names?: unknown; favorites?: unknown };
    const names: Record<string, string> = {};
    if (raw.names && typeof raw.names === 'object')
      for (const [k, v] of Object.entries(raw.names as Record<string, unknown>))
        if (typeof v === 'string' && v.trim()) names[k] = v;
    const favorites = Array.isArray(raw.favorites)
      ? raw.favorites.filter((f): f is string => typeof f === 'string')
      : [];
    return { names, favorites };
  } catch {
    return { names: {}, favorites: [] };
  }
}

export function readMeta(file = HISTORY_META_PATH): HistoryMeta {
  try {
    return parseMeta(fs.readFileSync(file, 'utf8'));
  } catch {
    return { names: {}, favorites: [] };
  }
}

/** Empty name = back to the CLI's name. */
export function applyMeta(
  meta: HistoryMeta,
  ref: HistoryRef,
  change: { name?: string | null; favorite?: boolean },
): HistoryMeta {
  const key = refKey(ref);
  const names = { ...meta.names };
  if (change.name !== undefined) {
    const name = change.name?.trim();
    if (name) names[key] = name;
    else delete names[key];
  }
  let favorites = meta.favorites.filter((f) => f !== key);
  if (change.favorite ?? meta.favorites.includes(key)) favorites = [...favorites, key];
  return { names, favorites };
}

/** Temp file + rename, so a crash never leaves half a file. */
export function writeMeta(meta: HistoryMeta, file = HISTORY_META_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...meta }, null, 2));
  fs.renameSync(tmp, file);
}

// ── Projects ───────────────────────────────────────────────────────────────────

const realpath = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

const within = (dir: string, root: string) =>
  dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`);

/**
 * The project a session's cwd belongs to: the project dir itself or a folder in it (deepest project wins), or a
 * worktree next to it (`<repo>-wt/…`, T7).
 */
export function matchProject(config: Config, cwd: string, resolve = realpath): string | undefined {
  const dir = resolve(cwd);
  let best: { id: string; len: number } | undefined;
  for (const p of config.projects) {
    if (p.remote) continue;
    const root = resolve(expand(p.path));
    if ((within(dir, root) || within(dir, `${root}-wt`)) && (!best || root.length > best.len))
      best = { id: p.id, len: root.length };
  }
  return best?.id;
}

/** Where a resumed session runs: the project dir, or (for a subfolder / worktree) that folder as a worktree. */
export function resumeWorktree(
  projectPath: string,
  cwd: string,
  branch: string | undefined,
  resolve = realpath,
): Worktree | undefined {
  const dir = resolve(cwd);
  if (dir === resolve(expand(projectPath))) return undefined;
  return { path: dir, branch: branch || path.basename(dir) };
}

// ── Markdown export ────────────────────────────────────────────────────────────

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

export function toMarkdown(
  e: Pick<HistoryEntry, 'agent' | 'id' | 'cwd' | 'branch' | 'account' | 'startedAt' | 'updatedAt'> & {
    title: string;
  },
  messages: TranscriptMessage[],
): string {
  const who = e.agent === 'claude' ? 'Claude' : 'Codex';
  const meta = [
    `- ${who} session \`${e.id}\``,
    `- Folder: \`${e.cwd}\`${e.branch ? ` · branch \`${e.branch}\`` : ''}`,
    ...(e.account ? [`- Account: ${e.account}`] : []),
    `- ${iso(e.startedAt)} → ${iso(e.updatedAt)} UTC`,
  ];
  const body = messages.map(
    (m) => `## ${m.role === 'user' ? 'User' : who}${m.at ? ` · ${iso(m.at)}` : ''}\n\n${m.text.trim()}\n`,
  );
  return `# ${e.title.replace(/\n/g, ' ')}\n\n${meta.join('\n')}\n\n${body.join('\n')}`;
}

/** Up to `n` chars around the first match, on one line. */
export function snippet(text: string, index: number, length: number, n = 120): string {
  const start = Math.max(0, index - Math.floor((n - length) / 2));
  const end = Math.min(text.length, start + n);
  return `${start > 0 ? '…' : ''}${oneLine(text.slice(start, end))}${end < text.length ? '…' : ''}`;
}

/** What one session touched (T70). Paths as written: absolute, or relative to `entry.cwd`. */
export interface SessionWork {
  entry: HistoryEntry;
  files: string[];
  mentions: string[];
}

// ── The index ──────────────────────────────────────────────────────────────────

interface Indexed {
  ref: HistoryRef;
  entry: HistoryEntry;
  /** Transcript file (Claude jsonl or codex rollout); absent for a codex thread without one. */
  file?: string;
  /** The file is on this SSH host (T36). */
  host?: RemoteHost;
  messages: TranscriptMessage[];
  truncated: boolean;
  /** Bash commands (Claude, T59). */
  commands?: CommandRun[];
  /** Edited files and `@note.md` mentions (T70). */
  files?: string[];
  mentions?: string[];
  /** Name, titles, first message and messages (and lower-cased): what full-text search looks in. */
  text?: { original: string; lower: string };
}

interface CacheItem {
  mtimeMs: number;
  size: number;
  parsed: ParsedSession | null;
}

interface Sources {
  /** Codex home (database, session_index.jsonl, sessions/). */
  codexHome: string;
  metaFile: string;
}

const DEFAULT_SOURCES: Sources = { codexHome: CODEX_HOME, metaFile: HISTORY_META_PATH };

/** One SSH host's part of the index (T36): parsed heads of its transcripts, re-fetched when mtime/size change. */
interface RemoteState {
  host: RemoteHost;
  /** `$HOME` on the host (remote project paths are `~/…`). */
  home: string;
  cache: Map<string, CacheItem>;
  items: Map<string, Indexed>;
  error?: string;
  checkedAt?: number;
  latencyMs?: number;
}

/** A fetched head (or whole file) → what the index keeps. A cut transcript still ends at the file's mtime. */
function parseRemote(f: RemoteFile, text: string, full = false): ParsedSession | null {
  const parsed = parseText(
    text,
    f.agent === 'claude' ? new ClaudeParser(full) : new CodexParser(full),
  ).result(f.mtimeMs);
  return parsed && { ...parsed, updatedAt: Math.max(parsed.updatedAt, f.mtimeMs) };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Builds and caches the list. Files are re-parsed only when their mtime or size changed, so reopening the panel is
 * cheap. Everything is read-only except ~/.aquila/history.json.
 */
export class HistoryIndex {
  private cache = new Map<string, CacheItem>();
  private items = new Map<string, Indexed>();
  private building: Promise<HistoryList> | null = null;
  private cleanup: Record<string, number> = {};
  private remote = new Map<string, RemoteState>();
  private remoteBuilding: Promise<HistoryList> | null = null;

  /** `exec` runs scripts on SSH hosts (T36); without it remote hosts are never scanned. */
  constructor(
    private sources: Sources = DEFAULT_SOURCES,
    private exec?: RemoteExec,
  ) {}

  private async parseCached<P extends { line(l: string): void }>(
    file: string,
    make: () => P,
    finish: (p: P, mtime: number) => ParsedSession | null,
  ): Promise<ParsedSession | null> {
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(file);
    } catch {
      return null;
    }
    const hit = this.cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.parsed;
    let parsed: ParsedSession | null = null;
    try {
      parsed = finish(await parseFile(file, make()), st.mtimeMs);
    } catch (err) {
      console.error('[history] unreadable', file, err);
    }
    this.cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, parsed });
    return parsed;
  }

  /**
   * Re-scans this Mac (cached files aren't re-read). Concurrent calls share one scan. SSH hosts are not contacted:
   * their entries are the last `refreshRemote` result.
   */
  list(config: Config): Promise<HistoryList> {
    this.building ??= this.build(config).finally(() => (this.building = null));
    return this.building;
  }

  private async build(config: Config): Promise<HistoryList> {
    const meta = readMeta(this.sources.metaFile);
    const items = new Map<string, Indexed>();
    const cleanup: Record<string, number> = {};
    const seenFiles = new Set<string>();

    // Claude: one config dir per account (two accounts on the same dir are read once, under the first).
    const dirs = new Map<string, string>(); // config dir → account
    for (const account of Object.keys(config.accounts)) {
      const dir = realpath(claudeConfigDir(config, account));
      if (!dirs.has(dir)) dirs.set(dir, account);
    }
    for (const [dir, account] of dirs) {
      const days = cleanupDays(dir);
      for (const a of Object.keys(config.accounts))
        if (realpath(claudeConfigDir(config, a)) === dir) cleanup[a] = days;
      const root = path.join(dir, 'projects');
      let folders: string[];
      try {
        folders = await fs.promises.readdir(root);
      } catch {
        continue;
      }
      const files: string[] = [];
      for (const f of folders) {
        try {
          for (const name of await fs.promises.readdir(path.join(root, f)))
            if (name.endsWith('.jsonl')) files.push(path.join(root, f, name));
        } catch {
          // not a folder
        }
      }
      await mapLimit(files, PARSE_CONCURRENCY, async (file) => {
        seenFiles.add(file);
        const parsed = await this.parseCached(
          file,
          () => new ClaudeParser(),
          (p, mtime) => p.result(mtime),
        );
        if (!parsed) return;
        const id = path.basename(file, '.jsonl');
        const ref: HistoryRef = { agent: 'claude', id };
        const key = refKey(ref);
        const prev = items.get(key);
        if (prev && prev.entry.updatedAt >= parsed.updatedAt) return;
        const mtime = this.cache.get(file)?.mtimeMs ?? parsed.updatedAt;
        items.set(key, {
          ref,
          file,
          messages: parsed.messages,
          truncated: parsed.truncated,
          commands: parsed.commands,
          ...(parsed.files ? { files: parsed.files } : {}),
          ...(parsed.mentions ? { mentions: parsed.mentions } : {}),
          entry: this.entry(config, meta, ref, parsed, {
            account,
            expiresAt: days > 0 ? mtime + days * DAY_MS : undefined,
          }),
        });
      });
    }

    // Codex: database rows first, rollout files fill in text (and sessions the database doesn't have).
    const home = this.sources.codexHome;
    const threads = await readCodexThreads(codexStateDb(home));
    let names = new Map<string, string>();
    try {
      names = parseCodexIndex(await fs.promises.readFile(path.join(home, 'session_index.jsonl'), 'utf8'));
    } catch {
      // no index
    }
    const rollouts = listRollouts(path.join(home, 'sessions'));
    const rolloutById = new Map<string, string>();
    for (const f of rollouts) {
      const id = UUID_TAIL.exec(f)?.[1]?.toLowerCase();
      if (id) rolloutById.set(id, f);
    }
    const byId = new Map<string, CodexThread>();
    for (const t of threads ?? []) if (!t.archived) byId.set(t.id, t);
    const ids = new Set<string>([...byId.keys(), ...rolloutById.keys()]);
    // Archived in codex: keep it out, even if its rollout is still on disk.
    for (const t of threads ?? []) if (t.archived) ids.delete(t.id);
    await mapLimit([...ids], PARSE_CONCURRENCY, async (id) => {
      const t = byId.get(id);
      const file =
        (t?.rolloutPath && fs.existsSync(t.rolloutPath) ? t.rolloutPath : undefined) ?? rolloutById.get(id);
      if (file) seenFiles.add(file);
      const parsed = file
        ? await this.parseCached(
            file,
            () => new CodexParser(),
            (p, mtime) => p.result(mtime),
          )
        : null;
      if (!t && !parsed) return;
      const base: ParsedSession = {
        cwd: t?.cwd ?? parsed?.cwd ?? '',
        branch: t?.branch ?? parsed?.branch,
        title: names.get(id) ?? t?.name,
        firstMessage: t?.firstMessage ?? parsed?.firstMessage ?? t?.title ?? '',
        startedAt: t?.startedAt || parsed?.startedAt || 0,
        updatedAt: Math.max(t?.updatedAt ?? 0, parsed?.updatedAt ?? 0),
        count: parsed?.count ?? 0,
        messages: parsed?.messages ?? [],
        truncated: parsed?.truncated ?? false,
      };
      if (!base.cwd || (!base.count && !base.firstMessage)) return;
      const ref: HistoryRef = { agent: 'codex', id };
      items.set(refKey(ref), {
        ref,
        file,
        messages: base.messages,
        truncated: base.truncated,
        ...(parsed?.files ? { files: parsed.files } : {}),
        ...(parsed?.mentions ? { mentions: parsed.mentions } : {}),
        entry: this.entry(config, meta, ref, base, {}),
      });
    });

    for (const f of this.cache.keys()) if (!seenFiles.has(f)) this.cache.delete(f);
    this.items = items;
    this.cleanup = cleanup;
    return this.compose();
  }

  /** Local + remote entries, most recent first, with each host's scan state. */
  private compose(): HistoryList {
    const entries = [...this.all()].map((i) => i.entry).sort((a, b) => b.updatedAt - a.updatedAt);
    const hosts: HistoryHost[] = [...this.remote.entries()].map(([alias, st]) => ({
      alias,
      ...(st.error ? { error: st.error } : {}),
      ...(st.checkedAt ? { checkedAt: st.checkedAt } : {}),
      ...(st.latencyMs !== undefined ? { latencyMs: st.latencyMs } : {}),
    }));
    return { entries, cleanupDays: this.cleanup, ...(hosts.length ? { hosts } : {}) };
  }

  private *all(): Iterable<Indexed> {
    yield* this.items.values();
    for (const st of this.remote.values()) yield* st.items.values();
  }

  private item(ref: HistoryRef): Indexed | undefined {
    const key = refKey(ref);
    return ref.host ? this.remote.get(ref.host)?.items.get(key) : this.items.get(key);
  }

  /** Scans the SSH hosts of the configured remote projects (in parallel; a host that fails keeps its old entries). */
  refreshRemote(config: Config): Promise<HistoryList> {
    this.remoteBuilding ??= this.buildRemote(config).finally(() => (this.remoteBuilding = null));
    return this.remoteBuilding;
  }

  private async buildRemote(config: Config): Promise<HistoryList> {
    const hosts = remoteHosts(config);
    for (const alias of [...this.remote.keys()])
      if (!hosts.some((h) => h.host.alias === alias)) this.remote.delete(alias);
    if (this.exec) await Promise.all(hosts.map((h) => this.scanHost(config, h.host, h.claudeDirs)));
    return this.compose();
  }

  private async scanHost(config: Config, host: RemoteHost, claudeDirs: string[]): Promise<void> {
    const exec = this.exec;
    if (!exec) return;
    const alias = host.alias;
    const state: RemoteState = this.remote.get(alias) ?? {
      host,
      home: '',
      cache: new Map(),
      items: new Map(),
    };
    state.host = host;
    this.remote.set(alias, state);
    try {
      const started = Date.now();
      const listing = await listRemote(exec, host, claudeDirs);
      state.latencyMs = Date.now() - started;
      state.home = listing.home;
      const changed = listing.files.filter((f) => {
        const hit = state.cache.get(f.path);
        return !hit || hit.mtimeMs !== f.mtimeMs || hit.size !== f.size;
      });
      const texts = await fetchFiles(
        exec,
        host,
        changed.map((f) => f.path),
      );
      for (const f of changed) {
        const text = texts.get(f.path);
        if (text === undefined) continue; // gone since the listing
        let parsed: ParsedSession | null = null;
        try {
          parsed = parseRemote(f, text);
        } catch (err) {
          console.error('[history] unreadable', alias, f.path, err);
        }
        state.cache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, parsed });
      }
      const live = new Set(listing.files.map((f) => f.path));
      for (const f of state.cache.keys()) if (!live.has(f)) state.cache.delete(f);

      const meta = readMeta(this.sources.metaFile);
      const names = parseCodexIndex(listing.codexIndex);
      const days = listing.settings.map(parseCleanupDays);
      const items = new Map<string, Indexed>();
      for (const f of listing.files) {
        const cached = state.cache.get(f.path)?.parsed;
        if (!cached) continue;
        const id =
          f.agent === 'claude'
            ? path.posix.basename(f.path, '.jsonl')
            : UUID_TAIL.exec(f.path)?.[1]?.toLowerCase();
        if (!id) continue;
        const parsed = f.agent === 'codex' ? { ...cached, title: names.get(id) ?? cached.title } : cached;
        if (!parsed.cwd || (!parsed.count && !parsed.firstMessage)) continue;
        const ref: HistoryRef = { agent: f.agent, id, host: alias };
        const key = refKey(ref);
        const prev = items.get(key);
        if (prev && prev.entry.updatedAt >= parsed.updatedAt) continue;
        const d = f.agent === 'claude' ? (days[f.dir ?? 0] ?? DEFAULT_CLEANUP_DAYS) : 0;
        items.set(key, {
          ref,
          file: f.path,
          host,
          messages: parsed.messages,
          truncated: parsed.truncated || f.size > REMOTE_HEAD_BYTES,
          entry: this.entry(config, meta, ref, parsed, {
            expiresAt: d > 0 ? f.mtimeMs + d * DAY_MS : undefined,
            projectId: matchRemoteProject(config, alias, listing.home, parsed.cwd) ?? null,
          }),
        });
      }
      state.items = items;
      state.error = undefined;
      state.checkedAt = Date.now();
    } catch (err) {
      state.error = (err as Error).message;
    }
  }

  /** The SSH host a remote entry lives on, and that host's home (for matching / adding a project). */
  remoteOf(ref: HistoryRef): { host: RemoteHost; home: string } | undefined {
    const st = ref.host ? this.remote.get(ref.host) : undefined;
    return st && this.item(ref) ? { host: st.host, home: st.home } : undefined;
  }

  private entry(
    config: Config,
    meta: HistoryMeta,
    ref: HistoryRef,
    p: ParsedSession,
    extra: { account?: string; expiresAt?: number; projectId?: string | null },
  ): HistoryEntry {
    const key = refKey(ref);
    // Remote entries come with their project already matched (null = none).
    const projectId =
      extra.projectId !== undefined ? (extra.projectId ?? undefined) : matchProject(config, p.cwd);
    return {
      ...ref,
      cwd: p.cwd,
      ...(p.branch ? { branch: p.branch } : {}),
      ...(extra.account ? { account: extra.account } : {}),
      ...(meta.names[key] ? { name: meta.names[key] } : {}),
      ...(p.title ? { title: p.title } : {}),
      ...(p.autoTitle ? { autoTitle: p.autoTitle } : {}),
      firstMessage: p.firstMessage,
      startedAt: p.startedAt,
      updatedAt: p.updatedAt,
      messages: p.count,
      favorite: meta.favorites.includes(key),
      ...(projectId ? { projectId } : {}),
      ...(extra.expiresAt ? { expiresAt: extra.expiresAt } : {}),
    };
  }

  get(ref: HistoryRef): HistoryEntry | undefined {
    return this.item(ref)?.entry;
  }

  /**
   * T70: local sessions with what they touched — edited files and `@note.md` mentions — from the last `list` (no
   * scan of its own). Sessions that touched nothing are left out.
   */
  work(): SessionWork[] {
    const out: SessionWork[] = [];
    for (const i of this.items.values())
      if (i.files?.length || i.mentions?.length)
        out.push({ entry: i.entry, files: i.files ?? [], mentions: i.mentions ?? [] });
    return out;
  }

  /** Full-text search (case-insensitive substring) over names, titles, first message and every indexed message. */
  search(query: string, limit = 200): HistoryMatch[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: HistoryMatch[] = [];
    for (const item of this.all()) {
      const e = item.entry;
      if (!item.text) {
        const head = [e.name, e.title, e.autoTitle, e.firstMessage].filter(Boolean).join('\n');
        const original = `${head}\n${item.messages.map((m) => m.text).join('\n')}`;
        item.text = { original, lower: original.toLowerCase() };
      }
      const at = item.text.lower.indexOf(q);
      if (at < 0) continue;
      out.push({ ...item.ref, snippet: snippet(item.text.original, at, q.length) });
      if (out.length >= limit) break;
    }
    return out;
  }

  transcript(ref: HistoryRef): HistoryTranscript {
    const item = this.item(ref);
    if (!item) return { messages: [], truncated: false };
    return {
      messages: item.messages,
      truncated: item.truncated,
      ...(item.commands?.length ? { commands: item.commands } : {}),
    };
  }

  /** Every message, read again from disk — or fetched whole from the host (the index keeps only the start). */
  async fullTranscript(ref: HistoryRef): Promise<TranscriptMessage[]> {
    const item = this.item(ref);
    if (!item?.file) return item?.messages ?? [];
    if (item.host) {
      if (!this.exec) return item.messages;
      const text = (await fetchFiles(this.exec, item.host, [item.file], 0)).get(item.file);
      const f: RemoteFile = { path: item.file, agent: ref.agent, mtimeMs: 0, size: 0 };
      return (text !== undefined && parseRemote(f, text, true)?.messages) || item.messages;
    }
    const parser = ref.agent === 'claude' ? new ClaudeParser(true) : new CodexParser(true);
    await parseFile(item.file, parser);
    return parser.result(0)?.messages ?? item.messages;
  }

  setMeta(ref: HistoryRef, change: { name?: string | null; favorite?: boolean }): HistoryEntry | undefined {
    const meta = applyMeta(readMeta(this.sources.metaFile), ref, change);
    writeMeta(meta, this.sources.metaFile);
    const item = this.item(ref);
    if (!item) return undefined;
    const key = refKey(ref);
    const entry: HistoryEntry = { ...item.entry, favorite: meta.favorites.includes(key) };
    if (meta.names[key]) entry.name = meta.names[key];
    else delete entry.name;
    item.entry = entry;
    item.text = undefined;
    return item.entry;
  }
}

/** The panel's display title: our name, else the CLI's name, else its auto title, else the first message. */
export const displayTitle = (e: Pick<HistoryEntry, 'name' | 'title' | 'autoTitle' | 'firstMessage' | 'id'>) =>
  e.name || e.title || e.autoTitle || e.firstMessage || e.id;
