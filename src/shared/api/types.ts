// Types shared by the main process (electron/) and the renderer (src/). Keep this file dependency-free.

export type SessionKind = 'claude' | 'codex' | 'shell';
/** `stopped` = the user interrupted (Esc / Ctrl+C) or the program exited normally; `error` = it failed. */
export type SessionStatus = 'working' | 'waiting' | 'done' | 'error' | 'stopped' | 'idle';
/** Why a session is `error`: an API failure Claude reported (StopFailure), a non-zero exit, or unknown. */
export type ErrorReason = 'rateLimit' | 'auth' | 'billing' | 'server' | 'exit' | 'other';

/** What main sends on `session:status`. */
export interface StatusUpdate {
  id: string;
  status: SessionStatus;
  /** Guessed from output activity, not reported by the program (shown dimmed). */
  estimated?: boolean;
  reason?: ErrorReason;
  /** When this status started (ms since epoch) — "waiting for 12 min". */
  since?: number;
}

export type Language = 'ko' | 'en';

/**
 * A Claude login. `shared` = plain `claude` (~/.claude), `personal` = `claude-personal` (~/.claude-personal).
 * `label` is optional: when absent the UI shows the translated name for known ids (shared/personal).
 */
export interface Account {
  label?: string;
  /** null = Claude default (~/.claude, CLAUDE_CONFIG_DIR unset). */
  claudeConfigDir: string | null;
}

/** What `accounts:status` reports per account. */
export interface AccountStatus {
  /** ~/.claude for shared, the account's claudeConfigDir otherwise. */
  configDirExists: boolean;
  /** `.claude.json` has `oauthAccount` (shared: ~/.claude.json, others: <dir>/.claude.json). */
  loggedIn: boolean;
}

/** The zsh function that runs Claude with an account, e.g. `claude-personal`. */
export interface ShellFunctionPreview {
  name: string;
  rcPath: string;
  /** Exact line that would be appended. */
  snippet: string;
  /** Already a function/alias in the user's shell: nothing will be written. */
  defined: boolean;
}

export interface Group {
  id: string;
  /** Optional: translated name is used for known ids (work/personal). */
  label?: string;
}

export interface Project {
  id: string;
  name: string;
  group: string;
  account: string;
  path: string;
  /** What the tab bar's + and the empty state open first (default Claude). */
  defaultAgent?: SessionKind;
  /** New worktree branches start from it (default: the branch checked out in the project dir). */
  defaultBranch?: string;
  /** Runs once in a new worktree before the agent starts (`zsh -c`). */
  setupScript?: string;
  /** Sessions get `PORT` / `AQUILA_PORT_BASE` = this; each worktree +10. */
  portBase?: number;
  /** macOS app name for "Open in" (`open -a <app>`), e.g. "Visual Studio Code". */
  openIn?: string;
  /** Runs on an SSH host (T29): `path` is then the folder on that host (`~/…` = the remote home). */
  remote?: RemoteHost;
  /** Sessions get the official Figma MCP (T32). Local projects only. */
  figma?: boolean;
}

/** Where a remote project runs (T29). Uses the user's `~/.ssh/config` and ssh-agent; nothing secret is stored. */
export interface RemoteHost {
  /** Host alias from `~/.ssh/config` (or `user@host`). */
  alias: string;
  /** `CLAUDE_CONFIG_DIR` on the host for Claude sessions (`~/…` = the remote home); unset = Claude's default. */
  claudeConfigDir?: string;
}

/** Connection of a remote session: up, retrying with backoff, or retrying for a while without luck. */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'lost';

export interface ConnectionUpdate {
  id: string;
  state: ConnectionState;
  /** Next automatic attempt (ms since epoch) while reconnecting / lost. */
  retryAt?: number;
}

export type RemoteToolId = 'claude' | 'codex' | 'tmux' | 'git';

/** What `remote:check` found on a host. Install commands are only shown, never run. */
export interface RemoteCheck {
  /** ssh connected without asking for anything (BatchMode). */
  reachable: boolean;
  /** ssh's own message when it didn't. */
  error?: string;
  /** `uname -sm`, e.g. "Linux x86_64". */
  system?: string;
  tools: { tool: RemoteToolId; path?: string; version?: string; install: string }[];
  /** Claude has a login in its config dir on the host; undefined when Claude is missing. */
  claudeLoggedIn?: boolean;
  /** systemd-logind `KillUserProcesses=yes`: tmux sessions die when the last ssh login ends. */
  killUserProcesses?: boolean;
}

