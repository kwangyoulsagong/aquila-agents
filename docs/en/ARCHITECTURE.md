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
│           manage-projects, next-waiting,  │        │ git.ts        git status + diff (read-only)      │
│ entities/ session (xterm, status), project│        │ state.ts      ~/.aquila/state.json (open tabs)   │
│           diff                            │        │ worktrees.ts  git worktree add / reuse (T7)      │
│           open-in-worktree                │        │ menu.ts       native context menus               │
│                                           │        │ notify.ts     notifications, reminder, Dock badge│
│                                           │        │ status/       OSC 7501 parser + status tracker   │
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
4. pty output → `session:data` → `terminalBus` → the xterm for that id (buffered until mounted).
5. Hidden sessions stay mounted (`hidden`), so scrollback survives; xterm skips painting hidden ones.

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
- Renderer: `entities/diff` parses the diff into files/lines (`parseDiff`, tested) and renders `.c-diff`.
  Clicking a file scrolls to it. Refreshes on window focus and every 5 s while open and visible; nothing polls when closed.

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

## Worktree sessions

- "New Claude in worktree…" (right-click the tab bar's **+**, or the ⌘K palette) opens `features/open-in-worktree`:
  a dialog with a branch field (local branches suggested) and a line saying what will happen and where.
- Main (`worktrees.ts`, `session:create-worktree`): validates the name with `git check-ref-format --branch`, then
  reuses the worktree that already has the branch checked out (`git worktree list --porcelain`, incl. the main one),
  otherwise `git worktree add <repo>-wt/<branch>` next to the main worktree — checking out the branch if it exists,
  else `-b` from the project's current HEAD. Git's own error is shown in the dialog. Nothing is ever removed.
- The session (`SessionInfo.worktree = { path, branch }`) spawns with that cwd. The tab shows the branch
  (`.c-tab__branch`, path in the tooltip), as do the pane head, the palette label and the notification title.
- The changes panel follows the focused session: for a worktree session it shows that worktree (main resolves the
  path from the live session id, never from a renderer-supplied path).
- `worktree:info` gives the dialog the repo root, the current branch, local branches and existing worktrees (read-only).

## Restore on relaunch

- Main keeps `~/.aquila/state.json` = the open tabs in tab order (`{ projectId, kind, account?, worktree?, claudeSessionId? }`),
  rewritten on every create / exit / Claude session change (temp file + rename), so a crash keeps them too. It's read
  once at startup, before any session exists; quitting kills the ptys without overwriting it. Smoke never reads or writes it.
- Claude tabs start with `--session-id <uuid>` we generate. The `SessionStart` hook posts Claude's stdin JSON to
  the hook receiver (`POST /hook`), so the saved id follows `/clear` and resumes.
- After the config loads, the renderer calls `restoreSessions()` (once per launch): Claude → `claude --resume <id>`
  if `<configDir>/projects/*/<id>.jsonl` exists (Claude writes it only after the first message), otherwise a new
  session; codex → `codex resume --last` (codex filters by cwd); shell → fresh shell. Tabs of removed projects are
  dropped; a removed account falls back to the project's account. Worktree tabs reopen in their worktree, or are
  dropped if its folder is gone.

## Shortcuts

- One map in `src/shared/lib/shortcuts.ts`: `ShortcutId` → Electron accelerator (`CommandOrControl+Shift+T`).
  `matchShortcut(e)` runs it in `pages/workspace/model/useShortcuts.ts` (capture phase, exact modifiers, matched by
  `KeyboardEvent.code` so the Korean input source doesn't break it); `shortcutLabel(id)` / `withShortcut(label, id)` give
  `⇧⌘T` on macOS (Apple order ⌃⌥⇧⌘) and `Ctrl+Shift+T` elsewhere for the palette, buttons and tooltips; native menus
  get the accelerator via `ContextMenuItem.accelerator` (display only). New shortcut → add it to the map, never a literal.

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

- **+** in the sidebar footer → native folder picker (`dialog:pick-folder`) → dialog: name (= folder name), group,
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

## i18n

`src/shared/i18n/dictionary.ts` holds every string in `ko` and `en` (typecheck fails if a key is missing in one).
Renderer: `useT()`; main (notifications): `translator(config.language)`.

## Build

- Renderer: Vite → `dist/`. Main + preload: `tsc -p tsconfig.electron.json` → `dist-electron/` (CommonJS).
- `node-pty` is native: `postinstall` runs `electron-rebuild`. After changing Electron's version, rerun `npm install`.
- `npm run smoke`: build, launch, open a shell session, verify the pty round-trip, save `dist/smoke.png`, quit (0 ok / 1 fail).
  It also logs whether `claude`/`codex` are on PATH. A packaged app saves the screenshot to the temp dir.
- Finder launches get launchd's minimal PATH. `env.ts` reads the login + interactive shell's PATH once at startup and
  puts it in front (sessions already start a login shell; this is for what main runs directly, like `git`).
- `npm run dist`: electron-builder (`electron-builder.yml`) → `release/*.dmg` + `.zip`, arm64, unsigned. Only `node-pty`
  is a runtime dependency (renderer libraries are bundled by Vite, so they're devDependencies); it's unpacked from the
  asar. Icon: `build/icon.svg` → `npm run icon` → `build/icon.png` (rendered by Electron, `electron/tools/render-icon.ts`).
