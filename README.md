# Aquila Agents

> 한국어: [docs/ko/README.md](docs/ko/README.md)

One window for every Claude Code and Codex session across all your projects.
No more juggling a terminal per project: pick a project on the left, open Claude / Codex / a shell as tabs,
and see at a glance which agent is working, done, or waiting for you.

- **Real CLIs, embedded.** Runs your own `claude` and `codex` in a real terminal — same login, same `CLAUDE.md`,
  hooks, MCP, slash commands, same token usage.
- **Status you can see.** Working / waiting / done per session and per project, plus macOS notifications.
- **Two Claude accounts.** Shared (`claude`) or Personal (`claude-personal`) per project, one click to switch.
- **Korean & English** UI.

## Run

```bash
npm install     # also rebuilds node-pty for Electron
npm run dev     # app with hot reload
npm run smoke   # build, launch, verify a terminal session works, screenshot → dist/smoke.png
npm run check   # typecheck + lint (incl. FSD boundaries) + tests
npm run dist    # package → release/Aquila Agents-<version>-arm64.dmg (+ .zip)
```

Projects live in `~/.aquila/config.json` (created on first run; "Open settings file" in the sidebar).

## Share a build

`npm run dist` writes `release/Aquila Agents-<version>-arm64.dmg` and a `.zip` (Apple Silicon). Bump `version` in
`package.json` before each build you hand out. Builds are **not signed or notarized** yet, so on the receiving Mac:

1. Open the `.dmg` and drag **Aquila Agents** to Applications.
2. The first launch is blocked ("unidentified developer"). Right-click the app → **Open** → **Open**, or run once:
   `xattr -dr com.apple.quarantine "/Applications/Aquila Agents.app"`
3. `claude` and/or `codex` must already be installed and logged in on that Mac (the app runs the real CLIs).

## Shortcuts

| Keys | Action |
|---|---|
| ⌘T / ⇧⌘T / ⌥⌘T | Open Claude / Codex / shell in the current project |
| ⌘W | Close session (empty pane: close the pane) |
| ⌘D / ⇧⌘D | Split right / down (up to 4 panes) |
| ⌥⌘←→↑↓ | Move focus between panes |
| ⇧⌘G | Show / hide the changes panel (git diff) |
| ⌘K | Command palette: jump to a session or project, or run an action |
| ⌘J | Next session that needs you (waiting > error > done, any project) |
| Right-click **+** | New Claude / Codex / shell, or **New Claude in worktree…** (`../<repo>-wt/<branch>`) |
| ⌘1–9 | Jump to project |

## Docs

- [Architecture](docs/en/ARCHITECTURE.md) · [Design system](docs/en/DESIGN-SYSTEM.md) · [Tasks](docs/en/TASKS.md)
- Agents: [AGENTS.md](AGENTS.md) (Codex) / [CLAUDE.md](CLAUDE.md) (Claude Code)
