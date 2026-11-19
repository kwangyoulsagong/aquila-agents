# Architecture

> 한국어: [../ko/ARCHITECTURE.md](../ko/ARCHITECTURE.md)

```
┌──────── Renderer (src/, React, FSD) ──────┐        ┌──────────── Main (electron/, Node) ─────────────┐
│ app/      entry, global styles            │  IPC   │ main.ts       window + IPC handlers              │
│ pages/    workspace (state hook, shortcuts)│◀──────▶│ config.ts     ~/.aquila/config.json              │
│ widgets/  sidebar, session-tabs,          │preload │ sessions.ts   one node-pty per session           │
│           split-view, changes-panel,      │        │ accounts.ts   account status, ~/.claude-* dir,   │
│           command-palette                 │  .ts   │               zsh function (explicit click)      │
│ features/ switch-account, switch-language,│        │ hooks.ts      127.0.0.1:<port> hook receiver     │
│           open-session, setup-account,    │        │               + ~/.aquila/claude-hooks.json       │
│           manage-projects, next-waiting,  │
│           first-run, guide                │        │ git.ts        git status/diff, watch, stage/revert│
│ entities/ session (xterm, status), project│        │ state.ts      ~/.aquila/state.json (tabs, layout)│
│                                           │        │               + scrollback/ (T21)                │
│                                           │        │ codex.ts      codex session id per tab (T21)     │
│           diff                            │        │ worktrees.ts  git worktree add / reuse (T7)      │
│           open-in-worktree                │        │ menu.ts       native context menus               │
│                                           │        │ notify.ts     notifications, reminder, Dock badge│
│                                           │        │ status/       OSC 7501 parser + status tracker   │
│                                           │        │ output.ts     output batching + flow control     │
│                                           │        │ power.ts      power profile: battery/heat (T9)   │
│           usage-gauge                     │        │ usage.ts      5h / weekly usage per account (T30)│
│                                           │        │ context.ts    context use per tab (T31)          │
│                                           │        │ detect.ts     CLI checks, first-run state (T17)  │
│                                           │        │ guide.ts      tour offered once (T23)            │
│                                           │        │ history.ts    past sessions, read-only (T11)     │
│                                           │        │ terminalHelpers.ts clipboard paths, last reply   │
│                                           │        │ remote/       ssh + tmux, reconnect, host check  │
│                                           │        │ smoke.ts      npm run smoke self-check           │
│ shared/   api (types · IPC · bridge), i18n│        │                                                 │
└───────────────────────────────────────────┘        └─────────────────────────────────────────────────┘
                                                              │ spawns (login + interactive zsh)
                                                              ▼
                              claude --settings ~/.aquila/claude-hooks.json  |  codex  |  $SHELL
```

## FSD rules (renderer)

- Layers: `app → pages → widgets → features → entities → shared`. Import **only from layers below**.
- Other slices only through their public index: `@/entities/session` (yes), `@/entities/session/ui/TerminalView` (no).
- Slices on the same layer don't import each other. Use the `@/` alias between slices.
- Enforced by ESLint (`eslint.config.mjs`) — `npm run lint` fails on a violation.
- `shared/api/types.ts` and `shared/i18n/dictionary.ts` are also compiled into the main process: keep them dependency-free.

## Session lifecycle

1. Renderer calls `createSession(projectId, kind)`.
2. Main spawns `$SHELL -l -i -c "<cmd>; exec $SHELL -l -i"` in the project dir, so the user's PATH/fnm/aliases work
   and the tab drops to a shell when the agent exits.
3. Env per session: `AQUILA_TAB_ID`, `AQUILA_PORT`, and — for Claude sessions on the **personal** account —
   `CLAUDE_CONFIG_DIR=~/.claude-personal` (same as the `claude-personal` shell function). The **shared** account leaves
   it unset (plain `claude`): Claude keys its keychain entry off this variable, so it must not be set to `~/.claude`.
   With a project **port base** (T26), also `PORT` and `AQUILA_PORT_BASE` = base + 10 × the worktree's position in
   `git worktree list` (main = 0), so parallel dev servers in different worktrees don't collide.
4. pty output → `electron/output.ts` batches it (one message per 16 ms frame or 64 KB; 200 ms while the session is
   off screen, from `session:visible`; 1 s off screen in power-saver mode — `electron/power.ts`, see `ENERGY.md`) → `session:data` → `terminalBus` → the xterm for that id (buffered until mounted).
   **Flow control:** the renderer sends `session:ack` once xterm has written a batch; main pauses the pty at 5
   unacknowledged batches and resumes at 2, so a flood (`yes`) never queues megabytes and Ctrl+C stays instant
   (smoke checks it). A renderer reload resets the counts. Output buffered before a terminal mounts is acked on arrival.
