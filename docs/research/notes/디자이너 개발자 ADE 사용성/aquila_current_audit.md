# Aquila today: usability audit of the designer/developer tools (codebase reading, 2026-11-21)

Scope: Changes panel (T3/T25), Remote SSH (T29/T36/T39), Figma MCP opt-in (T32), Preview + pick element (T33),
Figma prompt chips "Design vs Build" (T34), Guide (T23/T24), First-run checklist (T17). Three personas: **FE** = frontend
dev, **BE** = backend/server dev, **DS** = Figma designer.
Method: read only, no app run. "Sources" are repo paths with line numbers (relative to
`/Users/sagong-kwangyoul/Desktop/aquila-agents/`). Nothing was clicked through live by this researcher. Every UX
claim comes from reading the code and copy, not from watching users.

---

## 1. Entry points and discoverability of each tool

### Takeaway

Changes and Preview are reachable four ways: a tab-bar icon, a shortcut, ⌘K, and the View menu. But the tab-bar icons
are bare glyphs (`±`, `◫`) that only explain themselves on hover. Figma lives deep inside Right-click → Project settings
and is off by default. Its chips appear only after you paste a Figma link. "Design vs Build" isn't a mode at all, just two
chip-group labels. Remote and Figma have **no guide entry**, no ⌘K action and no menu item of their own.

### Cited Findings

**Shortcut map / global entry points**

- One shortcut map: Changes `⌘⇧G`, Preview `⌘⇧P`, History `⌘Y`, Guide `⌘/`, Palette `⌘K`. There is no shortcut for
  Figma, Designer, remote, or Select element — `src/shared/lib/shortcuts.ts:9-76`
- ⌘K actions include `toggleChanges`, `togglePreview`, `history`, `addProject`, `projectSettings`, `firstRun`
  ("Setup checklist") and `guide`. There is **no** Figma action, Designer action, "Select element" action or
  "Add remote project" action. `addProject` opens the generic add flow — `src/widgets/command-palette/model/commands.ts:75-101`
- macOS menu bar: File → Open Claude/Codex/Shell, Add project, Close. View → Show changes, Show preview. Help → Guide,
  What's new. No Figma or remote items — `electron/appMenu.ts:52-64, 108-109, 131-132`

**Changes panel**

- Tab-bar trailing area: a ghost icon button with the bare glyph `±`, plus a tooltip "Show changes ⇧⌘G" — `src/pages/workspace/ui/WorkspacePage.tsx:327-337`
- Shown for local **and** remote projects (no `!project.remote` guard) — `src/pages/workspace/ui/WorkspacePage.tsx:327-337, 401-407`
- Guide item "Changes panel" has captured media (`changes.*.webm/webp`) — `src/features/guide/media/` listing; copy at `src/shared/i18n/dictionary.ts` ('guide.changes.body', ~line 969)

**Preview + Select element**

- Tab-bar icon with the bare glyph `◫`, tooltip "Show preview ⇧⌘P". **Hidden entirely for remote projects** — `src/pages/workspace/ui/WorkspacePage.tsx:338-349`
- The panel renders only when `project && !project.remote` — `src/pages/workspace/ui/WorkspacePage.tsx:409-416`
- "Select element" is a button in the panel's second bar, disabled until a page has loaded (`disabled={!ready && !picking}`) — `src/widgets/preview/ui/PreviewPanel.tsx:261-268`
- Guide item "Preview + select element" exists (still image only: `preview.en.webp`, no video) — `src/features/guide/media/`; copy `src/shared/i18n/dictionary.ts:973`

**Figma MCP (T32)**

