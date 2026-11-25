// One pty per session. Runs the user's real `claude` / `codex` / shell — same tokens, same config.
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import type { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import { expand, loadConfig } from './config';
import { assignRollouts, findRollouts } from './codex';
import { binaryFor } from './detect';
import { ensureMcpConfig, figmaArgv } from './figma';
import { headSha } from './git';
import type { HookEvent } from './hooks';
import { OutputBatcher } from './output';
import { SAVER_TICK_MS, TICK_MS } from './power';
import { Attention, firstLine, setDockBadge, type AttentionSession } from './notify';
import { PORT_STEP, worktreeSlot } from './worktrees';
import { formatRestored, newTabKey, planRestore, TITLE_MAX, type RestorePlan, type SavedTab } from './state';
import { logStatus } from './status/log';
import { OSC_7501_REPLY, OscScanner, parse7501 } from './status/osc';
import { StatusTracker } from './status/tracker';
import { isWindows, KILL_GAP_MS, KillQueue, platform, type SessionCommand } from './platform';
import { waitForExits } from './exitWait';
import { sshExec } from './remote/exec';
import { remoteHeadSha } from './remote/git';
import { Reconnector } from './remote/reconnect';
import { killArgs, sessionArgs, SSH_FAILED } from './remote/ssh';
import { translator } from '../src/shared/i18n/dictionary';
import {
  IPC,
  type Config,
  type SessionInfo,
  type SessionKind,
  type SessionStatus,
  type SessionTitleUpdate,
  type StatusUpdate,
  type Worktree,
} from '../src/shared/api/types';

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
  /** The user's title for the tab and the first prompt (T43). */
  title?: string;
  prompt?: string;
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
  /** Remote session (T29): ssh → tmux on that host, reconnected with backoff when ssh drops. */
  remote?: { alias: string; reconnector: Reconnector };
  /** Last size from the renderer (a reconnect spawns ssh at it). */
  cols: number;
  rows: number;
  /** The user closed the tab: its exit is final (no reconnect). */
  killed?: boolean;
  /** The current pty exited (never kill it again: ConPTY throws). */
  exited?: boolean;
}

interface Deps {
  send: (channel: string, payload: unknown) => void;
  getWindow: () => BrowserWindow | null;
  hookPort: number;
  /**
   * `--settings` file for Claude: http hooks, or command hooks for old versions (read at spawn time); with our context
   * statusline unless the user has their own for this folder / config dir.
   */
  hookSettingsPath: (at: { cwd: string; configDir?: string }) => string;
  /** A tab is gone (closed or exited). */
  onEnded?: (id: string) => void;
  /** Raw output of a local tab (T33 looks for dev server addresses in it). */
  onOutput?: (projectId: string, id: string, data: string, worktree?: string) => void;
  /** Open tabs changed (created, closed, Claude session id moved) — persisted by state.ts. */
  onTabsChanged?: (tabs: SavedTab[]) => void;
  scrollback?: ScrollbackStore;
}

/** How to start a session that is being restored after a relaunch. */
export type RestoreOptions = Partial<
  Pick<RestorePlan, 'key' | 'resumeClaude' | 'resumeCodex' | 'resumeCodexId' | 'cold' | 'title' | 'prompt'>
>;

export class SessionManager {
  private sessions = new Map<string, LiveSession>();
  private dormant = new Map<string, DormantTab>();
  /** Tab ids in tab order (live and dormant). */
  private order: string[] = [];
  private codexScans: NodeJS.Timeout[] = [];
  private activeId: string | null = null;
  /** Sessions whose terminal is in a visible pane (any split), reported by the renderer. */
  private visible = new Set<string>();
  private timer: NodeJS.Timeout;
  /** Set on quit so the exits caused by killAll don't wipe the saved tabs. */
  private closing = false;
  private attention: Attention;
  private badge = 0;
  /** Power-saver mode (T9): slower activity tick, hidden output held longer. */
  private saver = false;
  /** ConPTY wants kills one at a time (T19); immediate on macOS. */
  private kills = new KillQueue(KILL_GAP_MS);