/** Allowed `portBase` range (each worktree adds 10). */
export const PORT_BASE_MIN = 1024;
export const PORT_BASE_MAX = 65000;

/** Settings from the project settings dialog. Empty string / null clears an optional one. */
export interface ProjectSettings {
  name?: string;
  group?: string;
  account?: string;
  /** Absolute (folder picker); stored as `~/…` when under home. */
  path?: string;
  defaultAgent?: SessionKind | null;
  defaultBranch?: string;
  setupScript?: string;
  portBase?: number | null;
  openIn?: string;
  /** Remote project only: host alias / remote Claude config dir ('' clears it). `path` is then sent as typed. */
  remote?: { alias: string; claudeConfigDir: string };
  /** Figma MCP on/off (T32). */
  figma?: boolean;
}

export interface Config {
  language: Language;
  accounts: Record<string, Account>;
  groups: Group[];
  projects: Project[];
  error?: string;
}

/** One change to the project list, made from the sidebar. Main applies it to ~/.aquila/config.json. */
export type ProjectEdit =
  /** `path` is absolute (folder picker); stored as `~/…` when under home. Empty name = folder name. */
  | { op: 'addProject'; path: string; name: string; group: string; account: string; remote?: RemoteHost }
  | ({ op: 'updateProject'; id: string } & ProjectSettings)
  | { op: 'removeProject'; id: string }
  /** `index` = position among the target group's other projects (past the end = last). */
  | { op: 'moveProject'; id: string; group: string; index: number }
  | { op: 'addGroup'; label: string }
  /** Empty label = back to the translated name (work/personal) or the id. */
  | { op: 'renameGroup'; id: string; label: string }
  /** Only an empty group is removed. */
  | { op: 'removeGroup'; id: string }
  | { op: 'moveGroup'; id: string; index: number };

/** A native context-menu item. Clicking one resolves `showContextMenu` with its `id`. */
export interface ContextMenuItem {
  id?: string;
  label?: string;
  enabled?: boolean;
  checked?: boolean;
  /** Shortcut shown next to the label (Electron accelerator from `shared/lib/shortcuts.ts`); display only. */
  accelerator?: string;
  separator?: boolean;
  submenu?: ContextMenuItem[];
}

/** A git worktree a session runs in instead of the project dir (T7). */
export interface Worktree {
  /** Absolute path of the worktree. */
  path: string;
  branch: string;
}

/** What `worktree:info` reports for a project, for the "New Claude in worktree" dialog. */
export interface WorktreeInfo {
  isRepo: boolean;
  /** Main worktree of the repo. */
  repoRoot: string;
  /** Where new worktrees go: `<parent>/<repo>-wt` (a branch `a/b` lands in `<root>/a/b`). */
  root: string;
  /** Branch checked out in the project dir ('' when detached). */
  current: string;
  /** New branches start from it: the project's default branch if it exists, else `current`. */
  base: string;
  /** Local branches. */
  branches: string[];
  /** Worktrees that have a branch checked out (incl. the main one); opening that branch reuses it. */
  worktrees: Worktree[];
}

export interface SessionInfo {
  id: string;
  projectId: string;
  kind: SessionKind;
  /** Account the session was started with (claude sessions only). */
  account?: string;
  /** Runs in this worktree instead of the project dir. */
  worktree?: Worktree;
  /** Restored but not spawned yet: starts on first show (`startSession`). */
  dormant?: boolean;
  /** SSH host alias of a remote session (T29). */
  remote?: string;
}

/** A split layout as saved across launches: the pane tree with session ids, and the focused pane's index. */
export type SavedPane =
  | { kind: 'leaf'; sessionId: string | null }
  /** `ratio` = share of the split that `a` takes (missing = half). */
  | { kind: 'split'; dir: 'row' | 'column'; a: SavedPane; b: SavedPane; ratio?: number };

export interface SavedLayout {
  root: SavedPane;
  /** Index of the focused pane among the leaves (left to right / top to bottom). */
  focused: number;
}

/** What `restoreSessions` returns: the tabs (on-screen ones spawned, the rest dormant) and the saved layout. */
export interface RestoreResult {
  sessions: SessionInfo[];
  layout: SavedLayout | null;
}

