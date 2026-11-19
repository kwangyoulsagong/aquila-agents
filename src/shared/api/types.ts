// Types shared by the main process (electron/) and the renderer (src/). Keep this file dependency-free.

export type SessionKind = 'claude' | 'codex' | 'shell';
export type SessionStatus = 'working' | 'waiting' | 'done' | 'error' | 'idle';
export type HookStatus = Extract<SessionStatus, 'working' | 'waiting' | 'done'>;

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

export interface SessionInfo {
  id: string;
  projectId: string;
  kind: SessionKind;
  /** Account the session was started with (claude sessions only). */
  account?: string;
}

export interface Session extends SessionInfo {
  status: SessionStatus;
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

export type Unsubscribe = () => void;

/** API exposed on window.aquila by electron/preload.ts. */
export interface AquilaApi {
  getConfig(): Promise<Config>;
  openConfig(): Promise<string>;
  setLanguage(language: Language): Promise<Config>;
  setProjectAccount(projectId: string, account: string): Promise<Config>;
  /** `account` overrides the project's account for this one session (setup opens a Claude login with it). */
  createSession(projectId: string, kind: SessionKind, account?: string): Promise<SessionInfo>;
  /** Reopens the tabs saved at the last quit (~/.aquila/state.json), once per launch; later calls return the live ones. */
  restoreSessions(): Promise<SessionInfo[]>;
  accountsStatus(): Promise<Record<string, AccountStatus>>;
  /** Creates the account's config dir. */
  prepareAccount(account: string): Promise<AccountStatus>;
  shellFunctionPreview(account: string): Promise<ShellFunctionPreview>;
  /** Appends the previewed function to ~/.zshrc unless already defined. Explicit click only. */
  installShellFunction(account: string): Promise<ShellFunctionPreview>;
  /** Branch, changed files and diff of the project's dir (read-only). */
  gitChanges(projectId: string): Promise<GitChanges>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  markSeen(id: string): void;
  setActive(id: string | null): void;
  onData(cb: (p: { id: string; data: string }) => void): Unsubscribe;
  onStatus(cb: (p: { id: string; status: SessionStatus }) => void): Unsubscribe;
  onExit(cb: (p: { id: string; exitCode: number }) => void): Unsubscribe;
  onFocusSession(cb: (p: { id: string }) => void): Unsubscribe;
}

/** IPC channel names — single source for main, preload and renderer. */
export const IPC = {
  configGet: 'config:get',
  configOpen: 'config:open',
  configSetLanguage: 'config:set-language',
  configSetProjectAccount: 'config:set-project-account',
  sessionCreate: 'session:create',
  sessionRestore: 'session:restore',
  accountsStatus: 'accounts:status',
  accountsPrepare: 'accounts:prepare',
  accountsShellPreview: 'accounts:shell-preview',
  accountsShellInstall: 'accounts:shell-install',
  gitChanges: 'git:changes',
  sessionWrite: 'session:write',
  sessionResize: 'session:resize',
  sessionKill: 'session:kill',
  sessionSeen: 'session:seen',
  uiActive: 'ui:active',
  sessionData: 'session:data',
  sessionStatus: 'session:status',
  sessionExit: 'session:exit',
  uiFocusSession: 'ui:focus-session',
} as const;