5. Hidden sessions stay mounted (`hidden`), so scrollback survives; xterm skips painting hidden ones. WebGL
   (`lib/gpuPool.ts`): terminals on screen always have it; hidden ones keep it up to 12 in all, the least recently seen
   dropping to the DOM renderer first (Chromium keeps ~16 live contexts per page and drops the oldest, while the DOM
   renderer costs more memory: dropping WebGL from every hidden terminal measured +125 MB with 15 sessions). A lost
   context falls back to DOM (after 3 losses that terminal stays on DOM). The scrollbar shows only with scrollback. Resizes are coalesced per frame and refit only when
   cols/rows change. Scrollback: 10,000 rows for shells, 5,000 for Claude/Codex (`model/terminal.ts`). xterm 6.x.

## Split view

- `widgets/split-view/model/layout.ts`: a binary tree of panes (max 4), pure functions + tests. Each pane holds one
  session or none (empty pane → open actions). The layout is **global**, so panes can mix projects.
- Terminals are not children of panes: every session is mounted once in a flat list and absolutely positioned over
  its pane's rect. Re-splitting never remounts xterm; the host resize triggers a refit.
- The focused pane's session is the active one. Focusing a pane from another project switches the sidebar/tabs to it.
  Selecting a project focuses a pane that already shows it, otherwise the focused pane takes that project's last session.
- Tabs are draggable (`shared/lib/sessionDrag.ts`); dropping on a pane edge splits, on the middle replaces.

## Changes panel

- ⌘⇧G (or the ± button in the tab bar) toggles `widgets/changes-panel` on the right, for the selected project.
- Main (`git.ts`, `git:changes`): `git status --porcelain=v1 -b -z` → branch, ahead/behind, files (status letter
  M A D R C U ?); `git diff --no-color HEAD` (falls back to `git diff` before the first commit) plus up to 20
  untracked files as new-file diffs (`--no-index /dev/null`). Output capped at 400 KB, cut at a line end. Read-only,
  `GIT_OPTIONAL_LOCKS=0` so it never fights the agent for `index.lock`.
- Renderer: `entities/diff` parses the diff into files/lines with old/new line numbers and hunk indexes (`parseDiff`,
  tested) and renders `.c-diff` unified or side by side (`toSplitRows`). Clicking a file scrolls to it; j/k move between files.
- Refresh (T25): while the panel is open main keeps one recursive `fs.watch` on the tree (`TreeWatcher`: 400 ms debounce,
  2 s max wait, `.git/` internals and `node_modules` ignored) and sends `git:changed`; the renderer also refreshes on
  window focus and every 45 s as a safety net. Each refresh runs `git status`; the diff is only recomputed when a
  fingerprint (status + HEAD + mtime/size of changed files) changed. The bar shows "git working tree · updated n s ago".
- Since session start: `SessionManager` records HEAD when a session spawns (`startHeadOf`); scope "Since session start"
  diffs against it (`git diff <base>` + untracked), so committed work shows too.
- Review loop: clicking a line opens a comment; "Paste comments" builds one prompt (`file:line`, quoted code, comment)
  and pastes it into the focused session through xterm's `paste` (`entities/session` → `pasteIntoSession`, bracketed paste
  when the CLI asked for it). Nothing is sent — the user presses Enter. "Commit message" / "PR description" paste fixed prompts.
- Stage / revert (`git:action`): file stage/unstage/revert, and hunk stage/revert for a plain modified file with nothing
  staged (the hunk is a patch against HEAD, `git apply [--cached|-R]`). Reverts are confirmed and backed up first: tracked
  state to a `git stash` entry (`stash create` + `stash store`, the tree is not touched), untracked files to the Trash.

## Command palette

- ⌘K toggles `widgets/command-palette` (`.c-palette` on a native `<dialog>`, near the top). It lists open sessions
  (most urgent first: waiting > error > done > working > idle), then projects (sidebar order), then actions.
- Actions: open Claude / Codex / shell, new Claude in worktree, split right / down, changes panel, close session, switch language. The
  workspace passes a handler only for actions that apply right now (no project → no open actions, no session → no close).
- `shared/lib/fuzzy.ts` (tested): the query's characters must appear in order, case-insensitive; word starts
  (incl. camelCase) and consecutive runs score higher, gaps cost a little. A project also matches on group · path,
  ranked below label matches. Matched letters are highlighted.
- ↑↓ (or ⌃N/⌃P) pick, Enter runs, Esc / backdrop closes. Keys are ignored during IME composition (Korean input).
  The command runs on the next frame, after the dialog has closed and returned focus, so the terminal it shows
  takes the keyboard.

## Session history

- ⌘Y (or ⌘K → "Session history") opens `widgets/history-panel`: a wide `Modal` — search, filter (All / Favorites /
  Claude / Codex), past sessions grouped by the folder they ran in (most recent group first), and the selected one's
  detail: actions, meta (agent + account, times, project, folder, branch, messages, id with Copy) and the start of the
  conversation.