  constructor(private deps: Deps) {
    this.timer = setInterval(() => this.tickActivity(), TICK_MS);
    this.attention = new Attention({
      get: (id) => {
        const s = this.sessions.get(id);
        return s && this.attentionView(s);
      },
      onScreen: (id) => this.onScreen(id),
      notifyDone: () => !!loadConfig().notifyDone,
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
      // A remote Claude uses the host's config dir, not a local account.
      ...(plan.kind === 'claude' && !project.remote ? { account: plan.account ?? project.account } : {}),
      ...(plan.worktree ? { worktree: plan.worktree } : {}),
      ...(project.remote ? { remote: project.remote.alias } : {}),
      ...(plan.title ? { title: plan.title } : {}),
      ...(plan.prompt ? { prompt: plan.prompt } : {}),
      dormant: true,
    };
  }

  /**
   * Restarts a live local agent tab so it picks up new spawn options (Figma MCP on/off, T54): the same conversation
   * (`claude --resume` / `codex resume <id>`), account, worktree and title, under a new id in the same tab slot.
   * A Claude tab without a transcript yet starts a new session. Shells and remote tabs are refused.
   */
  reopen(config: Config, id: string): SessionInfo {
    const live = this.sessions.get(id);
    if (!live || live.remote || live.kind === 'shell') throw new Error(`Can't reopen tab ${id}`);
    const tab = this.tabs().find((t) => t.key === live.key);
    const [plan] = tab ? planRestore({ tabs: [tab], legacy: false }, config) : [];
    if (!plan) throw new Error(`Can't reopen tab ${id}`);
    const slot = this.order.indexOf(id);
    const nextId = crypto.randomUUID().slice(0, 8);
    // Take the old tab's slot now; its exit (async) only removes its own id.
    this.order.splice(slot, 1, nextId);
    live.killed = true;
    this.kill(id);
    return this.spawn(
      config,
      nextId,
      plan.projectId,
      plan.kind,
      plan.account,
      { ...plan, key: newTabKey() },
      plan.worktree,
    );
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
    const remote = project.remote;
    const key = restore.key ?? newTabKey();

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AQUILA_TAB_ID: id,
      AQUILA_PORT: String(this.deps.hookPort),
    };
    delete env.CLAUDE_CONFIG_DIR;
    // Project port base (T26): each worktree gets its own range so parallel dev servers don't collide.
    if (project.portBase && !remote) {
      const port = String(project.portBase + (worktree ? PORT_STEP * worktreeSlot(worktree.path) : 0));
      env.PORT = port;
      env.AQUILA_PORT_BASE = port;
    }
    // Account only matters for Claude; codex/shell keep the user's environment as-is.
    if (kind === 'claude' && account?.claudeConfigDir && !remote)
      env.CLAUDE_CONFIG_DIR = expand(account.claudeConfigDir);

    const claudeSessionId = kind === 'claude' ? (restore.resumeClaude ?? crypto.randomUUID()) : undefined;
    const resuming = !!(restore.resumeClaude || restore.resumeCodexId);
    // Remote: ssh runs from home; the project folder is on the host (cd'd into by the remote script).
    const cwd = remote ? os.homedir() : (worktree?.path ?? expand(project.path));
    // Local: the platform's shell for that folder (macOS login shell; Windows pwsh/…/WSL distro, T19).
    const shell = remote ? null : platform.shellFor(cwd);
    // Inside WSL the Windows-side account dir, hook file and Figma config don't apply: log in in the distro.
    const wsl = shell?.kind === 'wsl';
    if (wsl) delete env.CLAUDE_CONFIG_DIR;
    // Figma MCP (T32): local projects only (the server's login lives in this machine's CLI config).
    const figma = !!project.figma && !remote && !wsl && kind !== 'shell';
    if (figma) ensureMcpConfig();
    const command: SessionCommand = {
      argv: this.commandFor(
        kind,
        claudeSessionId,
        restore,
        { cwd, configDir: env.CLAUDE_CONFIG_DIR },
        figma,
        wsl,
      ),
      // A failed resume prints our marker, then the tab drops to the shell as usual (cold restore).
      ...(resuming ? { onFail: RESUME_FAILED } : {}),
      // The setup script runs in the same shell (the user's PATH), visibly, once; the program starts either way.
      ...(setup?.trim()
        ? { setup: { banner: translator(config.language)('settings.setupRunning'), script: setup } }
        : {}),
    };
    const spec = shell
      ? platform.spawnSpec(shell, command, cwd)
      : {
          file: 'ssh',
          args: sessionArgs({
            host: remote!,
            path: project.path,
            tabKey: key,
            kind,
            claudeSessionId,
            resumeClaude: !!restore.resumeClaude,
            resumeCodexId: restore.resumeCodexId,
          }),
          cwd,
        };
    Object.assign(env, spec.env);
    const spawnProc = (cols: number, rows: number) =>
      pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols, rows, cwd: spec.cwd, env });
    const proc = spawnProc(120, 32);

    const now = Date.now();
    const s: LiveSession = {
      id,
      key,
      cwd: remote ? project.path : realpath(cwd),
      spawnedAt: now,
      ...(kind === 'codex' && restore.resumeCodexId ? { codexSessionId: restore.resumeCodexId } : {}),
      ...(resuming ? { resumeUntil: now + RESUME_FAIL_WINDOW_MS } : {}),
      projectId,
      projectName: worktree ? `${project.name} · ${worktree.branch}` : project.name,
      kind,
      account: kind === 'claude' && !remote ? accountId : undefined,
      worktree,
      claudeSessionId,
      ...(restore.title ? { title: restore.title } : {}),
      ...(restore.prompt ? { prompt: restore.prompt } : {}),
      proc,
      // Claude has hooks as its fallback; codex and shells fall back to output activity. Remote Claude has no
      // hooks (they post to 127.0.0.1 here) and tmux drops OSC 7501, so it falls back to output activity too.
      // Claude in WSL gets no hooks either (no `--settings`; NAT mode can't reach 127.0.0.1 here).
      tracker: new StatusTracker(kind !== 'claude' || !!remote || wsl),
      osc: new OscScanner(),
      output: new OutputBatcher({
        send: (data) => this.deps.send(IPC.sessionData, { id, data }),
        pause: () => s.proc.pause(),
        resume: () => s.proc.resume(),
      }),
      sentStatus: 'idle',
      since: Date.now(),
      details: {},
      cols: 120,
      rows: 32,
    };
    this.sessions.set(id, s);
    if (!this.order.includes(id)) this.order.push(id);
    // "Diff since session start" (T25); a remote tab asks the host (T36).
    if (!remote) void headSha(cwd).then((h) => (s.startHead = h));
    else void remoteHeadSha(sshExec, remote, project.path).then((h) => (s.startHead = h));
    s.output.setSaver(this.saver);
    // Cold restore: the last output, read-only, above the fresh shell. A remote tab reattaches to tmux instead.
    if (restore.cold && !remote) this.showSaved(s, config, 'restore.previous');

    if (remote) {
      const reconnector = new Reconnector(
        () => {
          if (this.sessions.get(id) !== s || s.killed || this.closing) return;
          s.output.resetFlow();
          s.proc = spawnProc(s.cols, s.rows);
          s.exited = false;
          this.attach(s);
          reconnector.spawned();
        },
        (state, retryAt) =>
          this.deps.send(IPC.sessionConnection, { id, state, ...(retryAt ? { retryAt } : {}) }),
      );
      s.remote = { alias: remote.alias, reconnector };
    }
    this.attach(s);
    s.remote?.reconnector.spawned();
    this.tabsChanged();
    return this.info(s);
  }

  /** Wires the session's current pty (a remote session gets a new one per reconnect). */
  private attach(s: LiveSession): void {
    const proc = s.proc;
    proc.onData((data) => {
      if (s.proc !== proc) return;
      // OSC 7501 first: the query must be answered before the renderer's xterm answers DA1.
      for (const payload of s.osc.feed(data)) this.onOsc(s, payload);
      s.output.push(data);
      s.tracker.output(Date.now());
      if (!s.remote) this.deps.onOutput?.(s.projectId, s.id, data, s.worktree?.path);
    });
    proc.onExit(({ exitCode, signal }) => {
      if (s.proc !== proc) return;
      s.exited = true;
      // ssh's own failure (connect failed / link lost): keep the tab and retry. Anything else ended the session.
      if (s.remote && exitCode === SSH_FAILED && !s.killed && !this.closing) {
        s.output.flush();
        s.remote.reconnector.dropped();
        return;
      }
      this.ended(s, exitCode, signal);
    });
  }

  private ended(s: LiveSession, exitCode: number, signal?: number): void {
    const { id } = s;
    s.remote?.reconnector.dispose();
    s.output.flush();
    s.output.dispose();
    if (s.tracker.exit(exitCode, signal)) this.emitStatus(s);
    this.deps.send(IPC.sessionExit, { id, exitCode });
    this.sessions.delete(id);
    this.order = this.order.filter((o) => o !== id);
    // The tab is gone for good (not a quit): its saved output too.
    if (!this.closing) this.deps.scrollback?.remove(s.key);
    this.attention.forget(id);
    this.visible.delete(id);
    this.deps.onEnded?.(id);
    this.updateBadge();
    this.tabsChanged();
  }

  private info(s: LiveSession): SessionInfo {
    return {
      id: s.id,
      projectId: s.projectId,
      kind: s.kind,
      ...(s.account ? { account: s.account } : {}),
      ...(s.worktree ? { worktree: s.worktree } : {}),
      ...(s.remote ? { remote: s.remote.alias } : {}),
      ...(s.title ? { title: s.title } : {}),
      ...(s.prompt ? { prompt: s.prompt } : {}),
    };
  }

  /** Names a live or dormant tab (T43); '' (or only spaces) clears it back to the automatic title. */
  rename(id: string, title: string): void {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX).trim() || undefined;
    const target = this.sessions.get(id) ?? this.dormant.get(id)?.plan;
    if (!target || target.title === clean) return;
    target.title = clean;
    this.sendTitle(id, target);
    this.tabsChanged();
  }

  private sendTitle(id: string, t: { title?: string; prompt?: string }): void {
    const update: SessionTitleUpdate = {
      id,
      ...(t.title ? { title: t.title } : {}),
      ...(t.prompt ? { prompt: t.prompt } : {}),
    };
    this.deps.send(IPC.sessionTitle, update);
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

  /** Program + args for an agent tab (unquoted: the platform layer writes them for the shell); null for a shell. */
  private commandFor(
    kind: SessionKind,
    claudeSessionId: string | undefined,
    restore: RestoreOptions,
    at: { cwd: string; configDir?: string },
    figma = false,
    /** Runs inside a WSL distro: the CLI on that distro's PATH, without our Windows-side files. */
    wsl = false,
  ): string[] | null {
    const bin = (tool: 'claude' | 'codex') => (wsl ? tool : binaryFor(tool));
    if (kind === 'claude') {
      // Only uuids reach here (ours or validated from state/hook).
      const session = restore.resumeClaude
        ? ['--resume', claudeSessionId!]
        : ['--session-id', claudeSessionId!];
      if (wsl) return [bin('claude'), ...session];
      const mcp = figma ? figmaArgv('claude') : [];
      return [bin('claude'), '--settings', this.deps.hookSettingsPath(at), ...mcp, ...session];
    }
    if (kind === 'codex') {
      const codex = [bin('codex'), ...(figma ? figmaArgv('codex') : [])];
      // Codex ids are validated uuids (state.ts).
      if (restore.resumeCodexId) return [...codex, 'resume', restore.resumeCodexId];
      return restore.resumeCodex ? [...codex, 'resume', '--last'] : codex;
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
    const slot = msg.fields.state === 'blocked' ? 'waiting' : msg.fields.state === 'done' ? 'done' : null;
    const fresh = !!text && !!slot && s.details[slot] !== text;
    if (text && slot) s.details[slot] = text;
    if (s.tracker.osc(msg.fields, Date.now())) this.emitStatus(s);
    // Same status, new context: the row and the pending notification show it (T52).
    else if (fresh && s.tracker.current().status === slot) this.emitStatus(s);
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
    // The first prompt names the tab until the user does (T43). Later prompts and /clear keep it.
    if (hook.event === 'UserPromptSubmit' && hook.prompt && !s.prompt) {
      s.prompt = hook.prompt;
      this.sendTitle(s.id, s);
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
    else if (slot && hook.detail && s.tracker.current().status === slot) this.emitStatus(s);
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
            ...(s.title ? { title: s.title } : {}),
            ...(s.prompt ? { prompt: s.prompt } : {}),
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
          ...(p.title ? { title: p.title } : {}),
          ...(p.prompt ? { prompt: p.prompt } : {}),
        },
      ];
    });
  }

  /** Re-save tabs (the layout changed; main writes it with them). */
  saveTabs(): void {
    this.tabsChanged();
  }

  /** The renderer reordered its tabs: known ids take that order, the rest keep theirs after them. */
  reorder(ids: string[]): void {
    const known = new Set(this.order);
    const first = [...new Set(ids)].filter((id) => known.has(id));
    const taken = new Set(first);
    const next = [...first, ...this.order.filter((id) => !taken.has(id))];
    if (next.every((id, i) => id === this.order[i])) return;
    this.order = next;
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
    const detail = status === 'waiting' || status === 'done' ? s.details[status] : undefined;
    const update: StatusUpdate = {
      id: s.id,
      status,
      since: s.since,
      ...(estimated ? { estimated } : {}),
      ...(reason ? { reason } : {}),
      ...(detail ? { detail } : {}),
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
      ...(s.title || s.prompt ? { title: s.title || s.prompt } : {}),
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
    const more = waiting > this.badge;
    this.badge = waiting;
    setDockBadge(waiting);
    // Windows has no Dock badge: flash the taskbar button until the window is focused (T19, T15).
    const win = this.deps.getWindow();
    if (isWindows && more && win && !win.isFocused()) win.flashFrame(true);
  }

  setActive(id: string | null): void {
    this.activeId = id;
    this.seen();
  }

  /**
   * The user is looking at it: the window is focused and the session is the focused tab or in any visible
   * split pane (T45). The other pane of a split never notifies.
   */
  onScreen(id: string): boolean {
    return !!this.deps.getWindow()?.isFocused() && (this.activeId === id || this.visible.has(id));
  }

  /** Withdraw the banners of every session now on screen (tab clicked, pane shown, window focused). */
  seen(): void {
    for (const id of this.sessions.keys()) if (this.onScreen(id)) this.attention.viewed(id);
  }

  /** The tab the renderer has focused (smoke checks where the global shortcut landed, T41). */
  get active(): string | null {
    return this.activeId;
  }

  /** Live session ids, oldest first. */
  ids(): string[] {
    return [...this.sessions.keys()];
  }

  /** The renderer wrote one `session:data` batch into xterm. */
  ack(id: string): void {
    this.sessions.get(id)?.output.ack();
  }

  /** Whether the session's terminal is on screen (any split pane): on-screen output flushes every frame. */
  setVisible(id: string, visible: boolean): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.output.setVisible(visible);
    if (visible) this.visible.add(id);
    else this.visible.delete(id);
    this.seen();
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

  /** The local Claude account a tab runs with (T30 usage); undefined for remote, Codex and shell tabs. */
  claudeAccount(id: string): string | undefined {
    const s = this.sessions.get(id);
    return s?.kind === 'claude' && !s.remote ? s.account : undefined;
  }

  /** Which transcript holds a live agent tab's replies (T28 "copy last response"); undefined for shells. */
  replySource(
    id: string,
  ):
    | { agent: 'claude'; account?: string; sessionId: string }
    | { agent: 'codex'; sessionId: string }
    | undefined {
    const s = this.sessions.get(id);
    // Remote transcripts live on the host.
    if (s?.remote) return undefined;
    if (s?.kind === 'claude' && s.claudeSessionId)
      return { agent: 'claude', sessionId: s.claudeSessionId, ...(s.account ? { account: s.account } : {}) };
    if (s?.kind === 'codex' && s.codexSessionId) return { agent: 'codex', sessionId: s.codexSessionId };
    return undefined;
  }

  /** T72: the agent conversation of every live local tab that has one yet. */
  agentIds(): { tabId: string; agent: 'claude' | 'codex'; sessionId: string }[] {
    const out: { tabId: string; agent: 'claude' | 'codex'; sessionId: string }[] = [];
    for (const tabId of this.sessions.keys()) {
      const src = this.replySource(tabId);
      if (src) out.push({ tabId, agent: src.agent, sessionId: src.sessionId });
    }
    return out;
  }

  has(id: string): boolean {
    return this.sessions.has(id) || this.dormant.has(id);
  }

  /** Keyboard path from the renderer (also xterm's own replies, which the tracker tells apart). */
  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    // A remote tab waiting to reconnect has no live ssh.
    if (!s || s.remote?.reconnector.waiting) return;
    s.proc.write(data);
    if (s.kind === 'codex' && !s.codexSessionId && !s.remote && data.includes('\r')) this.codexSubmitted(s);
    if (s.tracker.input(data, Date.now())) this.emitStatus(s);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || !(cols > 0 && rows > 0)) return;
    s.cols = cols;
    s.rows = rows;
    if (!s.remote?.reconnector.waiting) s.proc.resize(cols, rows);
  }

  /** "Reconnect now" on a remote tab that is waiting for its next attempt. */
  reconnect(id: string): void {
    this.sessions.get(id)?.remote?.reconnector.now();
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
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.remote) {
      s.killed = true;
      // Closing the tab ends its tmux session on the host too (a quit doesn't: relaunch reattaches).
      execFile('ssh', killArgs(s.remote.alias, s.key), { timeout: 20_000 }, () => undefined);
      if (s.remote.reconnector.waiting) return this.ended(s, 0);
    }
    const proc = s.proc;
    this.kills.kill(proc, () => s.exited === true || s.proc !== proc);
  }

  /** Set by the first killAll: later calls (a re-run quit) get the same wait. */
  private killingAll: Promise<void> | null = null;

  /**
   * Ends every session for a quit. Resolves once their ptys have exited (bounded, see exitWait.ts): exit the app
   * only after that, or node-pty's exit callback can land in a torn-down Node and abort the process.
   */
  killAll(): Promise<void> {
    if (this.killingAll) return this.killingAll;
    this.closing = true;
    clearInterval(this.timer);
    for (const t of this.codexScans) clearTimeout(t);
    this.attention.dispose();
    const pids: number[] = [];
    const procs: pty.IPty[] = [];
    for (const s of this.sessions.values()) {
      s.remote?.reconnector.dispose();
      if (s.exited) continue;
      pids.push(s.proc.pid);
      procs.push(s.proc);
      try {
        s.proc.kill();
      } catch {
        // already exited (a remote tab waiting to reconnect)
      }
    }
    // Windows: end each session's whole process tree, so no conhost / agent is left behind after quit.
    if (isWindows && pids.length)
      try {
        execFileSync('taskkill', ['/F', '/T', ...pids.flatMap((p) => ['/PID', String(p)])], {
          timeout: 3_000,
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        // some were already gone
      }
    this.killingAll = waitForExits(procs, isWindows ? {} : { forceSignal: 'SIGKILL' });
    return this.killingAll;
  }
}

function realpath(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}
