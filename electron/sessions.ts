// One pty per session. Runs the user's real `claude` / `codex` / shell — same tokens, same config.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import { expand, loadConfig } from './config';
import { assignRollouts, findRollouts } from './codex';
import { commandName } from './detect';
import { headSha } from './git';
import type { HookEvent } from './hooks';
import { OutputBatcher } from './output';
import { SAVER_TICK_MS, TICK_MS } from './power';
import { Attention, firstLine, setDockBadge, type AttentionSession } from './notify';
import { PORT_STEP, worktreeSlot } from './worktrees';
import { formatRestored, newTabKey, type RestorePlan, type SavedTab } from './state';
import { logStatus } from './status/log';
import { OSC_7501_REPLY, OscScanner, parse7501 } from './status/osc';
import { StatusTracker } from './status/tracker';
import { translator } from '../src/shared/i18n/dictionary';
import {
  IPC,
  type Config,
  type SessionInfo,
  type SessionKind,
  type SessionStatus,
  type StatusUpdate,
  type Worktree,
} from '../src/shared/api/types';

const SHELL = process.env.SHELL || '/bin/zsh';
/** `'…'` for sh, with embedded quotes escaped. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Printed by the session command when `claude --resume` / `codex resume` fails (OSC 7501 so the scanner sees it). */
const RESUME_FAILED = 'aquila-resume-failed';
/** A resume that fails does so right away; a non-zero exit later is the user's own session ending. */
const RESUME_FAIL_WINDOW_MS = 20_000;
/** After Enter in a codex tab without a session id: look for the rollout codex creates on the first prompt. */
const CODEX_SCAN_DELAYS_MS = [1500, 6000];

/** A restored tab that isn't spawned until it is first shown. */
interface DormantTab {
  id: string;
  plan: RestorePlan;
}

/** Scrollback files (`~/.aquila/scrollback/`); absent in smoke, which never touches the user's state. */
export interface ScrollbackStore {
  read(key: string): { text: string; savedAt: Date } | null;
  write(key: string, text: string): void;
  remove(key: string): void;
}

interface LiveSession {
  id: string;
  /** Stable across launches (state.json, scrollback file). */
  key: string;
  cwd: string;
  spawnedAt: number;
  projectId: string;
  projectName: string;
  kind: SessionKind;
  /** Claude sessions only. */
  account?: string;
  /** Runs in this git worktree instead of the project dir. */
  worktree?: Worktree;
  /** HEAD when the session spawned (changes panel "since session start", T25); '' outside a repo. */
  startHead?: string;
  /** Current Claude session id: ours from `--session-id`, then whatever SessionStart reports (/clear changes it). */
  claudeSessionId?: string;
  /** Codex session id: the one resumed, or captured from the rollout codex wrote (`codex.ts`). */
  codexSessionId?: string;
  /** Last Enter typed into a codex tab (matching it to its rollout). */
  lastSubmit?: number;
  /** Restored with `--resume` / `codex resume`: until then a failure shows the saved output. */
  resumeUntil?: number;
  proc: pty.IPty;
  tracker: StatusTracker;
  osc: OscScanner;
  /** pty output → batched `session:data`, paused while the renderer is behind. */
  output: OutputBatcher;
  /** Last status sent, to tell a status change from an estimated/reason change. */
  sentStatus: SessionStatus;
  /** When the current status started (ms); sent with every status update. */
  since: number;
  /** Notification context per status: the permission's tool summary, the last answer's first line. */
  details: { waiting?: string; done?: string };
}

interface Deps {
  send: (channel: string, payload: unknown) => void;
  getWindow: () => BrowserWindow | null;
  hookPort: number;
  /** `--settings` file for Claude: http hooks, or command hooks for old versions (read at spawn time). */
  hookSettingsPath: () => string;
  /** Open tabs changed (created, closed, Claude session id moved) — persisted by state.ts. */
  onTabsChanged?: (tabs: SavedTab[]) => void;
  scrollback?: ScrollbackStore;
}

/** How to start a session that is being restored after a relaunch. */
export type RestoreOptions = Partial<
  Pick<RestorePlan, 'key' | 'resumeClaude' | 'resumeCodex' | 'resumeCodexId' | 'cold'>
>;