export interface Session extends SessionInfo {
  status: SessionStatus;
  estimated?: boolean;
  reason?: ErrorReason;
  /** When the current status started (ms since epoch). */
  since?: number;
  exited?: boolean;
  /** Remote sessions: connection state and the next automatic retry. */
  connection?: ConnectionState;
  retryAt?: number;
}

/** One changed file from `git status --porcelain=v1`. */
export interface GitFileChange {
  path: string;
  /** Rename/copy source. */
  origPath?: string;
  /** Porcelain X (index) and Y (worktree) columns. */
  index: string;
  worktree: string;
  /** One letter for the list: M A D R C U ?. */
  status: string;
}

/** What `git:changes` reports for a project dir. */
export interface GitChanges {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  /** Unified diff vs HEAD (+ untracked files), capped at 400 KB. */
  diff: string;
  truncated: boolean;
  /** Commit the diff is against: HEAD, or the session's start commit for scope 'session' (T25). '' without commits. */
  base?: string;
  /** When main last checked the tree (ms since epoch). */
  checkedAt?: number;
}

/** What the changes panel diffs against: HEAD (working tree), or the commit HEAD was at when the session spawned. */
export type GitScope = 'worktree' | 'session';

/** Which tree the changes panel looks at: a project's dir, or the worktree/start commit of one of its sessions. */
export interface GitTarget {
  projectId: string;
  sessionId?: string;
}

/** A stage/revert from the changes panel (T25). Hunk actions carry the hunk as a patch against HEAD. */
export interface GitAction extends GitTarget {
  action: 'stage-file' | 'unstage-file' | 'revert-file' | 'stage-hunk' | 'revert-hunk';
  path: string;
  /** Rename source: reverting a rename restores it too. */
  origPath?: string;
  patch?: string;
}

/** Where the state before a revert went: a `git stash` entry (sha) and/or untracked files moved to the Trash. */
export interface GitActionResult {
  stash?: string;
  trashed?: string[];
}

/** A CLI the first-run checklist looks for (T17). */
export type ToolId = 'claude' | 'codex' | 'git';

export interface ToolCheck {
  tool: ToolId;
  /** Found and `--version` ran. */
  found: boolean;
  /** Resolved binary (also set when it exists but didn't run). */
  path?: string;
  version?: string;
  /** Path the user picked in the checklist, used instead of PATH. */
  override?: string;
  /** Copyable install command (macOS). */
  install: string;
  /** A picked path that didn't run `--version`; it was not saved. */
  rejected?: string;
}

/** What `first-run:get` reports. */
export interface FirstRunReport {
  /** The checklist hasn't been closed yet: open it at launch. */
  pending: boolean;
  /** The login shell's PATH was read (Finder launches start with a minimal one). */
  pathRestored: boolean;
  tools: ToolCheck[];
}

/** In-app guide (T23): the "Take a tour" offer after the first-run checklist was shown. */
export interface GuideState {
  offered: boolean;
}

/** macOS thermal pressure (Electron `powerMonitor.getCurrentThermalState`). */
export type ThermalState = 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';

/** What `power:get` / `power:changed` report (T9). */
export interface PowerState {
  onBattery: boolean;
  thermal: ThermalState;
  /** CPU speed limit in percent (100 = not throttled). */
  speedLimit: number;
  /** Use less power: on battery, throttled, or hot. No cursor blink, no looping animations, slower polling. */
  saver: boolean;
}

/** One usage window of an account (T30), estimated from local transcripts. */
export interface UsageWindow {
  /** Weighted tokens in the window (input-token equivalents: output ×5, cache write ×1.25, cache read ×0.1). */
  used: number;
  /** Learned 100% mark: what was used when this account last hit a rate limit. null until one was seen. */
  limit: number | null;
  /** When the window ends (epoch ms). 5h: block start + 5h, null when no block is running. Weekly: always null (rolling). */
  resetsAt: number | null;
}

/** What `usage:get` / `usage:changed` report per logged-in local Claude account (T30). */
export interface AccountUsage {
  account: string;
  fiveHour: UsageWindow;
  weekly: UsageWindow;
  /** At or past 90% of a learned limit in either window. */
  near: boolean;
}

/** Context window use of a Claude tab (T31), from the statusline JSON Claude hands our statusline command. */
export interface ContextUsage {
  /** 0–100. */
  percent: number;
  usedTokens: number;
  /** 0 when Claude didn't say. */
  windowTokens: number;
}

