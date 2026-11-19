// Open tabs saved to ~/.aquila/state.json so a relaunch brings them back (T4, T21).
// Claude tabs keep their Claude session id (`claude --resume <id>`), codex tabs their codex session id
// (`codex resume <id>`), shells start fresh under their last output (cold restore). The split layout is saved too,
// with tab keys in its panes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_DIR, expand } from './config';
import type { Config, SavedLayout, SavedPane, SessionKind, Worktree } from '../src/shared/api/types';

export const STATE_PATH = path.join(APP_DIR, 'state.json');
export const SCROLLBACK_DIR = path.join(APP_DIR, 'scrollback');

export interface SavedTab {
  /** Stable across launches: names the scrollback file and the tab in the saved layout. */
  key: string;
  projectId: string;
  kind: SessionKind;
  /** Account the Claude session was started with. */
  account?: string;
  /** The git worktree the session ran in (T7). */
  worktree?: Worktree;
  /** Current Claude session id (changes on /clear; tracked through the SessionStart hook). */
  claudeSessionId?: string;
  /** Codex session id, read from the rollout file codex wrote for this tab (`codex.ts`). */
  codexSessionId?: string;
}

export interface SavedState {
  tabs: SavedTab[];
  /** Pane tree with tab keys (not session ids) in its leaves. */
  layout: SavedLayout | null;
  /** Written by T4 (version 1): no keys, no codex ids — codex tabs fall back to `codex resume --last`. */
  legacy: boolean;
}

interface StateFile {
  version: 2;
  tabs: SavedTab[];
  layout: SavedLayout | null;
}

const KINDS: readonly SessionKind[] = ['claude', 'codex', 'shell'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Max panes a layout may have (= the renderer's MAX_PANES); anything bigger is not ours. */
const MAX_LEAVES = 4;

export const isSessionId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id);
/** Tab keys are uuids too: they become file names, so nothing else is accepted. */
export const isTabKey = isSessionId;
export const newTabKey = (): string => crypto.randomUUID();

const isWorktree = (w: unknown): w is Worktree =>
  typeof (w as Worktree | null)?.path === 'string' &&
  path.isAbsolute((w as Worktree).path) &&
  typeof (w as Worktree).branch === 'string';

/**
 * Copy of a pane tree with each leaf's `sessionId` mapped (null = empty pane). Returns null for anything that isn't a
 * well-formed tree of at most 4 panes.
 */
export function mapPanes(node: unknown, fn: (id: string) => string | null): SavedPane | null {
  let count = 0;
  const walk = (n: unknown, depth: number): SavedPane | null => {
    if (depth > MAX_LEAVES) return null;
    const p = n as Partial<{
      kind: string;
      sessionId: unknown;
      dir: string;
      a: unknown;
      b: unknown;
      ratio: unknown;
    }> | null;
    if (p?.kind === 'leaf') {
      if (++count > MAX_LEAVES) return null;
      return { kind: 'leaf', sessionId: typeof p.sessionId === 'string' ? fn(p.sessionId) : null };
    }
    if (p?.kind !== 'split' || (p.dir !== 'row' && p.dir !== 'column')) return null;
    const a = walk(p.a, depth + 1);
    const b = a && walk(p.b, depth + 1);
    if (!a || !b) return null;
    const ratio = typeof p.ratio === 'number' && p.ratio > 0 && p.ratio < 1 ? p.ratio : undefined;
    return { kind: 'split', dir: p.dir, a, b, ...(ratio !== undefined && { ratio }) };
  };
  return walk(node, 0);
}

export function paneLeaves(node: SavedPane): (string | null)[] {
  return node.kind === 'leaf' ? [node.sessionId] : [...paneLeaves(node.a), ...paneLeaves(node.b)];
}

/** A layout with its leaves mapped (ids ↔ tab keys); null when malformed. */
export function mapLayout(layout: unknown, fn: (id: string) => string | null): SavedLayout | null {
  const l = layout as Partial<SavedLayout> | null;
  const root = mapPanes(l?.root, fn);
  if (!root) return null;
  const n = paneLeaves(root).length;
  const focused =
    typeof l?.focused === 'number' && l.focused >= 0 && l.focused < n ? Math.floor(l.focused) : 0;
  return { root, focused };
}

/** Saved tabs and layout; anything unreadable or malformed is dropped rather than failing the launch. */
export function readState(file = STATE_PATH): SavedState {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { tabs: [], layout: null, legacy: false };
  }
  const data = raw as Partial<StateFile> | null;
  const legacy = (data?.version as number | undefined) === 1;
  if (!Array.isArray(data?.tabs)) return { tabs: [], layout: null, legacy };
  const seen = new Set<string>();
  const tabs = data.tabs.flatMap((t: Partial<SavedTab>): SavedTab[] => {
    if (typeof t?.projectId !== 'string' || !KINDS.includes(t.kind as SessionKind)) return [];
    const key = isTabKey(t.key) && !seen.has(t.key) ? t.key : newTabKey();
    seen.add(key);
    return [
      {
        key,
        projectId: t.projectId,
        kind: t.kind as SessionKind,
        ...(typeof t.account === 'string' ? { account: t.account } : {}),
        ...(isWorktree(t.worktree) ? { worktree: { path: t.worktree.path, branch: t.worktree.branch } } : {}),
        ...(isSessionId(t.claudeSessionId) ? { claudeSessionId: t.claudeSessionId } : {}),
        ...(isSessionId(t.codexSessionId) ? { codexSessionId: t.codexSessionId } : {}),
      },
    ];
  });
  const layout = mapLayout(data.layout, (key) => (seen.has(key) ? key : null));
  return { tabs, layout, legacy };
}