export class SessionManager {
  private sessions = new Map<string, LiveSession>();
  private dormant = new Map<string, DormantTab>();
  /** Tab ids in tab order (live and dormant). */
  private order: string[] = [];
  private codexScans: NodeJS.Timeout[] = [];
  private activeId: string | null = null;
  private timer: NodeJS.Timeout;
  /** Set on quit so the exits caused by killAll don't wipe the saved tabs. */
  private closing = false;
  private attention: Attention;
  private badge = 0;
  /** Power-saver mode (T9): slower activity tick, hidden output held longer. */
  private saver = false;

  constructor(private deps: Deps) {
    this.timer = setInterval(() => this.tickActivity(), TICK_MS);
    this.attention = new Attention({
      get: (id) => {
        const s = this.sessions.get(id);
        return s && this.attentionView(s);
      },
      onScreen: (id) => !!this.deps.getWindow()?.isFocused() && this.activeId === id,
      t: () => translator(loadConfig().language),
      focus: (id) => {
        const win = this.deps.getWindow();
        win?.show();
        win?.focus();
        this.deps.send(IPC.uiFocusSession, { id });
      },
    });
  }

  create(
    config: Config,
    projectId: string,
    kind: SessionKind,
    accountOverride?: string,
    restore: RestoreOptions = {},
    worktree?: Worktree,
    /** Run before the program (a new worktree's setup script). */
    setup?: string,
  ): SessionInfo {
    return this.spawn(
      config,
      crypto.randomUUID().slice(0, 8),
      projectId,
      kind,
      accountOverride,
      restore,
      worktree,
      setup,
    );
  }

  /** A restored tab that waits until it's shown (`wake`). Returns its info with `dormant: true`. */
  prepare(config: Config, plan: RestorePlan): SessionInfo {
    const project = config.projects.find((p) => p.id === plan.projectId);
    if (!project)
      throw new Error(translator(config.language)('error.projectNotFound', { id: plan.projectId }));
    const id = crypto.randomUUID().slice(0, 8);
    this.dormant.set(id, { id, plan });
    this.order.push(id);
    return {
      id,
      projectId: plan.projectId,
      kind: plan.kind,
      ...(plan.kind === 'claude' ? { account: plan.account ?? project.account } : {}),
      ...(plan.worktree ? { worktree: plan.worktree } : {}),
      dormant: true,
    };
  }

  /** Spawns a dormant tab under the same id; a live one is returned as is. */
  wake(config: Config, id: string): SessionInfo {
    const live = this.sessions.get(id);
    if (live) return this.info(live);
    const d = this.dormant.get(id);
    if (!d) throw new Error(`No restored tab ${id}`);
    this.dormant.delete(id);
    const { plan } = d;
    try {
      return this.spawn(config, id, plan.projectId, plan.kind, plan.account, plan, plan.worktree);
    } catch (err) {
      this.order = this.order.filter((o) => o !== id);
      this.tabsChanged();
      throw err;
    }
  }

  private spawn(
    config: Config,
    id: string,
    projectId: string,
    kind: SessionKind,
    accountOverride: string | undefined,
    restore: RestoreOptions,
    worktree: Worktree | undefined,
    setup?: string,
  ): SessionInfo {
    const project = config.projects.find((p) => p.id === projectId);
    if (!project) throw new Error(translator(config.language)('error.projectNotFound', { id: projectId }));
    const accountId = accountOverride && config.accounts[accountOverride] ? accountOverride : project.account;
    const account = config.accounts[accountId];

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AQUILA_TAB_ID: id,
      AQUILA_PORT: String(this.deps.hookPort),
    };
    delete env.CLAUDE_CONFIG_DIR;
    // Project port base (T26): each worktree gets its own range so parallel dev servers don't collide.
    if (project.portBase) {
      const port = String(project.portBase + (worktree ? PORT_STEP * worktreeSlot(worktree.path) : 0));
      env.PORT = port;
      env.AQUILA_PORT_BASE = port;
    }
    // Account only matters for Claude; codex/shell keep the user's environment as-is.
    if (kind === 'claude' && account?.claudeConfigDir)
      env.CLAUDE_CONFIG_DIR = expand(account.claudeConfigDir);

