// Open tabs saved to ~/.aquila/state.json so a relaunch brings them back (T4).
// Claude tabs keep their Claude session id (resumed with `claude --resume <id>`), codex resumes the last
// session in that dir, shells start fresh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_DIR, expand } from './config';
import type { Config, SessionKind } from '../src/shared/api/types';

export const STATE_PATH = path.join(APP_DIR, 'state.json');

export interface SavedTab {
  projectId: string;
  kind: SessionKind;
  /** Account the Claude session was started with. */
  account?: string;
  /** Current Claude session id (changes on /clear; tracked through the SessionStart hook). */
  claudeSessionId?: string;
}

interface StateFile {
  version: 1;
  tabs: SavedTab[];
}

const KINDS: readonly SessionKind[] = ['claude', 'codex', 'shell'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSessionId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id);

/** Saved tabs; anything unreadable or malformed is dropped rather than failing the launch. */
export function readState(file = STATE_PATH): SavedTab[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const tabs = (raw as Partial<StateFile> | null)?.tabs;
  if (!Array.isArray(tabs)) return [];
  return tabs.flatMap((t: Partial<SavedTab>): SavedTab[] =>
    typeof t?.projectId === 'string' && KINDS.includes(t.kind as SessionKind)
      ? [
          {
            projectId: t.projectId,
            kind: t.kind as SessionKind,
            ...(typeof t.account === 'string' ? { account: t.account } : {}),
            ...(isSessionId(t.claudeSessionId) ? { claudeSessionId: t.claudeSessionId } : {}),
          },
        ]
      : [],
  );
}

/** Write via a temp file + rename so a crash mid-write never leaves a half file. */
export function writeState(tabs: SavedTab[], file = STATE_PATH): void {
  const data: StateFile = { version: 1, tabs };
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
  projectId: string;
  kind: SessionKind;
  account?: string;
  /** Claude: `--resume` this id. Absent = start a new Claude session. */
  resumeClaude?: string;
  /** Codex: `codex resume --last`. */
  resumeCodex?: boolean;
}

/** What to spawn for the saved tabs. Tabs of projects no longer in the config are dropped. */
export function planRestore(
  tabs: SavedTab[],
  config: Config,
  transcriptExists: (configDir: string, sessionId: string) => boolean = hasClaudeTranscript,
): RestorePlan[] {
  return tabs.flatMap((t): RestorePlan[] => {
    const project = config.projects.find((p) => p.id === t.projectId);
    if (!project) return [];
    if (t.kind === 'shell') return [{ projectId: t.projectId, kind: 'shell' }];
    if (t.kind === 'codex') return [{ projectId: t.projectId, kind: 'codex', resumeCodex: true }];
    const account = t.account && config.accounts[t.account] ? t.account : project.account;
    const id = t.claudeSessionId;
    const resume = id && transcriptExists(claudeConfigDir(config, account), id) ? id : undefined;
    return [{ projectId: t.projectId, kind: 'claude', account, ...(resume ? { resumeClaude: resume } : {}) }];
  });
}