- The only entry point is the "Figma MCP" block inside **Project settings** (Right-click project → "Project settings…" or ⌘K → "Project settings…"). It's rendered through `renderFigma` and only in the local branch of the dialog — `src/features/manage-projects/ui/ProjectSettingsDialog.tsx:35-36, 268-272`; `src/pages/workspace/ui/WorkspacePage.tsx:385`
- "Off by default, per-project toggle; Figma UI hidden when off" — `docs/en/TASKS.md:252-262`; `docs/en/ARCHITECTURE.md:371-372`
- When off, the block shows only an Off/On segment with the hint "New Claude and Codex tabs get the official Figma MCP. Log in from the CLI (/mcp)" — `src/features/figma/ui/FigmaSettings.tsx:32-42`; `src/shared/i18n/dictionary.ts:690-691`
- "No in-app guide entry (needs captured media)" — `docs/en/TASKS.md` T32 Left over (line 254). The registry confirms there is no `figma` id — `src/features/guide/model/registry.ts:30-108`

**Figma prompt chips / "Design vs Build" (T34)**

- Chips render over a Claude/Codex terminal only if the project has `figma` on — `src/widgets/split-view/ui/SplitView.tsx:251-253`
- Trigger: a capture-phase `paste` listener. The chips appear only when the pasted text parses as a Figma link. **Typing** a link or dragging one in does not trigger them — `src/features/figma/ui/FigmaChips.tsx:19-37`
- "Design vs Build" = two `TermChipGroup` labels inside the chip overlay. Design: "Compare with app", "Comments → TODOs". Build: "Build with our components", "Get assets". A FigJam link gets "Flow → screens" and "Comments → TODOs" only — `src/features/figma/model/link.ts:30-53`; `src/shared/i18n/dictionary.ts:708-716`
- Any Enter in the terminal (even an unrelated one) dismisses the chips — `src/features/figma/ui/FigmaChips.tsx:27-30`
- "No in-app guide entry (needs captured media)" — `docs/en/TASKS.md:274` (T34 Left over)

**Remote SSH (T29/T36/T39)**

- Entry: sidebar text row "+ Add project" → native menu "Folder on this Mac…" / "Remote server (SSH)…" — `src/widgets/sidebar/ui/Sidebar.tsx:105`; `src/shared/i18n/dictionary.ts:663, 1111-1112`; spec `docs/en/TASKS.md:439-441`
- Remote projects are forced into the built-in "Remote" group — `docs/en/TASKS.md:370-373`; `src/features/manage-projects/ui/RemoteProjectDialog.tsx:44-45`
- "No in-app guide entry yet (needs captured media)" — `docs/en/TASKS.md:226` (T29 Left over). No `remote` id in the guide registry — `src/features/guide/model/registry.ts`

**Guide (T23) and First-run (T17)**

- Guide: `?` in the sidebar footer, `⌘/`, ⌘K → "Guide", Help menu. Offered once after the first-run checklist closes ("Take a quick tour?") — `docs/en/ARCHITECTURE.md:595-609`; `src/shared/i18n/dictionary.ts:918-922`
- Registry items: palette, sessions, projects, status, attention, globalShortcut, notify, split, focus, zoom, resize, changes, preview, terminal, worktree, history, trends, accounts, restore, power, firstRun, language, shortcuts. **No figma, designer, chips or remote** — `src/features/guide/model/registry.ts:30-108`
- First-run checklist checks PATH, claude/codex/git, and project folders. Nothing about preview, Figma or SSH. The only remote reference makes sure dropped folders don't land in the Remote group — `src/features/first-run/ui/FirstRunChecklist.tsx:12, 76`; `docs/en/ARCHITECTURE.md:579-593`

### Inferences

- FE: Preview and Changes are discoverable enough (menu, ⌘K, guide), but the `±`/`◫` glyphs are icon-only, the same
  problem T46 fixed for the sidebar's `+` and `✦`. The tab bar was not part of that pass.
- DS: the biggest problem is discoverability. Nothing in the main UI hints that Figma exists until you open a dialog meant
  for folder, branch and port settings. The chips need an exact gesture (paste into a Claude/Codex tab of a Figma-enabled
  project). Designer mode is a small ghost button inside the Preview header, and it shows up only after Figma is on.
- BE: remote is now reachable from "+ Add project", but with no guide entry, ⌘K item or menu item, it's easy to miss.

