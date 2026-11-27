// Types shared by the main process (electron/) and the renderer (src/). Keep this file dependency-free
// (type-only imports are erased: the shortcut ids of the app menu, T47).
import type { ShortcutId } from '../lib/shortcuts';

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
  /** What it waits on ("Bash: npm install") or the last answer's first line (done) — the notification detail (T52). */
  detail?: string;
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
  /** Run slot (T60): named commands started apart from the agent. None = `npm run dev` when package.json has it. */
  runCommands?: RunCommand[];
}

/** A named command of the run slot (T60), e.g. `{ name: 'web', command: 'npm run dev' }`. */
export interface RunCommand {
  name: string;
  command: string;
  /**
   * Text that means "healthy again" for this command (case-insensitive substring), on top of the built-in watcher
   * lines — for tools that print none of them. Written as `# ready: Listening on` after the command in settings.
   */
  ready?: string;
}

/** Where a remote project runs (T29). Uses the user's `~/.ssh/config` and ssh-agent; nothing secret is stored. */
export interface RemoteHost {
  /** Host alias from `~/.ssh/config` (or `user@host`). */
  alias: string;
  /** `CLAUDE_CONFIG_DIR` on the host for Claude sessions (`~/…` = the remote home); unset = Claude's default. */
  claudeConfigDir?: string;
}

/** Built-in sidebar group for SSH projects ("원격" / "Remote"). Remote projects live there and only there. */
export const REMOTE_GROUP = 'remote';

/** A remote project belongs in the Remote group, a local one anywhere else. */
export const fitsGroup = (remote: boolean, group: string): boolean => (group === REMOTE_GROUP) === remote;

/** Connection of a remote session: up, retrying with backoff, or retrying for a while without luck. */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'lost';

export interface ConnectionUpdate {
  id: string;
  state: ConnectionState;
  /** Next automatic attempt (ms since epoch) while reconnecting / lost. */
  retryAt?: number;
}

export type RemoteToolId = 'claude' | 'codex' | 'tmux' | 'git';

/** Folders in one directory on an SSH host (T56 folder picker). */
export interface RemoteDirList {
  /** Absolute path on the host (`~` resolved); as asked when it doesn't exist. */
  path: string;
  exists: boolean;
  dirs: { name: string; repo: boolean }[];
}

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
  /** Run slot commands (T60); empty = the default. */
  runCommands?: RunCommand[];
}

export interface Config {
  language: Language;
  accounts: Record<string, Account>;
  groups: Group[];
  projects: Project[];
  /** ⚙ Notify when done: a banner when a session finishes (off by default, T45). */
  notifyDone?: boolean;
  /** ⚙ Appearance: forced light / dark; absent = follow macOS. */
  theme?: 'light' | 'dark';
  error?: string;
}

/** ⚙ Appearance choice; `system` follows the OS. */
export type ThemeMode = 'system' | 'light' | 'dark';

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
  /** Checked-out branch; for a detached worktree, its short commit. */
  branch: string;
  /** No branch checked out (T42): opened by `path`, shown by commit. */
  detached?: true;
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

/** A linked worktree as the cleanup dialog sees it (T38). Suggested for removal when merged, clean and not open. */
export interface WorktreeCandidate {
  path: string;
  branch: string;
  /** The branch is contained in the project's base branch (nothing would be lost; the branch itself is kept). */
  merged: boolean;
  /** No changes and no untracked files (`git worktree remove` would refuse otherwise). */
  clean: boolean;
  /** A tab (live or dormant) runs in it. */
  open: boolean;
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
  /** Title the user gave the tab (T43); wins over everything else. */
  title?: string;
  /** First prompt of a Claude session, one line (T43): the title until the user names the tab. */
  prompt?: string;
}