- Main (`history.ts`, `HistoryIndex`, read-only): Claude `<configDir>/projects/*/<id>.jsonl` for every account (a dir
  shared by two accounts is read once; `subagents/` folders skipped); codex `threads` of the newest
  `~/.codex/state_<n>.sqlite` via `node:sqlite` with `readOnly: true`, rollout files under `sessions/YYYY/MM/DD/` for
  the text and for sessions the database doesn't have, names from `session_index.jsonl`; archived threads are left out.
  Grouping uses the `cwd` inside the transcript. Parsed files are cached by mtime + size (first scan of ~160 sessions /
  630 MB ≈ 1.7 s, reopening ≈ 10 ms). Kept per session: user + assistant text (no tool calls/results, thinking,
  slash-command wrappers, injected context, sidechains), capped at ~200k characters for search and the preview.
- Title: our name › the CLI's name (Claude `/rename`, codex thread name) › Claude's ai-title › the first message.
  Search: the renderer matches title / first message / folder / branch / id as typed; main's `history:search` adds
  full-text hits (substring, case-insensitive) with a snippet, shown when the hit is only in the conversation.
- Resume (↵ or the button, `features/resume-session` → `history:resume`): main looks the id up in its own index, picks
  the project whose folder (deepest) or `<repo>-wt/…` worktree holds the cwd, and opens a new tab with
  `claude --resume <id>` (the account whose config dir holds it) or `codex resume <id>`; a cwd other than the project
  dir becomes the tab's worktree (so a relaunch restores it there). A folder that isn't a project is added first
  ("Add project and resume"). A missing folder is an error.
- Names and favorites: `~/.aquila/history.json` (`history:set-meta`). Export: save dialog → Markdown of the whole
  conversation, re-read from disk. Claude's `cleanupPeriodDays` (`<configDir>/settings.json`, default 30) is shown in
  the footer, and a session within 7 days of deletion (mtime + period) gets an orange note.
- **Nothing under `~/.claude*` or `~/.codex` is written, renamed or deleted** (a test snapshots the fixture dirs).

## Worktree sessions

- "New Claude in worktree…" (right-click the tab bar's **+**, or the ⌘K palette) opens `features/open-in-worktree`:
  a dialog with a branch field (local branches suggested) and a line saying what will happen and where.
- Main (`worktrees.ts`, `session:create-worktree`): validates the name with `git check-ref-format --branch`, then
  reuses the worktree that already has the branch checked out (`git worktree list --porcelain`, incl. the main one),
  otherwise `git worktree add <repo>-wt/<branch>` next to the main worktree — checking out the branch if it exists,
  else `-b` from the project's **default branch** (T26; when it names a commit) or its current HEAD. Git's own error
  is shown in the dialog. Nothing is ever removed. A worktree made by this call runs the project's **setup script**
  once, visibly, in the session's login shell before the agent starts (the agent starts even if it fails).
- The session (`SessionInfo.worktree = { path, branch }`) spawns with that cwd. The tab shows the branch
  (`.c-tab__branch`, path in the tooltip), as do the pane head, the palette label and the notification title.
- The changes panel follows the focused session: for a worktree session it shows that worktree (main resolves the
  path from the live session id, never from a renderer-supplied path).
- `worktree:info` gives the dialog the repo root, the current branch, local branches and existing worktrees (read-only).

## Restore on relaunch

- Main keeps `~/.aquila/state.json` (version 2) = the open tabs in tab order (`{ key, projectId, kind, account?, worktree?,
  claudeSessionId?, codexSessionId? }`) and the split layout (pane tree with tab **keys** in its leaves + the focused
  pane's index), rewritten on every create / exit / Claude or codex session change / layout change (temp file + rename),
  so a crash keeps them too. `key` is a uuid that stays with the tab across launches. It's read once at startup, before
  any session exists; quitting kills the ptys without overwriting it. The renderer starts sending its layout
  (`layout:save`) only after it restored, so the saved one isn't overwritten first. Smoke never reads or writes it.
- Claude tabs start with `--session-id <uuid>` we generate. The `SessionStart` hook posts Claude's stdin JSON to
  the hook receiver (`POST /hook`), so the saved id follows `/clear` and resumes.
- After the config loads, the renderer calls `restoreSessions()` (once per launch): Claude → `claude --resume <id>`
  if `<configDir>/projects/*/<id>.jsonl` exists (Claude writes it only after the first message), otherwise a new
  session; codex → `codex resume <id>` with the captured id, otherwise a new codex (a T4 `version: 1` file:
  `codex resume --last`); shell → fresh shell under its saved output (cold restore). Tabs of removed projects are
  dropped; a removed account falls back to the project's account. Worktree tabs reopen in their worktree, or are
  dropped if its folder is gone.
- **Visible first:** only the tabs in the saved layout's panes are spawned (no layout: the first tab of the first
  project). The others come back `dormant` (`SessionInfo.dormant`, no pty, no xterm) and keep their place in
  state.json; the renderer calls `startSession(id)` the first time one is on screen and main spawns it under the same
  id. The renderer rebuilds the layout with `fromSaved` (unknown sessions leave their pane empty); if nothing in it is
  left, the first spawned tab goes in the focused pane.
- **Scrollback:** each terminal snapshots its normal buffer as plain text (`entities/session/lib/snapshot.ts`: wrapped
  rows joined, last 2,000 lines) every 10 s when it changed (30 s in power-saver mode) and on unload →
  `session:scrollback` → `~/.aquila/scrollback/<key>.txt` (512 KB cap, tail kept). Plain text on purpose: replaying raw
  escape sequences from the middle of a TUI draws garbage. Closing a tab deletes its file; files of tabs no longer
  saved are pruned at restore.
- **Cold restore:** main writes the saved text into the stream before the session's own output — dimmed, control
  characters stripped, ending with a banner "Previous output · <time> · read-only". Shells always get it. A resumed
  Claude / codex doesn't (the CLI shows its own transcript), but its command is `<resume> || printf '\e]7501;aquila-resume-failed\a'`:
  that marker within 20 s of the spawn (the OSC scanner sees it) shows the saved text with "Couldn't resume the session",
  and the tab drops to its shell in that dir as usual.
