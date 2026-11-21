# Frontend developers in ADEs: where the UI loop breaks and what they praise (2025–2026)

Scope: Cursor (browser, Visual Editor, Design Mode), Claude Code, VS Code agent browser tools, Stagewise, React Grab, Conductor, cmux, Lovable/Bolt/v0. Research date: 2026-11-21. About 15 searches and fetches. Direct Reddit and Hacker News threads did not come up in search, so most user voice here comes from the Cursor forum, GitHub-style issue trackers, and practitioner blogs. Reddit quotes appear only where an article relays them.

## 1. Where does the preview/feedback loop break?

### Takeaway

The loop breaks at three points: (a) **the agent cannot see the rendered page**, so it "fixes" CSS blind and users paste screenshots by hand; (b) **element pickers are fragile**: they do nothing, crash, open a new chat instead of adding to the current one, fail on complex React roots, iframes, or device-emulation mode, and return a DOM node rather than the owning component or source file; (c) **parallel worktrees collide on dev-server ports**.

### Cited Findings

**Agent is blind to rendering / manual screenshot tax**

- A Claude Code feature request describes the loop as needing "manual feedback to Claude Code: copy paste of screenshots / DOM elements (HTML) / CSS / console logs / errors." A second request says users must "open a separate browser, take a screenshot manually, then drag into chat." Source: claudeissues.com mirror of the GitHub issues, found via search. The mirror domain did not resolve when fetched, so the wording comes from the search snippet — [#13762](https://claudeissues.com/issue/13762-feature-browser-visual-output-integration-for-ui-development), [#10646](https://claudeissues.com/issue/10646-feature-native-browser-integration-for-visual-ui-testing-and-development), [#60559 "In-app UI preview with visual review"](https://claudeissues.com/issue/60559-feature-in-app-ui-preview-with-visual-review-via-claude)
- A blog says the Reddit community calls this "CSS gaslighting": Claude "confidently claims visual fixes without any way to confirm them." The blog quotes a Reddit comment: "Claude is bad at design and will gaslight you about CSS" (2026-03-12) — [bswen](https://docs.bswen.com/blog/2026-03-12-claude-code-css-design-struggles)
- A developer describes the same loop: the user kept saying "still not working" while Claude "was guessing based on code. It couldn't actually see what was rendering in the browser." — [dev.to, Chrome DevTools MCP](https://dev.to/hassantayyab/stop-wasting-tokens-on-ui-bugs-how-chrome-devtools-mcp-changed-my-debugging-workflow-3ma9)
- A Cursor forum user wrote: "manually uploading each screenshot to the chat whenever we discuss UI issues is tedious and interrupts my workflow." Drag-and-drop also fails over remote editing. This is an older (2025) thread — [Cursor forum](https://forum.cursor.com/t/claude-cant-view-images-unless-manually-uploaded/71905)
- A Product Hunt discussion asks: "what is the best in class way to let claude/codex etc view the browser" — [Product Hunt](https://www.producthunt.com/p/vibecoding/what-is-the-best-in-class-way-to-let-claude-codex-etc-view-the-browser)

**Element picker fragility (Cursor forum, late 2025 to 2026)**

- "Select element" opens a new agent chat instead of adding the element to the current one, so the user loses context — [forum](https://forum.cursor.com/t/built-in-browser-select-element-opens-new-agent-chat-instead-of-selecting-element/145968)
- Multi-select broke after the Visual Editor shipped. Staff called it a regression — [forum](https://forum.cursor.com/t/select-element-feature-does-not-allow-multiple-element-selection/145992), [forum](https://forum.cursor.com/t/new-visual-editor-prevents-adding-multiple-elements-in-chat-box/145962). Multi-select was later listed in the 3.7 changelog — [changelog](https://cursor.com/changelog/design-mode-improvements)
- "clicking on the 'select element' icon only changes the icon colour and does nothing else" — [forum](https://forum.cursor.com/t/integrated-browsers-select-element-does-nothing/139843). Selecting an element crashes the app — [forum](https://forum.cursor.com/t/cursor-element-selector-crashing-cursor/155930). Select Element in the Agent window is non-functional — [forum](https://forum.cursor.com/t/agent-window-browser-panel-select-element-is-non-functional/137613)
- Complex React app (React + Vite + Babylon.js, Cursor 2.4.21, Jan 25, 2026): "It activates (cursor changes) but nothing highlights, and no divs are selectable." Staff suspected `pointer-events: none` on the root container — [forum](https://forum.cursor.com/t/simple-browser-element-selector-doesnt-work-on-complex-react-apps/149850)
- The picker breaks in device-toolbar (responsive emulation) mode — [forum](https://forum.cursor.com/t/select-element-not-working-with-device-toolbar/145066). It cannot select elements inside iframes — [forum](https://forum.cursor.com/t/browser-cannot-select-iframe-elements/141722). The selected element's details are truncated in chat — [forum](https://forum.cursor.com/t/the-detailed-information-of-the-selected-element-is-not-fully-displayed-when-you-select-an-element/140882)
- **DOM vs component**: "Cursor's built-in browser element selector is useful, but in component-based apps it currently works at the DOM level." The user asks Cursor to resolve the owning React/Vue component, let users add parent components, and support pluggable resolvers (Apr 28, 2026). The post was merged into "Click-to-Source from Browser / Visual Editor (Inspect → Open File & Line)" — [forum](https://forum.cursor.com/t/framework-aware-component-selection-in-cursor-browser/159263)
- Design Mode existed only in the Agent view, not the classic editor view — [forum](https://forum.cursor.com/t/design-mode-in-classic-not-agent-view/164806)

**External picker → agent handoff**

- Stagewise docs: prompts sent from the toolbar go to the IDE agent, but "in most cases, you will be required to switch over to the IDE to send the message to the agent" because of IDE API limits — [Stagewise docs](https://stagewise.io/docs/advanced-usage/use-different-agents). A forum thread reports "Cursor 1.0 ignores input from stagewise" — [forum](https://forum.cursor.com/t/cursor-1-0-ignores-input-from-stagewise/102876)

**Parallel sessions → port collisions**

- "Git worktrees handle filesystem isolation cleanly. They do not handle anything about what your code does when it runs. If you have 3 agents each spinning up a dev server, you have a collision problem." — [MindStudio](https://www.mindstudio.ai/blog/parallel-agentic-development-playbook) (vendor blog)
- Conductor recommends `CONDUCTOR_PORT` to give each workspace its own port range, plus setup scripts for installs and env files — [Conductor docs](https://www.conductor.build/docs/concepts/git-worktrees). Some users route each worktree to its own subdomain through Portless on one shared port — [Vercel community](https://community.vercel.com/t/using-portless-with-conductor-git-worktrees/34557.md)

**Product churn as friction**

- Reporting on Cursor 2.2: "it is infuriating as hell when I have to reconfigure the editor every week." Another user: "obsessed with shipping new features while critical bugs introduced by your own updates are completely ignored." A Cursor engineer said the team is "working to minimize UI changes going forward." (Dec 16, 2025) — [DevClass](https://www.devclass.com/ai-ml/2025/12/16/cursor-ai-editor-gets-visual-designer-but-bugs-and-ever-changing-ui-irk-developers/1731163)

### Inferences

- For Aquila, the bug list above doubles as a test checklist for its element pick: complex React roots with `pointer-events:none`, iframes, responsive or emulated viewport, multi-select, and "append to the _current_ session, never open a new one." Context loss when a pick opens a new chat is the most-repeated complaint.
- Aquila embeds real CLIs, so it has no chat box to attach to. Picked context has to reach the pty as text (or a file path). Stagewise's "switch to IDE to send" friction shows that delivery into the agent input is where external pickers fail.
- With parallel sessions, Aquila's preview should know which session/worktree's dev server it shows, through per-session port detection or URL binding. Otherwise users preview the wrong branch.

### Gaps

- I found no first-hand Reddit or HN threads in this pass. Reddit sentiment is second-hand, through blogs.
- I found little on hot-reload failures or console-error forwarding specifically, beyond tool docs listing console reading as a feature.
- Windsurf Previews feedback was not covered.

## 2. What screen layouts do frontend devs prefer?

### Takeaway

The converging pattern is **terminal/agent and browser preview side by side in splits, inside per-project workspaces in a vertical sidebar**, with the browser bound to its workspace. Design tools (Cursor Design Mode, Lovable) put the preview at the center. Direct user-preference data, such as surveys or polls, was not found.

### Cited Findings

- cmux: workspaces sit in a vertical sidebar that behaves "like a vertical tab." Each workspace holds split panes, and each pane has surface tabs. The typical web setup is a terminal plus a browser split (`Cmd-Shift-L`). The browser is attached to its workspace, so switching projects also switches the browser context (updated Sep 29, 2026) — [Flavio Copes](https://flaviocopes.com/cmux/)
- cmux reviewer on parallel work: "cmux makes parallel work visible, but it does not remove shared-state conflicts." He suggests one agent per workspace, or one writer plus one read-only reviewer — [Flavio Copes](https://flaviocopes.com/cmux/)
- cmux was motivated by Claude Code notifications that only say "Claude is waiting for your input" with no context. Its fix is a blue ring on the pane plus an unread panel — [cmux README](https://github.com/manaflow-ai/cmux). Desktop alerts are skipped when the workspace is already visible; `Cmd-Shift-U` jumps to the newest unread — [Flavio Copes](https://flaviocopes.com/cmux/)
- Cursor's Visual Editor runs as a browser sidebar, available as a separate window or an inline pane — [DevClass](https://www.devclass.com/ai-ml/2025/12/16/cursor-ai-editor-gets-visual-designer-but-bugs-and-ever-changing-ui-irk-developers/1731163). Design Mode lives in the browser inside the Agents Window — [Cursor docs](https://cursor.com/docs/agent/design-mode)
- VS Code: an integrated browser sits next to the chat. The agent cannot see a page until the user clicks "Share with Agent" — [VS Code docs](https://code.visualstudio.com/docs/agents/run/browser-tools). Browser tools went GA on July 1, 2026 — [GitHub changelog](https://github.blog/changelog/2026-07-01-browser-tools-for-github-copilot-in-vs-code-are-generally-available/)

### Inferences

- Aquila's split panes, sidebar, and preview already match the cmux/Cursor pattern. The differentiators would be binding the preview to a session/workspace and context-rich notifications.
- VS Code's explicit "Share with Agent" step is a privacy-first pattern. It may suit Aquila, since preview pages can contain secrets (cmux's reviewer also warns that browser state "can contain secrets").

### Gaps

- I found no survey or quantitative data on terminal/preview/diff placement preferences, or on tabs vs splits.

## 3. Complaints about reviewing AI-made UI changes

### Takeaway

The core complaint is that code review cannot show what changed visually. AI changes pass lint, types, and tests while breaking or silently removing UI. Practitioners add before/after screenshots and baseline diffs at set breakpoints, and use vision-based judgment over strict pixel diffs. Human review of both the code diff and the visual evidence stays required.

### Cited Findings

- AI tools "generate UI code that passes linting, type checks, and functional tests while introducing browser-only visual bugs" — [Augment guide](https://www.augmentcode.com/guides/visual-regression-testing-ai-generated-uis) (vendor)
- A guide titled "how to stop AI edits from silently removing UI" exists, which signals a recurring failure mode — [positioniseverything](https://www.positioniseverything.net/how-to-stop-ai-edits-from-silently-removing-ui-with-visual-regression-testing/)
- One developer's setup: system tests save screenshots, plus a slash command that makes Claude Code examine every image after frontend changes. Claude "catches a significant number of visual issues before I even start reviewing" — [Medium, Rotbart](https://medium.com/@rotbart/giving-claude-code-eyes-round-trip-screenshot-testing-ce52f7dcc563)
- Diffy gives Claude skills to capture the page, compare it against a baseline, and report which pages and breakpoints moved — [Diffy](https://diffy.website/blog/visual-regression-testing-with-claude-code/). DojoWatch sorts differences into regression, intentional, or noise across viewports — [skillsmp](https://skillsmp.com/creators/dojocodinglabs/dojowatch)
- The verify-ui skill takes before/after screenshots and checks whether the change matches its stated intent. It advises against strict pixel diffing because "anti-aliasing, font hinting, browser version drift" cause false positives — [skillsmp](https://skillsmp.com/skills/sethdford-claude-code-teams-claude-skills-verify-ui-skill-md)
- One guide recommends reviewing both the code diff and the verification evidence (Playwright screenshots) before accepting a change — [negiadventures](https://negiadventures.github.io/blog/playwright-evidence-ai-ui-changes.html)
- Show HN "ProofShot – Give AI coding agents eyes to verify the UI they build" (2026) — [HN mirror](https://hn.svelte.dev/item/47499672)
- Conductor's pitch: code stays isolated from main "until you review it in the diff viewer," then you push a PR — [Conductor](https://www.conductor.build/workflows/run-parallel-claude-codes). The New Stack's hands-on review (Oct 2025) noted it is Mac-only and Claude-Code-only — [The New Stack](https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/)
- App builders: complaints center on credits, plus "bugs, loops, or unwanted changes" on complex projects — [Product Hunt Lovable reviews](https://producthunt.com/products/lovable/reviews). A harsher anecdote: none of three teams "shipped a single component worth keeping" — [Hashnode](https://hashnode.com/forums/thread/which-ai-app-builder-actually-ships)

### Inferences

- A **before/after preview snapshot attached to the Changes panel**, per session and per viewport, would fill a gap no mainstream ADE covers natively. Today it lives in third-party skills such as Diffy, DojoWatch, and verify-ui.
- Flagging deleted JSX/markup in the diff would address the "silently removing UI" worry.

### Gaps

- I found no first-hand user quotes about huge AI diffs in UI files specifically.
- I found no evidence on how Lovable, Bolt, or v0 present diffs for review.

## 4. Praised features

### Takeaway

The most-valued capability is **rich, automatic element context**: component name, source file and line, props, computed styles, and a screenshot of the surrounding layout, delivered to the _current_ agent with one click. Other praised features are multi-select, drawing/annotation, rapid send-as-you-notice with hot reload, and agents that drive the browser themselves (console errors, screenshots).

### Cited Findings

- Cursor Design Mode (updated Jun 5, 2026) passes "the element's identity (xpath, the component, attributes, computed styles, props from the fiber tree)" plus a screenshot for spatial context. Annotation draws over "a frozen frame of the viewport." Users can select multiple elements and "describe how they should change together," narrate by voice, and send edits as they notice them while the app hot-reloads — [Cursor blog](https://cursor.com/blog/design-mode)
- Design Mode toggles with Cmd+Shift+D. Notes can be sent immediately or batched, and Cmd/Ctrl+L moves a note into the chat input — [Cursor docs](https://cursor.com/docs/agent/design-mode)
- Cursor Visual Editor (Dec 11, 2025) has sliders for position, size, color, shadow, opacity, and border. "Apply" has the agent write the code, and hot reload shows the result — [Cursor blog](https://cursor.com/blog/browser-visual-editor), [DevClass](https://www.devclass.com/ai-ml/2025/12/16/cursor-ai-editor-gets-visual-designer-but-bugs-and-ever-changing-ui-irk-developers/1731163). A skeptic on Reddit (r/cursor) asked: "Do we even need AI agents when we just make small design changes?" — same DevClass article
- React Grab: hover an element and press Cmd+C to copy the file name, React component, and HTML source, including a component stack with file path and line. It offers a Claude Code integration package and an MCP tool `get_element_context`. Its speed claims vary across sources (up to 3x, 55%, or 66%) and are unverified marketing — [GitHub](https://github.com/burrr-ai/react-grab), [Mintlify docs](https://www.mintlify.com/aidenybai/react-grab/introduction)
- Stagewise: hover to highlight, click (or multi-select), and send elements as chat attachments with their HTML and DOM position — [Stagewise docs](https://docs.stagewise.io/features/dom-context-selector)
- VS Code: "Add Element to Chat" attaches HTML, CSS, and an optional screenshot, controlled by `chat.sendElementsToChat.attachCSS` and `attachImages` — [VS Code docs](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context)
- cmux's built-in browser lets an agent "open the local site, inspect the page, click a button, read console errors, and take a screenshot" — [Flavio Copes](https://flaviocopes.com/cmux/)
- Chrome DevTools MCP is praised for giving agents computed styles instead of guesses — [dev.to](https://dev.to/hassantayyab/stop-wasting-tokens-on-ui-bugs-how-chrome-devtools-mcp-changed-my-debugging-workflow-3ma9)
- Lovable Visual Edits (Mar 13, 2025): a "Figma-like visual editor" to "visually select, edit, and save instant frontend changes." Lovable's own marketing says it uses no credits — [Lovable blog](https://lovable.dev/blog/visual-edits), [Lovable comparison](https://lovable.dev/en/guides/lovable-vs-bolt-vs-v0)

### Inferences

- Aquila's pick should send at least a selector/xpath, the component name, file:line (from the React fiber's `_debugSource` or a similar source), key computed styles, and an optional cropped screenshot path. It should paste this as a compact text block into the active pty. Users should be able to switch the CSS and image parts on or off (VS Code precedent).
- Design-token awareness, where the agent maps a picked value to `--color-*` and similar tokens, was **not found** as a praised or shipped feature in any tool. It is an open opportunity, especially since Aquila uses semantic tokens.

### Gaps

- I found no independent benchmarks of picker-context accuracy or speed gains.
- I found no evidence of tools surfacing design tokens in picked context.

## 5. Multiple parallel agent sessions on frontend

### Takeaway

Tools standardize on **one git worktree per session**, with in-app diff review and merge (Conductor, Crystal/Nimbalyst, Superset). Runtime state stays unsolved: ports, databases, and which preview belongs to which session. Visibility comes from vertical-tab workspaces plus unread or attention indicators (cmux).

### Cited Findings

- "Each Conductor workspace is a new git worktree," with review in the diff viewer before PR — [Conductor docs](https://www.conductor.build/docs/concepts/git-worktrees). Crystal and Superset follow the same model, and Superset supports many CLI agents — [Superset comparison](https://superset.sh/compare/conductor-vs-crystal) (competitor-authored)
- Port collision fixes: a `PORT` env var per worktree (`PORT=3010 npm run dev`) — [dev.to](https://dev.to/jsmanifest/parallel-ai-coding-with-git-worktrees-run-multiple-agents-without-conflicts-11na); `CONDUCTOR_PORT` ranges — [Conductor](https://www.conductor.build/docs/concepts/git-worktrees); Portless subdomains — [Vercel community](https://community.vercel.com/t/using-portless-with-conductor-git-worktrees/34557.md)
- cmux binds one browser per workspace and marks the workspace unread when the agent finishes or needs input. It warns that parallel work does not remove shared-state conflicts — [Flavio Copes](https://flaviocopes.com/cmux/)
- Cursor Design Mode encourages firing several edits without waiting for each to finish (credited to Composer 2.5) — [Cursor blog](https://cursor.com/blog/design-mode)

### Inferences

- For Aquila: (1) bind each preview to a session's port or URL and show the branch/worktree on the preview tab; (2) auto-detect the dev-server URL from pty output (`localhost:XXXX`); (3) put session-specific context in notifications ("what finished, in which project") rather than generic text, the gap cmux was built to fill.

### Gaps

- I found no user data on how many parallel frontend sessions people actually run, or on how they compare multiple variants' previews side by side.
