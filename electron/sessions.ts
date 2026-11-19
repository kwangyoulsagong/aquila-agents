// One pty per session. Runs the user's real `claude` / `codex` / shell — same tokens, same config.
import crypto from 'node:crypto';
import { Notification, type BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import { expand, loadConfig } from './config';
import type { RestorePlan, SavedTab } from './state';
import { kindLabel, translator } from '../src/shared/i18n/dictionary';
import {
  IPC,
  type Config,
  type SessionInfo,
  type SessionKind,
  type SessionStatus,
} from '../src/shared/api/types';

const SHELL = process.env.SHELL || '/bin/zsh';
const QUIET_MS = 3000; // output-activity heuristic for codex/shell
const MIN_BUSY_MS = 3000;

interface LiveSession {
  id: string;
  projectId: string;
  projectName: string;
  kind: SessionKind;
  /** Claude sessions only. */
  account?: string;
  /** Current Claude session id: ours from `--session-id`, then whatever SessionStart reports (/clear changes it). */
  claudeSessionId?: string;
  proc: pty.IPty;
  status: SessionStatus;
  usesHooks: boolean;
  lastOutput: number;
  busySince: number;
}

interface Deps {
  send: (channel: string, payload: unknown) => void;
  getWindow: () => BrowserWindow | null;
  hookPort: number;
  hookSettingsPath: string;
  /** Open tabs changed (created, closed, Claude session id moved) — persisted by state.ts. */
  onTabsChanged?: (tabs: SavedTab[]) => void;
}

/** How to start a session that is being restored after a relaunch. */
export type RestoreOptions = Pick<RestorePlan, 'resumeClaude' | 'resumeCodex'>;

export class SessionManager {
  private sessions = new Map<string, LiveSession>();
  private activeId: string | null = null;
  private timer: NodeJS.Timeout;
  /** Set on quit so the exits caused by killAll don't wipe the saved tabs. */
  private closing = false;

  constructor(private deps: Deps) {
    this.timer = setInterval(() => this.tickActivity(), 1000);
  }

  create(
    config: Config,
    projectId: string,
    kind: SessionKind,
    accountOverride?: string,
    restore: RestoreOptions = {},
  ): SessionInfo {
    const project = config.projects.find((p) => p.id === projectId);
    if (!project) throw new Error(translator(config.language)('error.projectNotFound', { id: projectId }));
    const accountId = accountOverride && config.accounts[accountOverride] ? accountOverride : project.account;
    const account = config.accounts[accountId];
    const id = crypto.randomUUID().slice(0, 8);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AQUILA_TAB_ID: id,
      AQUILA_PORT: String(this.deps.hookPort),
    };
    delete env.CLAUDE_CONFIG_DIR;
    // Account only matters for Claude; codex/shell keep the user's environment as-is.
    if (kind === 'claude' && account?.claudeConfigDir)
      env.CLAUDE_CONFIG_DIR = expand(account.claudeConfigDir);

    const claudeSessionId = kind === 'claude' ? (restore.resumeClaude ?? crypto.randomUUID()) : undefined;
    const command = this.commandFor(kind, claudeSessionId, restore);
    const args = command ? ['-l', '-i', '-c', `${command}; exec ${SHELL} -l -i`] : ['-l', '-i'];
    const proc = pty.spawn(SHELL, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd: expand(project.path),
      env,
    });

    const s: LiveSession = {
      id,
      projectId,
      projectName: project.name,
      kind,
      account: kind === 'claude' ? accountId : undefined,
      claudeSessionId,
      proc,
      status: 'idle',
      usesHooks: kind === 'claude',
      lastOutput: 0,
      busySince: 0,
    };
    this.sessions.set(id, s);

    proc.onData((data) => {
      this.deps.send(IPC.sessionData, { id, data });
      if (!s.usesHooks) {
        const now = Date.now();
        if (!s.busySince) s.busySince = now;
        s.lastOutput = now;
      }
    });
    proc.onExit(({ exitCode }) => {
      this.setStatus(s, exitCode === 0 ? 'idle' : 'error');
      this.deps.send(IPC.sessionExit, { id, exitCode });
      this.sessions.delete(id);
      this.tabsChanged();
    });
    this.tabsChanged();

    return { id, projectId, kind, account: kind === 'claude' ? accountId : undefined };
  }

  private commandFor(kind: SessionKind, claudeSessionId: string | undefined, restore: RestoreOptions): string | null {
    if (kind === 'claude') {
      // Only uuids reach here (ours or validated from state/hook), so no shell quoting is needed for the id.
      const session = restore.resumeClaude ? `--resume ${claudeSessionId}` : `--session-id ${claudeSessionId}`;
      return `claude --settings ${JSON.stringify(this.deps.hookSettingsPath)} ${session}`;
    }
    if (kind === 'codex') return restore.resumeCodex ? 'codex resume --last' : 'codex';
    return null;
  }

  onHook(id: string, status: SessionStatus): void {
    const s = this.sessions.get(id);
    if (s) this.setStatus(s, status);
  }

  /** SessionStart hook: Claude started, resumed or /clear'ed into this session id. */
  onClaudeSession(id: string, claudeSessionId: string): void {
    const s = this.sessions.get(id);
    if (!s || s.kind !== 'claude' || s.claudeSessionId === claudeSessionId) return;
    s.claudeSessionId = claudeSessionId;
    this.tabsChanged();
  }

  /** Open tabs in creation order (= tab order). */
  tabs(): SavedTab[] {
    return [...this.sessions.values()].map((s) => ({
      projectId: s.projectId,
      kind: s.kind,
      ...(s.account ? { account: s.account } : {}),
      ...(s.claudeSessionId ? { claudeSessionId: s.claudeSessionId } : {}),
    }));
  }

  private tabsChanged(): void {
    if (!this.closing) this.deps.onTabsChanged?.(this.tabs());
  }

  /** Output-activity heuristic for sessions without hooks (codex, shell). */
  private tickActivity(): void {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.usesHooks || !s.busySince) continue;
      const quiet = now - s.lastOutput > QUIET_MS;
      if (!quiet && now - s.busySince > MIN_BUSY_MS && s.status !== 'working') this.setStatus(s, 'working');
      if (quiet) {
        if (s.status === 'working') this.setStatus(s, 'done');
        s.busySince = 0;
      }
    }
  }

  private setStatus(s: LiveSession, status: SessionStatus): void {
    if (s.status === status) return;
    s.status = status;
    this.deps.send(IPC.sessionStatus, { id: s.id, status });

    const win = this.deps.getWindow();
    const unseen = !win?.isFocused() || this.activeId !== s.id;
    if ((status === 'done' || status === 'waiting') && unseen && Notification.isSupported()) {
      const t = translator(loadConfig().language);
      const n = new Notification({
        title: s.projectName,
        body: `${kindLabel(t, s.kind)} · ${t(status === 'done' ? 'notify.done' : 'notify.waiting')}`,
      });
      n.on('click', () => {
        win?.show();
        win?.focus();
        this.deps.send(IPC.uiFocusSession, { id: s.id });
      });
      n.show();
    }
  }

  setActive(id: string | null): void {
    this.activeId = id;
  }

  markSeen(id: string): void {
    const s = this.sessions.get(id);
    if (s?.status === 'done') this.setStatus(s, 'idle');
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.sessions.get(id)?.proc.resize(cols, rows);
  }

  kill(id: string): void {
    this.sessions.get(id)?.proc.kill();
  }

  killAll(): void {
    this.closing = true;
    clearInterval(this.timer);
    for (const s of this.sessions.values()) s.proc.kill();
  }
}
