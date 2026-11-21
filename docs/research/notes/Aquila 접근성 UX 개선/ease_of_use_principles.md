# Ease-of-use ("편하게 쓸 수 있는") UX for an Agentic Development Environment (ADE): principles and proven patterns

Scope: the UX that makes a macOS app holding many Claude Code / Codex / shell sessions across projects feel easy, fast and calm, with the user supervising several agents at once. This is about UX, not new features. Screen-reader/ARIA detail and product-by-product comparisons of agent managers are out of scope (other researchers cover them).
Research date: 2026-11-20. Note on sources: much of the ADE material is 2025–2026 practitioner blogs and vendor writing, not peer-reviewed research. Each claim below is labeled with its source.

## 1. Supervising parallel agents: mental load, glanceable status, approvals, review (ADE-specific, highest priority)

### Takeaway

The cost of running parallel agents falls on human attention: the vigilance, context switching and review add up, while the compute does not matter. A comfortable ADE shows **what needs attention, not activity**. It uses a small, fixed set of session states. Approvals become a calm queue rather than modal interruptions. Each review should fit in one sitting.

### Cited Findings

- The term ADE took hold in June 2025 when Warp launched Warp 2.0 as an "agentic development environment". ADEs move the developer from operator to manager, "coordinating multiple agents simultaneously" — [Warp: What is an ADE](https://www.warp.dev/articles/what-is-an-agentic-development-environment); [Augment: what is an ADE](https://augmentcode.com/guides/what-is-an-agentic-development-environment); [InfoWorld: The IDE is dead, long live the ADE](https://www.infoworld.com/article/4193975/the-ide-is-dead-long-live-the-ade.html)
- Addy Osmani (Apr 7, 2026) names an "ambient anxiety tax": "More agents running doesn't mean more of you available." He adds, "What scales is your throughput of supervision, not your throughput of understanding." The main load sources are context switching, judgment calls that can't be batched, and trust calibration for each thread — [Osmani, Your parallel Agent limit](https://addyosmani.com/blog/cognitive-parallel-agents/)
- Osmani's practical limits: a typical ceiling of about 3–4 threads, and "start with one thread fewer than feels right." He time-boxes sessions because this "creates natural checkpoints that prevent quiet drift." Each thread should be reviewable in about 30 minutes. If you can't tell what's happening across several threads, you are at capacity — [Osmani](https://addyosmani.com/blog/cognitive-parallel-agents/)
- The tiring part is "background vigilance rather than active cognition." The cost of a task switch lies in recovery time, not in the switch itself — [Osmani, via search summary](https://addyosmani.com/blog/cognitive-parallel-agents/)
- One practitioner went from 2 to about 12 agents. "Adding a third didn't add a third of the load, it multiplied it," because he was acting as the scheduler. Review became the real bottleneck — [Mergify blog, Rémy Duthu, Jun 2026](https://mergify.com/blog/how-agents-work-with-parallel-agents)
- Counterview: idle time while waiting for one agent is already a context switch, so parallel sessions may cost little extra (LinkedIn opinion) — [Edwin Burgers](https://nl.linkedin.com/in/edwinburgers)
- Blake Crosley (May 15, 2026) says "The queue should show attention, not activity." He proposes a small set of run states (planning, acting, waiting, verifying, repairing, review-ready, blocked), each showing the decision the operator needs to make. He warns against false urgency: "a failed lint check on a draft branch should not look like a production mismatch." Interruptions should be saved for irreversible, public or security-sensitive actions — [Crosley, Agents Need Supervision Surfaces](https://blakecrosley.com/blog/agents-need-supervision-surfaces)
- Crosley also says "Approvals should work like a queue of review objects, not like a string of modal interruptions." Each approval shows tool, arguments, target, risk tier, reason and expected side effect. The choices are approve once / always / reject / defer / rewrite. Low-risk reads pass quietly, medium-risk ones are batched, and high-risk ones pause. "Recovery belongs beside the failed event": pause, resume, retry with changed input, fork, revert, with the failed command, working directory and output pre-filled — [Crosley](https://blakecrosley.com/blog/agents-need-supervision-surfaces)
- Linear's Agent Interaction Guidelines (Jul 2025) have six principles: an agent discloses that it is an agent, inhabits the platform natively, provides instant feedback (e.g. a "Thinking" indicator), is "clear and transparent about its internal state" (thinking / waiting / executing / finished, with reasoning and tool calls inspectable), respects requests to disengage, and "cannot be held accountable" (a human stays responsible) — [Linear AIG](https://linear.app/developers/aig); [Linear changelog 2025-07-30](https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk)
- Linear's SDK reduces agent sessions to four states: waiting for input, actively working, completed, errored. It also says "an agent that keeps going after being told to stop erodes trust faster than one that makes mistakes" — [Linear: approach to building the Agent Interaction SDK](https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk); [Every: How to design for human-agent interaction](https://every.to/thesis/how-to-design-for-human-agent-interaction)
- Human-in-the-loop: use propose-then-approve when an action "can't be undone, will be seen by other people or costs money," and "beware of approval fatigue" — [ProCreator: UX tips for AI agents](https://procreator.design/blog/best-ux-tips-when-designing-for-ai-agents). Researchers warn that oversight processes "actually push humans out of the loop" when agents overwhelm overseers with information — [IEEE Spectrum](https://spectrum.ieee.org/agentic-ai-humans-in-loop). A UW piece proposes three zones (very / barely / implicitly in the loop) instead of a binary — [UW](https://nwquantum.uw.edu/?p=2133)
- NN/g says agents and human-agent systems are "new objects of study," and some traditional research methods won't fit them — [NN/g: UX vs experience design](https://www.nngroup.com/articles/ux-vs-experience-design/)
- Common ADE practice: one git worktree per agent so parallel tasks don't interfere (Cursor 2.0 added multi-agent layouts and worktrees in Oct 2025). Having the agent draft a plan for review before it executes is a recommended pattern. More autonomy calls for better review interfaces — [search summary of Augment/Tessl/dev.to](https://tessl.io/patterns/agentic-development-workflow/coding-interfaces/)

### Inferences (how to apply to Aquila)

- **The status dot is the product.** Map every session to Linear's four states plus "needs you", e.g. `working · needs-input · done-unreviewed · error · idle`. Use the same color and shape everywhere: sidebar, tab, Dock badge, notification. Keep the set small and fixed so it can be read peripherally.
- **An attention inbox, not an activity feed.** Add a single "Needs you (N)" list (keyboard: jump to next waiting session) sorted by urgency (permission request > error > finished-unreviewed). The Dock badge should count only these items, never "running".
- **Finished is not the same as needs-you.** Treat "done" as a quiet state ("unreviewed"). It clears when the user visits the session. Only permission prompts and errors interrupt.
- **Approvals belong to the CLI.** Aquila embeds the real CLI and does not reimplement permissions, so it should not build its own approval UI. It should make the CLI's prompt _findable fast_: badge it, add a "jump to prompt" action, and include the project name and requested action in the notification text if the hook provides them.
- **Respect capacity.** Never auto-spawn sessions. Keeping 3–4 active agents visible by default is reasonable; a soft visual grouping (e.g. per-project) helps the user stay under their ceiling. Showing elapsed time per working session can support time-boxing (inference from Osmani).
- **Stop must work instantly and visibly.** Ctrl-C / an "interrupt" action should take effect right away, and the dot should change immediately (Linear's "respect disengage").
- **Recovery next to failure.** When a session exits non-zero or the pty dies, show the restart / reopen-in-same-cwd action inline in that pane, not in a global toast.

### Gaps

- I found no Anthropic- or GitHub Next-authored public essay specifically on multi-agent supervision UX in this pass, so their positions are not represented. No NN/g article dedicated to agent HITL/approval UX surfaced (only its research-agenda remarks).
- No controlled studies quantify how many parallel agents is comfortable. The 3–4 figure is one practitioner's experience.

## 2. Cognitive load, defaults, progressive disclosure, recognition over recall

### Takeaway

Show beginners a simple surface and put power features one step away, without removing them. Users skip tours (the "paradox of the active user"), so teach in context. Design for a specific user rather than everyone.

### Cited Findings

- NN/g on progressive disclosure: hiding advanced settings helps novices avoid mistakes and saves them time "contemplating features that they don't need," while users also want "power, features, and enough options to handle all of their special needs." Progressive disclosure serves both — [NN/g Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- NN/g: walkthrough tutorials are "dramatically overused." Because of the paradox of the active user, people want to start working right away and dismiss interruptions. Guidance shown out of context is hard to recall later — [NN/g Onboarding Tutorials](https://www.nngroup.com/articles/onboarding-tutorials/)
- Linear CEO Karri Saarinen: "you should design something for someone. It's hard — impossible even — to design something really good for everyone" — [Figma blog: Karri Saarinen's 10 rules](https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/)
- Linear treats quality as a recurring practice ("Quality Wednesdays") and as a north star — [Linear: Why is quality so rare](https://linear.app/blog/why-is-quality-so-rare); [AI Engineer talk, Tuomas Artman](https://www.ai.engineer/talks/wjk0ulMAkbc-taste-craft-conversation-tuomas-artman-cto-linear)
- Calm technology (Amber Case): "Technology should require the smallest possible amount of attention"; "should make use of the periphery"; "can communicate, but doesn't need to speak"; "should work even when it fails"; "The right amount of technology is the minimum needed to solve the problem" — [calmtech.com](https://calmtech.com/)

### Inferences (how to apply to Aquila)

- Default surface: sidebar (projects → sessions with dots), tabs, terminal. Keep split layouts, per-session settings and account switching behind menus or the palette.
- Recognition over recall: show project name, cwd basename, agent type icon, and the last line or title of each session in the sidebar, so users don't have to remember which tab is which.
- Good defaults: "Open Claude" in the selected project should be a single keystroke, inheriting the project's cwd. There should be no setup dialog.

### Gaps

- I did not retrieve the full text of the Laws of UX entries for Hick's or Miller's law in this pass. Only the Doherty threshold was fetched (see §3).

## 3. Speed and perceived performance

### Takeaway

Respond within about 400 ms and acknowledge every action immediately. Users judge speed by how fast the UI reacts, not how fast the backend finishes.

### Cited Findings

- Doherty threshold: "Provide system feedback within 400 ms in order to keep users' attention and increase productivity." "Use perceived performance to improve response time"; progress indicators make waits tolerable "regardless of their accuracy" — [Laws of UX: Doherty Threshold](https://lawsofux.com/doherty-threshold/)
- Linear's feel is attributed to local data, optimistic updates and keyboard-first design. "Users perceive speed based on how quickly the interface reacts, not how quickly the server responds" (third-party analysis; the author has not seen Linear's code) — [performance.dev: How is Linear so fast](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown); [dev.to: Why Linear feels fast](https://dev.to/0xgosu/why-linear-feels-fast-local-data-small-updates-and-product-discipline-1m53)
- Raycast's stated design principles are "fast, simple, and delightful," and its marketing says "Think in milliseconds" and "Keyboard First." The 2026 rewrite built custom components because standard macOS components didn't suit keyboard-first workflows — [Raycast: A fresh look and feel](https://raycast.com/blog/a-fresh-look-and-feel); [Raycast: technical deep dive](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast.md)
- Linear AIG: an agent "should provide instant feedback" when invoked — [Linear AIG](https://linear.app/developers/aig)

### Inferences (how to apply to Aquila)

- Opening a session: show the tab and pane at once with a "starting…" state, then attach the pty. Never block the UI on spawn.
- Switching sessions should feel instant: keep xterm instances mounted or cached, and avoid re-render flashes.
- Status changes (hook events) should update the dot within a frame of arriving.

### Gaps

- No measured benchmarks for Electron terminal switching latency were found.

## 4. Keyboard-first yet mouse-friendly: command palette, quick switcher, shortcut discoverability

### Takeaway

Use one memorable global palette that lists every action with its shortcut, forgives typos, understands synonyms, and ranks by context and recent use. It lets mouse users discover features and teaches keyboard users shortcuts over time.

### Cited Findings

- Superhuman: the palette lets users "instantly do any action — and also learn the shortcut for next time." Use one shortcut that works everywhere; a second press toggles it closed and restores previous focus. "You need fuzzy string matching" ("lnik" should find "link"). Add synonyms, because "your user may not know the specific terms you use in your product," and show the matched alias. Set default ranking before typing, boost commands that fit the context, and adapt to usage. "The user shouldn't have to understand the intricacies of your product" — [Superhuman: How to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- Show matching shortcuts in palette results and introduce new users to critical shortcuts sparingly — [Dynatrace: plan keyboard shortcuts](https://developer.dynatrace.com/develop/guides/keyboard-shortcuts/plan-keyboard-shortcuts/)
- Show shortcut hints specific to the user's OS in tooltips, guides and command bars. VS Code shows palette hints on its empty editor, and Figma prompts first-time users to open its shortcut guide — [Knock: How to design great keyboard shortcuts](https://knock.app/blog/how-to-design-great-keyboard-shortcuts)
- Caveat: the palette trigger can be hidden, so users may need to be taught that it exists — [Outdraw UX patterns: Command palette](https://outdraw-academy.gitbook.io/ux-patterns/command-palette)
- VS Code publishes command-palette UX guidelines for extension authors (naming, categories) — [VS Code UX guidelines: Command Palette](https://code.visualstudio.com/api/ux-guidelines/command-palette.md)
- Linear's patterns are credited to keyboard-first design and zero-friction workflows — [Gunpowder Labs: Linear's delightful patterns](https://gunpowderlabs.com/2024/12/22/linear-delightful-patterns)

### Inferences (how to apply to Aquila)

- Use Cmd+K (or Cmd+Shift+P) for one palette: "Open Claude in <project>", "Go to session…", "Next session needing input", "Switch account", "Toggle language". Each row shows its shortcut.
- Use Cmd+1…9 for tabs and Cmd+P (or similar) as a quick switcher over all sessions in all projects, with fuzzy matching on project + session name. Ranking puts "needs you" sessions first, then recent ones.
- Watch out for terminal conflicts: a pty needs most Ctrl/Option keys. Keep app shortcuts on Cmd, and make the palette shortcut toggle so it's never a trap.
- Put shortcut hints in the native macOS menu bar (free discoverability), in tooltips and in empty states. Add a "Keyboard shortcuts" sheet reachable from Help and the palette.
- Synonyms: "new", "spawn", "start", "run" and "열기" should all match "Open session".

### Gaps

- No user research found that quantifies how much palettes increase shortcut adoption.

## 5. Calm attention design: notifications, prioritization, "this needs you" without nagging

### Takeaway

Use the least intrusive channel that works, tier notifications by severity, let the periphery (dots, badges) carry routine status, and keep sounds and banners for "blocked on you". Fewer notifications raise satisfaction, while "crying wolf" trains users to ignore them.

### Cited Findings

- NN/g on dashboards: direct attention to critical values rather than flashing endless alerts without prioritization — [NN/g video: Alert fatigue in user interfaces](https://www.nngroup.com/videos/alert-fatigue-user-interfaces/)
- Practitioner guidance (secondary, widely repeated): three severity levels (high / medium / low attention), user-controlled modes (silent / regular / power), snooze and mute, and tracking whether notifications are acted on. It also reports that Facebook found satisfaction and usage improved when it sent fewer notifications — [MagicBell: Help users avoid notification fatigue](https://magicbell.com/blog/help-your-users-avoid-notification-fatigue) and LinkedIn reposts (secondary)
- Calm technology: "inform and create calm," "make use of the periphery," "can communicate, but doesn't need to speak" — [calmtech.com](https://calmtech.com/)
- ADE-specific: "The queue should show attention, not activity," avoid false urgency, and reserve interruptions for irreversible, public or security-sensitive actions — [Crosley](https://blakecrosley.com/blog/agents-need-supervision-surfaces)
- Apple platform interruption levels (passive / active / time-sensitive / critical) and thread grouping exist in UserNotifications. I couldn't fetch the HIG page text, so this comes from API knowledge, not a HIG quote — [Apple HIG: Managing notifications](https://developer.apple.com/design/human-interface-guidelines/managing-notifications) (page body not retrievable)

### Inferences (how to apply to Aquila)

- Three tiers:
  1. **Needs you** (permission prompt, question, error) → dot + Dock badge + one system notification, with optional sound, and only if the window or that session isn't focused.
  2. **Done** → quiet dot change + "unreviewed" marker, with no banner by default (opt-in).
  3. **Working** → periphery only.
- Suppress notifications for the session the user is looking at, and coalesce several at once ("3 sessions need you").
- Honor macOS Focus / Do Not Disturb automatically. Offer "Mute this session" and "Mute this project for 1h".
- Notification text should be specific and actionable: "<project> · Claude is waiting for permission". Clicking it focuses that exact session.

### Gaps

- I found no rigorous 2023–2026 study on notification fatigue in developer tools specifically. The evidence is mostly practitioner guidance.

## 6. Onboarding that doesn't get in the way

### Takeaway

Skip forced tours and forced sign-in. Use useful empty states that show system status and a direct path to the first key task, and teach in context.

### Cited Findings

- NN/g: empty states in complex apps "communicate system status, increase learnability of the system, and deliver direct pathways for key tasks." They are common in initial use before configuration — [NN/g: Empty states in complex applications](https://www.nngroup.com/videos/empty-states-in-application-design-guidelines/); [article](https://nngroup.com/articles/empty-state-interface-design)
- Every empty state should answer "what's happening, why, what can users do next" — [Toptal: Empty state UX](https://www.toptal.com/designers/ux/empty-state-ux-design)
- Tutorials are overused, users skip them, and out-of-context guidance isn't retained — [NN/g Onboarding Tutorials](https://www.nngroup.com/articles/onboarding-tutorials/)
- Real users: Warp's forced login and onboarding survey were the most common complaint ("why does a terminal app need an account?"). Warp defended login as needed for sharing and AI metering, and later made it optional — [Product Hunt Warp reviews](https://www.producthunt.com/products/warp/reviews); [dev.to: Warp, a terminal behind a login popup](https://dev.to/krunchdata/warp-a-terminal-behind-login-popup-5284); [Warp blog: login](https://warp.dev/blog/open-source-and-login-for-warp). A G2 reviewer wanted an easy switch to turn AI off — [G2 Warp reviews](https://www.g2.com/products/warp-warp/reviews)
- An anti-pattern listed in onboarding guidance is "no skip option" — [get-design-done reference](https://cdn.jsdelivr.net/npm/@hegemonart/get-design-done@1.60.4/reference/onboarding-progressive-disclosure.md) (secondary)

### Inferences (how to apply to Aquila)

- First run: no account and no tour. The empty state says "Add a project folder" (with drag & drop), then "Open Claude / Open Codex / Open shell" buttons that show their shortcuts.
- If `claude` or `codex` isn't installed, say so inline with the one install command. Don't show a modal.
- Teach in context: the first time a session needs input, a one-time hint like "Press ⌘J to jump to sessions that need you", which can be dismissed.

### Gaps

- No quantitative data on first-run checklists for developer tools was found.

## 7. Control and trust: system status, state restoration, undo over confirmation

### Takeaway

Always show the state, restore exactly what the user had, and make actions reversible instead of asking "Are you sure?". Confirm only truly destructive, irreversible actions, and name the consequence when you do.

### Cited Findings

- NN/g (Nielsen, 2018, reviewed Aug 2026): use confirmation for "actions with serious consequences," especially those that "cannot be undone." "Do not use confirmation dialogs for routine actions"; "if you cry wolf too many times, people will stop paying attention." Habituated users "simply click Yes without thinking." "Be specific and inform users about the consequence"; "do try your best to offer undo"; it's "probably best not to have a default answer at all"; use action labels ("Delete file" / "Keep file") instead of Yes/No — [NN/g: Confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/)
- NN/g lists placing destructive actions next to benign ones as a top-10 application design mistake — [NN/g: Proximity of consequential options](https://www.nngroup.com/articles/proximity-consequential-options/)
- "Prefer undo to confirmation steps" — [Andy Matuschak's notes](https://notes.andymatuschak.org/zXH4ASvHNz488hCNgrBjQJK); Smashing Magazine recommends specific language for dangerous actions — [Smashing: Managing dangerous actions (2024)](https://www.smashingmagazine.com/2024/09/how-manage-dangerous-actions-user-interfaces)
- Arc: before Spaces, closing windows "and then having to restore your working environment was a pain point." Users praise Spaces, the sidebar and split view for reducing tab overload. They complain when pinned tabs vanish on restart — [TidBITS 2023](https://tidbits.com/2023/05/01/arc-will-change-the-way-you-work-on-the-web/); [Product Hunt Arc reviews](https://producthunt.com/products/arc-browser/reviews); [dev.to Arc 18-month review](https://dev.to/pickuma/arc-browser-review-18-months-with-a-browser-that-thinks-differently-26o1)
- Linear AIG: users should see an agent's state "at a glance" and be able to inspect reasoning and tool calls, and a human remains accountable — [Linear AIG](https://linear.app/developers/aig)

### Inferences (how to apply to Aquila)

- Restore on relaunch: window frame, sidebar width, projects, open tabs, active tab and split layout. Re-open sessions in the same cwd (or offer "resume" if the CLI supports it). Clearly mark a restored but not-yet-running session rather than pretending it's live.
- Closing a tab with a running agent: don't confirm if idle. If it's working, either confirm with specifics ("Claude is still working in <project>. Stop and close?" with buttons "Stop & close" / "Keep") or close with a few seconds of "Reopen" undo where technically possible. Use Cmd+Shift+T to reopen the last closed session in the same cwd.
- Removing a project from the sidebar is reversible (it never deletes files), so use no confirm, only an undo toast.
- Keep destructive menu items away from frequent ones.

### Gaps

- No user research found specifically on session restoration in terminal apps.

## 8. Comfort details and native macOS feel vs. Electron pitfalls

### Takeaway

Users forgive Electron when it behaves like a Mac app (VS Code is cited as "forgot it's Electron"). They complain when OS conventions break: system shortcuts, regional formats, focus, memory and CPU.

### Cited Findings

- Complaints from Michael Tsai's blog comments (2025): Electron apps fail on "the way they don't adhere to OS conventions"; "system-wide keystrokes don't work properly"; "Basic stuff doesn't work as expected"; "the quickest way to tell an electron app… is the whacky datetime formatting" (ignoring regional settings); "obscene memory and CPU usage." Defenses: "Electron has gotten quite good," and VS Code users often forget "that it's an Electron app" — [Michael Tsai: Is Electron really that bad? (Apr 2025)](https://mjtsai.com/blog/2025/04/25/is-electron-really-that-bad)
- John Gruber criticized the Claude Mac app's Electron design (2024–2026). Anthropic's Boris Cherny replied that shared code keeps the look consistent across platforms — [Daring Fireball, Jul 2026](https://daringfireball.net/2026/07/claudes_criminally_bad_mac_app_is_an_inside_job); [Daring Fireball 2018 essay](https://daringfireball.net/2018/12/electron_and_the_decline_of_native_apps)
- Raycast deliberately built custom components for keyboard-first flow rather than stock macOS controls, so "native feel" means behavior more than widgets — [Raycast technical deep dive](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast.md)

### Inferences (how to apply to Aquila)

- Use a real macOS menu bar with standard items (About, Settings… ⌘,, Hide ⌘H, Window menu, Minimize ⌘M, Full screen) and shortcut hints. Support standard text editing and IME (Korean input) in every text field.
- Respect system settings: appearance (light / dark / system), accent color, reduced motion, regional date and time formats, and the trackpad scroll feel in xterm.
- Comfort controls: terminal font family and size, ⌘+/⌘−/⌘0 zoom per session or globally, line height, a density option, all remembered.
- Allow dragging folders from Finder onto the sidebar to add a project, and dragging files into a terminal to paste their path.
- Keep idle CPU near zero (no polling animations on hidden sessions) and watch memory per xterm, since resource use is the top Electron complaint.

### Gaps

- No systematic 2024 HN thread on Electron UX complaints was retrieved. The evidence is blog comments and essays.
- Cursor/VS Code-specific user complaints about ease of use weren't gathered in this pass.
