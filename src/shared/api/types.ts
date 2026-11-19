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
  | { op: 'addProject'; path: string; name: string; group: string; account: string }
  | { op: 'updateProject'; id: string; name?: string; group?: string; account?: string }
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
  /** Branch checked out in the project dir ('' when detached); new branches start from it. */
  current: string;
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
  gitChanges(projectId: string, sessionId?: string): Promise<GitChanges>;
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
  copyText(text: string): void;
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
  /** Current power profile (battery / throttling / thermal). */
  powerState(): Promise<PowerState>;
  onPower(cb: (p: PowerState) => void): Unsubscribe;
}

/** IPC channel names — single source for main, preload and renderer. */
export const IPC = {
  configGet: 'config:get',
  configOpen: 'config:open',
  configSetLanguage: 'config:set-language',
  configSetProjectAccount: 'config:set-project-account',
  configEditProjects: 'config:edit-projects',
  dialogPickFolder: 'dialog:pick-folder',
  uiContextMenu: 'ui:context-menu',
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
  powerGet: 'power:get',
  powerChanged: 'power:changed',
} as const;
