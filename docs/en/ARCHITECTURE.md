# Architecture

> 한국어: [../ko/ARCHITECTURE.md](../ko/ARCHITECTURE.md)

```
┌──────── Renderer (src/, React, FSD) ──────┐        ┌──────────── Main (electron/, Node) ─────────────┐
│ app/      entry, global styles            │  IPC   │ main.ts       window + IPC handlers              │
│ pages/    workspace (state hook, shortcuts)│◀──────▶│ config.ts     ~/.agentrix/config.json            │
│ widgets/  sidebar, session-tabs,          │preload │ sessions.ts   one node-pty per session           │
│           split-view                      │        │                                                 │
│ features/ switch-account, switch-language,│  .ts   │ hooks.ts      127.0.0.1:<port> hook receiver     │
│           open-session                    │        │               + ~/.agentrix/claude-hooks.json     │
│ entities/ session (xterm, status), project│        │ smoke.ts      npm run smoke self-check           │
│ shared/   api (types · IPC · bridge), i18n│        │                                                 │
└───────────────────────────────────────────┘        └─────────────────────────────────────────────────┘
                                                              │ spawns (login + interactive zsh)
                                                              ▼
                              claude --settings ~/.agentrix/claude-hooks.json  |  codex  |  $SHELL
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
3. Env per session: `AGENTRIX_TAB_ID`, `AGENTRIX_PORT`, and — for Claude sessions on the **personal** account —
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

## Status

| Source | Sessions | How |
|---|---|---|
| Claude hooks | local `claude` | `UserPromptSubmit`/`PostToolUse` → working, `Notification` → waiting, `Stop` → done. Hook = `curl` to the local receiver. |
| Output activity | codex, shell | output for >3s → working; then 3s quiet → done |
| Exit code | all | non-zero → error |

`done` turns `idle` once the session is on screen. Notifications fire for done/waiting when the window
isn't focused or the session isn't the active one. Project row = most urgent of its sessions
(`waiting > error > working > done > idle`).

## Config (`~/.agentrix/config.json`)

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

## i18n

`src/shared/i18n/dictionary.ts` holds every string in `ko` and `en` (typecheck fails if a key is missing in one).
Renderer: `useT()`; main (notifications): `translator(config.language)`.

## Build

- Renderer: Vite → `dist/`. Main + preload: `tsc -p tsconfig.electron.json` → `dist-electron/` (CommonJS).
- `node-pty` is native: `postinstall` runs `electron-rebuild`. After changing Electron's version, rerun `npm install`.
- `npm run smoke`: build, launch, open a shell session, verify the pty round-trip, save `dist/smoke.png`, quit (0 ok / 1 fail).
