# Software engineers orchestrating multiple agents: friction and comfort in ADEs / terminal agent workflows (2025–2026)

Scope: generalist / full-stack / senior-staff engineers running several Claude Code / Codex sessions. Excludes frontend preview and SSH/logs topics (covered elsewhere). Aquila context: sidebar projects, tabs, splits, status dots, ⌘J next waiting, ⌘K palette, worktree sessions, Changes panel, session titles, history, app menu.

Source-quality note: Strongest sources are primary posts by Simon Willison, Mitchell Hashimoto, Addy Osmani, the cmux founders, and two HN threads (Conductor Show HN, Jul 2025; "Parallel coding agents with tmux and Markdown specs", ~Mar 2026). Several DEV/Product Hunt posts are written by people building competing tools (flagged inline). WebFetch summarizer output sometimes paraphrases; quotes below are those returned as verbatim.

## 1. Where attention and flow break when running 3–10 agents

### Takeaway

The limit is human review and attention, not agent throughput: practitioners repeatedly land at about 3 (sometimes up to 5) concurrent sessions. The specific breakpoints are (a) a session silently blocked on a permission prompt, (b) not knowing which terminal does what, (c) a backlog of half-reviewed diffs, (d) agents colliding in a shared working tree, and (e) context-free notifications that force a full context switch.

### Cited Findings

