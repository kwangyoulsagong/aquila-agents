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
npm run capture # rebuild the in-app guide's screenshots and loops from demo fixtures (ko + en)
npm run check   # typecheck + lint (incl. FSD boundaries) + tests
npm run dist    # package → release/Aquila Agents-<version>-arm64.dmg (+ .zip)
npm run dist:win # Windows installers → release/AquilaAgents-<version>-{x64,arm64}-setup.exe (builds on macOS too)
```

Projects live in `~/.aquila/config.json` (created on first run; "Open settings file" in the sidebar).

## Share a build

`npm run dist` writes `release/Aquila Agents-<version>-arm64.dmg` and a `.zip` (Apple Silicon). Bump `version` in
`package.json` before each build you hand out, and write its release notes first: `npm run release-notes -- draft`
drafts `release-notes/<version>.json` from the commits since the last tag; finish it in ko + en (3–5 headlines, each a
guide item). `npm run dist` refuses to package while it's missing or has a TODO. Upload the `.dmg`, `.zip` and
`latest-mac.yml` to a GitHub release tagged `v<version>`: installed apps notify about it. Builds are **not signed or
notarized** yet, so on the receiving Mac:

1. Open the `.dmg` and drag **Aquila Agents** to Applications.
2. The first launch is blocked ("unidentified developer"). Right-click the app → **Open** → **Open**, or run once:
   `xattr -dr com.apple.quarantine "/Applications/Aquila Agents.app"`
3. `claude` and/or `codex` must already be installed and logged in on that Mac (the app runs the real CLIs).

**Windows** (10 1809+ / 11, x64 or arm64): `npm run dist:win` writes one installer per architecture and `latest.yml`;
upload all three (plus the `.blockmap` files) to the same release. Installers are **not signed**, so:

1. Run `AquilaAgents-<version>-x64-setup.exe` (or `-arm64-` on ARM PCs). It installs for the current user, no admin.
2. SmartScreen says "Windows protected your PC": click **More info** → **Run anyway**. Only the first install asks;
   updates download in the background and install when you quit (or click the "restart" notification).
3. `claude` and/or `codex` must be installed and logged in on that PC (or inside the WSL distro you open projects in).

## Shortcuts

| Keys | Action |
|---|---|
| ⌘T / ⇧⌘T / ⌥⌘T | Open Claude / Codex / shell in the current project |
| ⌘W | Close session (empty pane: close the pane) |
| ⌘D / ⇧⌘D | Split right / down (up to 4 panes) |
| ⌥⌘←→↑↓ | Move focus between panes |
| ⇧⌘↩ | Zoom the focused pane / restore (or double-click its head) |
| ⌥⇧⌘←→↑↓ | Resize panes (or drag the divider; double-click evens it out) |
| ⇧⌘G | Show / hide the changes panel (git diff) |
| ⌘K | Command palette: jump to a session or project, or run an action |
| ⌘J | Next session that needs you (waiting > error > done, any project) |
| Right-click **+** | New Claude / Codex / shell, or **New Claude in worktree…** (`../<repo>-wt/<branch>`) |
| ⌘1–9 | Jump to project |

## Docs

- [Architecture](docs/en/ARCHITECTURE.md) · [Design system](docs/en/DESIGN-SYSTEM.md) · [Tasks](docs/en/TASKS.md)
- Agents: [AGENTS.md](AGENTS.md) (Codex) / [CLAUDE.md](CLAUDE.md) (Claude Code)
