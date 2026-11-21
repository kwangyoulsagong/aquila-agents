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
- [x] **Goal:** see what's new in my CLIs and in the field without leaving the app. (#39)
  _Left over: fetched only when the modal opens (cache > 30 min) or on ↻ — owner's call over the spec's startup + 6 h, so no unread badge. Releases via GitHub's Atom feeds + codex `/releases/latest` (the REST list was ~10 MB), CHANGELOG first 64 KB; a fetch is ~3 MB (OpenAI / Latent Space ignore Range). Keyword groups match few items (4 of 70 live) — the rest are under "Latest". Seen items are pruned after 7 days, unseen after 30. Checked live: all sources parse (Codex 0.171.0 flagged newer than the installed 0.170.0); the opt-in summary ran once (haiku, ~5 s). Also on this branch: the footer's bare "English"/"한국어" button became ⚙ Settings (native menu: Language ▸ 한국어 / English, settings file); guide media recaptured with a `trends` item (capture/smoke run the news service on the fixture feeds at the fixtures' date). Capture: video 900 → 450 kbps, stills WebP 0.85 → 0.75 (media 3.0 → 2.4 MB, text still legible), and `capturePage` retries Chromium's occasional "UnknownVizError" (it failed 2 runs of 4 at `preview`). The "What's new" modal is T27._
- **Spec:** main fetches at startup and every 6 h into `~/.aquila/news-cache.json`, sent over a new IPC channel. Sources:
  GitHub Releases (claude-code, codex; ETag, 60 req/h limit, skip prereleases), Claude Code CHANGELOG, OpenAI News RSS,
  Cursor changelog RSS, Antigravity blog RSS, Simon Willison, Latent Space, HN Algolia (`points%3E100`). Tab 1 "My CLI
  updates": 3–5 "Added" lines from releases newer than the local `claude --version` / `codex --version`. Tab 2 "Industry":
  keyword groups (subagent, hook, agent view, ADE, harness). Button + unread badge in the sidebar top band; titles,
  links and short excerpts only. LLM summary opt-in via `claude -p` (uses the user's quota). Modal shared with T23,
  different title/icon ("AI trends" vs "What's new").
- **Owns:** `electron/news.ts` (+ tests for feed parsing), `src/widgets/trends/`.

### T36 · Remote panels
- [x] **Goal:** changes panel and history for remote projects. (#45)
  _Left over: no SSH host was available here, so nothing ran against a real host — every remote script is tested end to end through a fake `ssh` that runs it with the local `sh` (macOS BSD userland; the GNU `stat` branch is untested), and the remote UI wasn't seen live. Latency is shown (`n ms` in the panel bar and history footer) but not yet measured on a real link. Remote changes poll every 10 s (no watch); remote history reads each transcript's first 256 KB (search, preview and message count cover that; export fetches all), not Codex's SQLite (archived threads rely on codex moving them out of `sessions/`). Resuming a Claude session whose cwd is a subfolder of the remote project fails like locally (claude resumes per folder). ControlMaster masters linger 2 min after quit. Smoke failed once on the guide check (timing) and passed on rerun._
- **Spec:** run `git` / history reads over the same SSH connection (ControlMaster); measure latency; 
- **Owns:** `electron/remote/`, remote adapters for `git.ts` / `history.ts`.

### T10 · Light theme
- [x] Add `[data-theme='light']` semantic remap in `tokens.css`, follow `nativeTheme`; the terminal theme follows. No component changes allowed. (#41)
  _Left over: guide media (`src/features/guide/media/`) is captured in dark only. The `.c-kbd` hint inside a primary button is low-contrast in both themes (tertiary text on the accent) — a component fix, out of scope here. Claude's own `/theme` stays the user's choice; on light, xterm's minimum contrast keeps dark-theme output readable but tints it. Checked with `AQUILA_THEME=light npm run smoke` screenshots, not by flipping macOS appearance live._

## Release (last)

### T27 · Release notes modal + pipeline
- [x] **Goal:** after an update, show once what changed. (#29, #30, owner)
  _Left over: version bumped to 0.2.0 with notes for 0.1.0 and 0.2.0 (both reuse guide media — nothing new to capture). Notes are one JSON per version with ko + en inside, not two .md files. `?` is now a native menu (Guide ⌘/ · What's new); ⌘/ still opens the guide directly. The updater only checks and notifies (opens the release page): unsigned builds can't self-install, so download + install waits for signing (T20); it needs a public GitHub release with `latest-mac.yml` and was not tried against a real release. The auto-open after an update was checked by unit tests, not by installing an older build and upgrading. Smoke failed once on an IME scenario (timing, not touched here) and passed on rerun. Also: `electron/releaseNotes.ts`, `electron/updater.ts`, `tsconfig.scripts.json` outside Owns._
- **Spec:** compare `lastSeenVersion` in `~/.aquila/` with `app.getVersion()`; open only when higher (not on a fresh
  install — record the version and offer the guide instead). Same modal as T23: 3–5 headlines with media, "How to use" →
  guide item; "What's new" in the `?` menu lists past versions; skipped versions are combined. Notes bundled per version
  (`release-notes/<version>.{ko,en}.md` or JSON with `guideId` + media), offline. Draft from Conventional Commits since
  the last tag, edited by hand; packaging fails if the version's ko/en notes are missing.
- **Also:** electron-updater for macOS (Windows updates come with T20, later).
- **Owns:** `src/features/release-notes/`, `release-notes/`, `scripts/release-notes.ts`.

## Windows (later)

### T19 · Windows runtime
- [x] **Goal:** the app runs properly on Windows 10 1809+ / 11, x64 + arm64, native and WSL. (#9–#13)
  _Left over: **built and unit-tested on macOS only — never run on Windows**; CI (`.github/workflows/ci.yml`, windows x64 + arm64) is the first real check and runs only the Windows-safe tests (many existing tests drive /bin/sh). Done: `electron/platform/` (shell detection + spawn templates, WSL paths + distro list, git routing, `KillQueue`, `taskkill /T` on quit), ConPTY `windowsPty`, Windows shortcut map (Ctrl+Shift+T/W/K/G…, Alt+arrows, Ctrl+1–9, F1 guide instead of Ctrl+/; no Ctrl+Alt), Ctrl+C copies a selection, `titleBarOverlay` in token colors + `--size-window-controls`, AUMID, taskbar `flashFrame`, PATHEXT lookup (`git.exe`), Windows install commands, Cascadia Mono / Consolas / Segoe UI fallbacks. pwsh uses `-EncodedCommand` (not `-Command`) to dodge quoting. A project runs in WSL when its folder is a `\\wsl.localhost\…` path — there's no per-project native/distro setting in project settings yet, no shell picker UI, and no "refresh distros" action (detected once at startup). Not done: WSL hooks for NAT mode (WSL Claude uses activity fallback, no context gauge), "log in separately in this distro" note, worktree sessions for WSL projects, Ctrl+V vs Alt+V image paste check, `.cmd` shims for main's `execFile` calls (`claude --version`, usage, figma) need `shell: true` on Windows, taskbar overlay icon, per-distro first-run checks, Windows IME smoke, energy tool, per-OS capture, Windows OpenSSH control channel (T36), guide/UI copy that hard-codes ⌘ (e.g. "⌘K", "⌘V")._
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
- [x] **Goal:** a Windows installer people can run. (#28)
  _Left over: **signing path: unsigned + SmartScreen note** (owner's choice); `win.azureSignOptions` is the hook for signing later. NSIS x64 + arm64 installers are built and inspected on macOS, **never installed or run on Windows** — CI packs on the Windows runners and spawns a pty from the packaged layout as the first real check. Windows updates download + install on quit (unsigned NSIS is allowed); macOS still only notifies (Squirrel.Mac needs signing). Not done: winget/scoop manifests (need a published release URL + sha256 to submit), release workflow (artifacts are uploaded by hand), installer/uninstaller UI copy is NSIS default (not ko/en from the dictionary)._
- **Spec:** decide the signing path first (Korean individual: no Azure Artifact Signing; Korean company: eligible →
  company + Artifact Signing / unsigned + winget/scoop + SmartScreen note / MSIX — check MSIX file-system limits).
  NSIS x64 + arm64, electron-updater (also for macOS).
- **Owns:** `electron-builder.yml`, `build/`, update code in `electron/updater.ts`.

## Next

### T37 · Fullscreen toggle + scrollback per kind
- [x] **Goal:** read a long Claude session full-window without re-splitting, and keep memory down for chatty sessions. (#40)
  _Done: ⇧⌘F (not ⌃⌘F — the default app menu's Toggle Full Screen takes it) hides sidebar, tab bar and side panels and shows only the focused pane under a title band (traffic lights + exit); the split tree is untouched, so leaving restores it. Also in ⌘K, the tab bar (⛶) and the guide; checked in smoke. Left over: not native macOS full screen (stays in the window); the changes panel loses its state while hidden; scrollback numbers kept (5000 agents / 10000 shell) — no memory measurement with real Claude sessions yet._
  _Note: per-kind scrollback already exists (`SCROLLBACK` in `entities/session/model/terminal.ts`: claude/codex 5000, shell 10000) — only revisit the numbers._
- **Spec:** toggle that hides sidebar + tab bar for the focused pane (macOS only; off on Windows because of the Hangul
  paste bug); same shortcut to leave, Esc does not (it belongs to the CLI). Scrollback differs per session kind
  (claude/codex vs shell), set from one place.
- **Owns:** `src/features/fullscreen/`, scrollback setting in `entities/session`.

### T38 · Worktree sessions v2
- [x] **Goal:** use the worktrees you already have, and clean them up from the app. (#31 + T7 leftovers)
  _Done: + menu "Worktrees" submenu and ⌘K list linked worktrees × Claude/Codex/Shell; the dialog has an agent picker. New worktrees copy gitignored files matching `.worktreeinclude`. "Clean up worktrees…" suggests merged + clean + closed ones, removes after a confirm step with plain `git worktree remove`; the branch stays. Left over: detached/locked worktrees are not listed; no branch deletion; the cleanup dialog was not seen in a screenshot (only the open dialog, via the guide capture)._
- **Spec:** list existing worktrees (`git worktree list --porcelain`) in the open-session menu and ⌘K; open
  claude/codex/shell in any of them. New worktrees copy the files listed in `.worktreeinclude` (gitignored files like
  `.env`), nothing else. Never force a worktree — "in worktree" stays opt-in. Cleanup: suggest removing worktrees that
  are merged and clean, remove only after confirmation (`git worktree remove`, never a silent `--force`).
- **Owns:** `electron/worktrees.ts`, `src/features/open-in-worktree/`.

### T39 · Remote group in the sidebar
- [x] **Goal:** tell remote projects apart at a glance: the sidebar reads Work / Personal / Remote.
  _Done: built-in group `remote` ("원격" / "Remote"), in the default config. Remote projects go there automatically (no group field in "Add remote project" or its settings) and can't be moved out; local projects can't be moved in. On launch, older configs get the group once (marker `~/.aquila/.remote-group`, so deleting the empty group sticks) and misplaced projects are moved. Dropped from the old spec on purpose (owner): helper binary, mosh, tmux `-CC` — a remote tab is just a terminal on the host._
- **Owns:** `REMOTE_GROUP` in `src/shared/api/types.ts`, `addProject` in `electron/config.ts`, `RemoteProjectDialog`.

### T40 · Scrollback search + safe paste
- [x] **Goal:** find an error or file name in long agent output, and never let a paste run a command. (Ghostty 1.3, see `docs/research/notes/ghostty.md`)
  _Left over: no guide media for find yet (`npm run capture` not rerun; the guide lists the shortcut and the terminal-helpers text mentions it). Find covers the scrollback of mounted terminals only (a dormant restored tab has none until started). The current match shows the selection tint over its amber (xterm draws the selection on top). Windows: full window's unused key moved to F11 so Ctrl+Shift+F is free — not run on Windows._
- **Spec:** ⌘F (Windows Ctrl+Shift+F, in T13's map) opens a find bar on the focused pane: next/previous, match count,
  case toggle, Esc closes and returns focus to the terminal; highlights cleared on close. `@xterm/addon-search`, loaded
  only while the bar is open. Paste: strip control characters that can end bracketed paste early (`ESC[201~`, other
  C0/C1 except tab/newline) before writing to the pty — same rule for ⌘V, drag & drop paths and quick select.
- **Owns:** `src/features/terminal-search/`, paste path in `src/entities/session/lib/terminalBus.ts`.

### T41 · Global shortcut: bring Aquila + next waiting
- [x] **Goal:** jump to the session that needs you from any app. (Ghostty quick terminal, adapted)
  _Done: ⚙ Settings → Global shortcut… (also ⌘K) records a key (needs ⌘/⌃/⌥, in-app shortcuts refused); saved only after the OS registers it, a taken key keeps the old one. From another app it goes to the head of T15's queue, from Aquila it cycles like ⌘J. Guide item "Global shortcut" with captured media. Smoke opens the dialog and records a key; `AQUILA_SMOKE_GLOBAL=1 npm run smoke` also registers ⌃⌥⌘J, brings Finder to the front and sends the real key through System Events (needs Accessibility for the terminal) — passed: window up on the waiting shell. Left over: not run on Windows._
- **Spec:** one system-wide shortcut (`globalShortcut`, default off until the user picks a key in settings; show a clear
  error when the key is taken). Pressing it shows the window and focuses the next waiting session (T15's order); if
  none is waiting, just shows the window. Registered only while enabled, unregistered on quit.
- **Owns:** `electron/globalShortcut.ts`, setting UI in `src/features/global-shortcut/`.

### T42 · Leftovers: terminal helpers, find media, detached worktrees
- [x] **Goal:** close the small leftovers of T28, T38 and T40 that are worth it.
  _Done: the terminal's right-click menu has Paste (files or an image as paths like ⌘V, else the text through the same safe paste). Quick select follows output while open: boxes move with the screen, a text keeps its label, new paths get free labels (smoke prints a path after opening and checks it gets one). The guide's terminal media now shows ⌘F find (`npm run capture` rerun, ko + en). Detached worktrees are listed too (+ menu and ⌘K, as `a1b2c3d (detached)`) and open by path — a git branch name can't start with `/`, so the same IPC takes either; never turned into a branch (tested on a real repo). Smoke checks right-click Paste end to end (the menu handler answers for the native menu): text arrives without `ESC[201~`, an image as a temp PNG path. T38 correction: locked worktrees with a branch were already listed (only cleanup skips them). Not changed on purpose: quick select labels only the visible rows, like Kitty hints / WezTerm QuickSelect — ⌘F covers the scrollback. Left over: the native menu itself and a detached worktree in the running app not seen by hand; detached worktrees are not offered for cleanup (merge check needs a branch)._
- **Spec:** right-click Paste; quick select keeps labels stable but follows new output; find in the guide media.
- **Owns:** `src/features/terminal-helpers/`, the terminal scene in `electron/capture.ts`, `checkQuickSelectFollows` / `checkMenuPaste` in `electron/smoke.ts`, detached worktrees in `electron/worktrees.ts` + `src/features/open-in-worktree/`; `clipboardText` IPC and `Worktree.detached` (additive).

## UX: comfort pass

From the ADE UX research (calm attention, recognition over recall). Only what is uncomfortable today; no new features.

### T43 · Session titles
- [x] **Goal:** every tab says which session it is. Today two Claude tabs both read "Claude".
  Left over: the first prompt only comes from Claude's hook, so Codex and remote/WSL Claude tabs fall back to branch / kind; `Session.prompt` was added next to `Session.title`.
- **Spec:**
  - The tab title is the first that exists: a user title → the first prompt (from the Claude `UserPromptSubmit` hook, first line, ~40 chars) → the worktree branch → the kind label.
  - The kind moves to a small badge in front of the title (reuse `KindBadge`).
  - Double-click the title (or ⌘K "Rename session") edits it in place: Enter saves, Esc cancels, empty resets to auto.
  - The CLI's own terminal title never overwrites it.
  - The title is shown in the pane head, the palette and notifications, and is kept by Restore.
- **Owns:** `src/widgets/session-tabs/`, `src/features/rename-session/`; `Session.title` (additive).
- **Done:** two Claude tabs with different prompts show different titles; a rename survives a restart.

### T44 · Status by shape, not only colour
- [x] **Goal:** status can be read without telling blue, green and red apart (colour vision, 6px sidebar dots).
  Also: with motion off (reduced motion, power saver) `working` can't pulse, so it shows a static half-filled disc and never reads as `idle`.
- **Spec:**
  - `done` shows a check and `error` shows `!` (or a square).
  - `waiting` (halo), `stopped` (ring) and `working` (pulse) stay as they are.
  - Must stay legible at `--size-dot-sm`, in light and dark themes and under reduced motion.
- **Owns:** `design-system/react/Dot.tsx`, `.c-dot` in `components.css`, `design-system/preview.html`, `docs/*/DESIGN-SYSTEM.md`.
- **Done:** the preview shows every status at both sizes, and each one is recognisable in greyscale.

### T45 · Calmer notifications
- [x] **Goal:** a banner only when something is blocked on me. No stale alerts, no alerts for what I'm already looking at.
  _Left over: the settings item lives in `features/switch-language/ui/SettingsMenu.tsx` (there is no `settings-menu` slice); withdrawal on macOS was checked by unit tests, not by watching Notification Center (smoke can't stage a hook-driven banner)._
- **Spec:**
  - `done` no longer sends a system notification by default. It stays a quiet dot (and Dock badge rules are unchanged). An opt-in "Notify when done" setting lives in ⚙ Settings.
  - A delivered notification is withdrawn as soon as its session is viewed or changes status (keep the `Notification` object per session, call `close()`).
  - "On screen" means every pane visible in the focused window, not only the active session (`electron/sessions.ts` `onScreen`).
- **Owns:** `electron/notify.ts` (+ tests), `onScreen` in `electron/sessions.ts`, the setting in `src/features/settings-menu/`.
- **Done:** four agents finishing in a row produce no banners. A waiting session's banner disappears from Notification Center after clicking its tab. The other pane of a split never notifies.

### T46 · Clear sidebar buttons
- [x] **Goal:** the two icon-only buttons are understood without hovering.
  _Left over: the name stays "AI trends" instead of "News" (the newspaper icon and the subtitle "CLI updates · industry" carry the meaning). Dropping several folders opens the add dialog for the first one only. Guide media (`npm run capture`) was not rebuilt._
- **Spec:**
  - **Add project:**
    - The bare **+** in the footer (easily confused with the tab bar's **+** = new session) becomes a text row "+ Add project" right under the project list.
    - Menu items: "Folder on this Mac…" / "Remote server (SSH)…".
    - Dropping a folder on the sidebar adds it (T17 leftover).
  - **AI trends:**
    - The ✦ in the top band reads as "run AI", but it opens a news list. Rename it to "News" (subtitle "CLI updates · industry").
    - Give it a news icon and move it to the footer next to Settings and Guide.
    - Show a dot only when the last cached fetch found a CLI version newer than the installed one. No new background fetch (T35's call stands).
- **Owns:** `src/widgets/sidebar/`, `src/widgets/trends/ui/TrendsButton.tsx`, `addProject` labels in `src/features/manage-projects/`.
- **Done:** a first-time user can add a project and find the news without a tooltip. The ko + en copy is updated and the guide text matches.

### T47 · App menu bar
- [x] **Goal:** Aquila behaves like a Mac app: commands and their shortcuts can be found in the menu bar (T13 leftover).
  _Left over: no "Reopen ⌘⇧T" (there is no reopen-closed-session feature, and ⌘⇧T is Open Codex). Settings… ⌘, pops the ⚙ menu at the cursor. macOS only; Windows keeps its current menu._
- **Spec:**
  - `Menu.setApplicationMenu` built from T13's shortcut map:
    - **Aquila:** About, Settings… ⌘,, Hide, Quit
    - **File:** Open Claude / Codex / Shell, Close session ⌘W, Reopen ⌘⇧T
    - **Edit:** standard roles
    - **View:** Split, Full window, Find ⌘F
    - **Window:** Next waiting ⌘J, Command palette ⌘K, Minimize ⌘M
    - **Help:** Guide
  - Accelerators are display-only where the renderer already handles the key (`registerAccelerator: false`).
  - Labels are in ko/en and rebuilt when the language changes.
- **Owns:** `electron/appMenu.ts`; one call in `electron/main.ts`.
- **Done:** every shortcut in the guide also appears in a menu, and switching the language relabels the menu.

## Persona pass

From the persona research (`reports/디자이너 개발자 ADE 사용성.md`: frontend, backend, designer, PM, engineer, AI engineer). Only what is broken or blocks a tool today; the rest is listed under **Nice to have**.

### T48 · Honest preview pick
- [x] **Goal:** a picked element never lands in the wrong place.
  _Left over: "waiting" comes from the status engine, so a prompt it can't see (e.g. Codex's first "Trust this folder?" before any status) still counts as ready. Guide media for the preview rebuilt (`CAPTURE_ONLY=preview`); the busy label itself was checked by unit tests, not in a screenshot._
- **Spec:**
  - The pick bar shows where a pick goes: `→ <tab title>`, `→ Clipboard`, or `→ Clipboard (<tab> is waiting)`.
  - A tab waiting on a question or permission is never pasted into: the pick is copied, that tab is focused, and the note says to answer first and paste with ⌘V. Status is read again when the pick arrives.
  - Disconnected remote tabs count as no target.
- **Owns:** `src/widgets/preview/model/pickTarget.ts` (+ test), the pick bar in `PreviewPanel.tsx`.

### T49 · Panel layout that doesn't break
- [x] **Goal:** terminal, Changes and Preview fit together on a 1440 px window.
  _Left over: below ~1300 px with both panels open the last panel is clipped (the terminal keeps 480, panels stop at 288). At 480 px the tab bar is tight: tab titles get cut short. Dragging over the native preview page was checked with synthetic input in smoke, not by hand._
- **Spec:**
  - Fix the sideways scroll and clipped sidebar footer with the Changes panel open at 1440 px (T24 leftover).
  - Changes and Preview widths are draggable and remembered; the terminal keeps a minimum width and panels shrink first.
- **Owns:** panel layout in `src/app/styles/app.css` + `pages/workspace` (small), a resize handle in the design system.
- **Done:** at 1440 px with both panels open there is no overflow (smoke screenshot).

### T50 · Preview follows the session's worktree
- [x] **Goal:** in parallel worktrees, the preview shows the focused session's app.
  _Left over: the branch shows only for worktree tabs (the project dir has none to read cheaply). A server that ignores `PORT` (Vite's 5173) is listed for its worktree but not preferred. Checked by unit tests + smoke; switching between two live worktrees was not seen by hand._
- **Spec:** key the preview by the focused session's worktree (not the project), prefer its `PORT`, show the branch in the panel head.
- **Owns:** `src/widgets/preview/`, `electron/preview.ts`.

### T51 · Open the preview in Chrome / full window
- [x] **Goal:** look at the app large, with real browser tools.
  _Left over: no shortcut for preview full window (button only, so the shortcut map, menu and guide list stay as they are). Links the previewed page opens in a new window also go to Chrome now. Chrome is found with `open -b com.google.Chrome`; the fallback to the default browser and the full-window layout were not seen live (guide media shows the head buttons only)._
- **Spec:** "Open in browser" in the preview head opens the current address in Google Chrome when installed, else the default browser. A full-window toggle shows only the preview (like ⇧⌘F for a pane).
- **Owns:** `src/widgets/preview/`, one IPC for "open in browser".

### T52 · Waiting reason on the row
- [x] **Goal:** see what a session waits on without opening it, and spot a destructive command at a glance.
  _Left over: smoke stages the reason over OSC 7501 from a shell; a real Claude `PermissionRequest` was checked by a unit test, not live. Only the longest-waiting session's reason is on the row (others are on their tab tooltips). The tooltip is on the tab, not its title (the title keeps its rename hint). Detection is a pattern list, so wrapped commands (`sh -c "…"` with odd quoting) can slip through._
- **Spec:**
  - `session:status` carries the notification detail (`detail`, waiting / done); re-sent when it arrives late.
  - The project row shows the longest-waiting session's reason on a line under it; clicking it shows that session. Tabs show it in their tooltip.
  - `rm -rf`, `push --force`, `reset --hard`, `clean -f`, `branch -D`, `DROP`/`TRUNCATE`, `DELETE FROM` without `WHERE`, `migrate reset`, `terraform destroy`, `kubectl delete`, `--force`… get a ⚠ in the error colour on the line and the tab.
- **Owns:** `src/shared/lib/risk.ts` (+ test), `design-system/react/Reason.tsx` + `.c-reason`/`.c-risk`, the row in `src/widgets/sidebar/`, the tab in `src/widgets/session-tabs/`; `detail` on `StatusUpdate`/`Session` (additive).

### Remote check on a real host (on hold)
- [ ] On hold until an SSH host is available: add a remote project, open tabs, Changes, history and reconnect on a real host, fix only what breaks (T29/T36 leftovers).

### Nice to have (not planned)
- Text labels on the tab-bar panel buttons (`±` `◫` `{}`), like T46.
- Figma in ⌘K / menu / guide, and a login button that walks through `/mcp`; chips also on typed or dropped links.
- Run slot: dev server / tests / long jobs as processes apart from the agent, with a log pane and a status dot.
- Review queue: sessions done but not looked at, with changed files and push state.
- Commands timeline per session from the read-only transcript.
- Production label on a project or host.
- Before/after preview snapshots in the Changes panel; "share what changed" as Markdown.
- Changes panel risk badges (migrations, `.env`, lockfiles, prompt files).
- Designer view as side-by-side / overlay compare instead of stacked.