/** Write via a temp file + rename so a crash mid-write never leaves a half file. */
export function writeState(tabs: SavedTab[], layout: SavedLayout | null, file = STATE_PATH): void {
  const data: StateFile = { version: 2, tabs, layout };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** Claude's config dir for an account: its claudeConfigDir, or ~/.claude when unset (shared). */
export function claudeConfigDir(config: Config, account: string | undefined): string {
  const dir = account ? config.accounts[account]?.claudeConfigDir : null;
  return dir ? expand(dir) : path.join(os.homedir(), '.claude');
}

/**
 * Whether Claude has a transcript for this session (`<configDir>/projects/<encoded-cwd>/<id>.jsonl`).
 * Claude only writes it after the first message, and `--resume` fails without it. Looks in every project dir
 * instead of re-deriving Claude's cwd encoding. Read-only.
 */
export function hasClaudeTranscript(configDir: string, sessionId: string): boolean {
  const root = path.join(configDir, 'projects');
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return false;
  }
  return dirs.some((d) => fs.existsSync(path.join(root, d, `${sessionId}.jsonl`)));
}

export interface RestorePlan {
  key: string;
  projectId: string;
  kind: SessionKind;
  account?: string;
  worktree?: Worktree;
  /** Claude: `--resume` this id. Absent = start a new Claude session. */
  resumeClaude?: string;
  /** Codex: `codex resume <id>`. */
  resumeCodexId?: string;
  /** Codex from a T4 state file (no id saved): `codex resume --last`. */
  resumeCodex?: boolean;
  /** Nothing to resume: show the saved output read-only above the fresh session (shells). */
  cold?: boolean;
}

/**
 * What to spawn for the saved tabs. Tabs of projects no longer in the config are dropped, and so are worktree tabs
 * whose worktree folder is gone (removed with `git worktree remove`).
 */