- **Codex session ids** (`codex.ts`, read-only): codex writes `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`
  on the first prompt; its first line is `session_meta` with `id` and `cwd`. After Enter in a codex tab that doesn't
  know its id, main reads the heads of rollouts started since that tab spawned (1.5 s and 6 s later) and gives each new
  one to the tab with the same cwd where Enter was typed closest to its start, skipping ids other tabs own.

## Terminal helpers (T28)

`features/terminal-helpers/` draws a `TermOverlay` over each session's terminal (rendered next to `TerminalView` in
split view). It gets the xterm instance through `useTerminal(id)` (`entities/session`, a registry `TerminalView` fills),
so the terminal stays owned by the entity.

- **⌘V with files / an image:** a capture `paste` listener on xterm's root runs before xterm's own. When the clipboard
  carries files, `clipboard:paths` (main, `electron/terminalHelpers.ts`) returns Finder-copied paths as they are, or
  saves the image as `$TMPDIR/aquila-paste/paste-<time>.png` (pruned after a day). The paths are shell-escaped and pasted
  like typed text (bracketed paste), so Claude/Codex attach the image. Plain text paste is untouched.
- **Drop files:** `dragover`/`drop` on the terminal (not tab drags) → `webUtils.getPathForFile` → same escaped paths.
- **Copy last response** (⇧⌘C, palette, right-click): `session:last-reply` reads the tail (4 MB) of the tab's
  transcript — Claude `<configDir>/projects/*/<session id>.jsonl`, Codex `rollout-…-<id>.jsonl` — and returns the text
  of the last assistant message (Claude's text blocks of that message joined; tools and thinking left out). Read-only.
- **Jump to bottom:** xterm 6 already holds the view while you're scrolled up; the overlay watches `viewportY < baseY`
  and shows a button ("New output" once something arrived).
- **Quick select** (⇧⌘E): URLs, paths (`a/b.ts:12`, `~/x`, `README.md`) and commit hashes in the visible rows
  (wrapped rows joined; wide characters mapped to their cells) get home-row labels, nearest to the bottom first; equal
  texts share one. Typing a label copies it, ⇧+label types it into the session, Esc closes. Keys are read by `code`, so
  the Korean input source doesn't matter.
- Electron 45 has no `clipboard` module in the preload: `copyText` goes through `clipboard:write` in main.

## Remote sessions (T29)

A project can live on an SSH host: `project.remote = { alias, claudeConfigDir? }`, and `project.path` is then the
folder **on the host** (`~/…` = the remote home). Added from the sidebar's **+** → "SSH host…" (`RemoteProjectDialog`:
host with suggestions from `~/.ssh/config` (`remote:hosts`, `electron/remote/hosts.ts`, `Host` names without wildcards,
simple `Include`s), folder, name, group, optional `CLAUDE_CONFIG_DIR` on the host). Project settings edit the same fields.

- **Spawn** (`electron/remote/ssh.ts`, pure and tested, incl. a run of the generated script under `sh` with a fake tmux):
  `ssh -t -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ConnectTimeout=15 <alias> -- 'exec "$SHELL" -l -c <script>'`
  — ssh runs its command without a login, so PATH from `~/.profile` (a tmux in `~/.local/bin`) would be missing. The script
  checks for tmux (exit 127 with a message if missing), writes our `~/.aquila/tmux.conf` (the only file we write on the
  host: no status bar, no alternate screen so output scrolls into xterm, `allow-passthrough on`, OSC 52), `cd`s into the
  folder and `exec tmux -L aquila -f ~/.aquila/tmux.conf new-session -A -s aq-<tab key> -c "$PWD" '<inner>'`. Our own
  tmux server (`-L aquila`) never touches the user's. `<inner>` = `exec "$SHELL" -l -i -c '<agent>; exec "$SHELL" -l -i'`
  (same as local: the agent in a login shell, then the shell), with `export CLAUDE_CONFIG_DIR=…` first for Claude when set.
  Claude starts with `--session-id` / `--resume`, codex with `resume <id>` — the plain names on the host's PATH.