/** What main sends on `session:title` when a tab's title or first prompt changes (absent = cleared). */
export interface SessionTitleUpdate {
  id: string;
  title?: string;
  prompt?: string;
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
  /** Waiting: the permission / question summary; done: the last answer's first line (T52). */
  detail?: string;
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
  /** Remote projects (T36): how long the SSH round trip took. */
  latencyMs?: number;
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
  /** Remote projects (T36): where on the host the untracked file went (`~/.aquila/trash/…`) instead of the Trash. */
  trashedTo?: string;
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

/** Release notes (T27): the running version and the last one whose notes were shown (~/.aquila/release-notes.json). */
export interface ReleaseNotesState {
  /** `app.getVersion()`. */
  current: string;
  /** null = no record yet. */
  lastSeen: string | null;
  /** A fresh install (no record and no earlier use): the version is recorded, nothing is shown. */
  fresh: boolean;
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
  /** When the window ends (epoch ms). 5h: block start + 5h, null when no block is running. Weekly: always null (rolling).
   * With a live `percent`: the reset time the CLI reported. */
  resetsAt: number | null;
  /** Real share 0–100 as the CLI reports it (T30b: `claude -p /usage`, Codex session files); wins over `used`/`limit`. */
  percent?: number | null;
  /** Window length in minutes when known (300 = 5 hours, 10080 = a week; Codex can report others, e.g. 43200). */
  span?: number;
}

/** What `usage:get` / `usage:changed` report per logged-in local Claude account (T30). */
export interface AccountUsage {
  account: string;
  fiveHour: UsageWindow;
  weekly: UsageWindow;
  /** At or past 90% of a learned limit (or of a live percent) in either window. */
  near: boolean;
  /** Absent = a Claude account; 'codex' = the Codex row (`account` is then 'codex'). */
  kind?: 'codex';
  /** At least one window comes from the CLI itself, not from the estimate (T30b). */
  live?: boolean;
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
  /** SSH host alias when the transcript is on a remote host (T36); absent on this Mac. */
  host?: string;
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
  /** SSH hosts of remote projects scanned so far (T36). */
  hosts?: HistoryHost[];
}

/** One SSH host's last history scan (T36). */
export interface HistoryHost {
  alias: string;
  /** The last scan failed (its entries are from the scan before). */
  error?: string;
  checkedAt?: number;
  /** Listing round trip. */
  latencyMs?: number;
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
  /** Bash commands the agent ran (Claude only, T59), oldest first. */
  commands?: CommandRun[];
}

/**
 * One Bash command from a transcript (T59): the command as run (secrets masked), when, and how it ended. Output is
 * never read or kept. `pending` = no result yet (still running, or the transcript stops there).
 */
export interface CommandRun {
  command: string;
  at?: number;
  state: 'ok' | 'error' | 'interrupted' | 'pending';
}

/** A resumed past session; `config` when its folder was added as a project first. */
export interface HistoryResumeResult {
  session: SessionInfo;
  config?: Config;
}

/** AI trends (T35): one CLI whose releases we follow. */
export type CliTool = 'claude' | 'codex';

/** One stable release of a CLI: its link and 3–5 "Added" lines. */
export interface CliRelease {
  version: string;
  url: string;
  /** null when only the CHANGELOG knew it. */
  publishedAt: number | null;
  added: string[];
}

/** "My CLI updates": releases newer than the installed version, or the latest one when none is newer. */
export interface CliNews {
  tool: CliTool;
  /** `<tool> --version`; null when it isn't installed (or didn't answer). */
  installed: string | null;
  upToDate: boolean;
  /** Newest first. */
  releases: CliRelease[];
}

export type NewsSourceId =
  | 'claude-code'
  | 'claude-changelog'
  | 'codex'
  | 'codex-latest'
  | 'openai'
  | 'cursor'
  | 'antigravity'
  | 'simonw'
  | 'latent-space'
  | 'hn'
  | 'github-changelog'
  | 'huggingface'
  | 'hf-papers'
  | 'github-new'
  // Korea (T63)
  | 'geeknews'
  | 'naver-d2'
  | 'kakao'
  | 'toss'
  | 'woowahan'
  | 'daangn'
  | 'lycorp';

/** The industry tab's Global / Korea switch (T63). */
export type NewsRegion = 'global' | 'kr';

/** Which industry sources are Korean; CLI sources count as global. */
export const NEWS_REGION: Record<NewsSourceId, NewsRegion> = {
  'claude-code': 'global',
  'claude-changelog': 'global',
  codex: 'global',
  'codex-latest': 'global',
  openai: 'global',
  cursor: 'global',
  antigravity: 'global',
  simonw: 'global',
  'latent-space': 'global',
  hn: 'global',
  'github-changelog': 'global',
  huggingface: 'global',
  'hf-papers': 'global',
  'github-new': 'global',
  geeknews: 'kr',
  'naver-d2': 'kr',
  kakao: 'kr',
  toss: 'kr',
  woowahan: 'kr',
  daangn: 'kr',
  lycorp: 'kr',
};

/** Keyword groups of the "Industry" tab. */
export type NewsGroup = 'subagent' | 'hook' | 'agentView' | 'ade' | 'harness' | 'mcp' | 'context' | 'vibe';

/** One industry item: title, link and a short excerpt only. */
export interface NewsItem {
  id: string;
  source: NewsSourceId;
  title: string;
  url: string;
  /** Hacker News: the discussion page (`url` is the story's link). */
  discussion?: string;
  excerpt: string;
  publishedAt: number;
  groups: NewsGroup[];
}

/** Opt-in LLM summary of the industry items (`claude -p`, the user's quota). */
export interface NewsSummary {
  text: string;
  at: number;
  language: Language;
}

/** What `news:get` / `news:changed` report (T35). */
export interface NewsState {
  /** Last fetch (epoch ms); null before the first one. */
  fetchedAt: number | null;
  loading: boolean;
  summarizing: boolean;
  cli: CliNews[];
  /** Newest first, last 30 days. */
  industry: NewsItem[];
  /** The modal was last opened then; newer items get a "new" dot. */
  seenAt: number;
  /** Sources whose last fetch failed (their previous items are kept). */
  failed: NewsSourceId[];
  summary: NewsSummary | null;
}

// ── Apply a trend to a repo (T64) ────────────────────────────────────────────

/** `harness`: how agents are set up (AGENTS.md, hooks, skills, scripts, tests, CI); `code`: folders. */
export type RepoColumn = 'harness' | 'code';

/** One box of the repo skeleton. Ids: `h:<slot>`, `c:<folder>`, `new:<slug>` (added by a proposal). */
export interface RepoNode {
  id: string;
  label: string;
  column: RepoColumn;
  /** Repo-relative path it stands for. */
  path?: string;
  /** A harness slot the repo doesn't have yet (shown only when a proposal adds it). */
  present: boolean;
  /** Short count ("12 scripts", "84 files"). */
  detail?: string;
}

/** Folder-level imports (code) or a reference between harness files; `weight` = how many. */
export interface RepoEdge {
  from: string;
  to: string;
  weight: number;
}

/** What the scan (no AI) finds: ≤30 nodes. */
export interface RepoSkeleton {
  nodes: RepoNode[];
  edges: RepoEdge[];
}

export type ApplyVerdict = 'apply' | 'partial' | 'skip';

// ---- Knowledge graph (T65–T70). T65 fixes these types; every other graph task uses them. ----

/**
 * What a graph node stands for. T65: `note` (a `.md` file), `missing` (a `[[link]]` to a note that doesn't exist),
 * `tag`, `code` (a file name / exported symbol of a project mentioned in notes). T68: `person` / `decision` / `todo`
 * (suggested by AI). T70: `session`, `file` (changed by a session), `trend`, `apply`.
 */
export type GraphNodeKind =
  | 'note'
  | 'missing'
  | 'tag'
  | 'code'
  | 'person'
  | 'decision'
  | 'todo'
  | 'session'
  | 'file'
  | 'trend'
  | 'apply';

export interface GraphNode {
  /** Stable: `note:<sourceId>:<relPath>`, `missing:<name>`, `tag:<tag>`, `code:<name>`, `<kind>:<id>` for the rest. */
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Notes: the source they belong to. */
  sourceId?: string;
  /** Notes: absolute file path. Code: where the name was found (first project). */
  path?: string;
  /** Notes: file mtime (ms), for the time filter. */
  mtime?: number;
  /** Notes: `#tags` and frontmatter tags, without `#`. */
  tags?: string[];
  /** Code: ids of the projects that have this name. Sessions, files, applies (T70): their project. */
  projects?: string[];
  /** Trends (T70): the article. */
  url?: string;
  /** Notes (T75): the most telling words of the body (local TF-IDF), for naming groups of notes. */
  terms?: string[];
}

/**
 * How sure an edge is, strongest first: written (`[[link]]`, tag, frontmatter) · caused by the app (T70) ·
 * found in text (title, ID, code name, URL) · suggested (T68, not accepted yet).
 */
export type GraphEdgeKind = 'explicit' | 'action' | 'mention' | 'suggested';

/** Why two nodes are linked. One edge can have several reasons. */
export type GraphEdgeVia =
  | 'link'
  | 'tag'
  | 'frontmatter'
  | 'title'
  | 'id'
  | 'code'
  | 'url'
  | 'similar'
  | 'ai'
  | 'rule'
  | 'accepted'
  | 'session'
  | 'changed'
  /** T70: a trend → the decision taken on it. */
  | 'apply';

export interface GraphEdgeReason {
  via: GraphEdgeVia;
  /** The ID, code name, URL, frontmatter key or heading behind it. */
  label?: string;
}

export interface GraphEdge {
  /** `<source>→<target>`: from the note that wrote the link / mention; sorted when every reason is symmetric (shared ID / URL, similarity). */
  id: string;
  source: string;
  target: string;
  /** The strongest of its reasons. */
  kind: GraphEdgeKind;
  /** 0–1: explicit 1 · action 1 · mention 0.4–0.7 · suggested < 0.4. */
  strength: number;
  reasons: GraphEdgeReason[];
}

/** IDs (`[A-Z][A-Z0-9]+-\d+`) of one prefix seen in 2+ notes: offered as a group ("looks like an ID"). */
export interface GraphIdGroup {
  prefix: string;
  /** The IDs seen in 2+ notes, most notes first (≤20). */
  ids: string[];
  /** Notes that mention one of them. */
  notes: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  idGroups: GraphIdGroup[];
  /** Goes up on every change of the index. */
  version: number;
}

/** A folder of Markdown files (in a repo or not). Files stay where they are and are never written to. */
export interface GraphSource {
  id: string;
  /** Stored as `~/…` under home. */
  path: string;
  enabled: boolean;
  /** T68: changed notes go to a hidden `claude -p` (haiku) for people / decisions / to-dos / related notes. Off by default. */
  ai?: boolean;
  /**
   * T73: a project's folder, indexed with no setup (every `.md` in it; hidden and build folders skipped). Not in
   * the `sources` list of sources.json; it comes and goes with the project. Can be turned off (and AI set), not removed.
   */
  auto?: boolean;
}

/**
 * `off`: disabled (costs nothing). `paused`: a large first index in power saver, waits for "Index now".
 * `missing`: the folder is gone.
 */
export type GraphSourceState = 'off' | 'indexing' | 'ready' | 'paused' | 'missing' | 'error';

export interface GraphSourceStatus extends GraphSource {
  state: GraphSourceState;
  /** Notes indexed from this source. */
  notes: number;
  /** While indexing / paused: Markdown files found. */
  total?: number;
  error?: string;
}

export interface GraphStatus {
  sources: GraphSourceStatus[];
  notes: number;
  edges: number;
  /** Offered as groups in Settings → Sources ("looks like an ID"). */
  idGroups: GraphIdGroup[];
  version: number;
  /** T68: rules, rule proposals and AI extraction per source (absent until the index runs). */
  links?: GraphLinksState;
}

/** What makes connections always link (T68): notes sharing an ID of this prefix, or a URL on this host. */
export type GraphRulePattern = { kind: 'id'; prefix: string } | { kind: 'url'; host: string };

export interface GraphRule {
  id: string;
  pattern: GraphRulePattern;
  enabled: boolean;
  createdAt: number;
}

/** The same pattern accepted 3+ times with no rule for it yet: "`DB-<n>` always links?". */
export interface GraphRuleProposal {
  /** `id:DB`, `url:github.com`. */
  key: string;
  pattern: GraphRulePattern;
  accepts: number;
}

/** AI extraction of one source (only sources with `ai` on). */
export interface GraphAiState {
  sourceId: string;
  /** Notes sent today / the daily cap. */
  today: number;
  cap: number;
  /** Changed notes waiting to be read. */
  queued: number;
  running: boolean;
  /** Queued because of power saver: runs on power, or by hand. */
  waitingForPower: boolean;
  /** Last failure (Claude missing, bad reply); automatic runs stop until the next "Run now". */
  error?: string;
}

export interface GraphLinksState {
  rules: GraphRule[];
  proposals: GraphRuleProposal[];
  ai: GraphAiState[];
  accepted: number;
  rejected: number;
}

/** Accept (becomes solid) or reject (never suggested again) a suggested / mentioned connection. */
export interface GraphDecision {
  source: string;
  target: string;
  accept: boolean;
  /** Accept and also write `[[linkTo]]` at the end of this note (a `.md` in an enabled source). */
  insertInto?: string;
  linkTo?: string;
}

export type GraphRuleOp =
  | { op: 'add'; pattern: GraphRulePattern }
  | { op: 'update'; rule: GraphRule }
  | { op: 'remove'; id: string }
  /** "Not now" on a proposal: not offered again. */
  | { op: 'dismiss'; key: string };

/** A note open in the editor (T67). The text is the file's bytes as UTF-8, with a leading BOM split off into `bom`. */
export interface NoteFile {
  path: string;
  text: string;
  bom: boolean;
  /** File mtime (ms) the text was read at: a save is refused when the file changed since. */
  mtime: number;
  /** The file isn't valid UTF-8: shown, never saved (saving would change bytes nobody touched). */
  readOnly?: boolean;
  /** Too big to edit (a log dump): only its start is shown, read-only. */
  truncated?: boolean;
}

/** An open note changed on disk (an agent, another editor): its new contents, or that it's gone. */
export type NoteChange = NoteFile | { path: string; deleted: true };

export type NoteWriteResult =
  { ok: true; mtime: number } | { ok: false; reason: 'changed' | 'refused' | 'failed' };

/** T80: an open note differs on disk from the text the user last looked at (an agent, a terminal, git changed it). */
export interface NoteSeenState {
  /** The note as the user last saw it (opened / marked as seen). */
  seenText: string;
  seenAt: number;
  /** The disk version's mtime (ms). */
  changedAt: number;
  /** A Claude session's turns touched the file; null: changed outside, nobody known. */
  by: 'claude' | null;
}

/** T80: a note changed outside since the user last saw it (mtime only, no diff). */
export interface NoteSeenChange {
  path: string;
  changedAt: number;
  by: 'claude' | null;
}

// ---- Per-source settings (T69). Nothing about any repo's format is built in: a source is shaped by its config. ----

/** A starting point for a source's settings. */
export type VaultPresetId = 'basic' | 'status-board' | 'daily' | 'meeting' | 'empty';

/** Where a source's settings live: `~/.aquila/vaults/<id>.json` (mine) or `.aquila-vault.json` in the folder (shared). */
export type VaultScope = 'personal' | 'shared';

export type VaultPropertyType = 'text' | 'select' | 'date' | 'tags';

/** A frontmatter key and how it is edited / shown. `select` options are also a board's column order. */
export interface VaultProperty {
  key: string;
  type: VaultPropertyType;
  options?: string[];
}

/**
 * Text matching `pattern` (a regular expression, case-insensitive) links to: the note whose file name is the match
 * (or starts with it and `-` / a space: `DB-12` → `DB-12-login.md`), the note whose `key` property is the match, or
 * a URL (`$0` the match, `$1`… its groups; kept for the editor, not used yet). With a group, group 1 is the value.
 */
export interface VaultLinkRule {
  pattern: string;
  to: 'name' | 'property' | 'url';
  key?: string;
  url?: string;
}

/**
 * A new note: `file` (`{{date}} {{title}}.md`) inside `folder`, starting with `body`. Variables: `{{title}}`,
 * `{{slug}}`, `{{date}}` (YYYY-MM-DD), `{{time}}` (HH:MM), `{{id}}` (the first ID-like token of the title).
 */
export interface VaultTemplate {
  id: string;
  name: string;
  folder: string;
  file: string;
  body: string;
}

/**
 * Files with the same key in these folders (searched below them) are one thing shown as tabs: a spec, its checklist,
 * its retrospect. The key is the file name's first match of `key` (its group 1 when it has one), else the whole name.
 */
export interface VaultCompanions {
  folders: string[];
  key?: string;
}

/**
 * Notes under `folder` (the whole source when empty) grouped by a property or by the sub-folder they are in.
 * Moving a card sets the property or moves the file. `order` puts these groups first; `columns` are the properties
 * a table shows.
 */
export interface VaultView {
  id: string;
  name: string;
  kind: 'board' | 'table' | 'list';
  folder?: string;
  group: 'property' | 'folder';
  key?: string;
  order?: string[];
  columns?: string[];
}

/**
 * A button on a note: `insert` adds `block` at the end of the section under the heading `under` (the end of the note
 * when there is none) and sets properties (`set`); `claude` opens a Claude tab with `prompt` and the note as `@path`.
 * Same variables as templates, plus `{{path}}`. `folder` limits it to notes under that folder.
 */
export interface VaultAction {
  id: string;
  name: string;
  kind: 'insert' | 'claude';
  block?: string;
  under?: string;
  set?: Record<string, string>;
  prompt?: string;
  folder?: string;
}

export interface VaultConfig {
  v: 1;
  /** The preset it started from (shown only). */
  preset?: VaultPresetId;
  links: VaultLinkRule[];
  properties: VaultProperty[];
  templates: VaultTemplate[];
  /** The template a missing `[[link]]` is created with (its folder is where new notes go). */
  newNotes?: string;
  companions?: VaultCompanions;
  views: VaultView[];
  actions: VaultAction[];
}

export interface VaultState {
  sourceId: string;
  /** null: nothing saved yet (an empty config). */
  scope: VaultScope | null;
  /** A shared `.aquila-vault.json` exists in the folder (mine wins while I have one). */
  hasShared: boolean;
  config: VaultConfig;
  /** What was dropped when reading it (an invalid pattern, an unknown kind). */
  problems: string[];
}

/** "Make with Claude": a config to preview before it's saved, or why there is none. */
export type VaultSuggestion = { config: VaultConfig; problems: string[] } | { error: string };

export interface VaultCard {
  path: string;
  /** Inside the source. */
  rel: string;
  title: string;
  props: Record<string, string | string[]>;
  mtime: number;
}

export interface VaultViewData {
  view: VaultView;
  groups: { key: string; cards: VaultCard[] }[];
  /** Property types, for the table's cells and the board's move. */
  properties: VaultProperty[];
}

/** What the editor shows for one note: its companion tabs, typed properties, actions and the source's views. */
export interface VaultNoteInfo {
  sourceId: string;
  companions: { label: string; path: string }[];
  properties: VaultProperty[];
  /** The note's frontmatter as last indexed. */
  values: Record<string, string | string[]>;
  actions: { id: string; name: string; kind: VaultAction['kind'] }[];
  views: { id: string; name: string }[];
  templates: { id: string; name: string }[];
}

/** An edit of a note's text (the open editor applies it, so it saves like typing). */
export type VaultEdit = { action: string } | { property: string; value: string | string[] };

/** `projectId`: the local project the note is in (the Claude tab opens there). */
export type VaultEditResult = { text: string } | { prompt: string; projectId?: string };

export type VaultMoveResult =
  { ok: true; path: string } | { ok: false; reason: 'exists' | 'refused' | 'failed' };

export type NodeChangeKind = 'add' | 'change' | 'unfit';

export interface NodeChange {
  node: string;
  kind: NodeChangeKind;
  why: string;
}

export type StepSize = 'S' | 'M' | 'L';
export type StepRisk = 'low' | 'medium' | 'high';

export interface ApplyStep {
  id: string;
  title: string;
  /** Repo-relative paths. */
  files: string[];
  nodes: string[];
  size: StepSize;
  risk: StepRisk;
}

export interface UnfitItem {
  title: string;
  why: string;
}

/** Claude's answer, validated (unknown nodes dropped, steps outside the repo moved to `unfit`). */
export interface ApplyProposal {
  verdict: ApplyVerdict;
  summary: string;
  benefits: string[];
  changes: NodeChange[];
  /** Nodes the proposal adds (`new:<slug>`). */
  added: RepoNode[];
  steps: ApplyStep[];
  unfit: UnfitItem[];
}

export interface ApplyArticle {
  itemId: string;
  title: string;
  url: string;
  source: NewsSourceId;
}

export interface ApplyAnalyseRequest {
  /** Made by the renderer, so the run can be cancelled before it answers; re-analysing keeps it. */
  id: string;
  projectId: string;
  itemId: string;
  language: Language;
  /** "Edit": the user's extra request ("no Python"). */
  request?: string;
  /** "Edit": the steps the user kept or rewrote. */
  steps?: ApplyStep[];
}

export type ApplyDecision = 'pending' | 'dropped' | 'applied';

/** One decision, kept in `~/.aquila/applies/<id>.json`. */
export interface ApplyRecord {
  id: string;
  projectId: string;
  article: ApplyArticle;
  createdAt: number;
  /** Times it was analysed (Edit → Analyse again adds one). */
  rounds: number;
  request?: string;
  skeleton: RepoSkeleton;
  proposal: ApplyProposal;
  decision: ApplyDecision;
  decidedAt?: number;
  /** Applied: the worktree branch and the steps that were pasted. */
  branch?: string;
  approved?: ApplyStep[];
}

/** "Apply": the new tab and the text to paste into it (the approved steps only). */
export interface ApplyStartResult {
  session: SessionInfo;
  prompt: string;
}

export type Unsubscribe = () => void;

/** The system-wide key that brings Aquila up (T41), from `~/.aquila/global-shortcut.json`. */
export interface GlobalShortcutState {
  /** Saved key as an Electron accelerator (`Command+Shift+J`); null = off. */
  accelerator: string | null;
  /** Registered with the OS right now. */
  active: boolean;
  /** The last attempt failed: another app or the OS has the key / not a key we accept. */
  error?: 'taken' | 'invalid';
  /** The key that failed, when it isn't the saved one (a change that didn't go through). */
  failed?: string;
}

/** The OS the app runs on (T19), known synchronously at startup. */
export interface PlatformInfo {
  os: 'darwin' | 'win32' | 'linux';
  /** Windows build number (xterm's ConPTY handling); Windows only. */
  windowsBuild?: number;
}

/** API exposed on window.aquila by electron/preload.ts. */
export interface AquilaApi {
  /** Read once in preload, no IPC round trip (the terminal needs it at creation). */
  platform: PlatformInfo;
  getConfig(): Promise<Config>;
  openConfig(): Promise<string>;
  setLanguage(language: Language): Promise<Config>;
  /** ⚙ Notify when done (T45). */
  setNotifyDone(on: boolean): Promise<Config>;
  /** ⚙ Appearance: system / light / dark (sets Electron's nativeTheme.themeSource). */
  setTheme(mode: ThemeMode): Promise<Config>;
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
  /** The project's linked worktrees with merged / clean / open flags, for cleanup (read-only). */
  worktreeCandidates(projectId: string): Promise<WorktreeCandidate[]>;
  /** `git worktree remove` (no `--force`) one linked worktree of the project; throws git's message. */
  removeWorktree(projectId: string, path: string): Promise<void>;
  /**
   * Reopens the tabs saved at the last quit (~/.aquila/state.json), once per launch; later calls return the live ones.
   * Tabs in the saved layout's panes are spawned, the others come back `dormant`.
   */
  restoreSessions(): Promise<RestoreResult>;
  /** Spawns a dormant restored tab (same id). */
  startSession(id: string): Promise<SessionInfo>;
  /**
   * Restarts a live local Claude/Codex tab, resuming its conversation, so new spawn options apply (Figma on/off, T54).
   * Returns the new tab, which takes the old one's place; the old id exits.
   */
  reopenSession(id: string): Promise<SessionInfo>;
  /** The split layout changed (saved with the tabs). */
  saveLayout(layout: SavedLayout): void;
  /** The tab order changed (ids in their new order; saved with the tabs). Ids main doesn't know are ignored. */
  reorderSessions(ids: string[]): void;
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
  /** Scan the SSH hosts of remote projects (T36) and return the whole list again; slow, so called after `historyList`. */
  historyRefreshRemote(): Promise<HistoryList>;
  /** Full-text search over the indexed transcripts. */
  historySearch(query: string): Promise<HistoryMatch[]>;
  historyTranscript(ref: HistoryRef): Promise<HistoryTranscript>;
  /** Bash commands of a live Claude tab, read fresh from its transcript (T59); null when it has none to read. */
  sessionCommands(id: string): Promise<CommandRun[] | null>;
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
  /** Running version vs. the last one whose release notes were shown (T27). */
  releaseNotesState(): Promise<ReleaseNotesState>;
  /** The notes up to `version` were shown: never auto-open them again. */
  markReleaseNotesSeen(version: string): Promise<void>;
  /** Absolute path of a dropped `File` (Electron's webUtils; typed loosely because main has no DOM types). */
  pathForFile(file: object): string;
  /** Plain text to the clipboard (through main: Electron 45 has no clipboard module in the preload). */
  copyText(text: string): void;
  /**
   * Files on the clipboard as absolute paths (T28 ⌘V): copied Finder files as they are, an image saved as a temp PNG.
   * Empty when the clipboard holds neither.
   */
  clipboardPaths(): Promise<string[]>;
  /** Plain text on the clipboard (T42: the terminal's right-click Paste). */
  clipboardText(): Promise<string>;
  /** Text of the last agent reply in a Claude/Codex tab, from its transcript (read-only). null when there is none. */
  lastReply(sessionId: string): Promise<string | null>;
  /** T72: the Claude / Codex conversation each open local tab is running (the graph marks those session nodes live). */
  sessionAgentIds(): Promise<{ tabId: string; agent: 'claude' | 'codex'; sessionId: string }[]>;
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
  /** Names a tab (T43); '' goes back to the automatic title. Main answers on `onTitle`. */
  renameSession(id: string, title: string): void;
  onTitle(cb: (p: SessionTitleUpdate) => void): Unsubscribe;
  /** Host aliases from `~/.ssh/config` (no wildcards), for the remote project form. */
  sshHosts(): Promise<string[]>;
  /** Connects once (BatchMode) and reports OS, CLIs, tmux, git and the Claude login on the host. */
  checkRemote(host: RemoteHost): Promise<RemoteCheck>;
  /** Folders in `path` on the host (read-only `ls`, T56); `~` or blank = home. Rejects with ssh's error. */
  listRemoteDirs(host: RemoteHost, path: string): Promise<RemoteDirList>;
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
  /** Dev server addresses for a local project (T33): `.claude/launch.json` and `localhost:<port>` seen in its tabs. */
  /** `worktree`: path of the focused tab's worktree (T50); none = the project dir. */
  previewTargets(projectId: string, worktree?: string): Promise<PreviewTargets>;
  onPreviewTargets(cb: (t: PreviewTargets) => void): Unsubscribe;
  /** Shows / moves / navigates the native preview view of a slot; null closes it. */
  previewSet(slot: PreviewSlot, state: PreviewState | null): void;
  previewCommand(slot: PreviewSlot, command: PreviewCommand): void;
  onPreviewNav(cb: (n: PreviewNav) => void): Unsubscribe;
  /** Select mode: resolves with the element the user clicked in the preview (null on Esc / cancel). */
  previewPick(slot: PreviewSlot): Promise<PickResult | null>;
  previewPickCancel(slot: PreviewSlot): void;
  /** A PNG of what a slot's view shows now (Designer compare, T62); null when the view isn't on screen. */
  previewCapture(slot: PreviewSlot): Promise<PreviewShot | null>;
  /** Run slot (T60), local projects only: the commands of a project dir / worktree with their state. */
  runList(projectId: string, worktree?: string): Promise<RunList>;
  onRunsChanged(cb: (l: RunList) => void): Unsubscribe;
  /** Starts a command (restarts it when running). */
  runStart(projectId: string, worktree: string | undefined, name: string): Promise<RunList>;
  /** Stops its process group. */
  runStop(id: string): Promise<void>;
  /** Output kept so far (tail) of a run. */
  runLog(id: string): Promise<string>;
  onRunData(cb: (d: { id: string; data: string }) => void): Unsubscribe;
  /** AI trends (T35): cached CLI releases and industry news. Nothing is fetched in the background. */
  news(): Promise<NewsState>;
  onNews(cb: (s: NewsState) => void): Unsubscribe;
  /** Fetch again now. */
  newsRefresh(): Promise<NewsState>;
  /** The trends modal was opened: marks everything seen, fetches if the cache is older than 30 min. */
  newsOpened(): void;
  /** Opens a link from the news state in the browser (others are ignored). */
  newsOpen(url: string): void;
  /** Opt-in: summarizes the industry items with a hidden `claude -p` (the account's quota). Rejects on failure. */
  newsSummarize(language: Language, account?: string): Promise<NewsState>;
  /** Apply a trend (T64), local projects only: the repo skeleton (no AI, one pass, no watcher). */
  applyScan(projectId: string): Promise<RepoSkeleton>;
  /** Hidden `claude -p --permission-mode plan` (the project account's quota) → a validated proposal. Rejects on failure. */
  applyAnalyse(req: ApplyAnalyseRequest): Promise<ApplyRecord>;
  /** Stops a running analysis (its `applyAnalyse` rejects). */
  applyCancel(id: string): void;
  /** Cancel: kept as dropped. */
  applyDrop(id: string): Promise<void>;
  /** Apply: worktree `trend/<slug>` + a Claude tab there; the renderer pastes `prompt`. */
  applyStart(id: string, steps: ApplyStep[]): Promise<ApplyStartResult>;
  /** Knowledge graph sources (T65). The first call starts the index (nothing runs before). */
  graphStatus(): Promise<GraphStatus>;
  onGraphStatus(cb: (s: GraphStatus) => void): Unsubscribe;
  /** Adds a folder of Markdown (enabled). Rejects if it's not a folder or overlaps a source. */
  graphAddSource(path: string): Promise<GraphStatus>;
  graphRemoveSource(id: string): Promise<GraphStatus>;
  graphSetSourceEnabled(id: string, enabled: boolean): Promise<GraphStatus>;
  /** Starts a first index that was paused in power saver. */
  graphIndexNow(id: string): Promise<GraphStatus>;
  /** The whole index: notes, tags, code names and their edges. */
  /**
   * `notesOnly`: the index without the app's part (sessions, files, trends) — no history scan, so it answers at once
   * (quick open).
   */
  graphSnapshot(opts?: { notesOnly?: boolean }): Promise<GraphSnapshot>;
  /** Opens a note of an enabled source in the default app (T66, until the editor T67). Other paths are refused. */
  graphOpenNote(path: string): Promise<boolean>;
  /** T68: accept / reject a suggestion. `inserted`: the `[[link]]` was written (false when asked and refused). */
  graphDecide(d: GraphDecision): Promise<{ inserted: boolean }>;
  /** T68: add / edit / remove a link rule, or dismiss a proposal. The new state comes with `onGraphStatus`. */
  graphRule(op: GraphRuleOp): Promise<void>;
  /** T68: AI extraction on/off for a source (uses the user's Claude quota). */
  graphSetSourceAi(id: string, ai: boolean): Promise<GraphStatus>;
  /** T68: read the queued notes of a source now (also in power saver). */
  graphExtractNow(id: string): Promise<void>;
  /** Note editor (T67): reads a note of an enabled source and watches it until `noteClose`. Other paths → null. */
  noteOpen(path: string): Promise<NoteFile | null>;
  noteClose(path: string): void;
  /** Saves in place; refused (`changed`) when the file on disk isn't the one read at `baseMtime`. */
  noteWrite(path: string, text: string, bom: boolean, baseMtime: number): Promise<NoteWriteResult>;
  /** A note open in the editor changed on disk. */
  onNoteChanged(cb: (c: NoteChange) => void): Unsubscribe;
  /** A pasted image saved as `attachments/<note>-<time>.<ext>` next to the note: the relative path, or null. */
  noteAttach(notePath: string, data: Uint8Array, ext: string): Promise<string | null>;
  /** A link in a note: opened in the browser (http/https only). */
  noteOpenUrl(url: string): Promise<void>;
  /** T70: the local project a file is in (a note's "Handle with Claude" opens there), or null. */
  noteProject(path: string): Promise<string | null>;
  /** T80: the seen copy when the note on disk differs from what the user last looked at, else null. */
  noteSeenState(path: string): Promise<NoteSeenState | null>;
  /** T80: "Mark as seen" — the note as it is on disk now becomes the seen copy. */
  noteSeenMark(path: string): Promise<boolean>;
  /** T80: notes (of enabled sources) changed outside since last seen, newest first. */
  noteSeenChanged(): Promise<NoteSeenChange[]>;
  /**
   * T70: today's sessions added to the day's note of a source (when null: one with a date template, else the first
   * enabled) — its date template when it has one, else `<date> sessions.md` — only lines it doesn't have yet. The note's path, or null.
   */
  graphDailyNote(sourceId: string | null): Promise<string | null>;
  /** T69: a source's settings (personal wins over shared). */
  vaultGet(sourceId: string): Promise<VaultState>;
  /** T69: validated and saved as mine or shared (shared writes `.aquila-vault.json` and drops mine). */
  /** `problems`: what was dropped from the given config while validating it. */
  vaultSave(sourceId: string, config: VaultConfig, scope: VaultScope): Promise<VaultState>;
  /** T69: drop my settings so the shared ones apply. */
  vaultRemovePersonal(sourceId: string): Promise<VaultState>;
  /** T69: a preset's config. */
  vaultPreset(preset: VaultPresetId): Promise<VaultConfig>;
  /** T69: "Make with Claude" — the folder's outline and the description go to a hidden `claude -p` (user's quota). */
  vaultSuggest(sourceId: string, description: string): Promise<VaultSuggestion>;
  vaultView(sourceId: string, viewId: string): Promise<VaultViewData | null>;
  /** T69: a card moved to another group: sets the property, or moves the file into that folder. */
  vaultMove(path: string, viewId: string, group: string): Promise<VaultMoveResult>;
  vaultNoteInfo(path: string): Promise<VaultNoteInfo | null>;
  /** T69: the note's text after an action / a property change (not written), or a Claude prompt to send. */
  vaultEdit(path: string, text: string, edit: VaultEdit): Promise<VaultEditResult | null>;
  /** T69: a new note from a template (the source's `newNotes` one when null): its path, or null. */
  vaultCreateNote(sourceId: string, templateId: string | null, title: string): Promise<string | null>;
  /** T69: a source's settings changed (saved here, or the shared file changed on disk). */
  onVaultChanged(cb: (sourceId: string) => void): Unsubscribe;
  /** Global shortcut (T41): the saved key and whether the OS gave it to us. */
  globalShortcut(): Promise<GlobalShortcutState>;
  /** Saves and registers a new key (null = off). A taken key keeps the old one and reports `taken`. */
  setGlobalShortcut(accelerator: string | null): Promise<GlobalShortcutState>;
  /** The key was pressed: the window is already up. `wasFocused`: Aquila was the front window before. */
  onGlobalShortcut(cb: (p: { wasFocused: boolean }) => void): Unsubscribe;
  /** App menu bar (T47): a menu item was clicked; the renderer runs it like the key. */
  onMenuCommand(cb: (command: MenuCommand) => void): Unsubscribe;
  /** Extensions (T71): the folders under ~/.aquila/extensions, rescanned. */
  extensionsList(): Promise<ExtensionInfo[]>;
  /** An extension installed, removed, enabled, started / suspended, or its chip text changed. */
  onExtensions(cb: (list: ExtensionInfo[]) => void): Unsubscribe;
  /** Enable after the user saw its permissions (off also closes it and drops the background allowance). */
  extensionsSetEnabled(id: string, enabled: boolean): Promise<ExtensionInfo[]>;
  /** Let an extension that asks `background` keep running while its panel is closed. */
  extensionsSetBackground(id: string, allowed: boolean): Promise<ExtensionInfo[]>;
  /** Shows / moves the native view of an extension over the panel's stage; null hides it. */
  extensionsShow(id: string, state: ExtensionViewState | null): void;
  /** Rescans the folder and reloads the extension's page (a changed manifest applies). */
  extensionsReload(id: string): void;
  /** Runs a manifest command (⌘K): the extension gets a `command` event. */
  extensionsCommand(id: string, commandId: string): void;
  /** "New extension": a folder from the template, added as a project so a Claude tab can open in it. */
  extensionsCreate(name: string, group: string, account: string): Promise<ExtensionCreated>;
  /** Reveals the extensions folder (or one extension's) in Finder; creates it first. */
  extensionsOpenFolder(id?: string): Promise<void>;
  /** Opens the extension in a floating window (or brings it forward) / puts it back in the panel. */
  extensionsFloat(id: string, floating: boolean): Promise<ExtensionInfo[]>;
  /** Opacity (0.2–1) and always-on-top of its floating window. */
  extensionsFloatStyle(id: string, style: { opacity?: number; onTop?: boolean }): Promise<ExtensionInfo[]>;
}

/** Extensions (T71): what an extension may ask for in its manifest (plus `network:<domain>` entries). */
export type ExtensionPermission = 'system' | 'sessions:status' | 'usage' | 'storage' | 'notify' | 'background';

/** A manifest command, listed in ⌘K as "<extension>: <title>". */
export interface ExtensionCommand {
  id: string;
  title: string;
}

/** One folder under ~/.aquila/extensions. */
export interface ExtensionInfo {
  /** The folder name. */
  id: string;
  name: string;
  description?: string;
  version?: string;
  /** One or two characters for the chip and the picker. */
  glyph?: string;
  /** The extension's own picture (data URL), shown instead of the glyph where a picture fits. */
  icon?: string;
  dir: string;
  /** False: the manifest can't be used (`problems` says why). */
  valid: boolean;
  /** What was wrong or dropped while reading the manifest. */
  problems: string[];
  permissions: ExtensionPermission[];
  /** Domains it may reach over https. */
  network: string[];
  commands: ExtensionCommand[];
  /** The user enabled it after seeing the permissions. */
  enabled: boolean;
  /**
   * It was enabled, but its manifest now asks for more than the user approved (`added`), so it's off until enabled
   * again.
   */
  added?: { permissions: ExtensionPermission[]; network: string[] };
  /** The user allowed it to run while hidden (only with the `background` permission). */
  background: boolean;
  /** Its page is loaded (shown, or hidden and not yet suspended). */
  running: boolean;
  /** Text it set with `chip.set`, shown in the sidebar. */
  chip?: string;
  /** In its own floating window (moved, resized, faded by the user) instead of the panel. */
  floating: boolean;
  /** Floating window opacity, 0.2–1. */
  opacity: number;
  /** Floating window stays above other apps. */
  onTop: boolean;
}

export interface ExtensionViewState {
  bounds: PreviewRect;
  /** A dialog is open over the panel: the native view would cover it. */
  hidden: boolean;
}

/** `system` (T71): one shared poll in main. Bytes, CPU in percent of all cores. */
export interface ExtensionSystem {
  cpu: number;
  cores: number;
  /** 1-minute load average. */
  load: number;
  memory: { used: number; total: number };
  /** Main process resident memory. */
  appMemory: number;
  onBattery: boolean;
  saver: boolean;
  at: number;
}

export interface ExtensionCreated {
  id: string;
  dir: string;
  projectId: string;
  config: Config;
}

/** App menu bar (T47): a shortcut of the map, or a menu-only command. */
export type MenuCommand = ShortcutId | 'settings' | 'addProject' | 'whatsNew' | 'connectFigma';

/** In-app preview (T33): the app, or Figma under it in the Designer layout. */
export type PreviewSlot = 'app' | 'figma';
/** `browser`: the slot's current page in Chrome (else the default browser), T51. */
export type PreviewCommand = 'reload' | 'back' | 'devtools' | 'browser';

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewState {
  url: string;
  /** The stage's rect in the window (CSS px of the main renderer). */
  bounds: PreviewRect;
  /** CSS width the page gets (device preset 390 / 768 / 1440); 0 = the stage's width. Wider → zoomed out. */
  width: number;
  /** Kept loaded but not drawn (a dialog is open: the native view would cover it). */
  hidden?: boolean;
}

/** Run slot state (T60): never started (or stopped and cleared), up, ended, or failed (error in output / exit ≠ 0). */
export type RunState = 'idle' | 'running' | 'exited' | 'error';

/** One command of the run slot of a project dir or worktree. */
export interface RunInfo {
  /** Opaque key: project + worktree + name. */
  id: string;
  name: string;
  command: string;
  state: RunState;
  /** The process group is still alive (an `error` run can still be up, e.g. a compile error). */
  alive: boolean;
  /** When the current / last run started (ms since epoch); changes on every start (the log restarts). */
  startedAt?: number;
  exitCode?: number | null;
  /** The output line that made it `error`, or why it couldn't start. */
  reason?: string;
  /** Last local address it printed (`http://localhost:5173/`). */
  url?: string;
  /** `PORT` it was started with. */
  port?: number;
}

export interface RunList {
  projectId: string;
  /** Worktree path; absent = the project dir. */
  worktree?: string;
  runs: RunInfo[];
}

export interface PreviewTargets {
  projectId: string;
  /** Worktree path the addresses belong to (T50); absent = the project dir. */
  worktree?: string;
  /** The server on this worktree's `PORT` first, then launch.json, then other addresses its terminals printed. */
  urls: string[];
  /** A server seen on this worktree's `PORT` range: the panel switches to it when it appears. */
  preferred?: string;
}

export interface PreviewNav {
  slot: PreviewSlot;
  url: string;
  title: string;
  loading: boolean;
  /** The last load failed (server down): the renderer hides the view and offers a retry. */
  error?: string;
  /** The address whose load failed (the view's `url` stays on the last page that loaded). */
  errorUrl?: string;
  canGoBack: boolean;
}

/** A whole-view screenshot of a preview slot (T62): saved in the paste temp folder, and inline for the panel. */
export interface PreviewShot {
  path: string;
  dataUrl: string;
  /** Device px. */
  width: number;
  height: number;
}

/** The element picked in the preview (T33), pasted into the focused session as a prompt + screenshot path. */
export interface PickResult {
  url: string;
  selector: string;
  tag: string;
  text: string;
  /** Useful attributes: role, aria-label, data-testid, href, alt, placeholder, … */
  attrs: Record<string, string>;
  /** React / Vue component names, nearest first (dev builds only). */
  components: string[];
  /** `file:line` of the nearest component when the framework exposes it (React ≤18 dev, Vue `__file`). */
  source?: string;
  /** Computed style, defaults left out. */
  styles: Record<string, string>;
  /** CSS px in the page's viewport. */
  rect: PreviewRect;
  /** PNG crop of the element (with a margin), in the paste temp folder. */
  imagePath?: string;
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
  configSetNotifyDone: 'config:set-notify-done',
  configSetTheme: 'config:set-theme',
  configSetProjectAccount: 'config:set-project-account',
  configEditProjects: 'config:edit-projects',
  dialogPickFolder: 'dialog:pick-folder',
  configProjectForPath: 'config:project-for-path',
  projectOpenIn: 'project:open-in',
  uiContextMenu: 'ui:context-menu',
  clipboardPaths: 'clipboard:paths',
  clipboardWrite: 'clipboard:write',
  clipboardText: 'clipboard:text',
  sessionLastReply: 'session:last-reply',
  sessionAgentIds: 'session:agent-ids',
  sessionCreate: 'session:create',
  sessionRestore: 'session:restore',
  sessionStart: 'session:start',
  layoutSave: 'layout:save',
  sessionReorder: 'session:reorder',
  sessionScrollback: 'session:scrollback',
  sessionCreateWorktree: 'session:create-worktree',
  sessionReopen: 'session:reopen',
  worktreeInfo: 'worktree:info',
  worktreeCandidates: 'worktree:candidates',
  worktreeRemove: 'worktree:remove',
  accountsStatus: 'accounts:status',
  accountsPrepare: 'accounts:prepare',
  accountsShellPreview: 'accounts:shell-preview',
  accountsShellInstall: 'accounts:shell-install',
  gitChanges: 'git:changes',
  gitWatch: 'git:watch',
  gitChanged: 'git:changed',
  gitAction: 'git:action',
  historyList: 'history:list',
  historyRefreshRemote: 'history:refresh-remote',
  historySearch: 'history:search',
  historyTranscript: 'history:transcript',
  sessionCommands: 'session:commands',
  historySetMeta: 'history:set-meta',
  historyExport: 'history:export',
  historyResume: 'history:resume',
  firstRunGet: 'first-run:get',
  firstRunFinish: 'first-run:finish',
  firstRunPickBinary: 'first-run:pick-binary',
  firstRunResetBinary: 'first-run:reset-binary',
  guideGet: 'guide:get',
  guideOffered: 'guide:offered',
  releaseNotesGet: 'release-notes:get',
  releaseNotesSeen: 'release-notes:seen',
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
  sessionRename: 'session:rename',
  sessionTitle: 'session:title',
  uiFocusSession: 'ui:focus-session',
  remoteHosts: 'remote:hosts',
  remoteCheck: 'remote:check',
  remoteList: 'remote:list',
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
  previewTargets: 'preview:targets',
  previewTargetsChanged: 'preview:targets-changed',
  previewSet: 'preview:set',
  previewCommand: 'preview:command',
  previewNav: 'preview:nav',
  previewPick: 'preview:pick',
  previewPickCancel: 'preview:pick-cancel',
  previewCapture: 'preview:capture',
  runList: 'run:list',
  runsChanged: 'run:changed',
  runStart: 'run:start',
  runStop: 'run:stop',
  runLog: 'run:log',
  runData: 'run:data',
  newsGet: 'news:get',
  newsChanged: 'news:changed',
  newsRefresh: 'news:refresh',
  newsOpened: 'news:opened',
  newsOpen: 'news:open',
  newsSummarize: 'news:summarize',
  applyScan: 'apply:scan',
  applyAnalyse: 'apply:analyse',
  applyCancel: 'apply:cancel',
  applyDrop: 'apply:drop',
  applyStart: 'apply:start',
  graphStatus: 'graph:status',
  graphStatusChanged: 'graph:status-changed',
  graphAddSource: 'graph:add-source',
  graphRemoveSource: 'graph:remove-source',
  graphSetSourceEnabled: 'graph:set-source-enabled',
  graphIndexNow: 'graph:index-now',
  graphSnapshot: 'graph:snapshot',
  graphOpenNote: 'graph:open-note',
  graphDecide: 'graph:decide',
  graphRule: 'graph:rule',
  graphSetSourceAi: 'graph:set-source-ai',
  graphExtractNow: 'graph:extract-now',
  noteOpen: 'note:open',
  noteClose: 'note:close',
  noteWrite: 'note:write',
  noteChanged: 'note:changed',
  noteAttach: 'note:attach',
  noteOpenUrl: 'note:open-url',
  noteProject: 'note:project',
  noteSeenState: 'note:seen-state',
  noteSeenMark: 'note:seen-mark',
  noteSeenChanged: 'note:seen-changed',
  graphDailyNote: 'graph:daily-note',
  vaultGet: 'vault:get',
  vaultSave: 'vault:save',
  vaultRemovePersonal: 'vault:remove-personal',
  vaultPreset: 'vault:preset',
  vaultSuggest: 'vault:suggest',
  vaultView: 'vault:view',
  vaultMove: 'vault:move',
  vaultNoteInfo: 'vault:note-info',
  vaultEdit: 'vault:edit',
  vaultCreateNote: 'vault:create-note',
  vaultChanged: 'vault:changed',
  globalShortcutGet: 'global-shortcut:get',
  globalShortcutSet: 'global-shortcut:set',
  globalShortcutFired: 'global-shortcut:fired',
  menuCommand: 'menu:command',
  extensionsList: 'extensions:list',
  extensionsChanged: 'extensions:changed',
  extensionsSetEnabled: 'extensions:set-enabled',
  extensionsSetBackground: 'extensions:set-background',
  extensionsShow: 'extensions:show',
  extensionsReload: 'extensions:reload',
  extensionsCommand: 'extensions:command',
  extensionsCreate: 'extensions:create',
  extensionsOpenFolder: 'extensions:open-folder',
  extensionsFloat: 'extensions:float',
  extensionsFloatStyle: 'extensions:float-style',
  /** From an extension's own view (its preload), not the app window. */
  extensionRequest: 'ext:request',
  extensionEvent: 'ext:event',
} as const;
