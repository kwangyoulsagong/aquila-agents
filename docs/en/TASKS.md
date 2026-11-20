# Tasks

> 한국어: [../ko/TASKS.md](../ko/TASKS.md)

Built so far (v0.1 base): sidebar with groups/projects, tabs per project, real `claude` / `codex` / shell
in xterm (WebGL), Claude status via hooks, activity status for others, notifications, shared/personal Claude
account per project, ko/en UI, design system, shortcuts ⌘T ⌘⇧T ⌘⌥T ⌘W ⌘1–9.

**How to run tasks in parallel:** one task per session, each on its own branch/worktree
(`git worktree add ../aquila-T1 -b task/T1-split-view`). Stay inside **Owns**. Touch shared files
(`pages/workspace/*`, `src/shared/api/types.ts`, `src/shared/i18n/dictionary.ts`, `electron/main.ts`, `electron/preload.ts`, `components.css`)
only with small additive edits. Merge order follows the numbering when two tasks touch the same shared file.

---

### T1 · Split view
- [x] **Goal:** see and chat with 2–4 sessions at once (any projects).
  _Left over: pane sizes are fixed halves (no drag-to-resize divider); single pane shows no `.c-pane__head` (the tab bar already says it)._
- **UX:** ⌘D split right, ⌘⇧D split down, ⌘⌥←/→/↑/↓ move focus, drag a tab onto a pane edge to split there.
  Each pane has `.c-pane__head` (status dot · kind · project · account). Focused pane gets `data-focused`.
- **Owns:** `src/widgets/split-view/`, `src/widgets/split-view/model/layout.ts` (+ test), `src/widgets/session-stage/` (merged into split-view).
- **Done:** layout persists while switching projects; closing a session collapses its pane; xterm refits on resize.

### T2 · Account setup (Shared `claude` / Personal `claude-personal`)
- [x] **Goal:** a user without `claude-personal` can set it up from the app.
  _Left over: the setup dialog (and its zshrc option) is only reachable while an account is logged out._
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
- [x] **Goal:** see what agents changed without leaving the app.
  _Left over: read-only (no stage/discard); untracked diffs limited to 20 files; panel width is fixed._
- **UX:** ⌘⇧G toggles `.c-panel` on the right: branch, changed files (status letter + path), unified diff with
  `.c-diff__line--*`. Refresh on focus and every 5s while open.
- **Owns:** `electron/git.ts` (`git status --porcelain=v1 -b`, `git diff --no-color`, 400 KB cap),
  `src/widgets/changes-panel/`, `src/entities/diff/` (parseDiff + test).

### T4 · Restore sessions on relaunch
- [x] **Goal:** reopening the app brings tabs back.
  _Left over: split layout and which tab was focused aren't restored (opens the first project's tab); two codex tabs in one project both resume the same last session; shells don't keep cwd/scrollback._
- **Spec:** save open tabs to `~/.aquila/state.json`. Claude: start with `--session-id <uuid>` we generate, restore with
  `claude --resume <uuid>`. Codex: `codex resume --last` in that dir. Shell: fresh shell.
- **Owns:** `electron/state.ts`, small additions in `sessions.ts`.

### T5 · Projects UI (no JSON editing)
- [x] **Goal:** add/rename/remove/reorder projects and groups in the app.
  _Left over: groups reorder by menu (Move up/down), not drag; a project's path can't be changed in the app; no duplicate-folder warning._
- **UX:** "+" at the bottom of the sidebar → folder picker (`dialog.showOpenDialog`), name = folder name,
  pick group + account. Right-click row → rename / change group / remove. Drag to reorder.
- **Owns:** `src/features/manage-projects/`, `electron/config.ts` (add save helpers).

### T6 · Command palette
- [x] **Goal:** ⌘K jumps to any project/session or runs an action.
  _Left over: no "Add project" action (the folder-picker flow lives in the sidebar); no recently-used ordering._
- **Owns:** `src/widgets/command-palette/`, `src/shared/lib/fuzzy.ts` (+ test).

### T7 · Worktree sessions
- [x] **Goal:** "New Claude in worktree" creates `../<repo>-wt/<branch>` and opens the session there; tab shows the branch.
  _Left over: no way to remove a worktree from the app (use `git worktree remove`); Claude only (codex/shell in a worktree is supported by the API but has no button)._