export function planRestore(
  state: Pick<SavedState, 'tabs' | 'legacy'>,
  config: Config,
  transcriptExists: (configDir: string, sessionId: string) => boolean = hasClaudeTranscript,
  dirExists: (dir: string) => boolean = fs.existsSync,
): RestorePlan[] {
  return state.tabs.flatMap((t): RestorePlan[] => {
    const project = config.projects.find((p) => p.id === t.projectId);
    if (!project) return [];
    if (t.worktree && !dirExists(t.worktree.path)) return [];
    const where = { key: t.key, projectId: t.projectId, ...(t.worktree ? { worktree: t.worktree } : {}) };
    if (t.kind === 'shell') return [{ ...where, kind: 'shell', cold: true }];
    if (t.kind === 'codex') {
      if (t.codexSessionId) return [{ ...where, kind: 'codex', resumeCodexId: t.codexSessionId }];
      return [{ ...where, kind: 'codex', ...(state.legacy ? { resumeCodex: true } : {}) }];
    }
    const account = t.account && config.accounts[t.account] ? t.account : project.account;
    const id = t.claudeSessionId;
    const resume = id && transcriptExists(claudeConfigDir(config, account), id) ? id : undefined;
    return [{ ...where, kind: 'claude', account, ...(resume ? { resumeClaude: resume } : {}) }];
  });
}

/**
 * Which planned tabs to spawn now: the ones in the saved layout's panes; without a layout (or none of its tabs left),
 * the first tab of the first project that has one. The rest wait until they are first shown.
 */
export function visibleKeys(plans: RestorePlan[], layout: SavedLayout | null, config: Config): Set<string> {
  const planned = new Set(plans.map((p) => p.key));
  const inPanes = layout ? paneLeaves(layout.root).filter((k): k is string => !!k && planned.has(k)) : [];
  if (inPanes.length) return new Set(inPanes);
  const first = config.projects.map((p) => plans.find((t) => t.projectId === p.id)).find(Boolean) ?? plans[0];
  return new Set(first ? [first.key] : []);
}

// ── Scrollback (plain text the renderer snapshots; shown read-only when a tab can't resume) ──

/** Kept per tab; older lines are cut from the top. */
export const SCROLLBACK_MAX_BYTES = 512 * 1024;

const scrollbackFile = (key: string, dir: string) => path.join(dir, `${key}.txt`);

export function writeScrollback(key: string, text: string, dir = SCROLLBACK_DIR): void {
  if (!isTabKey(key)) return;
  let body = text;
  if (Buffer.byteLength(body) > SCROLLBACK_MAX_BYTES) {
    body = body.slice(-SCROLLBACK_MAX_BYTES);
    body = body.slice(body.indexOf('\n') + 1);
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = scrollbackFile(key, dir);
  fs.writeFileSync(`${file}.tmp`, body);
  fs.renameSync(`${file}.tmp`, file);
}

export function readScrollback(key: string, dir = SCROLLBACK_DIR): { text: string; savedAt: Date } | null {
  if (!isTabKey(key)) return null;
  try {
    const file = scrollbackFile(key, dir);
    const text = fs.readFileSync(file, 'utf8');
    return text.trim() ? { text, savedAt: fs.statSync(file).mtime } : null;
  } catch {
    return null;
  }
}

export function removeScrollback(key: string, dir = SCROLLBACK_DIR): void {
  if (isTabKey(key)) fs.rmSync(scrollbackFile(key, dir), { force: true });
}

/** Deletes the scrollback of tabs that are no longer saved. */
export function pruneScrollback(keep: Set<string>, dir = SCROLLBACK_DIR): void {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of files) {
    const key = f.replace(/\.txt(\.tmp)?$/, '');
    if (!keep.has(key)) fs.rmSync(path.join(dir, f), { force: true });
  }
}

/**
 * Saved output as terminal bytes: dimmed, control characters stripped (the file is plain text, but never let it carry
 * escape sequences), then a banner line. Written into the terminal before the new session's own output.
 */
export function formatRestored(text: string, banner: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    // Control characters are exactly what this strips (tab and newline stay).
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/\s+$/, '')
    .split('\n');
  return `\x1b[0m\x1b[2m${lines.join('\r\n')}\r\n── ${banner} ──\x1b[0m\r\n\r\n`;
}