### Gaps

- Not verified live whether the `±` / `◫` tooltips are read by users or how long hover takes. No usage telemetry exists in the repo.

---

## 2. Step count and required setup to first success

### Takeaway

The Changes panel takes 1 step (git repo required). Preview takes 2–3 steps but needs a dev server running _inside
an Aquila terminal_ or a `.claude/launch.json`. Figma takes about 6–9 steps across Aquila and the CLI, and one of them
is a CLI-internal `/mcp` login. On first success, Remote needs a pre-configured `~/.ssh/config` alias with key auth,
tmux on the host, and a typed remote path.

### Cited Findings

**Changes panel (FE/BE): about 1 step**

- Press ⌘⇧G or `±` → panel on the right for the selected project. It watches the tree with `fs.watch` (400 ms
  debounce), refreshes on focus and every 45 s, and shows "git working tree · updated n s ago" — `docs/en/ARCHITECTURE.md:94-114`
- Requires git. The first-run row says "Needed for the changes panel and worktrees" — `src/shared/i18n/dictionary.ts:889`
- Empty and error states are one-line notes only: "Not a git repository", "No changes", "Showing the first 400 KB" — `src/widgets/changes-panel/ui/ChangesPanel.tsx:380-414`; `src/shared/i18n/dictionary.ts:763-765`
- Review loop: click a line → comment ("⌘Enter to add") → "Paste comments (n)" pastes into the focused session; the user presses Enter. "Commit message" / "PR description" paste fixed prompts. With no session the panel says "No session to paste into. Open one first." — `src/shared/i18n/dictionary.ts:781-789`; `src/widgets/changes-panel/ui/ChangesPanel.tsx:129`
- Revert is confirmed in a dialog and backed up (stash, or Trash for untracked files) — `src/widgets/changes-panel/ui/ChangesPanel.tsx:84, 190-216, 419-437`; `src/shared/i18n/dictionary.ts:793-801`

**Preview + Select element (FE): 2–3 steps when a dev server is known**

