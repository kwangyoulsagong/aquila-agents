# Tasks

> 한국어: [../ko/TASKS.md](../ko/TASKS.md)

Built so far (v0.1 base): sidebar with groups/projects, tabs per project, real `claude` / `codex` / shell / ssh
in xterm (WebGL), Claude status via hooks, activity status for others, notifications, shared/personal Claude
account per project, ko/en UI, design system, shortcuts ⌘T ⌘⇧T ⌘⌥T ⌘W ⌘1–9.

**How to run tasks in parallel:** one task per session, each on its own branch/worktree
(`git worktree add ../agentrix-T1 -b task/T1-split-view`). Stay inside **Owns**. Touch shared files
(`pages/workspace/*`, `src/shared/api/types.ts`, `src/shared/i18n/dictionary.ts`, `electron/main.ts`, `electron/preload.ts`, `components.css`)
only with small additive edits. Merge order follows the numbering when two tasks touch the same shared file.

---

### T1 · Split view
- [ ] **Goal:** see and chat with 2–4 sessions at once (any projects).
- **UX:** ⌘D split right, ⌘⇧D split down, ⌘⌥←/→/↑/↓ move focus, drag a tab onto a pane edge to split there.
  Each pane has `.c-pane__head` (status dot · kind · project · account). Focused pane gets `data-focused`.
- **Owns:** `src/widgets/split-view/`, `src/widgets/split-view/model/layout.ts` (+ test), `src/widgets/session-stage/`.
- **Done:** layout persists while switching projects; closing a session collapses its pane; xterm refits on resize.

### T2 · Account setup (Shared `claude` / Personal `claude-personal`)
- [ ] **Goal:** a user without `claude-personal` can set it up from the app.
- **Spec:**
  - Main: `accounts:status` → for each account `{ configDirExists, loggedIn }` (`loggedIn` = `<dir>/.claude.json`
    contains `oauthAccount`; shared uses `~/.claude.json`).
  - If Personal isn't set up, `AccountSwitch` shows a dot + "Set up" → creates the dir and opens a Claude
    session with that account (Claude runs its own `/login`).
  - Optional, **explicit click only**: "Use `claude-personal` in your terminal too" → appends
    `claude-personal() { CLAUDE_CONFIG_DIR="$HOME/.claude-personal" command claude "$@"; }` to `~/.zshrc`
    if not already defined (show a preview first). This is the only place we may write to an rc file.
- **Owns:** `electron/accounts.ts`, `src/features/setup-account/`, `src/features/switch-account/`.

### T3 · Changes panel
- [ ] **Goal:** see what agents changed without leaving the app.
- **UX:** ⌘⇧G toggles `.c-panel` on the right: branch, changed files (status letter + path), unified diff with
  `.c-diff__line--*`. Refresh on focus and every 5s while open.
- **Owns:** `electron/git.ts` (`git status --porcelain=v1 -b`, `git diff --no-color`, 400 KB cap),
  `src/widgets/changes-panel/`, `src/entities/diff/` (parseDiff + test).

### T4 · Restore sessions on relaunch
- [ ] **Goal:** reopening the app brings tabs back.
- **Spec:** save open tabs to `~/.agentrix/state.json`. Claude: start with `--session-id <uuid>` we generate, restore with
  `claude --resume <uuid>`. Codex: `codex resume --last` in that dir. Shell: fresh shell.
- **Owns:** `electron/state.ts`, small additions in `sessions.ts`.

### T5 · Projects UI (no JSON editing)
- [ ] **Goal:** add/rename/remove/reorder projects and groups in the app.
- **UX:** "+" at the bottom of the sidebar → folder picker (`dialog.showOpenDialog`), name = folder name,
  pick group + account. Right-click row → rename / change group / remove. Drag to reorder.
- **Owns:** `src/features/manage-projects/`, `electron/config.ts` (add save helpers).

### T6 · Command palette
- [ ] **Goal:** ⌘K jumps to any project/session or runs an action.
- **Owns:** `src/widgets/command-palette/`, `src/shared/lib/fuzzy.ts` (+ test).

