# Product managers and AI coding agents / ADEs: friction and comfort (2025–2026)

Scope: PMs who prototype themselves, PMs who review agent output, PMs who track many parallel agents. Context: findings will be applied to Aquila (a macOS Electron ADE that embeds the real claude, codex and shell CLIs, with status dots, notifications, ⌘J next-waiting, a Changes panel, in-app preview and session history).
Source quality: much of the available material is vendor content (Lovable, Builder.io, Linear, Anthropic, Warp), each source is tagged as such where relevant. I could not fetch Reddit threads directly, and the comment thread on Lenny's "Everyone should be using Claude Code" post is paywalled.

## Q1. What blocks non-engineer or semi-technical PMs in terminal/CLI agents, and which UI patterns lower the barrier?

### Takeaway

The main blockers are fear more than skill: no undo, raw shell commands in permission prompts, git seen as "an engineering tool", and the terminal itself. PMs reach for GUI wrappers (the desktop app, the VS Code extension), plan mode and plain-language explanations. One permission failure mode is approving everything blindly. The opposite is getting stuck, which pushes users toward risky "skip permissions" modes.

### Cited Findings

- Teresa Torres (Product Talk, a non-technical guide, 12 Nov 2025): "Claude has no undo button." / "If Claude deletes something, it doesn't go to your trash can. It's gone forever. That scares me." / Moving and copying files "can be as dangerous as deleting files." / Claude overwrote her unsaved edits: "I sadly have encountered this problem more than once." — [Product Talk](https://www.producttalk.org/how-to-use-claude-code-safely/)
- Torres on git: "Git is an engineering tool designed for engineers. It's not super easy to learn." / "I was scared to learn it for many years." She treats git as an advanced option and recommends folder backups instead. — [Product Talk](https://www.producttalk.org/how-to-use-claude-code-safely/)
- Torres on prompts: "Don't gloss over these permission requests. They're your checkpoint…" / "If you aren't sure, say no." / "When in doubt, choose 'Yes' (one time) instead of 'Yes for this session'." / "Launch Claude Code in a specific project folder, not from your home directory, Desktop, or Documents folder." / Her rule: "Claude never deletes anything. Only I delete stuff." — [Product Talk](https://www.producttalk.org/how-to-use-claude-code-safely/)
- GitHub issue #34884 on anthropics/claude-code (seen through the claudeissues.com mirror; opened 16 Mar 2026, closed 19 Mar 2026; the excerpt does not say why it was closed) asks for human-readable permission prompts. It says non-technical users (analysts, ops staff, managers) see shell commands they don't understand and "either blindly approve everything or get stuck". It proposes prompts like "I want to see what changed in the last commit" in place of raw git commands. — [claudeissues mirror #34884](https://claudeissues.com/issue/34884-feature-human-readable-permission-prompts-for-non-technical-users)
- Related issues: plain-language warnings for destructive commands (`rm -rf`, `git reset --hard`, `DROP TABLE`) — [#30505](https://claudeissues.com/issue/30505-feature-request-plain-language-warnings-for-destructive-commands-in-permission-p). Command prompts should explain "what the command does and why" in 1–2 sentences — [#77479](https://claudeissues.com/issue/77479-feature-command-execution-prompts-should-explain-what-the-command-does-and-why). The bash approval dialog is "inaccessible to non-technical users", with fixed English text and no localization or plain-language summary (opened 31 Jul 2026, still open at the time of search) — [#82789](https://claudeissues.com/issue/82789-bash-approval-dialog-is-inaccessible-to-non-technical-users-fixed-ui-text-no-loc). Requests to localize prompts — [#37685](https://claudeissues.com/issue/37685-feature-request-localize-tool-permission-prompts-do-you-want-to-proceed-based-on). The "View" button is ambiguous — [#40239](https://claudeissues.com/issue/40239-permission-prompt-ux-view-confirm-cancel-buttons-need-better-discoverability-and). Note: I saw these only as search-result excerpts, because the mirror site would not resolve on fetch.
- A headline reports that Claude Code users approve 93% of permission prompts (secondary aggregator, not verified) — [Digg](https://digg.com/ai/8te506p3). An Atomic Object post calls permission fatigue a security risk — [Atomic Object](https://spin.atomicobject.com/?p=3674329).
- A Substack commenter on a non-technical Claude Code guide warns that skip permissions plus auto-accept "is where things go sideways for non-technical users who can't debug a spiral loop" (search-result summary only) — [ruben.substack comments](https://ruben.substack.com/p/claude-code/comments).
- Lenny Rachitsky (Lenny's Newsletter, 14 Oct 2025) frames it as "forget that it's called Claude Code… think of it as Claude Local or Claude Agent". The post walks through opening Terminal step by step and admits the interface is overwhelming at first. A reader comment calls the terminal intimidating. — [Lenny's Newsletter](https://www.lennysnewsletter.com/p/everyone-should-be-using-claude-code)
- Third-party PM guides often tell PMs to use the VS Code extension, not the raw terminal. One commenter notes that most guides "start with terminal setup and lose people immediately" (search-result summaries) — [search context: Lenny's / Skool guide](https://www.skool.com/vas-ai-4135/claude-code-for-product-managers-complete-setup-guide-real-pm-workflows-2026); [Alarcon, "It's one tab over"](https://christopheralarcon.com/blog/how-to-use-claude-code)
- Anthropic redesigned the Claude Code desktop app for parallel sessions (14 Apr 2026). Guides for non-terminal users call it the easiest way in, and one reviewer says that for a PM or first-time user it "removes a real barrier". VentureBeat expects the GUI to become the default for management and review, with the CLI used for execution. — [Claude blog](https://claude.com/blog/claude-code-desktop-redesign); [VentureBeat](https://venturebeat.com/orchestration/we-tested-anthropics-redesigned-claude-code-desktop-app-and-routines-heres-what-enterprises-should-know); [eseospace guide](https://eseospace.com/blog/claude-code-desktop-app/)
- OpenAI launched the Codex app on 2 Feb 2026. One source says non-developers are about 20% of Codex's 5M+ weekly users (unverified secondary claim). One review cautions that many users of the app are non-developers and you should "tame your expectations about them handling things like 'isolation'" (i.e. worktrees). — [Fortune](https://fortune.com/2026/02/02/openai-launches-codex-app-to-bring-coding-models-to-more-users-openclaw-ai-agents/); [heyuan110 guide](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/); Every's review is titled "OpenAI's New Codex App Is Gold for Senior Engineers" — [Every](https://every.to/p/codex-vibe-check)
- Builder.io's "Claude Code for PMs" (Feb 2026; vendor) lists PM friction: "Complex multi-file changes require deeper Claude Code knowledge". On context limits: "When it fills up, responses get less accurate" (it recommends `/clear` and `/compact`). "MCP servers frequently disconnect and require re-authentication." "Each session starts fresh, and there's no built-in way to share progress with designers." It recommends Plan Mode (Shift+Tab) to explore before building. — [Builder.io](https://www.builder.io/blog/claude-code-for-product-managers)
- Cloud agents remove local setup. Linear's coding sessions run in the cloud, "so you don't need a local development setup to prototype or make changes" (Jun 2026) — [Linear changelog](https://linear.app/changelog/2026-06-11-coding-sessions). Codex cloud tasks each run in an isolated sandbox preloaded with the repo, and keep running while your computer sleeps — [OpenAI](https://openai.com/index/introducing-codex/); [OpenAI Help](https://help.openai.com/fil-ph/articles/20001545-using-codex-cloud)

### Inferences

- For Aquila, the cheapest wins for PM users: (1) a plain-language layer over a pending permission prompt (e.g. in the status/notification text: "Claude wants to delete 3 files" rather than the raw `rm`), with a red marker for destructive commands; (2) visible undo or safety, such as a "checkpoint before this session" or a clear Changes panel with revert; (3) never start a session in `~`, and default to a project folder, matching Torres's rule. All of this can be done without reimplementing the CLI's permission system, because Aquila only annotates what the pty shows.
- The terminal is a fear barrier, not only a skill barrier. Aquila's pitch to PMs should be the surrounding structure (project sidebar, status, preview, Changes), with the real CLI kept inside it.
- Localized copy (ko/en) around prompts matters, since issue #82789 and #37685 call out English-only prompt text as an accessibility gap.

### Gaps

- No primary Reddit (r/ProductManagement) threads could be retrieved. Verbatim PM complaints about dev servers ("localhost won't start") and ports were not found in a citable form.
- No survey quantifies what share of PMs use CLI agents compared with Lovable-style builders.
- I could not confirm the resolution status of the claude-code permission-prompt issues.

## Q2. How do PMs want to see progress and status across many agent sessions/tasks?

### Takeaway

The bottleneck is tracking state and pulling attention back, not launching agents. People cap out at about 4 agents without tooling. The emerging patterns are an "agent inbox" (GitHub PRs or Linear issues as the tracker), status-colored sidebars filtered by project, self-archiving when a PR merges, and digest-style summaries pulled from Slack, Linear and Notion.

### Cited Findings

- Tomasz Tunguz (14 Jul 2025, older): "I can barely manage 4 AI agents at once." Productive engineers manage 10–15, but only by writing 10–15 detailed specs up front. Agents "ask for clarification, request permission, issue web searches" and each request needs attention. Task length varies from 30 seconds to 30 minutes. He loses track of which agent is doing what, and about half the work gets redone. He proposes an "agent inbox" and notes that GitHub PRs and Linear tickets fill that role today. — [Tunguz](https://www.tomtunguz.com/how-many-agents-can-you-manage/index.md)
- Claude Code desktop redesign (14 Apr 2026): a sidebar shows "every active and recent session in one place". You can "filter by status, project, or environment" and group by project. A session archives itself when its PR merges or closes. Panes for terminal, preview, diff and chat are drag-and-drop. A side chat (⌘;) branches off without polluting the main thread. — [Claude blog](https://claude.com/blog/claude-code-desktop-redesign)
- A third-party write-up describes Claude Code's "Agent View" as color-coded status: green = completed, yellow = needs input, blue = active. Its 60% cognitive-load figure is attributed to Anthropic, but I could not verify it — [MindStudio](https://www.mindstudio.ai/blog/claude-code-agent-view-manage-multiple-agents-3)
- Warp for PMs (vendor docs): vertical tabs run separate agent sessions side by side, and "agent status badges and activity indicators" show which workstream needs attention. A suggested PM workflow is a cross-project status update that pulls Slack, Linear and Notion and is told to "Flag anything blocked or at risk." — [Warp docs](https://docs.warp.dev/guides/agent-workflows/warp-for-product-managers/)
- Codex app: the right sidebar shows diffs and uncommitted changes. A July 2026 update added inline diff editing and a PR review side panel (secondary). — [heyuan110 guide](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/); [The New Stack: "all about managing agents"](https://thenewstack.io/openais-codex-desktop-app-is-all-about-managing-agents/)
- Linear as the tracker: delegating an issue to Cursor, Codex or Linear's own agent produces a branch or draft PR plus a notification when it is ready. You can see PR reviewers and review states in Linear. — [Linear Cursor changelog](https://linear.app/changelog/2025-08-21-cursor-agent); [Linear Codex changelog](https://linear.app/changelog/2025-12-04-openai-codex-agent); [Linear integrations](https://linear.app/integrations/agents)
- An analysis argues the friction "isn't in the initiation of the task; it is in the 'state management'", and that terminal users typically juggle many tabs — [Ability.ai](https://www.ability.ai/blog/managing-ai-agents-visual-orchestration)

### Inferences

- Aquila's status dots plus ⌘J next-waiting map directly onto Tunguz's attention problem. To serve PMs, add: (a) a one-line, human-readable "what it's doing / what it needs" per session (the last prompt or question, not raw terminal text); (b) a grouped "Needs you" view across projects; (c) auto-archive or de-emphasize when work is done or merged; (d) an optional end-of-day digest ("3 sessions finished, 1 waiting, files changed").
- Linking a session to its PR or issue URL (if detectable from the git branch or CLI output) would let PMs treat Aquila as the agent inbox without opening GitHub.

### Gaps

- No direct PM-authored account of tracking many parallel coding agents was found. Most sources are engineers or vendors.
- No published data on which status vocabulary or colors non-engineers understand best.

## Q3. How do PMs hand specs/PRDs/tickets to agents and review results?

### Takeaway

Handoff is shifting to "assign the issue" (Linear → Cursor, Codex or Linear Agent), with the result coming back as a draft PR plus a diff or preview link in the same thread. PMs' preferred review medium is visual proof (preview URL, screenshots, recordings) plus a plain-language description, not the diff. Prompts that are well scoped (about one hour of work) succeed more often.

### Cited Findings

- Linear coding sessions (Jun 2026): "Start a coding session by assigning an issue to Linear", or ask in a comment or Slack thread. A session uses issue history and customer requests as context, returns a diff for review, lets you share preview links and "bring teammates into the discussion", and handles feedback "with further iterations in the same thread". Linear says the triage agent resolves about 30% of incoming bug reports internally (vendor claim). — [Linear changelog](https://linear.app/changelog/2026-06-11-coding-sessions)
- Linear + Codex: assigning or mentioning Codex starts a cloud task, and Codex posts a link back to the issue to review, create a PR or continue. Linear + Cursor: Cursor creates a branch, drafts a PR and notifies you. Cursor says background agents can be used "by your whole team—not just engineers." — [Linear Codex](https://linear.app/changelog/2025-12-04-openai-codex-agent); [Cursor blog](https://cursor.com/blog/linear); Linear also deeplinks issues into AI coding tools (Feb 2026) — [Linear changelog](https://linear.app/changelog/2026-02-26-deeplink-to-ai-coding-tools)
- OpenAI: Superhuman uses Codex so "product managers [can] contribute lightweight code changes without pulling in an engineer, except for code review." OpenAI's internal guidance: Codex works best on tasks that "would take you or a teammate about an hour… or a few hundred lines of code." — [OpenAI Codex launch](https://openai.com/index/introducing-codex/); [How OpenAI uses Codex](https://openai.com/business/guides-and-resources/how-openai-uses-codex/)
- What reviewers need from non-engineer PR authors (Builder.io, Alice Moore, May 2026, vendor): a plain-language statement of intent, a minimal diff, test results, "screenshots, a replay, or a recording", logs on failure, and a list of what wasn't tested. It proposes automatic visual recaps: each PR gets an image linked to an interactive version, "so reviewers see what changed before reading the diff". — [Builder.io](https://www.builder.io/blog/developers-drowning-in-ai-prs)
- Builder.io (vendor) pitches "Every branch gets a live preview URL", plus a Slack flow where the agent posts a plan for approval before implementing. — [Builder.io PM guide](https://www.builder.io/blog/claude-code-for-product-managers)
- Lovable share links: a view-only link to the latest in-progress version, no account needed, guests can comment by default, links expire after 7 days. — [Lovable docs](https://docs.lovable.dev/features/share-project)
- A spec still matters next to the prototype. "I spent 6 hours writing the spec. I built the prototype in 1" (Mind the Product) — [Mind the Product](https://mindtheproduct.com/be-a-product-builder-period/). A UX Collective article argues the prototype gives the "vibe" while the spec captures complexity and nuance — [uxdesign.cc](https://uxdesign.cc/how-pms-can-vibe-code-to-build-stronger-requirements-11faeedb5274)
- PMs have trouble verifying agent claims. "Sometimes it said it fixed it—but it hadn't." (Phill Lord-David, Kallidus). "You have to check that it didn't break anything when you prompt it." (Claudia Llapart). An agent "would say, 'Okay, I've applied that change,' but the text would still be in English." (Matt Smith) — [Product Talk, 11 teams using Lovable, Aug 2025](https://www.producttalk.org/2025/08/ai-prototyping-lovable)

### Inferences

- Agents claiming "done" when it isn't is a top PM pain. Aquila's in-app preview next to the session, plus the Changes panel showing which files actually changed, gives PMs a way to verify. A quick screenshot or "before/after" capture of the preview would serve the "visual recap" need.
- Supporting a Linear issue or URL as session context (e.g. paste an issue link to open a session named after it) fits how PMs already hand off work. But this would be Aquila-side glue, and must not reimplement the CLIs.

### Gaps

- No source showed PMs checking acceptance criteria item by item against agent output inside a tool. This looks unaddressed.
- No independent (non-vendor) evaluation of Linear coding sessions from a PM's point of view was found.

## Q4. Pain points in PM–engineer–designer collaboration when agents are in the loop

### Takeaway

The core collaboration failure is that the prototype a PM validated is not the code that ships. Prototypes built in Lovable-style tools live outside the production codebase, so engineers start over. When PMs do open PRs on the real repo, the review burden lands on senior engineers. Framing ("this communicates intent, not a starting point") and evidence-rich PRs ease the tension.

### Cited Findings

- Lewis Gavin (Substack, 19 Jun 2026): "What it doesn't do is give us a handoff. It's not actually built on our code base at all, so it is throw away." / "I can't point Lovable at easyfundraising because it just can't do that." Co-author Paul Johns argues that architectural drift, design debt and throwaway branches all stem from one cause: "the validated artifact is not the one that gets merged". He quotes Stripe design manager Owen Williams: "The prototype is the source of truth – they literally have a pull request of a prototype." — [Lewis Gavin Substack](https://lewisdgavin.substack.com/p/the-prototype-to-production-gap)
- Phill Lord-David (Kallidus): "We used Lovable to show the engineers what we meant." The team still rebuilt the UI in their design system. Aarthi Shankaran exported to Stitch and then Figma to match the brand. Dany Mucheroni: "Lovable couldn't help us solve the dashboard problem." Zack Nolette (LexisNexis) on his designer's reaction: "This is great and terrible at the same time." — [Product Talk](https://www.producttalk.org/2025/08/ai-prototyping-lovable)
- Framing advice found in search summaries: say "this is a prototype to communicate intent, not a starting point for code". A poorly framed prototype can pressure engineers to keep bad assumptions. — [search summary across uxdesign.cc / monday.com](https://uxdesign.cc/how-pms-can-vibe-code-to-build-stronger-requirements-11faeedb5274)
- Builder.io (vendor): non-engineers "usually have the best user context on the team" but "just don't know what you need to judge risk". Teams want them to contribute and then "expect them to act like senior engineers before we'll look at their work." It argues the entry bar should stay low and the review bar should go up. — [Builder.io](https://www.builder.io/blog/developers-drowning-in-ai-prs)
- Review load data (secondary, vendor-reported): LinearB 2026 reportedly found AI PRs wait 4.6x longer for review, and 67.3% fail first review against 15.6% for human-written code — [The New Stack](https://thenewstack.io/ai-code-review-burnout/); [Codacy](https://blog.codacy.com/ai-breaking-code-review-how-engineering-teams-survive-pr-bottleneck). Treat as unverified.
- Session isolation: "there's no built-in way to share progress with designers"; CLAUDE.md is "the best workaround available" but "requires manual upkeep" — [Builder.io PM guide](https://www.builder.io/blog/claude-code-for-product-managers)
- A Lovable vendor blog positions the handoff to engineering as "intentional by design" — [Lovable blog](https://lovable.dev/blog/prototype-to-production-handoff-how-non-technical-teams-use-lovable-without-bypassing-engineering). This contrasts with Gavin's experience above.
- Jeff Gothelf (13 Apr 2026), after an hour in Claude Code with a non-technical person: "After sixty minutes, we had something interactive" → "Now what?" / "a clickable prototype that generated 1000 new questions" / "democratizing the ability to build something is not the same as democratizing the judgment". — [Gothelf](https://jeffgothelf.com/blog/vibe-coding-surfaces-the-questions-product-management-answers-them/)

### Inferences

- Aquila sits on the real repo, unlike Lovable, which is a PM advantage: a PM's prototype session can live on a branch or worktree that engineers can open. Clear branch ownership labels per session ("PM's prototype – branch X") and a one-click "share what changed" summary (file list + preview screenshot + plain description) would address the handoff gap.
- Showing the branch name and whether work is uncommitted or pushed per session helps answer "who owns this branch".

### Gaps

- No primary source showed PM, engineer and designer conflict over branch ownership specifically. The evidence is about prototype throwaway and review load.
- Direct engineer complaints about PM-authored AI PRs (as opposed to AI PRs in general) were not found in citable form.

## Q5. Praised features and layouts

### Takeaway

Praised patterns: issue → agent assignment with results back in the thread (Linear), shareable preview links with comments (Lovable, Builder), a session sidebar with status filters and self-archiving (Claude desktop), plan mode before edits, side chats, and realistic interactive prototypes that create "common ground". Speed is the most praised outcome. Fidelity to the design system and reliability are the most criticized.

### Cited Findings

- On speed and common ground: "With an interactive prototype, we have a common ground that's undisputable. Something that would have taken about three weeks took one week." (Evangelos Foutakoglou, Group PM; Lovable marketing) — [Lovable PM page](https://lovable.dev/product-managers). "It took maybe an hour or something, which would have traditionally taken a week." (Moritz Homann, EQS). "When it feels real, they are able to identify real risks." (Jared Stephens, TimelyCare). "From idea to user validation, it just took us 11 days." (Aarthi Shankaran) — [Product Talk](https://www.producttalk.org/2025/08/ai-prototyping-lovable)
- On reliability, these complaints cut against the praise: "When I first started logging in, it took half a second. By the end, it took 25 seconds." (Stephens) / "It got stuck a few times." (Marie Phillips) / repeated fix attempts "burned tokens" (Princess Edo-Osagie) — [Product Talk](https://www.producttalk.org/2025/08/ai-prototyping-lovable)
- A PM on Product Hunt raises a gap in presenting variations: "one challenge I keep running into when sharing with stakeholders: how to present different variations of the same prototype" — [Product Hunt](https://www.producthunt.com/p/vibecoding/how-do-you-manage-variations-in-prototypes)
- Plan mode: Builder.io recommends Plan Mode to explore before building. Plan Mode "makes no changes". — [Builder.io](https://www.builder.io/blog/claude-code-for-product-managers)
- Claude desktop: unified sidebar, status/project filters, auto-archive on PR merge, in-app preview of HTML, PDFs and local servers, drag-and-drop panes, side chat — [Claude blog](https://claude.com/blog/claude-code-desktop-redesign)
- Teresa Torres and Claire Vo (How I AI, Jan 2026) show PM-centric Claude Code use: plain-markdown tasks viewed in Obsidian, small context files, and custom slash commands "to reduce friction in daily workflows" — [Lenny's / How I AI](https://www.lennysnewsletter.com/p/claude-code-for-product-managers)
- Anthropic's own framing: designers ship code, engineers make product decisions, and PMs build prototypes and evals — [Claude blog: PM on the AI exponential](https://claude.com/ja/blog/product-management-on-the-ai-exponential)

### Inferences

- For Aquila, the most transferable praised patterns: (1) a status-filtered session list grouped by project with auto-archive (Aquila already has the sidebar and dots, and could add a "done/merged" fade); (2) preview beside the session; (3) saved prompts or slash commands as a PM-friendly launcher ("Open Claude in plan mode" as a one-click option); (4) a shareable, readable "what changed" summary. Variation comparison (several prototype branches side by side in preview) is an unmet PM need.

### Gaps

- No citable PM feedback found specifically on v0, Bolt, Replit Agent, Devin, Conductor or GitHub Copilot coding agent UX. Searches returned mostly vendor pages, so those tools are under-covered here.
- Praise for Lovable comes heavily from vendor testimonials or vendor-adjacent write-ups.