1. Start the dev server in an Aquila shell tab (Aquila doesn't start it) or have `.claude/launch.json`. 2. ⌘⇧P. 3. "Select element", then click. Text plus a screenshot path are pasted into the focused Claude/Codex tab. 4. Type the change, press Enter.

- Detection: `.claude/launch.json` `configurations[].port/url`, plus `localhost:<port>` printed in **this project's Aquila terminals** (last 5, root or one-segment paths only) — `electron/preview.ts:26-55, 63-100`; `docs/en/ARCHITECTURE.md:435-441`
- The first found server auto-fills the address. If the remembered one fails, it switches to a newer one — `src/widgets/preview/ui/PreviewPanel.tsx:109-116`
- Empty state: "No dev server found — Start one in a terminal (npm run dev) or type an address above. Addresses from .claude/launch.json and this project's terminals show up here." — `src/shared/i18n/dictionary.ts:822-824`; `src/widgets/preview/ui/PreviewPanel.tsx:282`
- Error state: "Couldn't load the page" + error + Retry — `src/widgets/preview/ui/PreviewPanel.tsx:79-85`
- If no Claude/Codex tab is focused, the pick goes to the clipboard ("No Claude or Codex tab focused — copied to the clipboard.") — `src/widgets/preview/ui/PreviewPanel.tsx:151-158`; `src/shared/i18n/dictionary.ts:821`
- The pick prompt holds intro, page URL, selector, component chain, text, attributes, size, computed style, and "Screenshot pasted right after this." — `src/widgets/preview/model/prompt.ts:19-33`; `src/shared/i18n/dictionary.ts:831-839`
- Component names need a dev build. There is no file:line on React 19 — `docs/en/TASKS.md:265` (T33 Left over)

**Figma MCP + chips (DS/FE): about 6–9 steps, spread across Aquila, the CLI and a browser**

1. Right-click project → Project settings… 2. Figma MCP → On. 3. Save. 4. Open a **new** Claude tab (open tabs keep their old args: "Open tabs keep what they started with"). 5. Inside Claude: `/mcp` → figma → Authenticate (browser OAuth). Codex needs `codex mcp login figma` in a terminal. 6. Optional: back in Project settings, "Check connection", which runs a hidden `claude -p` with a 90 s timeout. 7. Copy a frame link in Figma, then **paste** it into the Claude tab. 8. Click a chip; the prompt is typed after the link. 9. Press Enter.

- Sources: `docs/en/ARCHITECTURE.md:371-386`; `src/features/figma/ui/FigmaSettings.tsx:19-65`; `src/shared/i18n/dictionary.ts:694-707`
- Status copy: "Not checked yet", "Checking…", "Log in to Figma — in a Claude tab, /mcp → figma → Authenticate", "For Codex, in a terminal — codex mcp login figma", "Check failed — {error}", "Needs a Dev or Full seat", "May need an Organization plan", "Plan unknown — see Figma docs for limits" — `src/shared/i18n/dictionary.ts:694-707`
- Requirements beyond Aquila: a Figma account with a Dev or Full seat for "Design to code"; Code Connect may need an Organization plan (shown as hints, not enforced) — `docs/en/ARCHITECTURE.md:384-386`
- Known conflict: if the user already has the claude.ai Figma connector, the injected `figma` server stays "needs sign-in" and Claude warns "1 MCP server needs authentication" — `docs/en/TASKS.md:274` (T34 Left over)
- Designer view in the Preview needs a separate Figma login inside the embedded view ("The Figma view needs a Figma login inside the preview") — `docs/en/TASKS.md:265`; `docs/en/ARCHITECTURE.md:460-461`
- The "design changed" check (REST token polling) is not built — `docs/en/TASKS.md:274`

**Remote SSH (BE): about 5 steps if ssh already works, otherwise the setup happens outside Aquila**

1. "+ Add project" → "Remote server (SSH)…". 2. SSH host: a free-text field with suggestions from `~/.ssh/config` `Host` names (no wildcards). 3. Optional "Check host". 4. "Folder on the host": free text, defaults to `~/` and must be changed (no remote browsing). 5. Add → open a tab.

- Sources: `src/features/manage-projects/ui/RemoteProjectDialog.tsx:20-58, 73-120`; `docs/en/ARCHITECTURE.md:254-257`
- Add is enabled when the host is valid and the path is not `~/`. "Check host" is **optional**, so a user can add a broken host — `src/features/manage-projects/ui/RemoteProjectDialog.tsx:34-36, 67-68, 88-89`
- Requirements: an alias in `~/.ssh/config`, key/agent auth (a password or new host key makes the check fail with "If it asks for a password or a new host key, run ssh {host} in a terminal once"), and tmux on the host ("tmux is what keeps sessions alive across dropped connections"). claude/codex must be installed and logged in on the host; Aquila only _shows_ install commands. Hosts with KillUserProcesses=yes need `loginctl enable-linger` — `src/shared/i18n/dictionary.ts:1115-1133`; `docs/en/ARCHITECTURE.md:283-287`
- Copy and labels use raw jargon: "SSH host", "Host alias from ~/.ssh/config. Uses your keys and ssh-agent", "CLAUDE_CONFIG_DIR on the host", "KillUserProcesses=yes … loginctl enable-linger" — `src/shared/i18n/dictionary.ts:1115-1132`
- Local-only features are refused for remote: "Worktrees, preview and Open in are local-only" / "Not available for remote projects yet" — `src/shared/i18n/dictionary.ts:1113, 1133`; `docs/en/ARCHITECTURE.md:288-290`

**Guide / First-run**

- First run: the checklist opens once at launch. Closing it in any way marks it finished, and then the tour is offered once — `docs/en/ARCHITECTURE.md:581-584, 607-609`; `src/pages/workspace/ui/WorkspacePage.tsx` (FirstRunChecklist close → `guide.offerOnce()`, ~line 421-428)
- First-run doesn't mention Figma, preview or SSH setup — `src/features/first-run/ui/FirstRunChecklist.tsx` (grep: no figma/preview/ssh)

### Inferences

- FE gets the shortest path (Changes 1 step, Preview 2–3). The catch: a dev server started in an external terminal
  (iTerm, VS Code) is not auto-detected unless it's in `.claude/launch.json`. The user then has to type the address by hand.
- DS has the longest and most fragile path. It crosses three surfaces (Aquila dialog, CLI `/mcp`, browser OAuth),
  needs an extra in-preview Figma login for Designer view, and needs a new tab after the toggle. A designer who doesn't
  use a terminal hits the `/mcp` step right away.
- BE: the setup cost depends on the existing ssh config. Free-text remote path entry and an optional host check let
  mistakes through until a tab fails to open.

### Gaps

- Real time-to-first-success was not measured. No user test data exists in the repo.
- Not verified what a remote tab shows when tmux is missing (the doc says exit 127 with a message; the UI rendering was not seen) — `docs/en/ARCHITECTURE.md:261-263`

---

## 3. Layout: where preview, changes, Design vs Build and terminal sit; can they be seen together?

### Takeaway

The layout is a row: sidebar (248px) | main (tab bar + split terminals, up to 4 panes) | Changes panel (416px, or
min(720px, 50%) in side-by-side mode) | Preview panel (always min(720px, 50%)). All of them **can** be open at once.
On a laptop-width window the terminal is squeezed hard, and a horizontal-overflow bug was already seen at 1440px with
just the Changes panel open. "Design vs Build" has no place of its own in the layout: it's a transient chip overlay on
the terminal. Designer mode stacks Figma under the app inside the Preview column.

### Cited Findings

- Panel order in the DOM: `<main>` (tab bar + SplitView), then `ChangesPanel` if open, then `PreviewPanel` ("Last column: the native preview view only has to follow its own size") — `src/pages/workspace/ui/WorkspacePage.tsx:303-416`
- The open states are independent booleans (`changesOpen`, `previewOpen`), so both can be open together — `src/pages/workspace/ui/WorkspacePage.tsx:40-43`
- Sizes: `--size-sidebar: 248px`, `--size-panel: 416px`, `--size-panel-wide: 720px` (".c-panel--wide { width: min(var(--size-panel-wide), 50%) }") — `design-system/tokens.css:203-205`; `design-system/components.css:342-345, 361`
- The Changes panel switches to wide in side-by-side mode; Preview is always wide — `src/widgets/changes-panel/ui/ChangesPanel.tsx:270`; `src/widgets/preview/ui/PreviewPanel.tsx:183`
- Known bug: "with the changes panel open at 1440 px, the page scrolls sideways and the sidebar footer clips (not fixed here)" — `docs/en/TASKS.md:181` (T24 Left over)
- Full window (⌘⇧F) hides both side panels and keeps their open state — `src/pages/workspace/ui/WorkspacePage.tsx:400-410`
- The preview is a native `WebContentsView` above the DOM. It's hidden while any `dialog[open]` exists (palette, modals) or when the load failed — `docs/en/ARCHITECTURE.md:449-451`
- "App shortcuts don't fire while the previewed page has keyboard focus" — `docs/en/TASKS.md:265` (T33 Left over)
- Designer: a toggle in the Preview header (only when `project.figma`). It adds a "Figma link" address bar and a second native view under the app ("App above, Figma below") — `src/widgets/preview/ui/PreviewPanel.tsx:102-103, 192-201, 284-297`; `src/shared/i18n/dictionary.ts:827-830`
- The spec asked for a "Designer preset layout: terminal + preview + Figma panel". What shipped is a toggle inside the preview column, not a workspace layout preset — `docs/en/TASKS.md:267-269` vs `src/widgets/preview/ui/PreviewPanel.tsx:192-201`
- Chips: a `TermOverlay` over the terminal pane, shown after a Figma-link paste and gone after the next Enter, chip click or × — `src/features/figma/ui/FigmaChips.tsx:39-77`
- The Changes panel follows the **focused session's** project/worktree. The preview is keyed per project (`key={project.id}`) and follows the selected project — `docs/en/ARCHITECTURE.md:173`; `src/pages/workspace/ui/WorkspacePage.tsx:409-415`
- Split view puts up to 4 terminals in the main area, and they can mix projects — `docs/en/ARCHITECTURE.md:84-92`

### Inferences

- Rough arithmetic (not measured): on a 1440px-wide window with sidebar (248) + Changes unified (416) + Preview
  (min(720, 50% of the flex container)), the terminal column is left with roughly 100–300px. In practice, "terminal +
  changes + preview" doesn't fit side by side on a laptop. The panels are fixed-width, not resizable (no resize code in
  the panel CSS; the pane resize shortcuts apply to split panes only).