- **Owns:** `electron/worktrees.ts`, `src/features/open-in-worktree/`.

### T8 · Packaging
- [x] **Goal:** `npm run dist` → `Aquila Agents.app` (arm64) the user drags to /Applications.
  _Left over: unsigned/not notarized (receivers clear quarantine, see README), no auto-update, arm64 only, no Windows build, no in-app CLI-missing screen yet (PATH is restored)._
- **Spec:** electron-builder, icon from the design system (dark tile, accent mark), asar with `node-pty` unpacked.
- **Owns:** `electron-builder.yml`, `build/`, `package.json` scripts.

---

## Roadmap after v0.1

Source: [`docs/research/`](../research/README.md) (usability research, 2026-11-19, roadmap items `#n`). Everything in **Now** is macOS only, then distribution (**Release**). Everything Windows-related is pushed to the end
(**Windows (later)**). Within Now, the shortcut map (T13) and the status engine (T14) come first because almost everything else builds on them.

## Now

### T13 · Shortcut map
- [x] **Goal:** one shortcut list that every part of the app reads, so shortcuts never drift apart. (#1)
  _Left over: there is no app menu bar yet (only the **+** context menu shows accelerators). The guide (T23) reads the map._
- **Spec:** one map in `src/shared/lib/shortcuts.ts` (`CommandOrControl`-style ids, so Windows can reuse it later) that
  the key handler, the palette, menus and the guide all read; labels show ⌘ on macOS.
- **Owns:** `src/shared/lib/shortcuts.ts` (+ tests), `useShortcuts.ts`.

### T14 · Status engine: OSC 7501 first, http hooks
- [x] **Goal:** "who is waiting for me" is right and immediate; no false "done". (#25, #2, #3, #24)
  _Left over: Codex 0.170 emits 7501 in our pty (idle seen; working/blocked not yet observed live), so the OSC 9 `-c` fallback wasn't added — old Codex falls back to output activity. http-hook events other than SessionStart weren't exercised live (needs a prompt). Hook payloads (tool summary, `last_assistant_message`) are parsed but not used yet — T15._
- **Spec:**
  - Main answers the OSC 7501 query in the pty stream (`OSC 7501 ; ?` → `states=idle,working,done,blocked,error :
    kinds=permission,question,auth`), parses reports (sequences split across chunks are buffered), and uses them as the
    primary status for Claude Code 2.1.295+ (and Codex if it emits them — spike first). Unknown keys/states ignored,
    raw reports in a debug log, heuristics kept as fallback.
  - Hooks switch to `type: "http"` on all platforms (`url` to the local receiver, `X-Aquila-Session` header from
    `AQUILA_TAB_ID`, `timeout: 5`, `onFailure: "continue"`); command+curl only for old Claude versions
    (`claude --version`). Add `PermissionRequest` (→ waiting at once, no decision returned), `StopFailure` (→ error:
    rate limit, auth, billing, server), clear waiting on `PermissionDenied` / `PostToolUse` / `UserPromptSubmit` / a key
    typed into that session. Never use `idle_prompt`. Keep `SubagentStart/Stop` counts so a Stop during subagents stays working.
  - New status `stopped` (Ctrl+C / normal exit) separate from `error`. Heuristic "done" is shown as estimated (dimmed).
  - Codex fallback only if it doesn't emit 7501: `-c tui.notifications=true -c tui.notification_method="osc9"
    -c tui.notification_condition="always"` and catch OSC 9.
- **Owns:** `electron/hooks.ts`, `electron/status/` (osc parser + tests), status parts of `sessions.ts`, `entities/session` status.

### T15 · Attention: badge, next waiting, notifications with context
- [x] **Goal:** never hunt for the tab that needs you. (#5, #6)
  _Left over: the waiting time / detail with real Claude prompts wasn't exercised live (smoke can't stage a permission prompt); "on screen" still means the focused session only, not every visible split pane; reminder is fixed at 10 min (no setting)._
- **Spec:** waiting count on the Dock badge (macOS) . Shortcut
  "next waiting session" across projects (cycles waiting > error > done), plus "waiting for 12 min" elapsed time on the
  tab/row and one reminder. Notification body: project · tab · first line of `last_assistant_message` (Stop), or the
  `PermissionRequest` tool summary ("Bash: npm install"). Debounce same-status repeats; click focuses that exact session
  (exists). No notification when the session is already on screen (exists).
- **Owns:** `electron/notify.ts`, `src/features/next-waiting/`, small changes in `sessions.ts`, `useShortcuts.ts`.

### T16 · Terminal performance
- [x] **Goal:** 15+ sessions stay smooth and light. (#4, #18, #19)
  _Measured (`npm run perf`, 15 shells, 2 on screen, before → after): streaming agent-like output 493 → 127 IPC msgs/s, CPU 3.6 → 2.8 %; `yes` flood 22,700 → 280 msgs/s, CPU 13 → 9 %, renderer 470 → 310 MB, Ctrl+C 14 ms / no answer within 10 s → 21 ms; 120 fps throughout. Changed from the spec: hidden terminals keep WebGL up to 12 (gpuPool), since dropping it on every hidden one cost +125 MB. Left over: real Claude/Codex sessions weren't used (shells streaming similar output)._
- **Spec:** WebGL only on visible panes (≤4); hidden → dispose + `term.refresh(0, rows-1)`; context loss → DOM renderer.
  Upgrade `@xterm/xterm` 5.5 → 6.x with matching addons (webgl 0.19, fit 0.11, web-links 0.12 — today 5.5 is mixed
  with webgl 0.19); recheck scroll/viewport and smoke. Main batches pty output (16 ms or 64–100 KB; hidden sessions
  100–250 ms) with renderer ACK flow control (pause at 5 pending, resume at 2); test: `yes` then Ctrl-C responds fast.
  Resize: coalesce in rAF, call `fit()`/pty resize only when cols/rows change. Scrollback per kind instead of 10,000 for all.
- **Owns:** `src/entities/session/` (TerminalView, terminalBus), `electron/sessions.ts` output path, `package.json` xterm deps.

### T17 · First-run checklist
- [x] **Goal:** the first launch never fails silently. (#7)
  _Left over: the "missing CLI" state was only checked in `design-system/preview.html` (this Mac has all three); existing users also see the checklist once after updating; dropping folders outside the checklist (e.g. on the sidebar) isn't supported; removing a picked `git` keeps its folder in PATH until relaunch; the default config's sample projects aren't flagged when their folders don't exist._
- **Spec:** checklist screen: PATH restored (macOS, exists), `claude` / `codex` / `git` found  with versions; missing → copyable install command; manual binary path override; "Add folder" (drag & drop);
  "log in inside the CLI" hint. Optional things default to Skip. Shown once (state in `~/.aquila/`), reopenable.
- **Owns:** `src/features/first-run/`, `electron/detect.ts` (+ tests).

### T18 · Korean IME
- [x] **Goal:** Hangul input never breaks in our host. (#8)
  _Left over: smoke drives composition through Chromium's IME path via CDP (`Input.imeSetComposition`), not the real macOS 2-Set input method — the event orderings it stages are the known Chromium ones, real typing wasn't recorded; Windows IME is still in T19. `D2Coding` was already in `--font-family-mono`._
- **Spec:** regression checklist run by smoke: jamo split, duplicate input, composition shown while
  typing, Enter/Space during composition, Ctrl/⌘ shortcuts right after 한/영 switch. Fix in our input layer (follow VS
  Code's xterm integration).  Font fallback `"D2Coding"` in `--font-*` tokens.
- **Owns:** `electron/smoke.ts` (IME scenarios), IME handling in `TerminalView`, font tokens.

### T9 · Battery check + power profile
- [x] **Goal:** numbers, not guesses — and use less power on battery. (#26)
  _Left over: the comparison with Terminal.app / Ghostty / iTerm2 using 5 real Claude sessions wasn't run (Ghostty and iTerm2 aren't installed here; real sessions need a person) — the script is ready, see [ENERGY.md](ENERGY.md). Measured with `npm run perf` instead: in saver mode streaming CPU went 2.8 → 0.9 %. `top` shows 0 idle wakeups for Electron processes here, so wakeups come from `getAppMetrics` or `POWERMETRICS=1`._
- **Spec:** `scripts/measure-energy.sh`: `top -l 6 -s 5 -o power`, `powermetrics --samplers tasks` idle wakeups/s,
  `yes` Ctrl-C test; Aquila Agents vs Terminal.app / Ghostty / iTerm2 with the same sessions (5 Claude, 1 streaming).
  Results in `docs/en/ENERGY.md` + `docs/ko/ENERGY.md`. Power profile from `powerMonitor` (`on-battery`,
  `speed-limit-change`, macOS `thermal-state-change`): longer poll intervals, no cursor blink / looping animations.
  
- **Owns:** `scripts/`, `electron/power.ts`, those two docs.

### T21 · Restore v2
- [x] **Goal:** relaunch brings back content too, fast. (#14 + T4 leftovers)
  _Left over: saved output is plain text (no colors); a resumed Claude/codex shows only its own transcript, saved output appears only if the resume fails; codex ids are matched by cwd + Enter time (a heuristic), and `/new` inside codex keeps the old id; shells still don't keep cwd if you `cd`'d elsewhere._
- **Spec:** save the last scrollback per tab to `~/.aquila/`; if resume fails, show it read-only and open a fresh shell
  in that dir (cold restore). Spawn the visible tabs first, background tabs on first click. Capture codex session ids so
  two codex tabs resume their own sessions. Restore the split layout and the focused tab.
- **Owns:** `electron/state.ts`, `src/widgets/split-view/model/` (layout save/restore).

### T22 · Panes: zoom + resize
- [x] **Goal:** read long output without re-splitting. (#15 + T1 leftover)
  _Left over: zoom isn't restored after a relaunch (sizes are); focusing another pane leaves zoom (tmux-style); dividers don't take keyboard focus (resize with ⌥⇧⌘arrows)._
- **Spec:** toggle pane zoom (one pane fills the stage, toggle back); drag the divider and keyboard resize; sizes kept
  in the layout tree.
- **Owns:** `src/widgets/split-view/`.

### T23 · In-app guide (? button)
- [x] **Goal:** every feature is discoverable without docs. (#16, owner)
  _Left over: no item has media yet — each shows a placeholder (title + shortcut) until T24 captures them into `src/features/guide/media/`; the registry field is `shortcuts: ShortcutId[]` (several per feature) instead of one `shortcutId`._
- **Spec:** `?` in the sidebar footer, ⌘/. Modal: searchable feature list on the left;
  screenshot or short loop (bundled WebP/MP4, still frame under reduced motion), 1–2 lines and the shortcut on the right.
  Registry `{ id, titleKey, bodyKey, media, shortcutId }`; shortcuts read from T13's map; includes the full shortcut
  sheet. Offered once after the first-run checklist ("Take a tour / Skip"), state in `~/.aquila/`. Modal shell =
  design-system component (shared with T27 and T35).
- **Owns:** `src/features/guide/`, `design-system/react/` modal, `components.css` (additive).

### T24 · Smoke capture for guide media
- [x] **Goal:** guide and release-note media never go stale. (#17, owner)
  _Left over: `npm run capture` is run by hand, not in CI; `notify` and `power` show a workspace still (macOS notifications, the Dock badge and saver mode can't be captured from the page); release-note media wait for T27. Spotted: with the changes panel open at 1440 px, the page scrolls sideways and the sidebar footer clips (not fixed here)._
- **Spec:** smoke scenarios stage a demo state per guide item from fixed fixtures (no real user data), capture
  `capturePage(rect)`  in ko/en, encode short animations (tool to pick); smoke fails when an item has
  no media. Budget: resolution and 3–5 s length.
- **Owns:** `electron/smoke.ts`, `scripts/capture/`, `src/features/guide/media/`.

### T25 · Changes panel v2: watch + review loop
- [x] **Goal:** review what the agent did and send feedback without leaving the app. (#20, #21)
  _Left over: hunk stage/revert only on a plain modified file with nothing staged (otherwise file-level only); no unstage per hunk; a worktree session's index lives outside its tree, so staging there from a terminal shows up on the 45 s poll or focus; comments are kept per panel, not across relaunches._
- **Spec:** replace the 5 s poll with `fs.watch` (recursive) + 300–500 ms debounce + lazy diff, 30–60 s poll as a safety
  net; show "git working tree · updated n s ago". Unified / side-by-side, j/k between files. Line comments → a prompt
  (`file:line` + quoted code + comment) pasted into the focused session's input; the user presses Enter. Then hunk/file
  stage and revert with confirm (and a stash backup), "diff since session start" (HEAD recorded at spawn), buttons that
  paste "write a commit message / PR description" prompts. 
- **Owns:** `electron/git.ts`, `src/widgets/changes-panel/`, `src/entities/diff/`.

### T11 · Session history (read-only)
- [x] **Goal:** find and resume any past session — the gap the CLI pickers leave. (#22)
  _Left over: full-text search covers the first ~200k characters per session (export has everything); the panel rescans on open (cached, no live watch); Claude's ai-title is used as a title fallback; codex archived threads are hidden._
- **Spec:** ⌘Y panel: Claude `<configDir>/projects/*/*.jsonl` for each account, Codex jsonl rollouts **and** its SQLite
  stores (read-only adapter). Group by the `cwd` field inside the transcript, not the encoded dir name. Row: custom name
  (else first user message), last activity, branch/cwd, account, copy session id. Search name, first message and full
  text. Resume always by id in a new tab (`claude --resume <id>` with the right account / `codex resume <id>`). Warn about
  the 30-day `cleanupPeriodDays` deletion; export as Markdown. Names and favorites live in `~/.aquila/` (never in `~/.claude*`).
  **Nothing is deleted or written in `~/.claude*` / `~/.codex`.**
- **Owns:** `electron/history.ts` (+ tests with fixture files), `src/widgets/history-panel/`, `src/features/resume-session/`.

### T26 · Project settings
- [x] **Goal:** per-project defaults instead of JSON. (#23 + T5 leftovers)
  _Left over: "location" (this Mac / SSH) waits for T29; the default agent drives the tab bar's + and the empty state, not ⌘T/⌘⇧T; "Open in" offers a fixed app list (not filtered by what's installed); open sessions keep their old folder after a path change._
- **Spec:** project settings dialog: path (changeable), location (this Mac / SSH host, see T29),
  default agent, default branch, setup script, port base, "Open in" editor; duplicate-folder warning; "Add project"
  in the palette.
- **Owns:** `src/features/manage-projects/`, `electron/config.ts`.

### T28 · Terminal helpers
- [x] **Goal:** small host-side fixes for daily annoyances. (#27)
  _Left over: quick select reads the screen once when opened (labels don't follow output that scrolls meanwhile) and only the visible rows; the right-click menu has no Paste; ⌘V with an image is checked by unit tests and capture, not yet by hand with a real screenshot in Claude._
- **Spec:** ⌘V with an image on the clipboard (and drag & drop of files) → temp file, path typed into the session;
  "copy last response"; scrolling up pauses auto-scroll and shows a "jump to bottom" button; keyboard URL/path picker
  (QuickSelect style).
- **Owns:** `src/features/terminal-helpers/`, small changes in `TerminalView`.

### T29 · Remote sessions (SSH) MVP
- [x] **Goal:** open a project on this Mac or on an SSH host. (#43, #44, owner)
  _Left over: tried by hand against a real host (Ubuntu, tmux 3.2a in `~/.local/bin`): host check, connect, a killed link reattaching to the same shell, kill-session on close — through the same argv, not yet clicked through in the app; the UI is checked through preview.html only (smoke can't open the native "+" menu). No agent session on a real host yet (that host has no claude/codex). OSC 7501 does not survive tmux (it drops unknown OSC; passthrough needs the program to wrap it), so remote tabs use the output heuristic; remote Claude hooks (e.g. `ssh -R` to our hook port) not done. Config is `project.remote = { alias, claudeConfigDir }` with `project.path` = the folder on the host, instead of `location`. No in-app guide entry yet (needs captured media). Relaunch reattaches through `new-session -A` per tab rather than reading `tmux -L aquila ls`._
- **Spec:** `project.location = local | ssh { alias, path, claudeConfigDir }`. Run with
  `ssh -t <alias> -- tmux -L aquila new-session -A -s aq-<id> -c <path> -e CLAUDE_CONFIG_DIR=… '<cmd>'` (own tmux server,
  remote `~/.aquila/tmux.conf` with `allow-passthrough on`). Reconnect with 3→6→12→60 s backoff, `ServerAliveInterval=20`,
  reattach on relaunch from `tmux -L aquila ls`. Status through the same OSC parser as T14 (verify 7501 round-trip through
  tmux), output heuristic as fallback. First connect: check `uname`, `claude`/`codex`/`tmux`/`git` and login; only *show*
  install commands. Uses the user's `~/.ssh/config` and ssh-agent; no secrets stored; nothing written outside remote
  `~/.aquila/`. UI: host badge, connection dot (connected / reconnecting / lost), banner when lost; note about
  `KillUserProcesses=yes`.
- **Owns:** `electron/remote/`, `src/entities/project` (host badge), small changes in `sessions.ts`, `config.ts`.

### T30 · Usage gauge per account
- [x] **Goal:** see how much of the 5-hour and weekly limits is left, per account. (#33)
  _Left over: estimated from local transcripts (owner's pick over the undocumented OAuth usage API); the 100% mark is learned from the first `StopFailure: rate_limit`, so a fresh install shows tokens without a percentage, and which window ran out is a heuristic (the hook doesn't say). Weekly is a rolling 7 days, not the account's real reset time. claude.ai, other machines and remote sessions aren't counted. Not yet hit a real rate limit in the app (learning is unit-tested); no in-app guide entry (needs captured media)._
  _T30b: real percentages and reset times from `claude -p /usage` (per account, hidden, no quota) and Codex's session files, with the estimate as the fallback; a Codex row. Checked live: shared 8% / 78%, personal 9% / 40%, Codex 0% (30-day window). Not yet seen a real 90% notification with live values._
- **Spec:** per account config dir (not per session — statusline mixes accounts), bars side by side with reset time,
  labelled "estimated"; near the limit → notice + "open a new session with the other account".
- **Owns:** `electron/usage.ts`, `src/widgets/usage-gauge/`.

### T31 · Context gauge per tab
- [x] **Goal:** see context use before auto-compact surprises you. (#34)
  _Left over: tabs whose user has their own `statusLine` (account, project or managed settings) get no gauge, by design; remote tabs neither. Field names checked against Claude 2.1.328, but not yet watched live in the app with a real long session; no in-app guide entry (needs captured media)._
- **Spec:** the injected `--settings` gets a statusline command that writes `context_window` JSON to `~/.aquila/`; small
  gauge per tab (hint at ~60%). If the user has their own `statusLine`, don't inject (ours would replace it).
- **Owns:** `electron/hooks.ts` (settings file), `src/entities/session` gauge.

### T32 · Figma MCP (opt-in)
- [x] **Goal:** one click to give a project's Claude the official Figma MCP. (#35, #36)
  _Left over: Codex works via `-c mcp_servers.figma.url` (no repo `.codex/config.toml` needed). Local projects only (remote would need the host's own `/mcp` login). The whoami shape isn't documented: parser checked against a real reply (plans nested under `whoami.plans`, seat ≠ role), but the hidden `claude -p` check has only run live without a Figma login; seat/plan hints are heuristics, linked to Figma's docs. No in-app guide entry (needs captured media)._
- **Spec:** off by default, per-project toggle; Figma UI hidden when off. `~/.aquila/mcp/figma.json`
  (`https://mcp.figma.com/mcp`) passed with `--mcp-config` (no `--strict-mcp-config`); auth stays in the CLI (`/mcp`).
  Codex: verify `-c mcp_servers.figma.*`, else confirm-then-write repo `.codex/config.toml`. "Connect" runs a short
  hidden `claude -p` that calls `whoami`, caches plan/seat in `~/.aquila/figma-profile.json` (parse defensively, unknown
  → "unknown"); disabled reasons as tooltips ("needs a Dev seat", "may need Organization"); link to Figma's docs instead
  of hard-coded limits.
- **Owns:** `electron/figma.ts`, `src/features/figma/`.

### T33 · In-app preview + pick element
- [x] **Goal:** point at the running app and tell the agent what to change — for Claude and Codex. (#37)
  _Left over: the preview is width-only (no mobile user agent / touch emulation) and local projects only. Component names need a dev build (React 19 dropped `_debugSource`, so no file:line there). Checked live in the app: detection from terminal output, widths, hiding under the palette, Designer (Figma under the app) and a pick pasted into a real Claude tab (`[Pasted text][Image]`). Not checked with a real Codex: it stopped at its own "Trust this folder?" prompt first, and the panel says "pasted" even when the CLI is on such a prompt. The Figma view needs a Figma login inside the preview. App shortcuts don't fire while the previewed page has keyboard focus._
- **Spec:** detect the dev server (`.claude/launch.json`, `localhost:\d+` in pty output); `WebContentsView` with device
  presets 390/768/1440; Select mode collects selector, text, computed style, React component name if possible and a
  `capturePage(rect)` crop, pasted into the focused session as text + image path. "Designer preset" layout: terminal +
  preview + Figma panel.
- **Owns:** `src/widgets/preview/`, `electron/preview.ts`.

### T34 · Figma prompt chips + Design vs Build
- [x] **Goal:** better design-to-code results with less typing. (#38)
  _Left over: the "design changed" check (REST `/v1/files/:key` version polling with a token) is not built. The preview overlay is done by the agent (`get_screenshot` + the pick's screenshot), not drawn as an onion skin in the panel. Checked live in the app with Claude 2.1.329: chips on a real Figma link, chip → prompt after the link, Enter / × close them, FigJam chips, a Designer pick with the Figma line, and "Comments → TODOs" run end to end on a real file (via the user's claude.ai Figma connector; all six tool names confirmed in `/mcp`). Claude tabs: compare / implement also run a Claude in Chrome pass (Figma Dev Mode properties — component + variant, size, spacing… — against the app's components and computed styles, then on screen), checked pasted live; Codex gets the MCP-only prompt. Not checked in Codex (stopped at its own "Trust this folder?"). Found on the way (T32): with the claude.ai Figma connector already connected, our injected `figma` server stays "needs sign-in" and Claude warns "1 MCP server needs authentication". No in-app guide entry (needs captured media)._
- **Spec:** pasting a Figma link offers prompt chips ("implement this frame with our components and tokens" — tokens
  first via `get_variable_defs`; assets via `download_assets`; `get_figjam` flows and `get_comments` → TODOs for backend);
  overlay Figma `get_screenshot` on the preview capture; optional "design changed" check by polling REST
  `/v1/files/:key` version (needs a REST token; advanced setting).
- **Owns:** `src/features/figma/` (chips, overlay).

### T35 · AI trends button
- [ ] **Goal:** see what's new in my CLIs and in the field without leaving the app. (#39)
- **Spec:** main fetches at startup and every 6 h into `~/.aquila/news-cache.json`, sent over a new IPC channel. Sources:
  GitHub Releases (claude-code, codex; ETag, 60 req/h limit, skip prereleases), Claude Code CHANGELOG, OpenAI News RSS,
  Cursor changelog RSS, Antigravity blog RSS, Simon Willison, Latent Space, HN Algolia (`points%3E100`). Tab 1 "My CLI
  updates": 3–5 "Added" lines from releases newer than the local `claude --version` / `codex --version`. Tab 2 "Industry":
  keyword groups (subagent, hook, agent view, ADE, harness). Button + unread badge in the sidebar top band; titles,
  links and short excerpts only. LLM summary opt-in via `claude -p` (uses the user's quota). Modal shared with T23,
  different title/icon ("AI trends" vs "What's new").
- **Owns:** `electron/news.ts` (+ tests for feed parsing), `src/widgets/trends/`.

### T36 · Remote panels
- [ ] **Goal:** changes panel and history for remote projects. (#45)
- **Spec:** run `git` / history reads over the same SSH connection (ControlMaster); measure latency; 
- **Owns:** `electron/remote/`, remote adapters for `git.ts` / `history.ts`.

### T10 · Light theme
- [ ] Add `[data-theme='light']` semantic remap in `tokens.css`, follow `nativeTheme`; the terminal theme follows. No component changes allowed. (#41)

## Release (last)

### T27 · Release notes modal + pipeline
- [ ] **Goal:** after an update, show once what changed. (#29, #30, owner)
- **Spec:** compare `lastSeenVersion` in `~/.aquila/` with `app.getVersion()`; open only when higher (not on a fresh
  install — record the version and offer the guide instead). Same modal as T23: 3–5 headlines with media, "How to use" →
  guide item; "What's new" in the `?` menu lists past versions; skipped versions are combined. Notes bundled per version
  (`release-notes/<version>.{ko,en}.md` or JSON with `guideId` + media), offline. Draft from Conventional Commits since
  the last tag, edited by hand; packaging fails if the version's ko/en notes are missing.
- **Also:** electron-updater for macOS (Windows updates come with T20, later).
- **Owns:** `src/features/release-notes/`, `release-notes/`, `scripts/release-notes.ts`.

## Windows (later)

### T19 · Windows runtime
- [ ] **Goal:** the app runs properly on Windows 10 1809+ / 11, x64 + arm64, native and WSL. (#9–#13)
- **Spec:**
  - node-pty: serialize kills in a short queue, never kill an exited pty, clean leftover conhost on quit, rebuild per
    arch for Electron's ABI in CI, renderer `windowsPty: { backend: 'conpty', buildNumber }` (build number via IPC).
  - Shortcuts from T13's map: Ctrl+Shift+T/W/K/G, Ctrl/Alt+1–9, Alt+arrows for focus; Ctrl+C copies when there's a
    selection, else SIGINT; Ctrl+V goes to the pty (image paste — verify Ctrl+V vs Alt+V); no Ctrl+Alt (AltGr).
  - Window: `titleBarStyle: 'hidden'` + `titleBarOverlay` (height = `--size-titlebar`, colors from tokens), avoid
    `env(titlebar-area-*)`; window controls are on the right — recheck the tab bar's right end.
  - Accounts: `CLAUDE_CONFIG_DIR` in the spawn env (shared stays unset); WSL sessions show "log in separately in this distro".
  - WSL projects: run environment saved per project (native / distro), `wsl.exe -e git` for the changes panel, hook
    receiver address for NAT mode (host IP + token) if hooks are still needed there.
  - Notifications: `app.setAppUserModelId()`, Start Menu shortcut with AUMID.
  - Platform layer (#1): `electron/platform/{darwin,win32}.ts` behind one interface: shell detection + profiles
    (pwsh 7 > Windows PowerShell 5.1 > Git Bash > CMD; WSL distros detected once at startup and on request, never polled),
    spawn template per shell (`pwsh -NoLogo -NoExit -Command`, `cmd /K`, `bash -l -i -c "…; exec bash -l -i"`,
    `wsl.exe -d <distro> --cd <path> -- bash -lic "…"`), path conversion (`wslpath -a`, `\\wsl.localhost\…`), notifications.
  - Windows parts of Now tasks: taskbar overlay icon + `flashFrame` (T15); `claude`/`codex`/`git` per WSL distro in the
    first-run checklist (T17); IME smoke on Windows + `"Cascadia Mono"`, `Consolas` fallbacks (T18); energy measurement
    tool (T9); Ctrl+/ and F1 for the guide (T23); per-OS smoke capture (T24); `git.exe` detection (T25); WSL run
    environment in project settings (T26); Windows OpenSSH control channel (T36); `titleBarOverlay` colors (T10).
- **Owns:** `electron/platform/`, Windows parts of `sessions.ts`, `main.ts` window options, CI workflow.

### T20 · Windows packaging + signing
- [ ] **Goal:** a Windows installer people can run. (#28)
- **Spec:** decide the signing path first (Korean individual: no Azure Artifact Signing; Korean company: eligible →
  company + Artifact Signing / unsigned + winget/scoop + SmartScreen note / MSIX — check MSIX file-system limits).
  NSIS x64 + arm64, electron-updater (also for macOS).
- **Owns:** `electron-builder.yml`, `build/`, update code in `electron/updater.ts`.