### T7 · Worktree sessions
- [ ] **Goal:** "New Claude in worktree" creates `../<repo>-wt/<branch>` and opens the session there; tab shows the branch.
- **Owns:** `electron/worktrees.ts`, `src/features/open-in-worktree/`.

### T8 · Packaging
- [ ] **Goal:** `npm run dist` → `Agentrix.app` (arm64) the user drags to /Applications.
- **Spec:** electron-builder, icon from the design system (dark tile, accent mark), asar with `node-pty` unpacked.
- **Owns:** `electron-builder.yml`, `build/`, `package.json` scripts.

### T9 · Battery check
- [ ] **Goal:** numbers, not guesses.
- **Spec:** `scripts/measure-energy.sh` samples `top -l 6 -s 5 -o power` for Agentrix vs Terminal.app with
  the same 3 sessions; write results to `docs/en/ENERGY.md` + `docs/ko/ENERGY.md`.
- **Owns:** `scripts/`, those two docs.

### T10 · Light theme (later)
- [ ] Add `[data-theme='light']` semantic remap in `tokens.css`; terminal theme follows. No component changes allowed.

### T11 · Session history · delete sessions · clear memory
- [ ] **Goal:** per project, browse past sessions, resume one, delete ones you don't need, and wipe Claude's project memory.
- **Data (read):**
  - Claude: `<configDir>/projects/<encoded-cwd>/*.jsonl` (encoded-cwd = absolute path with `/` and `.` → `-`),
    for **each** account's config dir (`~/.claude`, `~/.claude-personal`). Title = first user message, plus
    last-modified time, message count, account.
  - Codex: `~/.codex/sessions/**/rollout-*.jsonl` whose `cwd` matches the project.
- **UX:** "History" (⌘Y) panel in `.c-panel`: list grouped by day, search box, per row: Resume · Delete.
  Resume = new tab running `claude --resume <id>` (right account) / `codex resume <id>`.
  Project menu: "Clear Claude memory" → `<configDir>/projects/<encoded-cwd>/memory/`.
  Session tab menu: "Clear context" → sends `/clear` + Enter to that Claude pty (no files touched).
- **Safety (required):** delete and clear-memory **move to macOS Trash** (`shell.trashItem`), never `rm`.
  Always confirm in an in-app dialog that names exactly what goes (count + paths). Never touch a session that is
  currently open in a tab. These are the only places we may write inside `~/.claude*` / `~/.codex`.
- **Owns:** `electron/history.ts` (+ test for path encoding/parsing with fixture files), `src/widgets/history-panel/`, `src/features/resume-session/`,
  `src/features/delete-session/`, `src/features/clear-memory/`, `src/shared/ui/ConfirmDialog.tsx`.

### T12 · System monitor (CPU · RAM · battery · per session)
- [ ] **Goal:** see machine load at a glance and which session is eating it.
- **UX:** a compact meter strip in the sidebar footer: CPU %, memory used / total with a pressure color
  (`--color-status-done` normal, `-waiting` warn, `-error` critical), swap used, battery % + charging + time left.
  Click → popover with per-session rows (project · kind · CPU % · RAM) and the top 5 other processes
  (so you spot e.g. a forgotten `next dev`). Tab tooltip shows that session's CPU/RAM.
- **Data (main, no new deps):** CPU from `os.cpus()` deltas; memory from `vm_stat` + `sysctl hw.memsize` +
  `sysctl vm.swapusage` + `memory_pressure -Q`; battery from `pmset -g batt`; per session: sum `ps -Ao pid,ppid,%cpu,rss`
  over the pty pid's process tree.
- **Battery-aware:** poll every 3s only while the window is visible and focused, every 15s when unfocused, stop when hidden.
- **Owns:** `electron/system.ts` (+ test for `vm_stat`/`pmset`/`ps` parsers with fixture output),
  `src/widgets/system-meter/`, `src/entities/system/`.
