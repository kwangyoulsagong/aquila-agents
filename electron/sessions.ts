// One pty per session. Runs the user's real `claude` / `codex` / shell — same tokens, same config.
import crypto from 'node:crypto';
import { Notification, type BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import { expand, loadConfig } from './config';
import type { RestorePlan, SavedTab } from './state';
import { logStatus } from './status/log';
import { OSC_7501_REPLY, OscScanner, parse7501 } from './status/osc';
import { StatusTracker, type HookSignal } from './status/tracker';
import { kindLabel, translator } from '../src/shared/i18n/dictionary';
import {
  IPC,
  type Config,
  type SessionInfo,
  type SessionKind,
  type StatusUpdate,
  type Worktree,
} from '../src/shared/api/types';

const SHELL = process.env.SHELL || '/bin/zsh';

interface LiveSession {
  id: string;
  projectId: string;
  projectName: string;
  kind: SessionKind;
  /** Claude sessions only. */
  account?: string;
  /** Runs in this git worktree instead of the project dir. */
  worktree?: Worktree;
  /** Current Claude session id: ours from `--session-id`, then whatever SessionStart reports (/clear changes it). */
  claudeSessionId?: string;
  proc: pty.IPty;
  tracker: StatusTracker;
  osc: OscScanner;
}

interface Deps {
  send: (channel: string, payload: unknown) => void;
  getWindow: () => BrowserWindow | null;
  hookPort: number;
  /** `--settings` file for Claude: http hooks, or command hooks for old versions (read at spawn time). */
  hookSettingsPath: () => string;
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
    worktree?: Worktree,
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
      cwd: worktree?.path ?? expand(project.path),
      env,
    });

    const s: LiveSession = {
      id,
      projectId,
      projectName: worktree ? `${project.name} · ${worktree.branch}` : project.name,
      kind,
      account: kind === 'claude' ? accountId : undefined,
      worktree,
      claudeSessionId,
      proc,
      // Claude has hooks as its fallback; codex and shells fall back to output activity.
      tracker: new StatusTracker(kind !== 'claude'),
      osc: new OscScanner(),
    };
    this.sessions.set(id, s);

    proc.onData((data) => {
      // OSC 7501 first: the query must be answered before the renderer's xterm answers DA1.
      for (const payload of s.osc.feed(data)) this.onOsc(s, payload);
      this.deps.send(IPC.sessionData, { id, data });
      s.tracker.output(Date.now());
    });
    proc.onExit(({ exitCode, signal }) => {
      if (s.tracker.exit(exitCode, signal)) this.emitStatus(s);
      this.deps.send(IPC.sessionExit, { id, exitCode });
      this.sessions.delete(id);
      this.tabsChanged();
    });
    this.tabsChanged();

    return {
      id,
      projectId,
      kind,
      ...(kind === 'claude' ? { account: accountId } : {}),
      ...(worktree ? { worktree } : {}),
    };
  }

  private commandFor(kind: SessionKind, claudeSessionId: string | undefined, restore: RestoreOptions): string | null {
    if (kind === 'claude') {
      // Only uuids reach here (ours or validated from state/hook), so no shell quoting is needed for the id.
      const session = restore.resumeClaude ? `--resume ${claudeSessionId}` : `--session-id ${claudeSessionId}`;
      return `claude --settings ${JSON.stringify(this.deps.hookSettingsPath())} ${session}`;
    }
    if (kind === 'codex') return restore.resumeCodex ? 'codex resume --last' : 'codex';
    return null;
  }

  private onOsc(s: LiveSession, payload: string): void {
    const msg = parse7501(payload);
    if (!msg) return;
    if (msg.type === 'query') {
      s.proc.write(OSC_7501_REPLY);
      logStatus(s.id, 'osc7501', '? (answered)');
      return;
    }
    logStatus(s.id, 'osc7501', payload);
    if (s.tracker.osc(msg.fields, Date.now())) this.emitStatus(s);
  }

  /** A Claude hook from this tab (status fallback; SessionStart also carries the Claude session id). */
  onHook(id: string, hook: HookSignal & { sessionId?: string }): void {
    const s = this.sessions.get(id);
    if (!s) return;
    logStatus(id, 'hook', [hook.event, hook.notificationType, hook.reason, hook.error].filter(Boolean).join(' '));
    // SessionStart: Claude started, resumed or /clear'ed into this session id.
    if (hook.event === 'SessionStart' && hook.sessionId && s.kind === 'claude' && s.claudeSessionId !== hook.sessionId) {
      s.claudeSessionId = hook.sessionId;
      this.tabsChanged();
    }
    if (s.tracker.hook(hook)) this.emitStatus(s);
  }

  /** Open tabs in creation order (= tab order). */
  tabs(): SavedTab[] {
    return [...this.sessions.values()].map((s) => ({
      projectId: s.projectId,
      kind: s.kind,
      ...(s.account ? { account: s.account } : {}),
      ...(s.worktree ? { worktree: s.worktree } : {}),
      ...(s.claudeSessionId ? { claudeSessionId: s.claudeSessionId } : {}),
    }));
  }

  private tabsChanged(): void {
    if (!this.closing) this.deps.onTabsChanged?.(this.tabs());
  }

  /** Output-activity heuristic for sessions that don't report (codex without 7501, shell). */
  private tickActivity(): void {
    const now = Date.now();
    for (const s of this.sessions.values()) if (s.tracker.tick(now)) this.emitStatus(s);
  }

  private emitStatus(s: LiveSession): void {
    const { status, estimated, reason } = s.tracker.current();
    const update: StatusUpdate = { id: s.id, status, ...(estimated ? { estimated } : {}), ...(reason ? { reason } : {}) };
    this.deps.send(IPC.sessionStatus, update);

    const win = this.deps.getWindow();
    const unseen = !win?.isFocused() || this.activeId !== s.id;
    const notify = status === 'done' || status === 'waiting' || (status === 'error' && reason !== 'exit');
    if (notify && unseen && Notification.isSupported()) {
      const t = translator(loadConfig().language);
      const what =
        status === 'error'
          ? `${t('notify.error')}: ${t(`status.reason.${reason ?? 'other'}`)}`
          : t(status === 'done' ? 'notify.done' : 'notify.waiting');
      const n = new Notification({ title: s.projectName, body: `${kindLabel(t, s.kind)} · ${what}` });
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
    if (s?.tracker.seen()) this.emitStatus(s);
  }

  /** Worktree path of a live session in that project; undefined for any other session (never a renderer path). */
  worktreeOf(id: string, projectId: string): string | undefined {
    const s = this.sessions.get(id);
    return s?.projectId === projectId ? s.worktree?.path : undefined;
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** Keyboard path from the renderer (also xterm's own replies, which the tracker tells apart). */
  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.proc.write(data);
    if (s.tracker.input(data, Date.now())) this.emitStatus(s);
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