/** `context:changed`: a tab's latest context use; null = none any more (Claude ended in that tab). */
export interface ContextUpdate {
  id: string;
  usage: ContextUsage | null;
}

/** Session history (T11): which CLI a past session belongs to. */
export type HistoryAgent = 'claude' | 'codex';

/** Names a past session; main looks it up in its own index, never trusting a path from the renderer. */
export interface HistoryRef {
  agent: HistoryAgent;
  id: string;
}

/** One past session in the ⌘Y panel. */
export interface HistoryEntry extends HistoryRef {
  /** Folder recorded inside the transcript (sessions are grouped by it). */
  cwd: string;
  branch?: string;
  /** Claude account whose config dir holds the transcript. */
  account?: string;
  /** Name given in the panel (~/.aquila/history.json). */
  name?: string;
  /** The CLI's own name: Claude `/rename`, codex thread name. */
  title?: string;
  /** Claude's auto-generated title. */
  autoTitle?: string;
  firstMessage: string;
  startedAt: number;
  /** Last activity (ms since epoch). */
  updatedAt: number;
  /** User + assistant messages. */
  messages: number;
  favorite: boolean;
  /** Project whose folder (or worktree next to it) holds `cwd`. */
  projectId?: string;
  /** Claude deletes the transcript around then (`cleanupPeriodDays` after its last write). */
  expiresAt?: number;
}

export interface HistoryList {
  /** Most recent first. */
  entries: HistoryEntry[];
  /** Claude's `cleanupPeriodDays` per account (30 when unset; 0 = never). */
  cleanupDays: Record<string, number>;
}

/** A full-text hit: the session and a line around the first match. */
export interface HistoryMatch extends HistoryRef {
  snippet: string;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
  at?: number;
}

/** The start of a past session's conversation (the panel's preview; ~200k characters). */
export interface HistoryTranscript {
  messages: TranscriptMessage[];
  truncated: boolean;
}

/** A resumed past session; `config` when its folder was added as a project first. */
export interface HistoryResumeResult {
  session: SessionInfo;
  config?: Config;
}

export type Unsubscribe = () => void;