    const claudeSessionId = kind === 'claude' ? (restore.resumeClaude ?? crypto.randomUUID()) : undefined;
    const resuming = !!(restore.resumeClaude || restore.resumeCodexId);
    let command = this.commandFor(kind, claudeSessionId, restore);
    // A failed resume prints our marker, then the tab drops to the shell as usual (cold restore).
    if (command && resuming) command = `${command} || printf '\\033]7501;${RESUME_FAILED}\\007'`;
    // The setup script runs in the same login shell (the user's PATH), visibly, once; the program starts either way.
    const pre = setup?.trim()
      ? `printf '\\033[2m%s\\033[0m\\n' ${shellQuote(translator(config.language)('settings.setupRunning'))}; ${setup.trim()}\n`
      : '';
    const args =
      command || pre
        ? ['-l', '-i', '-c', `${pre}${command ? `${command}; ` : ''}exec ${SHELL} -l -i`]
        : ['-l', '-i'];
    const cwd = worktree?.path ?? expand(project.path);
    const proc = pty.spawn(SHELL, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd,
      env,
    });

    const now = Date.now();
    const s: LiveSession = {
      id,
      key: restore.key ?? newTabKey(),
      cwd: realpath(cwd),
      spawnedAt: now,
      ...(kind === 'codex' && restore.resumeCodexId ? { codexSessionId: restore.resumeCodexId } : {}),
      ...(resuming ? { resumeUntil: now + RESUME_FAIL_WINDOW_MS } : {}),
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
      output: new OutputBatcher({
        send: (data) => this.deps.send(IPC.sessionData, { id, data }),
        pause: () => proc.pause(),
        resume: () => proc.resume(),
      }),
      sentStatus: 'idle',
      since: Date.now(),
      details: {},
    };
    this.sessions.set(id, s);
    if (!this.order.includes(id)) this.order.push(id);
    void headSha(cwd).then((h) => (s.startHead = h));
    s.output.setSaver(this.saver);
    // Cold restore: the last output, read-only, above the fresh shell.
    if (restore.cold) this.showSaved(s, config, 'restore.previous');

    proc.onData((data) => {
      // OSC 7501 first: the query must be answered before the renderer's xterm answers DA1.
      for (const payload of s.osc.feed(data)) this.onOsc(s, payload);
      s.output.push(data);
      s.tracker.output(Date.now());
    });
    proc.onExit(({ exitCode, signal }) => {
      s.output.flush();
      s.output.dispose();
      if (s.tracker.exit(exitCode, signal)) this.emitStatus(s);
      this.deps.send(IPC.sessionExit, { id, exitCode });
      this.sessions.delete(id);
      this.order = this.order.filter((o) => o !== id);
      // The tab is gone for good (not a quit): its saved output too.
      if (!this.closing) this.deps.scrollback?.remove(s.key);
      this.attention.forget(id);
      this.updateBadge();
      this.tabsChanged();
    });
    this.tabsChanged();
    return this.info(s);
  }

  private info(s: LiveSession): SessionInfo {
    return {
      id: s.id,
      projectId: s.projectId,
      kind: s.kind,
      ...(s.account ? { account: s.account } : {}),
      ...(s.worktree ? { worktree: s.worktree } : {}),
    };
  }

  /** Writes the tab's saved output (dimmed, with a banner) into its terminal, ahead of what comes next. */
  private showSaved(
    s: LiveSession,
    config: Config,
    banner: 'restore.previous' | 'restore.resumeFailed',
  ): void {
    const saved = this.deps.scrollback?.read(s.key);
    if (!saved) return;
    const time = saved.savedAt.toLocaleString(config.language === 'ko' ? 'ko-KR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    s.output.push(formatRestored(saved.text, translator(config.language)(banner, { time })));
  }

  /** Plain-text snapshot from the renderer. Also accepted while quitting (the last one may arrive then). */
  saveScrollback(id: string, text: string): void {
    const s = this.sessions.get(id);
    if (s && typeof text === 'string') this.deps.scrollback?.write(s.key, text);
  }

  /** Tab key of a live or dormant tab (the saved layout refers to tabs by key). */
  keyOf(id: string): string | undefined {
    return this.sessions.get(id)?.key ?? this.dormant.get(id)?.plan.key;
  }

  private commandFor(
    kind: SessionKind,
    claudeSessionId: string | undefined,
    restore: RestoreOptions,
  ): string | null {
    if (kind === 'claude') {
      // Only uuids reach here (ours or validated from state/hook), so no shell quoting is needed for the id.
      const session = restore.resumeClaude
        ? `--resume ${claudeSessionId}`
        : `--session-id ${claudeSessionId}`;
      return `${commandName('claude')} --settings ${JSON.stringify(this.deps.hookSettingsPath())} ${session}`;
    }
    if (kind === 'codex') {
      // Codex ids are validated uuids (state.ts), safe unquoted.
      if (restore.resumeCodexId) return `${commandName('codex')} resume ${restore.resumeCodexId}`;
      return restore.resumeCodex ? `${commandName('codex')} resume --last` : commandName('codex');
    }
    return null;
  }

  private onOsc(s: LiveSession, payload: string): void {
    if (payload === RESUME_FAILED) {
      if (s.resumeUntil && Date.now() <= s.resumeUntil)
        this.showSaved(s, loadConfig(), 'restore.resumeFailed');
      s.resumeUntil = undefined;
      return;
    }
    const msg = parse7501(payload);
    if (!msg) return;
    if (msg.type === 'query') {
      s.proc.write(OSC_7501_REPLY);
      logStatus(s.id, 'osc7501', '? (answered)');
      return;
    }
    logStatus(s.id, 'osc7501', payload);
    // `msg` is the program's own one-line context ("Allow Bash: npm install?").
    const text = firstLine(msg.fields.msg);
    if (text && msg.fields.state === 'blocked') s.details.waiting = text;
    if (text && msg.fields.state === 'done') s.details.done = text;
    if (s.tracker.osc(msg.fields, Date.now())) this.emitStatus(s);
  }

  /** A Claude hook from this tab (status fallback; SessionStart also carries the Claude session id). */
  onHook(id: string, hook: HookEvent): void {
    const s = this.sessions.get(id);
    if (!s) return;
    logStatus(
      id,
      'hook',
      [hook.event, hook.notificationType, hook.reason, hook.error].filter(Boolean).join(' '),
    );
    // SessionStart: Claude started, resumed or /clear'ed into this session id.
    if (
      hook.event === 'SessionStart' &&
      hook.sessionId &&
      s.kind === 'claude' &&
      s.claudeSessionId !== hook.sessionId
    ) {
      s.claudeSessionId = hook.sessionId;
      this.tabsChanged();
    }
    // Context for the notification. With 7501 the status may already have changed: refresh the pending one.
    const slot =
      hook.event === 'Stop'
        ? 'done'
        : hook.event === 'PermissionRequest' || hook.event === 'Notification'
          ? 'waiting'
          : null;
    if (slot && hook.detail && !(slot === 'waiting' && hook.event === 'Notification' && s.details.waiting))
      s.details[slot] = hook.detail;
    if (s.tracker.hook(hook)) this.emitStatus(s);
    else if (slot && hook.detail && s.tracker.current().status === slot)
      this.attention.changed(this.attentionView(s));
  }

  /** Open tabs (live and dormant) in creation order (= tab order). */
  tabs(): SavedTab[] {
    return this.order.flatMap((id): SavedTab[] => {
      const s = this.sessions.get(id);
      if (s)
        return [
          {
            key: s.key,
            projectId: s.projectId,
            kind: s.kind,
            ...(s.account ? { account: s.account } : {}),
            ...(s.worktree ? { worktree: s.worktree } : {}),
            ...(s.claudeSessionId ? { claudeSessionId: s.claudeSessionId } : {}),
            ...(s.codexSessionId ? { codexSessionId: s.codexSessionId } : {}),
          },
        ];
      const p = this.dormant.get(id)?.plan;
      if (!p) return [];
      return [
        {
          key: p.key,
          projectId: p.projectId,
          kind: p.kind,
          ...(p.account ? { account: p.account } : {}),
          ...(p.worktree ? { worktree: p.worktree } : {}),
          ...(p.resumeClaude ? { claudeSessionId: p.resumeClaude } : {}),
          ...(p.resumeCodexId ? { codexSessionId: p.resumeCodexId } : {}),
        },
      ];
    });
  }

  /** Re-save tabs (the layout changed; main writes it with them). */
  saveTabs(): void {
    this.tabsChanged();
  }

  /** Enter in a codex tab that doesn't know its session: codex creates the rollout on the first prompt. */
  private codexSubmitted(s: LiveSession): void {
    s.lastSubmit = Date.now();
    for (const t of this.codexScans) clearTimeout(t);
    this.codexScans = CODEX_SCAN_DELAYS_MS.map((ms) => setTimeout(() => this.scanCodex(), ms));
  }

  private scanCodex(): void {
    if (this.closing) return;
    const open = [...this.sessions.values()].filter((s) => s.kind === 'codex' && !s.codexSessionId);
    if (!open.length) return;
    const claimed = new Set<string>();
    for (const s of this.sessions.values()) if (s.codexSessionId) claimed.add(s.codexSessionId);
    for (const d of this.dormant.values()) if (d.plan.resumeCodexId) claimed.add(d.plan.resumeCodexId);
    const since = Math.min(...open.map((s) => s.spawnedAt));
    const found = assignRollouts(open, findRollouts(since), claimed);
    for (const [id, codexId] of found) {
      const s = this.sessions.get(id);
      if (s) s.codexSessionId = codexId;
    }
    if (found.size) this.tabsChanged();
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
    if (s.sentStatus !== status) {
      s.sentStatus = status;
      s.since = Date.now();
      // A new turn: the old question and answer no longer describe it.
      if (status === 'working') s.details = {};
    }
    const update: StatusUpdate = {
      id: s.id,
      status,
      since: s.since,
      ...(estimated ? { estimated } : {}),
      ...(reason ? { reason } : {}),
    };
    this.deps.send(IPC.sessionStatus, update);
    this.attention.changed(this.attentionView(s));
    this.updateBadge();
  }

  private attentionView(s: LiveSession): AttentionSession {
    const { status, reason } = s.tracker.current();
    const detail = status === 'waiting' || status === 'done' ? s.details[status] : undefined;
    return {
      id: s.id,
      projectName: s.projectName,
      kind: s.kind,
      status,
      since: s.since,
      ...(reason ? { reason } : {}),
      ...(detail ? { detail } : {}),
    };
  }

  /** Dock badge = sessions waiting for the user. */
  private updateBadge(): void {
    let waiting = 0;
    for (const s of this.sessions.values()) if (s.tracker.current().status === 'waiting') waiting++;
    if (waiting === this.badge) return;
    this.badge = waiting;
    setDockBadge(waiting);
  }

  setActive(id: string | null): void {
    this.activeId = id;
  }

  /** The renderer wrote one `session:data` batch into xterm. */
  ack(id: string): void {
    this.sessions.get(id)?.output.ack();
  }

  /** Whether the session's terminal is on screen (any split pane): on-screen output flushes every frame. */
  setVisible(id: string, visible: boolean): void {
    this.sessions.get(id)?.output.setVisible(visible);
  }

  /** Power profile changed: slower timers while saving. */
  setSaver(saver: boolean): void {
    if (this.saver === saver || this.closing) return;
    this.saver = saver;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tickActivity(), saver ? SAVER_TICK_MS : TICK_MS);
    for (const s of this.sessions.values()) s.output.setSaver(saver);
  }

  /** The renderer reloaded: forget unacknowledged batches so no pty stays paused. */
  resetFlow(): void {
    for (const s of this.sessions.values()) s.output.resetFlow();
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

  /** HEAD at spawn of a live session in that project ('' unknown / no commits). */
  startHeadOf(id: string, projectId: string): string {
    const s = this.sessions.get(id);
    return s?.projectId === projectId ? (s.startHead ?? '') : '';
  }

  /** Which transcript holds a live agent tab's replies (T28 "copy last response"); undefined for shells. */
  replySource(
    id: string,
  ): { agent: 'claude'; account?: string; sessionId: string } | { agent: 'codex'; sessionId: string } | undefined {
    const s = this.sessions.get(id);
    if (s?.kind === 'claude' && s.claudeSessionId)
      return { agent: 'claude', sessionId: s.claudeSessionId, ...(s.account ? { account: s.account } : {}) };
    if (s?.kind === 'codex' && s.codexSessionId) return { agent: 'codex', sessionId: s.codexSessionId };
    return undefined;
  }

  has(id: string): boolean {
    return this.sessions.has(id) || this.dormant.has(id);
  }

  /** Keyboard path from the renderer (also xterm's own replies, which the tracker tells apart). */
  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.proc.write(data);
    if (s.kind === 'codex' && !s.codexSessionId && data.includes('\r')) this.codexSubmitted(s);
    if (s.tracker.input(data, Date.now())) this.emitStatus(s);
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.sessions.get(id)?.proc.resize(cols, rows);
  }

  kill(id: string): void {
    const d = this.dormant.get(id);
    if (d) {
      this.dormant.delete(id);
      this.order = this.order.filter((o) => o !== id);
      this.deps.scrollback?.remove(d.plan.key);
      this.tabsChanged();
      return;
    }
    this.sessions.get(id)?.proc.kill();
  }

  killAll(): void {
    this.closing = true;
    clearInterval(this.timer);
    for (const t of this.codexScans) clearTimeout(t);
    this.attention.dispose();
    for (const s of this.sessions.values()) s.proc.kill();
  }
}

function realpath(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}
