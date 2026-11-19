# Architecture

> 한국어: [../ko/ARCHITECTURE.md](../ko/ARCHITECTURE.md)

```
┌──────── Renderer (src/, React, FSD) ──────┐        ┌──────────── Main (electron/, Node) ─────────────┐
│ app/      entry, global styles            │  IPC   │ main.ts       window + IPC handlers              │
│ pages/    workspace (state hook, shortcuts)│◀──────▶│ config.ts     ~/.aquila/config.json              │
│ widgets/  sidebar, session-tabs,          │preload │ sessions.ts   one node-pty per session           │
│           split-view, changes-panel       │        │ accounts.ts   account status, ~/.claude-* dir,   │
│ features/ switch-account, switch-language,│  .ts   │               zsh function (explicit click)      │
│           open-session, setup-account     │        │ hooks.ts      127.0.0.1:<port> hook receiver     │
│                                           │        │               + ~/.aquila/claude-hooks.json       │
│ entities/ session (xterm, status), project│        │ git.ts        git status + diff (read-only)      │
│           diff                            │        │ smoke.ts      npm run smoke self-check           │
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

## Status

| Source | Sessions | How |
|---|---|---|
| Claude hooks | local `claude` | `UserPromptSubmit`/`PostToolUse` → working, `Notification` → waiting, `Stop` → done. Hook = `curl` to the local receiver. |
| Output activity | codex, shell | output for >3s → working; then 3s quiet → done |
| Exit code | all | non-zero → error |

`done` turns `idle` once the session is on screen. Notifications fire for done/waiting when the window
isn't focused or the session isn't the active one. Project row = most urgent of its sessions
(`waiting > error > working > done > idle`).

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