- **One tmux session per tab**, named after the stable tab key. `-A` attaches when it exists, so a reconnect and an
  app relaunch both reattach to the running agent (tmux then ignores the command and folder). Closing a tab runs
  `ssh -o BatchMode=yes <alias> tmux -L aquila kill-session -t aq-<key>`; quitting the app doesn't, so relaunch reattaches.
- **Reconnect** (`electron/remote/reconnect.ts`, tested with a manual clock): ssh exit 255 (its own failure: connect
  refused, keepalive timeout) keeps the tab and retries after 3 → 6 → 12 → 60 s, then every 60 s. ssh counts as
  connected after staying up 2.5 s (it prints its own errors, so output alone doesn't mean connected); that resets the
  backoff. After 3 failed attempts the state is `lost` but it keeps trying. Any other exit code is the session ending
  (the agent and shell exited, or no tmux). The pty is replaced per attempt; the xterm, tab and status stay.
  States go to the renderer on `session:connection` (`connecting | connected | reconnecting | lost` + `retryAt`).
- **UI:** a host badge with a connection dot on the tab and pane head (`HostBadge`, `entities/project`), the host badge
  instead of the account badge in the sidebar, and while `lost` a banner over the terminal (`features/remote-connection`:
  countdown, "Reconnect now" → `remote:reconnect`, "the agent keeps running in tmux on the host").
- **Status:** remote Claude has no hooks (they post to 127.0.0.1 on this Mac) and tmux drops unknown OSC sequences, so
  OSC 7501 doesn't reach us (passthrough only forwards sequences the program wraps itself). Remote tabs use the output
  activity heuristic, shown as estimated.
- **Check host** (`remote:check`, `electron/remote/check.ts`): `ssh -o BatchMode=yes` runs one probe in the remote login
  shell: `uname -sm`, `command -v` + version of claude / codex / tmux / git, Claude login (`<dir>/.credentials.json` or
  `oauthAccount` in `.claude.json`), the package manager (for the install hint) and systemd-logind
  `KillUserProcesses` (+ linger). Install commands are only shown, with Copy. A host that needs a password or a new host
  key fails here with ssh's message; the session itself is a real pty and can ask.
- Uses the user's `~/.ssh/config` and ssh-agent; nothing secret is stored. Local-only for now (refused with one
  message by main, hidden in the UI): worktrees, changes panel, session history/resume, "Open in", copy last response,
  port base, setup script, the local account switch.
- **Smoke** (`electron/remote/smoke.ts`): fake `ssh` / `tmux` on PATH run the real script locally: first attempt refused
  → reconnecting → connected; a typed marker comes back; a dropped link (exit 255) → reconnect → output again; closing
  the tab sends `kill-session`.

## Usage gauge (T30)