- Simon Willison: "the natural bottleneck on all of this is how fast I can review the results" and "I can only focus on reviewing and landing one significant change at a time" (Oct 5, 2025). — [Simon Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- Armin Ronacher (Oct 2025): "I sometimes kick off parallel agents, but not as much as I used to do. The thing is: it's only so much my mind can review!" — [Pragmatic Engineer, Oct 30 2025](https://blog.pragmaticengineer.com/new-trend-programming-by-kicking-off-parallel-ai-agents/)
- Addy Osmani (Mar 26, 2026): "The bottleneck is no longer generation. It's verification."; "Three to five teammates is the sweet spot"; keep active agents to what you can actually review. — [addyosmani.com](https://addyosmani.com/blog/code-agent-orchestra/)
- koliber (HN): "Even when I really tried to do this in parallel I could not meaningfully run more than three sessions." Also spends attention "thinking how multiple agents could step on each others toes". — [Ask HN: How do you run parallel agent sessions?](https://hn.nuxt.dev/item/46682551)
- bob1029 (HN): "One "slow" agent can outpace many fast ones if they're making a lot of mistakes." — [same thread](https://hn.nuxt.dev/item/46682551)
- HN tmux/specs thread (~2026): schipperai (OP): "The merge conflicts and cognitive load are indeed two big struggles with my setup." medi8r: running several agents feels "cognitively like being a pilot landing a plane." CuriouslyC: "The current bottleneck is validation." evara-ai prefers "2-3 focused agents" (backend, frontend, tests) over "6-8 competing agents that create merge conflicts." sluongng: "I think we need much different toolings to go beyond 1 human - 10 agents ratio." — [HN 47218318](https://news.ycombinator.com/item?id=47218318)
- Rate limits are a hard practical cap: ecliptik says parallel agents "hit Max plan limits in under an hour"; gck1 hits the weekly quota "by around day 3-4" on a $200 plan. — [HN 47218318](https://news.ycombinator.com/item?id=47218318)
- Silently blocked sessions: freedomben (Conductor HN): "very easy to forget about one and have it paused waiting for confirmation"; asks for "a dashboard of sorts". — [Show HN: Conductor, Jul 20 2025](https://news.ycombinator.com/item?id=44594584)
- Product Hunt thread "Running 3-4 Claude Code / Codex sessions at once: what breaks first?" (summarized, not verbatim). OP (who said they are building a macOS tool in this space): the biggest time sink is tracking which terminal is blocked on a permission prompt and which spec each session follows, and they sometimes miss prompts for 10+ minutes even with worktrees + tmux. Another reply: the git tree breaks first, because one agent commits another's half-finished change. Another: an agent lost context and rebuilt an existing helper under a new name, which passed review at first glance. — [Product Hunt](https://www.producthunt.com/p/vibecoding/running-3-4-claude-code-codex-sessions-at-once-what-breaks-first-for-you)
- Context-free notifications: the cmux founders built cmux because Claude Code's notification only said it was waiting, without saying which session or why. Their fix was per-pane attention rings, a lit sidebar tab, and a notification panel. — [cmux Show HN blog](https://cmux.com/blog/show-hn-launch)
- Karl Wirth (Nimbalyst CEO, vendor post, Apr 2026): "A session list is not the same as knowing what an agent is doing."; "Cross-session diff review is still brutal."; "every transcript is trapped in the session that produced it." Replying means "alt-tabbing into a transcript and reading back". — [DEV](https://dev.to/stravukarl/what-actually-breaks-when-you-run-5-claude-code-agents-in-parallel-1lbd)
- Search-snippet anecdotes (not fully fetched): "My four agents finished in 25 minutes. Reviewing and merging their work took me three hours"; three terminals "with similar-looking prompts" and losing track of which was which; typing commands into the wrong window. — [Towards AI (403 on fetch)](https://pub.towardsai.net/i-ran-4-claude-code-agents-in-parallel-the-bottleneck-was-me-f596bc7f393e); [DEV: how I stopped losing track](https://dev.to/gemron_guo_d4c2e5a892fb40/how-i-stopped-losing-track-of-claude-code-and-codex-sessions-4egg)
- Deep-work protection: Mitchell Hashimoto: "turn off agent desktop notifications... it was my job as a human to be in control of when I interrupt the agent, not the other way around." He runs background agents "one at a time, not in parallel" and says "I'm not [yet?] running multiple agents, and currently don't really want to." (Feb 5, 2026) — [mitchellh.com](https://mitchellh.com/writing/my-ai-adoption-journey)
- esperent (HN): phone terminal access "really did destroy my deep thinking time," so they removed it after about 3 days. — [HN 47218318](https://news.ycombinator.com/item?id=47218318)
- petesergeant (Conductor HN): "I'm surprised people are running multiple agents, and are able to check their outputs diligently." — [HN 44594584](https://news.ycombinator.com/item?id=44594584)

### Inferences

- Engineers want two opposite things: catching blocked sessions quickly, and not being interrupted. An ADE should let the user pull ("⌘J next waiting", a quiet unread count) rather than push by default, with opt-in OS notifications and no alert for the pane already in focus (Ultenix does this, per the PH thread).
- A notification or status dot alone is not enough. It needs the reason (permission, question, done, error) plus the session title or task, so the user can decide without opening the transcript.
- Above about 3–5 sessions the bottleneck becomes review throughput, so the UI should make finished-but-unreviewed work visible as a queue, separate from waiting-for-input.

### Gaps

- No direct Reddit (r/ClaudeAI, r/ExperiencedDevs) threads were retrieved; searches returned blogs and PH instead.
- No quantitative study of context-switch cost; all numbers are anecdotal.

## 2. Preferred layouts and navigation

### Takeaway

Terminal-centric engineers prefer a vertical list of sessions (sidebar or vertical tabs) with live metadata (branch, cwd, ports, last notification), a few splits for watching sessions side by side, pane zoom, a command palette, and a keyboard jump to the next item that needs attention. Kanban boards suit "delegate and walk away" work, not interactive sessions.

### Cited Findings

- cmux design: vertical sidebar tabs showing each workspace's git branch, working directory, listening ports and latest notification text; a blue ring on a waiting pane; Cmd+Shift+U jumps to the most recent unread; scriptable CLI/socket control. The founders argue that rigid GUI orchestrators can't keep up with fast-changing agent tooling, so the terminal stays the base. — [cmux blog](https://cmux.com/blog/show-hn-launch)
- cmux user requests: "command palette (cmd-shift-p)", "cmd-z to 'zoom in' to a pane", "hotkey overrides". Complaints: "none of the controls were visible but I could see stuff happening when I moved my mouse over the panel" (hover-only controls hurt discoverability). — [cmux blog](https://cmux.com/blog/show-hn-launch)
- cmux traction: Show HN Feb 19 2026, peaked at #2, 0 to 3.5k GitHub stars in two weeks (founder-reported). — [cmux blog](https://cmux.com/blog/show-hn-launch)
- Split panes "allow you to watch multiple coding agents at the same time without having to click to switch between them." — [Towards Data Science (search snippet)](https://towardsdatascience.com/how-to-effectively-run-many-claude-code-sessions-in-parallel/)
- tmux remains common: sbinnee uses "vanilla tmux with visual changes" plus a bash script for worktrees. briantakita runs "4-6 parallel sessions", each tmux pane owning one markdown doc. funerr: "I really like cmux for this." digitalbase: "Trying workmux with claude. Really cool combo." synergy20: "I still use tmux but no longer for multiple agents," letting Claude Code manage parallelism itself. — [HN 47218318](https://news.ycombinator.com/item?id=47218318)
- Claude Code itself has an agent view (`claude agents`), "a single screen for managing multiple independent Claude Code sessions running in the background," and background sessions in worktrees under `.claude/worktrees/` (search snippets). — [Towards Data Science](https://towardsdatascience.com/how-to-effectively-run-many-claude-code-sessions-in-parallel/); [search summary](https://dev.to/gentic_news/how-to-manage-multiple-claude-code-sessions-with-harness-and-preview-460i)
- Osmani: "Teams (terminal) is for working alongside agents; Web (browser) is for delegating and walking away." He calls Conductor "the fastest way to start multi-agent orchestration on Mac" (parallel worktrees, diff-first review), and says Vibe Kanban "solves the 'doomscrolling gap'" with task cards, each with its own worktree/branch and a diff review on the board. — [addyosmani.com](https://addyosmani.com/blog/code-agent-orchestra/)
- Vibe Kanban's README says the project is sunsetting (search summary; announcement not fetched). — [GitHub BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)
- Interjection matters: aantix on Conductor wants "Being able to quickly hit escape to interject"; "Sadly, this is lost with conductor."; "I just don't feel as joyful using it." In contrast, simonbw: "This feels like just a nice clean simple extension of how Claude code already works". — [HN 44594584](https://news.ycombinator.com/item?id=44594584)
- Crystal praised as "Does One Thing Really Well" (SOLAR_FIELDS) and "the best of these tools I have come across!" (redhale). Claude Squad: "the instructions to use and interface was very clunky" (zanek). — [HN 44594584](https://news.ycombinator.com/item?id=44594584)
- Ultenix (per a PH reply): marks the agent's tab and notifies, forwarding to the phone when away, and skips the pane you're already viewing. A separate grid board shows project status. — [Product Hunt](https://www.producthunt.com/p/vibecoding/running-3-4-claude-code-codex-sessions-at-once-what-breaks-first-for-you)

### Inferences

- Aquila's sidebar + tabs + splits + ⌘J matches the cmux pattern engineers praise. Worth adding where missing: per-session branch / last-event text in the list, pane zoom (maximize one split temporarily), visible (not hover-only) controls, and the raw terminal staying fully interactive (Esc to interject) instead of being wrapped in a chat UI.
- A kanban or board view is best treated as an optional overview of task state, not the primary interaction surface. Vibe Kanban's sunsetting is weak evidence that board-first lacks staying power (cause unknown).

### Gaps

- Not researched in depth: Cursor background agents, Zed agent panel, Warp, VS Code agent sessions, Sculptor. No user quotes collected for them.

## 3. What a good review/merge loop looks like

### Takeaway

Good loop: isolated worktree per task, then a per-session diff (unified for scanning, side-by-side for refactors), then inline comments batched back to the agent, then automated verification (tests, a review agent), then PR/merge. Pain points: worktree setup cost (deps, untracked .env, submodules), cross-session combined review, and code that "passes review at first glance" but duplicates logic.

### Cited Findings

- Vibe Kanban loop: changes panel (navbar, app bar or command bar), file tree with search and expand/collapse all, unified vs side-by-side diff, hover a line to add an inline comment, comments batched and sent with the next chat message with a badge count, repeat. GitHub PR comments shown inline (pending reviews only appear once submitted). — [Vibe Kanban docs](https://vibekanban.com/docs/reviewing-code)
- Crystal: per-iteration commits, in-app diff review, integrated git operations (comparison-site description). — [Superset compare](https://superset.sh/compare/conductor-vs-crystal)
- Worktree friction on the Conductor HN thread: "you need to run all the dependency installs, etc. for every workspace" (_1tem); worktrees "don't include things that are not tracked by git" like env files (pjm331); "worktrees simply do not work with submodules" (clbrmbr); "the local branch doesn't have the changes that are on the PR" (henryaj); a shared Docker daemon "means need to manually tag & run by branch/project" (lmeyerov); worktrees are "overcomplicating most workflows" (oc1). Requests: change the default base branch, custom "Open in..." tools, multi-repo tasks, a brownfield setup script. — [HN 44594584](https://news.ycombinator.com/item?id=44594584)
- Conductor was criticized for requiring "Full read-write access to all your Github account's repos" (itsalotoffun) and for cloning from GitHub instead of local repos. cahaya: "If Conductor would work with local branches I would switch from Crystal." — [HN 44594584](https://news.ycombinator.com/item?id=44594584)
- Alternatives to worktrees: Willison uses fresh checkouts in /tmp; bernardom keeps repo, repo_2 and so on; Olshansky: "I still end up preferring having multiple clones". — [Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/); [HN 47218318](https://news.ycombinator.com/item?id=47218318); [Ask HN](https://hn.nuxt.dev/item/46682551)
- Review automation: cloverich auto-runs a review skill on every PR: "Over 10 reviews, only 1 false positive". kledru: "I think you should have a reviewer as well." schipperai runs `/fd-verify` after the worker finishes. jillesvangurp advises leaning on existing CI/CD, PRs and code review rather than new tooling. tinodb uses jj to make rebasing manageable. — [HN 47218318](https://news.ycombinator.com/item?id=47218318)
- Willison: "Code that started from your own specification is a lot less effort to review." He sends riskier tasks to async Codex Cloud. — [Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- Osmani: "Never let two agents edit the same file. Conflicts kill velocity."; "human review isn't optional overhead. It's the safety system." — [addyosmani.com](https://addyosmani.com/blog/code-agent-orchestra/)
- Wirth (vendor): coupled sessions need "a single combined review, not three separate ones." — [DEV](https://dev.to/stravukarl/what-actually-breaks-when-you-run-5-claude-code-agents-in-parallel-1lbd)
- Shared-tree hygiene rules (PH, summarized): stage only your own files by name, commit by path, never stash or revert others' work, check for foreign changes before deploy, and give routine build/test commands standing permission so only irreversible actions prompt. — [Product Hunt](https://www.producthunt.com/p/vibecoding/running-3-4-claude-code-codex-sessions-at-once-what-breaks-first-for-you)

### Inferences

- For Aquila's Changes panel and worktree sessions, the highest-value additions suggested by these complaints: inline comments sent back into the session's pty as one batched message; a unified/split diff toggle; a per-session "ready for review" state distinct from "waiting for input"; and a worktree setup hook (copy .env, run install) with a configurable base branch.
- Local-first git (no GitHub OAuth needed for the core loop) is a trust advantage.
- A test/CI pass indicator per session was requested only implicitly. No source described one in detail.

### Gaps

- No primary data on PR-creation UX preferences (in-app vs `gh` vs agent-created).
- The diff-first UI in Conductor/Crystal was not fetched from primary docs.

## 4. Plan/spec handling

### Takeaway

Markdown specs in the repo (one spec per agent), plan-mode review, and an AGENTS.md/CLAUDE.md that grows from observed failures are the most-endorsed practices. Per-session task context (which spec this session follows) is a recurring want.

### Cited Findings

- evara-ai: spends "the first 30 minutes writing detailed markdown specs"; "the spec quality is everything"; output "80-90% production-ready on the first pass." theshrike79 keeps a PROJECT.md because "the AI starts adding features like it's doing a multi-user SaaS." renewiltord: a markdown task list "survives context damage." briantakita: "The documents ARE the shared context." joshgachnang: it "starts to fall apart for a team." ramoz moved back to a single session plus "a hook for plan mode review" (plannotator). schipperai: "one spec = one agent, with worktrees if there is a chance of code clashing." — [HN 47218318](https://news.ycombinator.com/item?id=47218318)
- Hashimoto, harness engineering: "anytime you find an agent makes a mistake, you take the time to engineer a solution"; of Ghostty's AGENTS.md: "Each line in that file is based on a bad agent behavior." — [mitchellh.com](https://mitchellh.com/writing/my-ai-adoption-journey)
- Hashimoto's routine: "block out the last 30 minutes of every day to kick off one or more agents"; "try to do more in the time I don't have"; overnight triage with "I would NOT allow agents to respond, I just wanted reports the next day." — [mitchellh.com](https://mitchellh.com/writing/my-ai-adoption-journey)
- Osmani: "Your spec is the leverage." Agent Teams add "a shared task list with dependency tracking". Quality gates (plan approval, hooks, token budgets) stop errors compounding. — [addyosmani.com](https://addyosmani.com/blog/code-agent-orchestra/)
- PH (summarized): rules in CLAUDE.md/AGENTS.md work better with a short incident note beside each rule. A compact "existing utilities" index beats asking the agent to search first. — [Product Hunt](https://www.producthunt.com/p/vibecoding/running-3-4-claude-code-codex-sessions-at-once-what-breaks-first-for-you)
- Willison saves research and explanations from agents as reusable context. — [Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)

### Inferences

- Aquila could link a session to a task/spec file (show it in the title or tooltip, open it in one keystroke) without managing it itself, consistent with "don't touch the user's CLI setup".
- A "kick off before you leave / read reports in the morning" flow (Hashimoto) fits history plus a done/unread state.

### Gaps

- No evidence comparing per-session notes in the ADE vs repo markdown files.

## 5. Praised features and repeated complaints (tool summary)

### Takeaway

Praise goes to tools that feel like a thin, fast layer over the real CLI (Crystal, cmux, Conductor's simplicity) and that show attention state at a glance. Complaints cluster on permissions and trust, worktree setup cost, Apple-Silicon/macOS-only builds, clunky TUIs, hidden controls, and losing direct terminal control.

### Cited Findings

- Conductor praise: "I really enjoy the workflow." (irskep). Complaints: GitHub full-access OAuth; "You might want to mention it's silicon only." (WalterSear); "will it support other code agents, like gemini cli, codex, opencode" (markli21). — [HN 44594584](https://news.ycombinator.com/item?id=44594584)
- Crystal (now branded Nimbalyst, MIT, Electron) is praised for focus. — [HN 44594584](https://news.ycombinator.com/item?id=44594584); [Superset compare](https://superset.sh/compare/conductor-vs-crystal)
- Claude Squad: clunky interface, no uninstall instructions. — [HN 44594584](https://news.ycombinator.com/item?id=44594584)
- cmux: praised ("this looks seriously awesome", "it feels like an exciting time to be a terminal user"). Complaints are about discoverability (dev tools, hover-only controls). — [cmux blog](https://cmux.com/blog/show-hn-launch)
- Safety: schipperai says Claude "once bypassed the deny list and nuked an important untracked directory"; v_CodeSentinal: "Every new rule just taught the agent a new workaround." — [HN 47218318](https://news.ycombinator.com/item?id=47218318)

### Inferences

- Positioning that matches Aquila: real CLIs in a pty (preserves interjection and joy), local repos, and macOS-native attention UX. Risks to watch: worktree setup friction and discoverability of keyboard features (palette, zoom, next-waiting) for new users.

### Gaps

- No verbatim user quotes found for Sculptor, Warp, Zed, Cursor background agents or VS Code agent sessions within the tool budget.
- Superset, Emdash, Ultenix and Nimbalyst appear only via vendor or comparison pages.