- DS in Designer mode gets the app and the Figma frame stacked vertically in half of the window, each at about half
  height. That's tight for a visual comparison, and the comparison itself is handed to the agent (no onion skin). See
  "The preview overlay is done by the agent…" — `docs/en/TASKS.md:274`.
- "Design vs Build" exists only as chip-group labels for a few seconds after a paste. No persistent mode, panel or
  layout tells the user which phase they're in.

### Gaps

- Panel resize behavior was not verified live. Assumption: fixed width, based on the CSS at `design-system/components.css:342-361`.
- Exact pixel behavior with both panels open at common widths (1280/1440/1728) was not measured.

---

## 4. Which leftovers and missing pieces hurt each persona most?

### Takeaway

FE: the preview is width-only and local-only, component file:line is lost on React 19, shortcuts die while the preview has
focus, and a layout overflow appears at 1440px. BE: no remote preview or port forward, remote status is a guess (no
hooks/OSC through tmux), remote changes poll every 10 s, the remote UI was never seen live against a real host, and
there is no guide entry. DS: everything Figma is hidden behind Project settings plus a CLI login, there are no guide
entries, the "design changed" check is missing, the claude.ai connector conflicts, and Codex was never verified.

### Cited Findings

**Frontend dev**

- Preview is width-only (390/768/1440 via zoom; no mobile UA or touch) and local projects only — `docs/en/TASKS.md:265`; `docs/en/ARCHITECTURE.md:445-448`
- No file:line for components on React 19 (`_debugSource` was dropped); component names need a dev build — `docs/en/TASKS.md:265`
- "the panel says 'pasted' even when the CLI is on such a prompt" (for example Codex's "Trust this folder?"), so a pick can silently land in the wrong prompt — `docs/en/TASKS.md:265`; copy "Pasted into {name}. Write what to change, then press Enter." `src/shared/i18n/dictionary.ts:820`
- App shortcuts don't fire while the previewed page has focus — `docs/en/TASKS.md:265`
- Changes panel: hunk stage/revert only on a plain modified file with nothing staged; no per-hunk unstage; line comments are lost on relaunch — `docs/en/TASKS.md:189`
- 1440px horizontal scroll with the Changes panel open — `docs/en/TASKS.md:181`

**Backend / server dev**

- Remote projects get no Preview button and no panel (`!project.remote`), and no port forwarding exists. A web service on the host can't be previewed — `src/pages/workspace/ui/WorkspacePage.tsx:338, 409`; `docs/en/ARCHITECTURE.md:288-290`
- Remote status uses the output-activity heuristic ("shown as estimated"). There are no hooks (they post to 127.0.0.1), and OSC 7501 is dropped by tmux. Remote Claude hooks via `ssh -R` are not done — `docs/en/ARCHITECTURE.md:280-282`; `docs/en/TASKS.md:226`
- Context gauge hidden for remote tabs — `src/widgets/session-tabs/ui/SessionTabs.tsx:137`
- Remote Changes panel: no watch, polls every 10 s, shows `ssh <host> · … · n ms` — `docs/en/ARCHITECTURE.md:296-300`
- Never run against a real host for T36: "every remote script is tested end to end through a fake `ssh`… the remote UI wasn't seen live"; T29: "not yet clicked through in the app… No agent session on a real host yet" — `docs/en/TASKS.md:226, 295`
- Remote history reads only the first 256 KB of each transcript. Resuming fails for subfolder cwd — `docs/en/TASKS.md:295`
- Figma is local only ("remote would need the host's own `/mcp` login"), and the settings block isn't rendered for remote projects — `docs/en/TASKS.md:254`; `src/features/manage-projects/ui/ProjectSettingsDialog.tsx:268-272` (inside the local branch)
- The FigJam "Flow → screens" and "Comments → TODOs" prompts explicitly produce backend TODO lists ("endpoints, data"; "Mark the items that need backend work"). That's the BE handoff, and it only works where Figma is on (local) — `src/shared/i18n/dictionary.ts:719-722`
- No guide entry for remote — `docs/en/TASKS.md:226`; `src/features/guide/model/registry.ts`

**Figma designer**

- Figma has no guide entry (T32, T34 Left over) and no first-run step — `docs/en/TASKS.md:254, 274`
- Auth is in the CLI (`/mcp` → figma → Authenticate) or a terminal command for Codex. Aquila never shows a login button — `docs/en/ARCHITECTURE.md:377-378`; `src/shared/i18n/dictionary.ts:698-699`
- Conflict with an existing claude.ai Figma connector: "our injected `figma` server stays 'needs sign-in' and Claude warns '1 MCP server needs authentication'" — `docs/en/TASKS.md:274`
- The whoami check "has only run live without a Figma login". Seat/plan hints are heuristics — `docs/en/TASKS.md:254`
- No "design changed" check; no visual overlay in the panel (the agent compares screenshots) — `docs/en/TASKS.md:274`
- Not checked with Codex (it stopped at "Trust this folder?") — `docs/en/TASKS.md:265, 274`
- Chip prompts are long and English/Korean-literal with MCP tool names (`get_screenshot`, `get_variable_defs`, `get_design_context`, `download_assets`, `get_figjam`, `get_comments`). The Claude chromeCheck appendix is a paragraph about "Claude in Chrome… Dev Mode… properties panel". It gets typed into the input as one line for the user to review — `src/shared/i18n/dictionary.ts:717-730`; `src/features/figma/model/link.ts:55-68`
- Designer view needs its own Figma login inside the embedded preview — `docs/en/TASKS.md:265`

### Inferences

- **FE: most painful** are the silent "pasted" when the CLI is on a trust/permission prompt, and the panel-width squeeze
  when you want terminal + diff + preview together. Second: no auto-detection of servers run outside Aquila.
- **BE: most painful** is that the remote experience is unverified on a real host and degraded on several fronts
  (estimated status, no hooks, no context gauge, 10 s polling, no preview or port forward). Day-to-day, though, the
  Changes panel and history do work remotely.
- **DS: most painful** is discoverability plus terminal-native auth. The workflow assumes the designer sits in a CLI tab,
  pastes links there, and reads long tool-name prompts. Every entry point lives in developer surfaces (project settings
  dialog, terminal overlay, preview header). There is no designer-facing home, empty state or guide.
- Copy-level friction across tools: bare glyph buttons (`±`, `◫`, `{}` for devtools — `src/widgets/preview/ui/PreviewPanel.tsx:251-260`),
  raw jargon in remote ("CLAUDE_CONFIG_DIR", "KillUserProcesses", "loginctl enable-linger") and Figma copy ("/mcp", "Dev or
  Full seat", "Code Connect"). Most flows are modal-heavy: Project settings dialog, Remote add dialog, revert confirm dialog,
  Guide modal. While any of these dialogs is open, the native preview hides itself (`docs/en/ARCHITECTURE.md:449-451`).

### Gaps

- Per-persona severity ranking is the researcher's inference from the code and Left over notes, not from user research.
- Not checked: whether the Korean copy (`docs/ko`, ko dictionary half) has different wording issues. Only the English half was read.