`electron/usage.ts` + `widgets/usage-gauge`, a band above the sidebar footer. One block per **logged-in local
account** (per config dir, never per session — Claude's statusline `rate_limits` mixes accounts), two meters side by
side: the 5-hour block (with its reset time) and the last 7 days. Labelled "Estimated".

- **Source:** the account's own transcripts, `<configDir>/projects/*/*.jsonl` and `*/<session>/subagents/*.jsonl`,
  read incrementally from a byte offset per file (files untouched for 7 days are skipped). Assistant lines with
  `message.usage`, deduped by message id + request id (Claude writes one line per content block). Read-only.
- **Weight:** input-token equivalents by price ratio: input ×1, output ×5, cache write ×1.25, cache read ×0.1.
- **5-hour block:** starts at the hour of the first message after the previous block ended, lasts 5 h (ccusage's
  rule). No running block → empty, "starts with next message". Weekly is a rolling 7 days (the real reset is unknown).
- **100% mark:** learned. `StopFailure` with `error: rate_limit` from a tab (`SessionManager.claudeAccount`) records
  what that account used then in `~/.aquila/usage-limits.json`. Counted as the 5-hour limit, unless a 5-hour limit is
  known and the block is under 80% of it → the weekly limit. Stored with the account's `userRateLimitTier`
  (or the organization's) from `.claude.json`; a different tier (plan change) drops the limits. Until then the meter
  shows tokens, an outlined empty bar and no percentage.
- **Near (≥ 90%):** one macOS notification per 5-hour block / per day for weekly, and a "New Claude with <other
  account>" button (the other logged-in account with the most room; local projects only).
- **Refresh:** `usage:get` on mount, `usage:changed` pushes: 3 s after each `Stop` hook, every minute while focused,
  every 5 min otherwise, twice as long in power saver. First scan of a busy week ≈ 2 s (async), then ~25 ms.
- Not counted: claude.ai, other machines, remote (SSH) sessions.

## Context gauge (T31)

`electron/context.ts` + `entities/session` `ContextGauge`, a 12px ring in each local Claude tab.

- **Source:** Claude's own statusline JSON. The `--settings` file we pass gets a `statusLine` command that writes stdin
  to `~/.aquila/context/$AQUILA_TAB_ID.json` (temp file + `mv`, prints nothing, no-op outside our tabs). Four settings
  files now: http / legacy hooks, each with and without the statusline (`claude-hooks-status.json`,
  `claude-hooks-legacy-status.json`).
- **User's own status line wins:** before spawning, `statusLineSources` + `userHasStatusLine` read (never write)
  `<configDir>/settings.json`, `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json` and managed settings;
  any `statusLine` there → the plain settings file (ours would replace theirs) and that tab has no gauge.
- **Reading:** `ContextWatcher` clears the folder at launch, `fs.watch`es it, reads a tab's file 250 ms after a burst and
  takes `context_window.used_percentage` (else `current_usage` input + cache tokens ÷ `context_window_size`). Before the
  first message there is nothing to show. Pushes `context:changed` (`{ id, usage | null }`) only when the rounded
  percent or tokens change; `context:get` for a reloaded renderer.
- **Cleared:** tab closed (`SessionManager` `onEnded`) or `SessionEnd` other than `/clear` (Claude quit, the shell
  stays) → file removed, `usage: null`. `/clear` just reports anew.
- **UI:** grey ring; from 60% the number shows and it turns orange, from 85% red. Tooltip: percent, `used of size`
  tokens, and from 60% a /compact hint. Not shown for remote tabs (no hooks there) or smoke.

## Shortcuts

- One map in `src/shared/lib/shortcuts.ts`: `ShortcutId` → Electron accelerator (`CommandOrControl+Shift+T`).
  `matchShortcut(e)` runs it in `pages/workspace/model/useShortcuts.ts` (capture phase, exact modifiers, matched by
  `KeyboardEvent.code` so the Korean input source doesn't break it); `shortcutLabel(id)` / `withShortcut(label, id)` give
  `⇧⌘T` on macOS (Apple order ⌃⌥⇧⌘) and `Ctrl+Shift+T` elsewhere for the palette, buttons and tooltips; native menus
  get the accelerator via `ContextMenuItem.accelerator` (display only). New shortcut → add it to the map, never a literal.

## Korean IME

- xterm's `CompositionHelper` handles Hangul composition (it shows the syllable in `.composition-view` and sends it on
  commit). One gap: while composing, it drops every keydown with keyCode 229, and Chromium can deliver Enter / Tab / Esc /
  Ctrl+<letter> that way — the syllable arrived but Enter or Ctrl+C was lost. `entities/session/lib/imeGuard.ts` runs as
  xterm's custom key handler: such a key is swallowed and its bytes are written after the commit (xterm's commit timer runs
  first, so the order is `글` then `\r`); the same key arriving again as a normal keydown within 100 ms (macOS Chromium does
  that) is dropped instead of sent twice. Text, Backspace inside a syllable and Space stay with xterm.
- `npm run smoke` checks jamo, moving final consonant (한+ㅏ → 하나), composition shown, Enter in three orderings, Space,
  Ctrl+C while composing and right after the 한/영 switch, and ⌘K as `ㅏ`, by comparing the exact bytes sent to the session.

## Status

Main decides every session's status (`electron/status/`: `osc.ts` parser, `tracker.ts` per-session state machine)
and sends `session:status` `{ id, status, estimated?, reason?, since? }` (`since` = when this status started). Sources, most trusted first:

| Source | Sessions | How |
|---|---|---|
| OSC 7501 (Program Status Protocol) | Claude Code 2.1.295+, Codex 0.170+, anything run in a shell tab | Main scans pty output (sequences split across chunks are buffered, ≤4096 bytes). It answers `OSC 7501 ; ?` with `OSC 7501 ; ?:states=idle,working,done,blocked,error:kinds=permission,question,auth ST` **before** forwarding the chunk, so the reply beats xterm's DA1 answer (Claude only reports if it does). Reports: working → working, blocked → waiting, done → done, error → error, idle → idle; records by `id` (background tasks), the most urgent wins; `clear` of everything = the program exited → stopped, back to the fallbacks. Unknown keys/states are ignored. Once a session reports, hooks and output activity no longer set its status. |
| Claude hooks | local `claude` (fallback without 7501) | `UserPromptSubmit`/`PostToolUse`/`PermissionDenied` → working, `PermissionRequest` and `Notification` (`permission_prompt`, `elicitation_dialog` only — never `idle_prompt`) → waiting, `Stop` → done (stays working while `SubagentStart/Stop` count > 0). Always, even with 7501: `StopFailure` → error with reason (rate limit, auth, billing, server; a later done/idle report doesn't hide it until a new turn), `SessionEnd` (not `/clear`) → stopped. |
| Keys typed | all | Through `session:write` (focus/mouse/DA/CPR/OSC replies are filtered out). Without 7501: a key while waiting → working; Esc / Ctrl+C while busy → stopped. With 7501: an Esc / Ctrl+C turns the next `idle` report (within 5 s) into stopped. |
| Output activity | codex / shell that don't report | output for >3s → working; then 3s quiet → done, marked `estimated` (dimmed dot) |
| Exit code | all | 0, 130 or a signal → stopped; anything else → error (`reason: exit`) |

Hooks are `type: "http"` (`url` = the local receiver, `X-Aquila-Session: $AQUILA_TAB_ID` via `allowedEnvVars`,
`timeout: 5`, `onFailure: "continue"`) in `~/.aquila/claude-hooks.json`; the receiver answers 204 with no body, so
`PermissionRequest` never gets a decision. Claude skips http hooks for `SessionStart`, so that one stays a
command + `curl`; Claude older than 2.1.295 (`claude --version` at startup) gets `claude-hooks-legacy.json`, all
command + `curl` posting the same JSON. Raw 7501 reports and hook event names go to `~/.aquila/status.log`
(rotated at 512 KB).

`done` turns `idle` once the session is on screen. Project row = most urgent of its sessions
(`waiting > error > working > done > stopped > idle`).

### Attention (`electron/notify.ts`, `features/next-waiting`)

- **Notifications** for done / waiting / error (not exit errors) when the window isn't focused or the session isn't
  the active one. Title = project (· worktree branch), body = `Claude · Needs input — Bash: npm install`. The detail
  is the `PermissionRequest` tool summary (or the 7501 `msg`, or the `Notification` message) for waiting, and the
  first line of `Stop`'s `last_assistant_message` (or the 7501 `msg`) for done; it is dropped when a new turn starts.
  A notification waits 400 ms to settle (a late hook detail joins it, a waiting → working flap is dropped), and the
  same status for the same session isn't notified twice within 30 s. Click → window up + that exact session.
- **Reminder:** one more notification after 10 min of waiting off screen ("Still waiting after 10 min").
- **Dock badge** = number of sessions in `waiting` (empty at zero).
- **Waiting time:** tabs and project rows show how long a session has waited (`12m`, from `since`, ≥1 min) with
  `.c-elapsed`; the row shows its longest wait.
- **Next waiting session** (⌘J, also in the palette): cycles waiting > error > done across projects, longest wait
  first within a tier; from a session outside that list it jumps to the head.

## Config (`~/.aquila/config.json`)

Renamed from Agentrix: on first start, if `~/.aquila/config.json` doesn't exist, `~/.agentrix` is copied over
(everything except `claude-hooks.json`, which is regenerated). The old folder is left in place.

```jsonc
{
  "language": "ko",                       // "ko" | "en" — toggled from the sidebar footer
  "accounts": { "shared":   { "claudeConfigDir": null },                  // `claude`
                "personal": { "claudeConfigDir": "~/.claude-personal" } },// `claude-personal`
  "groups":   [{ "id": "work" }, { "id": "personal" }], // labels translated; add "label" to override
  "projects": [{ "id": "salt", "name": "SALT", "group": "personal", "account": "shared", "path": "~/Desktop/SALT" }]
}
```

The account switch in the tab bar changes `project.account`; it applies to **new** Claude sessions in that project.

### Managing projects in the app

`features/manage-projects` (used by the sidebar) edits the project list without touching JSON by hand:

- **+** in the sidebar footer → menu: "Local folder…" or "SSH host…" (remote project, T29). Local → native folder picker (`dialog:pick-folder`) → dialog: name (= folder name), group,
  account (preselected from the current project). The new project is selected.
- Right-click a project → native menu (`ui:context-menu`, `electron/menu.ts`): Rename… · Group ▸ (incl. New group…) ·
  Claude account ▸ · Remove from sidebar… (confirm; its open sessions close; files are never touched).
- Right-click a group label → Rename… (blank = default name) · Move up/down · New group… · Remove group (empty only).
- Drag a row onto another row (before/after) or onto a group label / empty group (= last). Empty groups stay visible.
- Every change is one `ProjectEdit` sent on `config:edit-projects`; main applies the pure `applyProjectEdit`
  (`config.ts`, tested) and saves. Ids are slugs of the name, made unique; paths under home are stored as `~/…`.
  If `config.json` couldn't be read, edits fail instead of overwriting it with the defaults.

Account setup (`accounts.ts`): `accounts:status` reads `{ configDirExists, loggedIn }` per account (`loggedIn` =
`.claude.json` has `oauthAccount`; shared reads `~/.claude.json`). An account that isn't logged in gets a "Set up"
button next to the switch → dialog → create the dir (only `~/.claude-*`) and open a Claude session with that account
(`createSession(projectId, 'claude', account)`), where Claude runs its own `/login`. The status re-reads on window
focus and every 5 s while the window is focused and an account is still logged out. The same dialog can preview and,
on an explicit click, append `claude-<id>() { … }` to `~/.zshrc` — skipped if `whence` or the rc already defines it.

## First-run checklist

- `features/first-run`: `useFirstRun` asks main once at launch (`first-run:get`) and opens the checklist while
  `~/.aquila/first-run.json` has no `finished`. Closing it any way (Start / Skip / Esc) sets `finished`, so optional
  things default to skip. ⌘K → "Setup checklist" reopens it (and re-checks).
- Rows: the login shell's PATH was read (`restoreShellPath()` result) · `claude` / `codex` (optional) / `git` with
  version and path, or a copyable install command when missing · project folders (drop folders on the drop zone —
  `webUtils.getPathForFile` in preload — or the folder picker; added to the first group with the shared account) ·
  "log in inside the CLI" hint. Re-checks on window focus (after installing in a terminal) and on "Check again";
  a re-check reads the shell's PATH again first.
- Main (`detect.ts`): finds each tool in PATH (no aliases), runs `<bin> --version` (10 s timeout) and parses the
  version. `/usr/bin/git` is only run when `xcode-select -p` succeeds (otherwise it's the stub that pops the
  installer). "Choose…" opens a file picker; the file is saved in `first-run.json` → `paths` only if it runs
  `--version`. A picked `claude` / `codex` is used (quoted) in the session command instead of the bare name, and for the
  hook-version check; a picked `git` goes first in main's PATH. Smoke never reads or writes `first-run.json`.

## In-app guide

- `features/guide`: `?` in the sidebar footer, ⌘/ (`guide` in the shortcut map) or ⌘K → "Guide" opens a `Modal`
  (design system, shared with T27/T35): searchable feature list on the left, the selected feature's media, 1–2 lines
  and its shortcuts on the right. ↑↓ pick (ignored during IME composition), Esc / × / backdrop close.
- Registry `model/registry.ts`: `{ id, titleKey, bodyKey, media?, shortcuts? }` — shortcuts are ids from
  `shared/lib/shortcuts.ts` (`project1` + `project9` = the ⌘1–⌘9 range), so labels never drift. Body text gets the
  palette's key as `{palette}`. New feature → add an item and its two strings.
- The last item is the full shortcut sheet (`model/sheet.ts`); a test checks it lists every shortcut of the map once.
- Search (`model/search.ts`, tested): fuzzy on the title, then the body containing the query as typed (no scattered
  letters across a long sentence); the sheet also matches every shortcut's name.
- Media (`Media`): a WebP/PNG screenshot or an MP4 loop, muted; under `prefers-reduced-motion` or in power-saver mode
  a video shows its poster. Items without media show a placeholder (title + shortcut) until T24 captures them.
- Offer: when the first-run checklist closes, "Take a tour / Skip" is shown once (`~/.aquila/guide.json`
  `offered`, via `guide:get` / `guide:offered`); opening the guide also counts. Smoke never reads or writes it.

## i18n

`src/shared/i18n/dictionary.ts` holds every string in `ko` and `en` (typecheck fails if a key is missing in one).
Renderer: `useT()`; main (notifications): `translator(config.language)`.

## Build

- Renderer: Vite → `dist/`. Main + preload: `tsc -p tsconfig.electron.json` → `dist-electron/` (CommonJS).
- `node-pty` is native: `postinstall` runs `electron-rebuild`. After changing Electron's version, rerun `npm install`.
- `npm run smoke`: build, launch, open a shell session, verify the pty round-trip, save `dist/smoke.png`, quit (0 ok / 1 fail).
  It also logs whether `claude`/`codex` are on PATH, and opens the first-run checklist from ⌘K (`dist/smoke-first-run.png`) and the guide with ⌘/
  (`dist/smoke-guide.png`, `dist/smoke-guide-shortcuts.png`); it fails when a guide item shows no media. A packaged app saves the screenshot to the temp dir.
- `npm run capture` (T24, `scripts/capture/capture.sh` + `electron/capture.ts`): rebuilds the guide media in
  `src/features/guide/media/` once per language. Each run gets a throwaway `HOME` (`/tmp/aquila-demo`) with a fixture
  zsh prompt, demo `claude`/`codex` scripts that print a fixed transcript and report status over OSC 7501, logged-in
  demo accounts and demo git projects, so no real user data is ever on screen. A scenario per guide item stages
  the state and grabs frames with `capturePage(rect)` at 12 fps; a hidden window encodes them with Chromium's own
  MediaRecorder (VP9 WebM, real-time replay keeps the timing) and canvas WebP, so there's no ffmpeg dependency.
  Output: `<id>.<lang>.webp` (still, or the loop's poster) and `<id>.<lang>.webm` for items that move; 960×600,
  loops ≤ 5 s, ≤ 700 KB per loop and ≤ 250 KB per still (the run fails over budget). The guide finds files with
  `import.meta.glob` (`model/media.ts`); a test and smoke fail when an item has none. New guide item → add a
  scenario in `electron/capture.ts` and run `npm run capture`.
- Finder launches get launchd's minimal PATH. `env.ts` reads the login + interactive shell's PATH once at startup and
  puts it in front (sessions already start a login shell; this is for what main runs directly, like `git`).
- `npm run dist`: electron-builder (`electron-builder.yml`) → `release/*.dmg` + `.zip`, arm64, unsigned. Only `node-pty`
  is a runtime dependency (renderer libraries are bundled by Vite, so they're devDependencies); it's unpacked from the
  asar. Icon: `build/icon.svg` → `npm run icon` → `build/icon.png` (rendered by Electron, `electron/tools/render-icon.ts`).