/** API exposed on window.aquila by electron/preload.ts. */
export interface AquilaApi {
  getConfig(): Promise<Config>;
  openConfig(): Promise<string>;
  setLanguage(language: Language): Promise<Config>;
  setProjectAccount(projectId: string, account: string): Promise<Config>;
  /** Add/rename/move/remove projects and groups; returns the saved config. */
  editProjects(edit: ProjectEdit): Promise<Config>;
  /** Native folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** Project whose folder is `path` (absolute or `~/…`), for the duplicate-folder warning; null when none. */
  projectForPath(path: string): Promise<string | null>;
  /** Opens the project folder in its "Open in" app (Finder when unset). */
  openProjectIn(projectId: string): Promise<void>;
  /** Native context menu at the cursor; resolves with the clicked item's id, or null. */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  /** `account` overrides the project's account for this one session (setup opens a Claude login with it). */
  createSession(projectId: string, kind: SessionKind, account?: string): Promise<SessionInfo>;
  /**
   * Opens a session in the worktree of `branch`: reuses the one that has it checked out, else
   * `git worktree add` at `../<repo>-wt/<branch>` (new branch from the project's current HEAD if needed).
   */
  createWorktreeSession(projectId: string, branch: string, kind: SessionKind): Promise<SessionInfo>;
  /** Repo root, current branch, local branches and worktrees of the project (read-only). */
  worktreeInfo(projectId: string): Promise<WorktreeInfo>;
  /**
   * Reopens the tabs saved at the last quit (~/.aquila/state.json), once per launch; later calls return the live ones.
   * Tabs in the saved layout's panes are spawned, the others come back `dormant`.
   */
  restoreSessions(): Promise<RestoreResult>;
  /** Spawns a dormant restored tab (same id). */
  startSession(id: string): Promise<SessionInfo>;
  /** The split layout changed (saved with the tabs). */
  saveLayout(layout: SavedLayout): void;
  /** Plain-text snapshot of a terminal's output, shown read-only if the tab can't resume after a relaunch. */
  saveScrollback(id: string, text: string): void;
  accountsStatus(): Promise<Record<string, AccountStatus>>;
  /** Creates the account's config dir. */
  prepareAccount(account: string): Promise<AccountStatus>;
  shellFunctionPreview(account: string): Promise<ShellFunctionPreview>;
  /** Appends the previewed function to ~/.zshrc unless already defined. Explicit click only. */
  installShellFunction(account: string): Promise<ShellFunctionPreview>;
  /**
   * Branch, changed files and diff of the project's dir (read-only). With `sessionId` of a worktree session in
   * that project, of its worktree instead.
   */
  gitChanges(projectId: string, sessionId?: string, scope?: GitScope): Promise<GitChanges>;
  /** Watch that tree (fs.watch, debounced) and emit `onGitChanged`; null stops. One watch at a time. */
  gitWatch(target: GitTarget | null): void;
  onGitChanged(cb: () => void): Unsubscribe;
  /** Stage / unstage / revert a file or a hunk. Reverts back up first (stash entry, untracked files to the Trash). */
  gitAction(action: GitAction): Promise<GitActionResult>;
  /** Past Claude / Codex sessions (read-only scan; files already read are cached). */
  historyList(): Promise<HistoryList>;
  /** Full-text search over the indexed transcripts. */
  historySearch(query: string): Promise<HistoryMatch[]>;
  historyTranscript(ref: HistoryRef): Promise<HistoryTranscript>;
  /** Name (empty = back to the CLI's name) or favorite, saved in ~/.aquila/history.json. */
  historySetMeta(
    ref: HistoryRef,
    change: { name?: string | null; favorite?: boolean },
  ): Promise<HistoryEntry | null>;
  /** Save dialog → the whole conversation as Markdown. Resolves with the path, or null when cancelled. */
  historyExport(ref: HistoryRef): Promise<string | null>;
  /**
   * New tab resuming the session by id (`claude --resume <id>` with its account / `codex resume <id>`) in its folder.
   * `addProject`: its folder isn't a project yet — add it first.
   */
  historyResume(ref: HistoryRef, addProject?: boolean): Promise<HistoryResumeResult>;
  /** First-run checklist: PATH and CLI checks. `recheck` reads the login shell's PATH again first (after an install). */
  firstRun(recheck?: boolean): Promise<FirstRunReport>;
  /** The checklist was closed (done or skipped): don't open it at launch again. */
  finishFirstRun(): Promise<void>;
  /** File picker for a CLI binary; saved only if it runs. null when cancelled. */
  pickBinary(tool: ToolId): Promise<ToolCheck | null>;
  /** Forget the picked binary, back to PATH. */
  resetBinary(tool: ToolId): Promise<ToolCheck>;
  /** Whether the "Take a tour" offer was shown already (~/.aquila/guide.json). */
  guideState(): Promise<GuideState>;
  /** The offer was shown (or the guide opened): never offer it again. */
  markGuideOffered(): Promise<void>;
  /** Absolute path of a dropped `File` (Electron's webUtils; typed loosely because main has no DOM types). */
  pathForFile(file: object): string;
  /** Plain text to the clipboard (through main: Electron 45 has no clipboard module in the preload). */
  copyText(text: string): void;
  /**
   * Files on the clipboard as absolute paths (T28 ⌘V): copied Finder files as they are, an image saved as a temp PNG.
   * Empty when the clipboard holds neither.
   */
  clipboardPaths(): Promise<string[]>;
  /** Text of the last agent reply in a Claude/Codex tab, from its transcript (read-only). null when there is none. */
  lastReply(sessionId: string): Promise<string | null>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  markSeen(id: string): void;
  setActive(id: string | null): void;
  /** xterm finished writing one `onData` batch (flow control: main pauses the pty while batches pile up). */
  ackData(id: string): void;
  /** The session's terminal came on / went off screen (output is batched less often while hidden). */
  setVisible(id: string, visible: boolean): void;
  onData(cb: (p: { id: string; data: string }) => void): Unsubscribe;
  onStatus(cb: (p: StatusUpdate) => void): Unsubscribe;
  onExit(cb: (p: { id: string; exitCode: number }) => void): Unsubscribe;
  onFocusSession(cb: (p: { id: string }) => void): Unsubscribe;
  /** Host aliases from `~/.ssh/config` (no wildcards), for the remote project form. */
  sshHosts(): Promise<string[]>;
  /** Connects once (BatchMode) and reports OS, CLIs, tmux, git and the Claude login on the host. */
  checkRemote(host: RemoteHost): Promise<RemoteCheck>;
  /** Retry a remote session's connection now instead of waiting for the backoff. */
  reconnect(id: string): void;
  onConnection(cb: (p: ConnectionUpdate) => void): Unsubscribe;
  /** Current power profile (battery / throttling / thermal). */
  powerState(): Promise<PowerState>;
  onPower(cb: (p: PowerState) => void): Unsubscribe;
  /** Estimated 5-hour and weekly usage per account (T30). */
  usage(): Promise<AccountUsage[]>;
  onUsage(cb: (u: AccountUsage[]) => void): Unsubscribe;
  /** Context use per Claude tab (T31); tabs whose user has their own statusline report nothing. */
  contextUsage(): Promise<ContextUpdate[]>;
  onContext(cb: (u: ContextUpdate) => void): Unsubscribe;
  /** Cached Figma profiles per account (T32). */
  figmaProfiles(): Promise<Record<string, FigmaProfile>>;
  /** Runs the hidden `whoami` check for this account and caches it (takes a few seconds). */
  figmaConnect(account: string): Promise<FigmaProfile>;
  /** Opens Figma's MCP docs in the browser. */
  figmaOpenDocs(): Promise<void>;
}

