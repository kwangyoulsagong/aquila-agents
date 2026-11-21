# ADE (Agentic Development Environment) UX: what makes running many agents feel comfortable and effortless

Framing (per the user's scope update): this is not a feature checklist. It covers the qualities that make day-to-day use of an ADE feel calm, low-friction and trustworthy from the developer's seat: how quiet the signals are, how cheap switching is, how little you have to remember, how much control you keep, and how review and hand-off feel. The products are the same ones as before (Warp, iTerm2, Ghostty, cmux, VS Code, Cursor, Codex app, Claude Code desktop, Conductor, Crystal, Superset, Sculptor, Claude Squad), plus 2025–2026 essays. Research date: 2026-11-20. Sources are a mix of vendor docs, community posts and essays. Vendor claims are flagged.

## What "ADE" means and what the essays say the core UX problem is

### Takeaway

"ADE" is Warp's term (June 2025). By 2026 essays agree the hard part is the human's serial attention and review capacity, not running agents. The comfortable ADE is the one that protects attention: it routes "agent needs attention" as a first-class event, makes coming back cheap, and makes verification easy.

### Cited Findings

- Warp 2.0 (June 2025) called itself "the first Agentic Development Environment." The management UI shows each agent's status, notifications fire when an agent needs input or finishes, and users choose autonomy, from "run to completion" to "check in more frequently." — [Warp blog](https://www.warp.dev/blog/reimagining-coding-agentic-development-environment), [SD Times](https://sdtimes.com/ai/warp-2-0-evolves-its-terminal-experience-into-an-agentic-development-environment/). The New Stack's walkthrough called the "agentic" label somewhat hyperbolic, and CEO Zach Lloyd framed the main use as human review of agent-written code. — [The New Stack](https://thenewstack.io/warp-goes-agentic-a-developer-walk-through-of-warp-2-0/)
- Addy Osmani, "Is the IDE dead?" (Mar 2026): "the agent is the unit of work, not the file." "The control plane is becoming the primary surface." He lists these patterns: isolation (worktrees), tasks over files (Vibe Kanban), async-first background work, **attention routing as a first-class event** (cmux rings and unread badges), diff-first review, lifecycle integration (PR/CI), and governance (approval gates, logs). — [addyosmani.com](https://addyosmani.com/blog/death-of-the-ide/)
- Osmani, "The Orchestration Tax": starting agents is cheap and closing the loop is not. The human is a serial reviewer, and "feeling busy" can look identical to being productive. — [addyosmani.com](https://addyosmani.com/blog/orchestration-tax/). In "Your parallel agent limit" he says the right number of agents is roughly how many you can review properly (low single digits) and that the cost of a switch is in the recovery time. — [addyosmani.com](https://addyosmani.com/blog/cognitive-parallel-agents/)
- Thoughtworks (2026): the main friction is verifying AI output, so the best tools are the ones with the best visibility. — [Thoughtworks](https://www.thoughtworks.com/insights/blog/continuous-delivery/is-developer-experience-dead)
- 1Password "Demoting the IDE" (Aug 2026): Windsurf 2.0's Kanban-style view shows what agents are doing and where they are blocked. — [1Password blog](https://www.1password.com/blog/demoting-the-ide) (seen in a search snippet only, not fetched)
- "Beyond the Agents Window" (Apr 2026) argues that parallel agent windows alone don't solve the deeper orchestration problem. — [dev.to/lastkeyagency](https://dev.to/lastkeyagency/beyond-the-agents-window-why-parallel-execution-is-only-half-the-answer-56m6) (snippet only)
- RedMonk (Dec 2025), "10 things developers want from their agentic IDEs" (persistent memory, spec-driven development, etc.). — [RedMonk](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/) (snippet only)

### Inferences

- For Aquila, "comfortable" means minimizing the orchestration tax: fewer interruptions, cheap re-entry, clear "what needs me" state. More panes or more agents do not help.

### Gaps

- I did not fetch the RedMonk, 1Password and Lastkey pieces in full. Their claims above come from search snippets.

## Calm vs noisy: how attention signals feel

### Takeaway

The calm tools share one structure. An ambient, glanceable layer (a status dot or ring per session) sits next to a separate interruptive layer (system notification, sound, badge) that fires only when you are away, names the session and the reason, and **retracts itself once you look**. Noise complaints come from signals that fire while you are already watching, use generic text, or repeat on every question.

### Cited Findings

- **Calm by design (Josh Morony, tmux + Claude hooks)**: separate "what's the state of everything?" (glanceable status bar, counters first) from "do I need to go back?" (alerts). Alerts fire only when the terminal isn't frontmost, so you aren't "spammed while watching." They persist so they "are still there when you come back," and retract when you view that instance, so persistence never becomes "a pile of stale alerts to clear by hand." The states he keeps separate are working, blocked-awaiting-approval, and finished-not-yet-viewed. — [Workflow write-up](https://www.joshmorony.com/workflows/handoff-claude-code-tmux-status-indicator/), [essay](https://www.joshmorony.com/effectively-manage-attention-across-multiple-coding-agents/)
- **cmux**: the pane gets a blue ring and the tab lights up when an agent needs you, quiet until something happens. A notification panel holds pending items, a shortcut jumps to the latest unread, and the sidebar shows the latest notification text. It was built because Claude's default notification was "always the same generic message" and tab titles were unreadable with many tabs. — [cmux README](https://raw.githubusercontent.com/manaflow-ai/cmux/HEAD/README.md), [Product Hunt](https://www.producthunt.com/posts/cmux)
- **iTerm2**: a colored dot plus label (Working / Waiting / Idle, with Done and Error since 3.7.5). A detail line gives the reason (the permission tool, or the last message). The list is **sorted so sessions needing attention are on top**. This is passive and scannable. — [iTerm2 docs](https://iterm2.com/claude-code-integration.html), [agentsroom guide](https://agentsroom.dev/blog/claude-code-in-iterm2-what-the-integration-does)
- **VS Code Inbox mode**: "acknowledge" a session to clear its activity without archiving it. It sits in an "Acknowledged" group until new activity arrives, an explicit "I've seen this" gesture. App-icon badges are in Preview. — [VS Code docs](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions)
- **Warp**: one notification mailbox behind a bell icon collects finished, error and needs-input events, alongside per-tab status icons and toasts when blocked. — [Warp docs](https://docs.warp.dev/agents/capabilities/agent-notifications/)
- **Superset**: working indicators, completion chimes, dock badges. — [Superset README](https://raw.githubusercontent.com/superset-sh/superset/main/README.md)
- **Noise complaints**: the Ghostty bell rings every time Claude asks a question, and a blog post explains how to silence it. — [andrewbaker.ninja](https://andrewbaker.ninja/2026/08/17/silencing-the-ghostty-bell-when-claude-code-asks-a-question/). OSC 9 notifications still show a banner and badge while the window is focused, and users ask for suppression. — [ghostty #10691](https://github.com/ghostty-org/ghostty/discussions/10691). Users want configurable notification sounds. — [ghostty #11866](https://github.com/ghostty-org/ghostty/discussions/11866). Ghostty bounces the dock only when the app is unfocused, a small calm-by-default choice. — [Ghostty commit](https://git.uoc.run.place/Applied-Software/ghostty/src/commit/2bcd76c3d9a61c277d5dcaef936ce62cab5adcee/macos)
- **Osmani**: interrupt only for decisions that need judgment, send routine results to a queue, and protect focus windows where agents queue instead of interrupting. This is my synthesis of his argument, not a feature list he wrote. — [Orchestration Tax](https://addyosmani.com/blog/orchestration-tax/)

### Inferences

- Calm recipe for Aquila: dots always on; notifications only if the session isn't visible; text = project + session + reason; auto-clear on view; a dock badge counting sessions that need you (not every event); one global "quiet" toggle. I found no evidence of a per-session mute in any tool, so it is an open opportunity.
- "Done" should not interrupt the way "waiting for permission" does. Permission blocks the agent, while done can wait in a queue.

### Gaps

- I found no documented do-not-disturb or per-session mute in Conductor, Codex app, Claude desktop or cmux. Notification behavior in the Claude Code desktop app is not described in its redesign materials.

## Low-friction switching between agents

### Takeaway

Switching feels effortless when (a) you go straight to "the one that needs me" with a single key or click, without scanning; (b) every session is recognizable at a glance by name, branch and last message; and (c) re-entering a session shows what changed and what decision is needed. Layout alone (tmux, grids) doesn't fix it: "Layout is not workflow."

### Cited Findings

- cmux: a shortcut jumps to the most recent unread notification. — [cmux README](https://raw.githubusercontent.com/manaflow-ai/cmux/HEAD/README.md). iTerm2: click a priority-sorted row to jump. — [iTerm2 docs](https://iterm2.com/claude-code-integration.html). Josh Morony: an fzf popup switcher with live pane preview. — [workflow](https://www.joshmorony.com/workflows/handoff-claude-code-tmux-status-indicator/)
- Claude desktop redesign (Apr 2026): one sidebar for active and recent sessions across repos, filter by status/project, group by project, `⌘/` shows the shortcuts for session switching, spawning and navigation. — [Anthropic blog](https://claude.com/blog/claude-code-desktop-redesign)
- Sculptor's team: "lowering the barrier to working in parallel is key," including context switching. Pairing Mode lets you hop between agents' containers and sync each one into your own IDE. — [Show HN: Sculptor](https://hn.svelte.dev/item/45427697), [imbue.com/sculptor](https://imbue.com/sculptor/)
- "Parallel Code" author: tmux fixes layout, not workflow ("Layout is not workflow"). Pain points were forgetting which terminal serves which branch and hesitating to start "just one more" agent. The main benefit of per-session isolation was "clarity more than speed." — [dev.to/johannesjo](https://dev.to/johannesjo/why-multitasking-with-ai-coding-agents-breaks-down-and-how-i-fixed-it-2lm0)
- Recognizability failures: every Ghostty tab said "Claude Code" — [dev.to](https://dev.to/liran_baba/why-every-ghostty-tab-said-claude-code-and-the-30-line-zsh-hook-that-fixed-it-19h5). Claude's spinner overwrites pane titles — [issue #55397](https://claudeissues.com/issue/55397-feature-include-session-name-in-terminal-title-critical-for-tmux-cc-iterm2). Users request session naming and machine-readable state — [issue #36909](https://claudeissues.com/issue/36909-feature-request-session-naming-and-machine-readable-state-indicators-for-multi-s)
- Rich rows aid recognition. cmux tabs show branch, PR status, cwd, ports and latest notification text — [cmux README](https://raw.githubusercontent.com/manaflow-ai/cmux/HEAD/README.md). VS Code rows show status, harness and change stats — [VS Code docs](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions)
- Layout churn hurts. Cursor 2.0's move to an agent-centric layout produced forum threads like "2.0 – a step in the wrong direction" and "Lost in New UIs". Cursor's sidebar groups by git remote, so worktrees and clones collapse together. — [Cursor forum](https://forum.cursor.com/t/2-0-a-step-in-the-wrong-direction/139648?page=5), [Lost in New UIs](https://forum.cursor.com/t/lost-in-new-uis/159278/5), [worktrees grouping](https://forum.cursor.com/t/worktrees-in-agent-sidebar/156637)
- Osmani: switch cost lives in recovery time. A short "what changed and what decision is needed" summary on re-entry is my extrapolation from his argument. — [Orchestration Tax](https://addyosmani.com/blog/orchestration-tax/), [parallel agent limit](https://addyosmani.com/blog/cognitive-parallel-agents/)

### Inferences

- The single most effortless switching gesture for Aquila is one key that cycles through sessions that need attention (waiting first, then done-unread). Next comes a quick switcher with fuzzy search over project, title and branch.
- Keep the layout stable. Users punish big layout changes (Cursor). Add capability without moving the user's landmarks.

### Gaps

- I found no documented Cmd+1..9 or jump-to-next-waiting shortcut in Conductor, the Codex app or Claude desktop (the Codex Commands page could not be fetched).

## How much the user has to remember (memory burden, persistence, restart)

### Takeaway

Comfortable tools remember for you. They keep which agent is doing what (names, branch, last message), keep sessions alive across app quit and restart, and reconstruct context on return. The common gap is resuming the actual CLI conversation after a restart, which users script by hand.

### Cited Findings

- Superset: sessions "stay alive and running if you quit or update the app, similar to tmux." — [Show HN: Superset](https://hn.svelte.dev/item/46368739). Claude Squad: quitting leaves agents running in tmux. — [README](https://raw.githubusercontent.com/smtg-ai/claude-squad/main/README.md)
- Users script `claude /resume` on terminal restart because it doesn't happen automatically. — [classmethod (cmux)](https://dev.classmethod.jp/en/articles/cmux-auto-resume-claude-code/), [dev.to snapshot/restore](https://dev.to/daksh-gargas/snapshot-your-terminal-state-restore-it-after-a-crash-claude-code-sessions-included-32pj)
- Claude desktop power users still miss durable metadata (phase, tags, linked files), search across past prompts and outputs, "reopen a session with its original context reconstructed," and a board view of which agent is on which branch, blocked, or ready to merge. — [dev.to/stravukarl](https://dev.to/stravukarl/claude-code-desktop-after-the-redesign-what-anthropic-shipped-and-what-power-users-still-miss-150h)
- Josh Morony's problem list: losing track of which projects still have agents running, forgetting work in other projects, returning too early or too late. — [essay](https://www.joshmorony.com/effectively-manage-attention-across-multiple-coding-agents/)
- Self-tidying reduces what you must remember to clean up. Claude desktop sessions auto-archive when their PR merges or closes — [Anthropic blog](https://claude.com/blog/claude-code-desktop-redesign). VS Code "Mark as Done" is restorable, and archiving a worktree session commits uncommitted work first — [VS Code docs](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions). Crystal deletes the worktree along with the session and commits each iteration — [Crystal CLAUDE.md](https://raw.githubusercontent.com/stravu/crystal/v0.3.4/CLAUDE.md)

### Inferences

- For Aquila: restore the full session list on relaunch, with titles, projects and last state, and offer one-click resume of the CLI conversation. That removes the most-scripted pain.
- "Done" should mean tidy, not deleted. Keep a recoverable archive so users don't fear losing things.

### Gaps

- I found no sources on scrollback persistence across restarts, or on close-confirmation when a process is running, in these tools.

## Trust and control while agents run

### Takeaway

Users feel in control when the blocking moment (permission or input) is unmistakable and comes with its reason, when the blast radius is contained (worktree or container isolation), and when they choose the autonomy level. Trust erodes when the status integration silently breaks or the agent's actual state is unclear.

### Cited Findings

- Warp lets the user set autonomy, from run to completion to frequent check-ins. — [Warp blog](https://www.warp.dev/blog/reimagining-coding-agentic-development-environment)
- Sculptor: containers let users skip permission prompts safely ("keep running the code until it actually works"). The goal is to verify agent code "so that over time you can trust it more." Founders admit "the cognitive overhead is real." — [Show HN: Sculptor](https://hn.svelte.dev/item/45427697)
- Worktree isolation as the safety net: Conductor (each workspace is its own worktree, branch, terminal and diffs) — [conductor.build](https://www.conductor.build/). Claude desktop isolates worktrees by default — [Claude Code desktop docs](https://code.claude.com/docs/en/desktop). The Parallel Code author says isolation made him "feel safer experimenting." — [dev.to/johannesjo](https://dev.to/johannesjo/why-multitasking-with-ai-coding-agents-breaks-down-and-how-i-fixed-it-2lm0)
- iTerm2's detail line names the tool a permission request concerns, so you know why the agent is blocked before switching. — [iTerm2 docs](https://iterm2.com/claude-code-integration.html)
- Silent breakage erodes trust. If Claude rewrites `~/.claude/settings.json` and drops iTerm2's hook, tabs stop updating with no warning. iTerm2 now offers to reinstall the hook when it notices. — [agentsroom guide](https://agentsroom.dev/blog/claude-code-in-iterm2-what-the-integration-does), [iTerm2 docs](https://iterm2.com/claude-code-integration.html)
- "Working" detection is subtle. Morony checks for the interrupt hint in the pane footer to avoid stuck "working" states after an interrupt, and tells permission prompts from idle prompts by hook matcher. — [workflow](https://www.joshmorony.com/workflows/handoff-claude-code-tmux-status-indicator/)
- Osmani lists governance (approval gates, tool logs, audit trails) as a core ADE pattern. — [Is the IDE dead?](https://addyosmani.com/blog/death-of-the-ide/)

### Inferences

- A wrong status dot is worse than none. Aquila should prefer hook signals, handle interrupts and stale states, and visibly flag "status unknown" rather than guess. Aquila's per-session `--settings` hooks file already avoids iTerm2's global-config fragility. Worth keeping and highlighting.

### Gaps

- No product documented how it handles "agent state unknown or stale."

## Review and hand-off moments

### Takeaway

Review is the bottleneck every source names. Hand-off feels good when you return to a compact, trustworthy summary (diff + to-do + summary), can verify in your own environment, and can batch reviews instead of being pulled in mid-task.

### Cited Findings

- HN on Superset: review is the real constraint, turning "typing time" into "reading time." — [Show HN: Superset](https://hn.svelte.dev/item/46368739)
- A Sculptor user built most of an app "while cooking," then found "the diffs, Sculptor's internal to-do list, and summaries all helpful" when reviewing. Pairing Mode syncs agent work into your own IDE to test and edit. — [Show HN: Sculptor](https://hn.svelte.dev/item/45427697)
- Diff-first review in-thread, then open the result in the editor for manual fixes (Claude Code Web, Copilot Agents, Codex). — [Osmani](https://addyosmani.com/blog/death-of-the-ide/)
- Claude desktop: diff viewer rebuilt for large changesets, integrated terminal, preview pane, view modes (Verbose/Normal/Summary) that control how much tool detail you see. — [Anthropic blog](https://claude.com/blog/claude-code-desktop-redesign)
- Warp Code (Sept 2025) added a review experience for steering agent diffs. — [Warp blog](https://www.warp.dev/blog/introducing-warp-code-prompt-to-prod)
- VS Code: a per-session "Changes" pill aggregates edits, and rows show change stats. — [VS Code docs](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions)
- Osmani: batch reviews, attach machine proof (tests, screenshots), track what changed since you last read it to avoid "cognitive debt." This is a synthesis of his argument. — [Orchestration Tax](https://addyosmani.com/blog/orchestration-tax/)

### Inferences

- Aquila already has a changes panel. The comfortable addition is a "since you last looked" marker on each session (new output or changes since last focus), plus the agent's last message as the hand-off summary on the sidebar row.

### Gaps

- I couldn't fetch The New Stack's hands-on reviews of Conductor and the Codex app (HTTP 403), so first-hand reviewer impressions of those two are missing.

## What users say feels good or annoying

### Takeaway

What feels good: near-zero friction to start ("~2s" worktrees), being able to walk away and get called back, clarity about which agent does what, and the native CLI left intact. What annoys: generic or noisy notifications, unreadable or overwritten tab titles, review overload, layout churn, heavy resource use, silent integration breakage, and cost and rate-limit multiplication.

### Cited Findings

- Good: "very little friction to spinning up a worktree (~2s)", "no longer chained to my laptop", agents watching builds and notifying when done. — [Show HN: Superset](https://hn.svelte.dev/item/46368739)
- Good: Sculptor is "Like claude code with task parallelism and history built in, all with a clean UI"; "transparent and understandable"; "my favorite agentic coding tool." — [Show HN: Sculptor](https://hn.svelte.dev/item/45427697)
- Good: keeping native CLI behavior intact (Parallel Code), and Sculptor "feels like you are using Claude Code locally." — [dev.to/johannesjo](https://dev.to/johannesjo/why-multitasking-with-ai-coding-agents-breaks-down-and-how-i-fixed-it-2lm0), [Show HN: Sculptor](https://hn.svelte.dev/item/45427697)
- Annoying: generic notification text and unreadable tabs (cmux origin story) — [Product Hunt](https://www.producthunt.com/posts/cmux). Bell on every question — [andrewbaker.ninja](https://andrewbaker.ninja/2026/08/17/silencing-the-ghostty-bell-when-claude-code-asks-a-question/). Banners while focused — [ghostty #10691](https://github.com/ghostty-org/ghostty/discussions/10691)
- Annoying: high idle CPU and memory, containers "very heavy for a dev laptop" (Sculptor) — [Show HN: Sculptor](https://hn.svelte.dev/item/45427697). xterm.js struggles with very large terminals (Superset) — [Show HN: Superset](https://hn.svelte.dev/item/46368739)
- Annoying: doubt that multiplexing saves time at all, "10x the cost with 0 to show" — [Show HN: Superset](https://hn.svelte.dev/item/46368739). Parallel agents multiply usage limits (third-party estimate) — [morphllm](https://www.morphllm.com/conductor-ai-coding)
- Annoying: Cursor 2.0 layout change disorienting — [Cursor forum](https://forum.cursor.com/t/2-0-a-step-in-the-wrong-direction/139648?page=5). Codex app worktree threads missing from the project sidebar — [OpenAI community](https://community.openai.com/t/codex-app-does-not-display-worktree-threads/1373261)

### Inferences

**Shortlist: highest-value comfort patterns for a small team (Aquila)**

1. **Two-layer attention**: quiet always-on dots (working / waiting / done-unread / idle / error) plus interruptions only when the session isn't visible. Sources: Morony, cmux, iTerm2.
2. **Self-clearing, specific notifications**: project + session + reason ("Permission: Bash"). Auto-retract on view, dedupe, no banner while focused. Sources: Morony, cmux, ghostty #10691.
3. **"Done-unread" as its own state**, cleared by looking (VS Code "acknowledge"). It is the cheapest way to stop re-checking idle sessions.
4. **One key to jump to the next session that needs me**, with waiting first, plus attention-first ordering in the sidebar. Sources: cmux, iTerm2.
5. **Recognizable rows**: user-editable title not overwritten by the CLI, branch, last-message or permission snippet. Sources: cmux, VS Code, the Ghostty/iTerm2 title complaints.
6. **Graded interruption**: permission/input interrupts, done goes to a queue or badge, plus one global quiet toggle (and per-session mute, which no tool documents). Sources: Osmani, Ghostty noise complaints.
7. **Remember everything across restarts**: restore the session list and offer one-click CLI resume. Sources: Superset persistence, users scripting `/resume`.
8. **Honest status**: hook-based, handle interrupts, flag "unknown," self-repair integration. Source: iTerm2 breakage.
9. **"Since you last looked" re-entry cue** on sessions and the changes panel. Sources: Osmani, the Sculptor summaries praise.
10. **Stable layout and the native CLI untouched**. Sources: Cursor backlash, Parallel Code, Sculptor praise.

### Gaps

- Reddit (r/ClaudeAI, r/commandline) could not be mined. Searches returned vendor comparison pages instead, so the user voice above comes from HN, Product Hunt, GitHub discussions, forums and blogs. Windsurf 2.0's Kanban view, zellij and Claude Code on the web were not researched in depth.
