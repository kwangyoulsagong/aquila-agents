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
```

Projects live in `~/.aquila/config.json` (created on first run; "Open settings file" in the sidebar).

## Shortcuts

| Keys | Action |
|---|---|
| ⌘T / ⌘⇧T / ⌘⌥T | Open Claude / Codex / shell in the current project |
| ⌘W | Close session (empty pane: close the pane) |
| ⌘D / ⌘⇧D | Split right / down (up to 4 panes) |
| ⌘⌥←→↑↓ | Move focus between panes |
| ⌘1–9 | Jump to project |

## Docs

- [Architecture](docs/en/ARCHITECTURE.md) · [Design system](docs/en/DESIGN-SYSTEM.md) · [Tasks](docs/en/TASKS.md)
- Agents: [AGENTS.md](AGENTS.md) (Codex) / [CLAUDE.md](CLAUDE.md) (Claude Code)