/** One Figma team/org from `whoami` (T32). Fields the tool didn't give are 'unknown'. */
export interface FigmaPlan {
  name: string;
  tier: string;
  seat: string;
}

/** Cached result of "Connect" (T32), per local Claude account, in `~/.aquila/figma-profile.json`. */
export interface FigmaProfile {
  /** needsAuth: the Figma server isn't logged in for this account yet (`/mcp` in a Claude tab). */
  state: 'connected' | 'needsAuth' | 'error';
  checkedAt: number;
  email?: string;
  handle?: string;
  plans: FigmaPlan[];
  error?: string;
}

/** IPC channel names — single source for main, preload and renderer. */
export const IPC = {
  configGet: 'config:get',
  configOpen: 'config:open',
  configSetLanguage: 'config:set-language',
  configSetProjectAccount: 'config:set-project-account',
  configEditProjects: 'config:edit-projects',
  dialogPickFolder: 'dialog:pick-folder',
  configProjectForPath: 'config:project-for-path',
  projectOpenIn: 'project:open-in',
  uiContextMenu: 'ui:context-menu',
  clipboardPaths: 'clipboard:paths',
  clipboardWrite: 'clipboard:write',
  sessionLastReply: 'session:last-reply',
  sessionCreate: 'session:create',
  sessionRestore: 'session:restore',
  sessionStart: 'session:start',
  layoutSave: 'layout:save',
  sessionScrollback: 'session:scrollback',
  sessionCreateWorktree: 'session:create-worktree',
  worktreeInfo: 'worktree:info',
  accountsStatus: 'accounts:status',
  accountsPrepare: 'accounts:prepare',
  accountsShellPreview: 'accounts:shell-preview',
  accountsShellInstall: 'accounts:shell-install',
  gitChanges: 'git:changes',
  gitWatch: 'git:watch',
  gitChanged: 'git:changed',
  gitAction: 'git:action',
  historyList: 'history:list',
  historySearch: 'history:search',
  historyTranscript: 'history:transcript',
  historySetMeta: 'history:set-meta',
  historyExport: 'history:export',
  historyResume: 'history:resume',
  firstRunGet: 'first-run:get',
  firstRunFinish: 'first-run:finish',
  firstRunPickBinary: 'first-run:pick-binary',
  firstRunResetBinary: 'first-run:reset-binary',
  guideGet: 'guide:get',
  guideOffered: 'guide:offered',
  sessionWrite: 'session:write',
  sessionResize: 'session:resize',
  sessionKill: 'session:kill',
  sessionSeen: 'session:seen',
  uiActive: 'ui:active',
  sessionAck: 'session:ack',
  sessionVisible: 'session:visible',
  sessionData: 'session:data',
  sessionStatus: 'session:status',
  sessionExit: 'session:exit',
  uiFocusSession: 'ui:focus-session',
  remoteHosts: 'remote:hosts',
  remoteCheck: 'remote:check',
  remoteReconnect: 'remote:reconnect',
  sessionConnection: 'session:connection',
  powerGet: 'power:get',
  powerChanged: 'power:changed',
  usageGet: 'usage:get',
  usageChanged: 'usage:changed',
  contextGet: 'context:get',
  contextChanged: 'context:changed',
  figmaProfiles: 'figma:profiles',
  figmaConnect: 'figma:connect',
  figmaOpenDocs: 'figma:open-docs',
} as const;
