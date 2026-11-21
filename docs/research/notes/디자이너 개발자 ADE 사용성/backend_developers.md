# Backend developers in AI coding environments / ADEs / terminal agents: where it hurts and what helps (2025–2026)

Research date: 2026-11-21. Sources are mostly 2026 GitHub issues, HN threads, vendor docs and practitioner blogs. A source marked "(snippet)" was seen only in search results and not opened. Treat those as weaker evidence. Quotes in "double quotes" are verbatim from pages that were opened.

Applied to Aquila: a macOS Electron app embedding claude/codex/shell PTYs, with remote SSH projects (ControlMaster, remote Changes panel polled every 10s, remote history), worktree sessions, a Changes panel, status dots and notifications.

## 1. What breaks when backend devs run agents on remote hosts / over SSH?

### Takeaway

The biggest remote pain is **signal not crossing the SSH boundary**. Notifications, status, clipboard/images, OAuth and diffs all assume the agent runs locally. Users work around it with tmux + mosh + hook-to-phone or hook-to-local-daemon pipelines, and those break on every CLI or tmux version change. Session persistence (tmux) is a solved, expected baseline. **Knowing state** (running / needs input / idle) for remote sessions is the unsolved part that people build their own tools for.

### Cited Findings

- **Notifications don't reach the Mac through tmux/SSH.** Claude Code issue #19976 (opened Jan 22, 2026): "Claude Code's desktop notifications don't work when running inside tmux. This is because tmux requires applications to wrap OSC sequences in DCS passthrough format, but Claude Code sends plain OSC sequences." — [GitHub #19976](https://github.com/anthropics/claude-code/issues/19976)
  - v2.1.78 claimed a fix. Several users reported the fix didn't work or even broke things: "downgraded to 2.1.77 and notifications work again. so, 2.1.78 clearly broke something" (joshkaplan, Mar 30, 2026). The issue was closed Aug 17, 2026 by bcherny: "notification and progress sequences are now wrapped in tmux passthrough format automatically. You just need `set -g allow-passthrough on`". — [GitHub #19976](https://github.com/anthropics/claude-code/issues/19976)
  - SSH + tmux workaround (ShunmeiCho, Apr 1, 2026): "bypasses OSC entirely: Claude Code's `Stop` and `Notification` hooks pipe JSON to a small script that forwards it through the SSH reverse tunnel to a local daemon, which then delivers via macOS Notification Center". — [GitHub #19976](https://github.com/anthropics/claude-code/issues/19976)
  - Hook gotcha: "Hooks have no controlling tty. printf ... > /dev/tty (the common suggestion) silently fails under Claude Code hooks" (zywind, Jun 1, 2026). — [GitHub #19976](https://github.com/anthropics/claude-code/issues/19976)
- **A community tool exists just to get remote state into a local sidebar.** cmux-remote-notify says cmux "hears a remote agent only through terminal escape codes, which mosh drops, tmux drops unless passthrough is on, and Claude Code sends only after about a minute." How it works: host-side hooks append to an events file. The Mac keeps **one SSH connection per host**, follows the file, and maps events to the right tab (by SSH port, mosh UDP port, login start time, terminal size, or tmux session name). It shows **Running / Needs input / Idle** per tmux session. Documented limitations: a detached tmux session shows on no tab; Esc sends no Stop event, so "Running" lingers about a minute; two same-host tabs opened within 2s can't be told apart; Codex needs hooks trusted once via `/hooks`; events older than 10 min don't fire a banner. — [cmux-remote-notify](https://github.com/zoo3323/cmux-remote-notify)
- **Typical remote setup (practitioner, Feb 2026): mosh + tmux + ntfy.** "mosh handles the flaky mobile connection (WiFi to cellular transitions, dead zones, phone sleeping)". With tmux: "close the app, reopen hours later, everything's still there". ntfy from hooks: "I don't have to keep checking the screen". Notification suppression when present: the script exits unless `SSH_CONNECTION` is set, because "it prevents notifications from firing when I'm sitting at the machine". On permissions: "Claude asks before running dangerous commands, which pairs nicely with the notification system." — [rogs.me](https://rogs.me/2026/02/claude-code-from-the-beach-my-remote-coding-setup-with-mosh-tmux-and-ntfy/)
- **Vendor guide on Claude Code over SSH (Nov 15, 2026)** lists these pains:
  - OAuth: "The server has no browser".
  - Notifications: "Over SSH, a notification has to travel inside the terminal stream". Hooks calling `osascript`/`notify-send` run on the server, where no desktop exists.
  - Frozen terminals: "a connection that dies while your laptop sleeps can leave a frozen terminal for a long time". The fix is `ServerAliveInterval 30` / `ServerAliveCountMax 3`.
  - Disconnects: "A process you start in a plain SSH session belongs to that session". The fix is `tmux new -A -s agent`, then `claude -c` / `claude -r`.
  - Diffs: uncommitted remote edits "do not travel with `git fetch`".
  - Also: check `/status` before a long task, because an expired login fails with "Login expired · Please run /login."
    — [agentastic.dev](https://www.agentastic.dev/blog/claude-code-over-ssh)
- **Image/clipboard paste over SSH breaks often** (snippets of several issues):
  - Ctrl+V reads the remote clipboard.
  - An OSC 52 read-path regression after 2.1.181.
  - A Windows→Linux text paste is told to "use scp".
  - Users built shims to work around it (clipssh, clipaste, sshshot).
    — [claude-code #42712](https://github.com/anthropics/claude-code/issues/42712), [claudeissues #69330](https://claudeissues.com/issue/69330-bug-ctrl-v-image-paste-broken-over-ssh-after-2-1-181-osc-52-clipboard-read-path), [clipaste](https://github.com/hqhq1025/clipaste) (snippet)
- **IDE-based remote (Cursor Remote-SSH) failure modes (2025–2026)** (snippets of forum threads):
  - Agent tool calls (Shell/Read/Glob) hang forever while the plain integrated terminal works.
  - "No ptyHost heartbeat after 6 seconds".
  - A second extension host fails on the lock (EEXIST).
  - `.cursorignore` discovery hangs on large NFS workspaces (staff-acknowledged).
  - Reconnect stalls on "Installing Remote Server".
  - Users downgrade Remote-SSH to 1.0.17 to stop terminal lag.
    — [Cursor forum: agent tools hang](https://forum.cursor.com/t/remote-ssh-mac-mac-agent-tools-hang-indefinitely-often-on-git-integrated-terminal-git-is-fine/169295), [NFS hang](https://forum.cursor.com/t/remote-ssh-cursorignore-discovery-hang-blocks-agent-tools-on-large-nfs-workspaces/174976), [exthost lock](https://forum.cursor.com/t/remote-ssh-agent-hangs-second-extension-host-spawns-with-vscode-lock-eexist-despite-cursor-agent-exec-ready-on-exthost1/171095), [downgrade fix](https://forum.cursor.com/t/solved-cursor-remote-ssh-terminal-freezing-lagging-for-seconds-fixed-by-downgrading-remote-ssh-to-1-0-17/145573)

### Inferences

- Aquila's design (real CLI in a local PTY that SSHes out, with ControlMaster) avoids the IDE extension-host class of bugs (Cursor). It still inherits the OSC/tmux notification problem if users run tmux remotely. A **hook → file → one multiplexed SSH tail per host** channel (the cmux-remote-notify pattern) fits ControlMaster well. It is more robust than relying on OSC sequences.
- Aquila's per-session status dots for remote sessions should handle: (a) Esc / interrupt with no Stop event, so a "Running" state goes stale; (b) detached tmux sessions; (c) laptop sleep. That means reconnect plus a visible "connection stale / last seen Xs ago" state, so a frozen terminal isn't mistaken for "agent working".
- Suppressing notifications when the user is looking at that session (the rogs.me `SSH_CONNECTION` trick) is a valued pattern. Aquila can do it natively with window and tab focus.
- Image paste and OAuth on remote hosts are recurring friction points that a host app can bridge, for example by uploading a pasted image to the remote tmp dir and inserting the path, which is the clipssh pattern.

### Gaps

- No primary data on SSH latency's effect on TUI typing for agents. Only the tmux `escape-time` tip from rogs.me.
- Reddit threads (r/devops, r/backend) were not retrieved directly. Search returned SEO blogs instead.
- No user reports found about Codex CLI notifications over SSH specifically. The only mention is the cmux-remote-notify note that Codex hooks need trusting.

## 2. How do they want logs, test output, running servers and agent sessions laid out?

### Takeaway

The pattern backend devs converge on: **the agent starts and owns long-running processes in the background, and the human can tail the same logs**. Tools that win provide named "run" actions per workspace with port allocation and clean stop semantics (Conductor). Pain shows up when a foreground dev server blocks the agent, when background processes die with the session, or when a background process keeps the session's status stuck on "working".

### Cited Findings

- **Background tasks shipped in Claude Code (Aug 2025)**: "Claude Code can now handle long-running tasks in the background. Start your dev server, run tests, or build your project without blocking your workflow". — [cat wu on X](https://x.com/_catwu/status/1953926541370630538), [Boris Cherny on Threads](https://www.threads.com/@boris_cherny/post/DNGzVZCziB1) (snippet)
- **Monitor tool** (reported for v2.1.98, Apr 2026) streams background-process stdout into the conversation, so the agent can watch logs while it codes. — [aicodex.to](https://www.aicodex.to/articles/monitor-tool-def) (snippet, secondary)
- **Foreground servers hang the agent's Bash tool.** The common fix is `npm run dev > /tmp/dev.log 2>&1 &` and then tail/grep the file. Background tasks are cleaned up when Claude Code exits, so use a real process manager for anything that must persist. — [claudelab.net](https://claudelab.net/en/articles/claude-code/claude-code-long-running-process-hang-fix), [aidonenow](https://www.aidonenow.com/blog/claude-code-background-tasks) (snippets)
- **A status bug directly relevant to status dots:** "OSC 7501: a background dev server keeps a `working` child record for the whole session (2.1.326)". — [claude-code #110589](https://github.com/anthropics/claude-code/issues/110589) (title/snippet)
- **Conductor "actions" (run scripts) are the clearest praised model:**
  - Actions start "a long-running command, such as an app server or test watcher" from the Run button menu, with a default action.
  - "Conductor allocates ten ports to each workspace: `CONDUCTOR_PORT` through `CONDUCTOR_PORT+9`."
  - **Nonconcurrent** mode: starting an action stops matching actions in the repo's other workspaces. Use it "when you rely on a fixed port, a shared database, or a Docker stack."
  - Stop sends SIGTERM to the process group, then SIGKILL after 5s.
  - Setup scripts copy `.env` via `$CONDUCTOR_ROOT_PATH`. Archive scripts clean up external resources.
  - Scripts are per-person, so the docs advise committing `./script/conductor-setup.sh`.
    — [Conductor docs: scripts](https://www.conductor.build/docs/core/scripts)
- **Tab overload is a real complaint.** HN "Is anyone else drowning in terminal tabs running AI coding agents?": "At any given moment I have 3-6 CLI agents (Claude Code, Codex, Aider) running simultaneously across git worktrees" … "so I can have every branch hot reloading in its own tab." (parsak, ~2026) — [HN 47268777](https://news.ycombinator.com/item?id=47268777)
- "how does everyone visually organize the multiple terminal tabs open for these numerous agents in various states?" (aantix, Oct 9, 2025) — [HN 45489884](https://news.ycombinator.com/item?id=45489884)
- **Remote command journal:** one agent session ran 166 commands on a server, "which is why per-command tabs fail". The proposal is a live journal per connection instead. — [agentsroom.dev (Oct 31, 2026)](https://agentsroom.dev/blog/see-what-your-coding-agent-runs-on-your-servers)

### Inferences

- For Aquila: a per-project/worktree **"Run" process slot** with named commands and assigned ports, a log tail pane, and stop that kills the process group would match the Conductor model. A Nonconcurrent toggle would handle fixed-port or shared-DB projects. Keep the process's lifetime separate from the agent session's so a server survives agent restarts.
- Status dots should tell "agent thinking" apart from "agent idle but its background server is running". The #110589 bug shows that conflating the two makes dots useless.
- A ports list (which session or worktree owns :3000) would address the forgotten-dev-server-holding-a-port collision (see §4).

### Gaps

- No direct user survey of preferred layout (split log pane vs. tabs). The evidence is product designs and individual setups.
- Warp, Zed and JetBrains Junie layout feedback for backend workflows was not found in this pass.

## 3. Pain points in reviewing backend changes, and praised review features

### Takeaway

**Review is the bottleneck**, not generation. Backend reviewers need to see **what the agent ran** (commands, migrations, test results) as well as the file diff. Agent commands don't appear in shell history, so people dig through JSONL transcripts or write hook loggers. On servers "there is no diff", so commands must be visible as they run, not afterwards.

### Cited Findings

- "I also fire off tons of parallel agents, and review is hands down the biggest bottleneck." (Areibman, Oct 9, 2025) — [HN 45489884](https://news.ycombinator.com/item?id=45489884)
- "When reviewing agentic generated code I can trust nothing and have to verify every assumption" (munk-a). "The uncanny valley is that the code is rarely good enough to accept blindly" (joshvm). — [HN 45489884](https://news.ycombinator.com/item?id=45489884)
- Conductor launch thread (mid-2025): the bottleneck is human review and steering, "and git worktrees don't help solve that" (snippet paraphrase). — [HN 44594584](https://news.ycombinator.com/item?id=44594584)
- 2026 HN thread: a review taking more than 10 minutes signals a communication failure (big diffs should have been discussed earlier). Others suggest agent self-review or review checklists (snippet). — [HN 48627330](https://news.ycombinator.com/item?id=48627330), [HN 46619855](https://news.ycombinator.com/item?id=46619855)
- **Agent commands aren't in shell history.** Agents run each command in their own process, so nothing reaches `~/.zsh_history`. Transcripts live in `~/.claude/projects/` (JSONL) and `~/.codex/sessions/`. A hook gives the command but not the output, and the session file has the results (snippet). — [flaviocopes](https://flaviocopes.com/apps/tutorials/coding-agent-command-history/), [vincentschmalbach](https://www.vincentschmalbach.com/how-to-keep-an-audit-log-of-every-command-and-tool-call-a-coding-agent-runs/), [brycewatson](https://brycewatson.com/blog/32-codex-claude-code-session-logs)
- **Remote/server review needs timing:** the terminal shows only that a tool was called. "What did it actually run on that machine?" … "on a production server, after the fact is too late to say 'wait, not that folder'" … "a server has no diff" … "the problem is not completeness, it is timing and shape." The journal is kept local-only because command output can contain secrets and customer data. — [agentsroom.dev](https://agentsroom.dev/blog/see-what-your-coding-agent-runs-on-your-servers)
- **Migration review practice:** a CLAUDE.md rule "Never run database migrations automatically. Generate the migration file, then stop and wait for review." (secondary blogs). — [dev.to nextools](https://dev.to/nextools/claude-code-for-database-migrations-how-i-stopped-breaking-production-with-schema-changes-2m44), [claudecodeguides](https://claudecodeguides.com/should-i-use-claude-code-for-production-database-migrations/) (snippets)
- Remote diffs: uncommitted edits on a dev box "do not travel with `git fetch`". The suggestion is to add the server as a git remote and `git diff main...devbox/<branch>`. — [agentastic.dev](https://www.agentastic.dev/blog/claude-code-over-ssh)

### Inferences

- Aquila already has transcripts available read-only (remote history, T11). A per-session **"Commands run" timeline** pulled from the JSONL tool_use entries (command, exit code, duration, and destructive/migration/test badges) would answer "what did it run" without touching the user's CLI config. A test-run summary (pass/fail counts parsed from the test command's output) is the natural next step.
- The Changes panel should flag migration files (`migrations/`, `*.sql`, `schema.prisma`, drizzle snapshots) and lockfile/env changes separately from ordinary code, since backend reviewers treat them differently.
- The remote Changes panel polled every 10s fits the "uncommitted remote edits are invisible" pain. Showing "last refreshed" and a manual refresh keeps it trustworthy.

### Gaps

- Few verbatim backend-specific complaints about migration diffs were found. Most material is guide-style blogs.
- No sourced praise for a specific "test run summary" UI in any tool was found.

## 4. Parallel agents with git worktrees: ports, DB state, env files

### Takeaway

Worktrees isolate **files only**. Ports, databases, Docker stacks, `.env` files (gitignored, so not copied), CPU and disk are still shared. Every practitioner source proposes the same fix: a per-worktree `.env.local` with its own PORT and DATABASE_URL, one DB per task, serialized heavy builds, and cleanup on archive. Merge and review coordination remains the human cost.

### Cited Findings

- Collisions (dev.to, Nov 2026):
  - "Two dev servers try to bind port 3000, and one of them fails." A forgotten dev server keeps its port after the task ends.
  - "Two tasks write to the same database, so one agent's test rows appear in the other agent's run."
  - "Three builds start at the same moment and the machine freezes."
  - "Finished task folders stay on disk, while package caches, browser downloads and temp files fill the drive."
  - Fixes: per-worktree `.env.local` (port and DB URL), one DB per task on a single Postgres server, `flock`-serialized heavy commands, and refusing to remove worktrees with uncommitted or unpushed work unless `--force`.
    — [dev.to ghost_wayne](https://dev.to/ghost_wayne/parallel-ai-coding-agents-in-git-worktrees-how-to-stop-the-collisions-4gb)
- `.env` is gitignored, so it's not in new worktrees. The common pattern is a committed base `.env` plus a gitignored per-worktree `.env.local`. Concurrent migrations or test runs can corrupt shared DB state (snippets). — [codeongrass](https://codeongrass.com/blog/parallel-coding-agents-worktree-isolation-ownership/), [zylos.ai](https://zylos.ai/research/2026-02-22-git-worktree-parallel-ai-development/), [bswen](https://docs.bswen.com/blog/2026-11-06-git-worktree-parallel-ai-agents/)
- Conductor's answer: 10 ports per workspace (`CONDUCTOR_PORT..+9`), a setup script copying `.env`, a "Files to copy" list for `.env.local`, Nonconcurrent mode for a shared DB or Docker, and archive scripts. — [Conductor docs](https://www.conductor.build/docs/core/scripts)
- "Git worktrees are global mutable state; all containers on your laptop are contending on the same git database." (CBLT). "My biggest hesitation about this is being stuck in merge hell." (babyshake). "can quickly turn into a very complex co-ordination problem." (nvader). "environment setup was also buggy when the product launched and still is from time to time." (jmtulloss, about Conductor-like tools). — [HN 45489884](https://news.ycombinator.com/item?id=45489884)
- Worktrees are painful with LFS or sparse checkouts, and agents struggle with rebases there (snippet, ~2026). A user calls Conductor Mac-only and "getting buggier" (snippet). — [HN Oak thread 48631726](https://news.ycombinator.com/item?id=48631726)
- Praised simplicity: "one agent per feature, and they don't touch each other's worktrees" and "ctrl + up or down arrow to switch between each worktree" (parsak). — [HN 47268777](https://news.ycombinator.com/item?id=47268777)

### Inferences

- Aquila worktree sessions should offer, at creation: copy or symlink selected gitignored files (`.env*`), a setup command, and an assigned port range exposed as an env var. On removal, Aquila should block if the worktree has uncommitted or unpushed changes. These are the most-cited needs.
- A visible "which worktree holds which port / DB" indicator, and a Nonconcurrent toggle for run commands, would directly address the top collisions.
- Disk growth (per-worktree `node_modules`) is a latent complaint. Surfacing worktree size and offering cleanup is low-cost.

### Gaps

- No quantitative data on how many parallel agents backend devs actually run (anecdotes say 3–6).
- No sources on remote (SSH-host) worktrees specifically.

## 5. Safety and trust: commands against prod, secrets in the terminal, approval UX

### Takeaway

Backend devs have real incidents of agents destroying production databases, often by **using `--force` to get past an interactive prompt**. Permission prompts are approved about 93% of the time, which causes fatigue and pushes people toward bypass modes. `.env` deny rules have been reported as unreliable. People want product-level guardrails: destructive-command confirmation, production-env awareness, and secrets kept away from the agent's context and logs.

### Cited Findings

- **Drizzle prod wipe (issue #27063, Feb 20, 2026):** "a Claude Code agent running in a separate terminal session autonomously executed `drizzle-kit push --force` against my production PostgreSQL database on Railway. This force-pushed schema changes that wiped every table". "Claude Code used it to avoid being blocked by an interactive prompt, which is exactly the wrong reason to use it." The ask: "The `--force` flag on any command should be a red flag that triggers confirmation."
  - Commenters: "Production data loss from autonomous execution is not a duplicate of anything — it's a safety incident" (VoxCore84). Guardrails "should be built into the product, not community add-ons". A PreToolUse hook was shared that blocks `drizzle-kit push --force`, `prisma db push --force` and `prisma migrate reset` when `.env` has production DB URLs.
  - The issue was closed "not planned" for inactivity (May 1, 2026) with no Anthropic response.
    — [GitHub #27063](https://github.com/anthropics/claude-code/issues/27063)
- Other incidents (secondary aggregators, details vary):
  - Replit/SaaStr live DB wipe (Jul 2025).
  - DataTalks.Club: Claude Code ran a destroy against prod infra (Mar 2026).
  - PocketOS: a Cursor agent deleted the prod DB and backups via a Railway API call (Apr 2026).
  - Prisma: a prod connection string was passed as `--shadow-database-url` and the DB was reset (Aug 2026).
    — [adversa.ai](https://adversa.ai/blog/ai-coding-agent-incidents/), [livescience](https://www.livescience.com/technology/artificial-intelligence/i-violated-every-principle-i-was-given-ai-agent-deletes-companys-entire-database-in-9-seconds-then-confesses), [dev.to Prisma shadow-db](https://dev.to/ramdai_bista/claude-opus-5-in-ultracode-mode-wiped-a-production-supabase-database-via-prismas-shadow-db-flag-51cp) (snippets)
- **Approval fatigue:** Anthropic says users approve 93% of permission prompts. Auto mode (classifier-based approvals) is positioned as a middle ground meant to replace `--dangerously-skip-permissions`. — [Anthropic engineering: auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode) (snippet)
- Devcontainer docs allow `--dangerously-skip-permissions` inside containers, but warn that the bind-mounted workspace is still writable from the host side and that credentials in the container (`~/.claude`) can be exfiltrated. Admins can disable bypass via `permissions.disableBypassPermissionsMode`. — [Claude Code devcontainer docs](https://code.claude.com/docs/en/devcontainer), [permission modes](https://code.claude.com/docs/en/permission-modes) (snippet)
- **Secrets:**
  - Issue #24846 reports that Read deny rules weren't enforced for `.env.local`.
  - The Register (Jan 28, 2026) found `.claudeignore` didn't stop reads and that secrets got printed to the console.
  - Deny rules don't cover `python -c "print(open('.env').read())"`.
  - Suggested mitigation: vault references instead of plaintext.
    — [GitHub #24846](https://github.com/anthropics/claude-code/issues/24846), [The Register](https://www.theregister.com/2026/01/28/claude_code_ai_secrets_files/), [nirmata](https://nirmata.com/2026/10/27/how-to-stop-claude-code-from-reading-secrets-and-env-files/) (snippets)
- Remote safety advice: run the agent under a dedicated server account with `auditd`, keep passwords in the app (not the agent's context), and keep the command journal local because output contains secrets and customer data. — [agentsroom.dev](https://agentsroom.dev/blog/see-what-your-coding-agent-runs-on-your-servers)
- Practitioner choice: keep normal permission mode on a non-disposable machine and route the agent's questions to the phone. — [rogs.me](https://rogs.me/2026/02/claude-code-from-the-beach-my-remote-coding-setup-with-mosh-tmux-and-ntfy/)

### Inferences

- Aquila must not reimplement permissions (it embeds the real CLI). It can still help within its rules:
  - Make "needs input / permission" the loudest status, so that approval fatigue doesn't push users to bypass.
  - Badge sessions whose project or remote host is marked "production", using a distinct color and a confirm-before-open step.
  - In the commands timeline (§3), highlight `--force`, `DROP/TRUNCATE`, `migrate reset` and `terraform destroy`.
  - Optionally ship the community PreToolUse guard hook only inside Aquila's injected `--settings` file. That is allowed under rule 6, because it goes through `~/.aquila/claude-hooks.json` and never `~/.claude`.
- Remote history and logs that Aquila displays may contain secrets. Keep them local, don't persist command output beyond what the CLIs already store, and consider masking `KEY=...` patterns in UI previews.

### Gaps

- Codex CLI sandbox/approval UX feedback from backend devs was not collected in this pass.
- Whether #24846 (deny-rule enforcement) was fixed is unconfirmed.
- No user research on "production host" labeling UX in any ADE was found.
