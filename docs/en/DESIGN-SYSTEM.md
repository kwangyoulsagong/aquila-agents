# Aquila Agents Design System

> 한국어: [../ko/DESIGN-SYSTEM.md](../ko/DESIGN-SYSTEM.md)

One window, many agents. The UI disappears behind the terminals and only speaks up when an agent needs you.

- Source of truth: `design-system/tokens.css` (values), `design-system/components.css` (component styles) and
  `design-system/react/` (React components that render them).
- Preview: `open design-system/preview.html` (add `?theme=light` or `?theme=dark` to force one).
- Rule: **no raw hex/px in app code.** New value → primitive + semantic token first.

## Principles

1. **Terminals are the content.** Chrome (sidebar, tabs) stays quiet; `--color-bg-canvas` (window + terminal) is the
   darkest surface in dark and the lightest in light, so the terminal always stands apart from the chrome.
2. **Status is the only loud color.** Blue = selection/focus. Orange (`--color-status-waiting`) means
   "you need to act" — never decorative.
3. **One grid.** Everything is a multiple of 4px and edges line up across regions (see Layout).
4. **Dark and light follow macOS.** `src/shared/lib/theme.ts` sets `<html data-theme>` from `prefers-color-scheme`
   (Electron maps `nativeTheme` onto it); `tokens.css` remaps **only `--color-*`** under `[data-theme='light']`.
   Components never branch on the theme. A new color token needs a value in both blocks. `AQUILA_THEME=light|dark`
   forces one (smoke, capture, checking).

## Token tiers

| Tier | Prefix | Who may use it |
|---|---|---|
| Primitive | `--p-*` (`--p-slate-950`, `--p-blue-400`, `--p-size-8`) | **Only** the semantic block of `tokens.css` |
| Semantic | `--color-*` `--font-*` `--space-*` `--radius-*` `--size-*` `--motion-*` | All components and app code |

Check: `grep -rn -- '--p-' src design-system/components.css` returns only the rule comment.

## Color (semantic)

| Token | Use |
|---|---|
| `--color-bg-canvas` | Window + terminal background |
| `--color-bg-surface` | Sidebar, tab bar, panels |
| `--color-bg-hover` / `--color-bg-pressed` | Hover / pressed & selected |
| `--color-bg-selected` | Current project row |
| `--color-bg-scrim` | Backdrop behind a dialog |
| `--color-border-subtle` / `-default` / `-focus` | Hairlines / control edges / focus ring |
| `--color-text-primary` / `-secondary` / `-tertiary` / `-on-accent` | Text levels (tertiary = hints only) |
| `--color-meter-track` / `-outline` | Usage gauge: empty track / outline of an unknown limit (darker on light, where bg-pressed and border-subtle fade into the sidebar) |
| `--color-action-primary(-hover)` | Primary button |
| `--color-agent-claude` / `-codex` / `-shell` | Session kind |
| `--color-account-shared` / `-personal` | Claude account badge (`claude` / `claude-personal`) |
| `--color-diff-*` | Diff add / del / hunk |
| `--color-terminal-*` | xterm theme (read at runtime, re-read when the theme changes): bg, fg, cursor, selection, scrollbar (+ `-hover`), find matches `-match` / `-match-active` (opaque `#RRGGBB`, xterm decorations need it; amber). On light, xterm's `minimumContrastRatio` is 4.5 so CLI colors picked for a dark background stay readable |

### Session status — the core vocabulary

| Status | Token | Meaning | Source |
|---|---|---|---|
| working | `--color-status-working` (pulses; half-filled disc when motion is off) | Agent is running | OSC 7501 `working`; Claude hooks; output activity for programs that don't report |
| waiting | `--color-status-waiting` (halo) | Needs you: permission or question | OSC 7501 `blocked`; Claude hook `PermissionRequest` / `Notification` |
| done | `--color-status-done` (disc with a check) | Finished, not yet viewed | OSC 7501 `done`; Claude hook `Stop` |
| done (estimated) | `--color-status-done-estimated` (`data-estimated`, dimmed check) | Probably finished: guessed from output going quiet | output activity (codex/shell that don't report) |
| error | `--color-status-error` (rounded square with `!`) | Failed: API error (rate limit, auth, billing, server) or non-zero exit; the reason is the dot's label | OSC 7501 `error`; Claude hook `StopFailure`; pty exit code |
| stopped | `--color-status-stopped` (ring) | You interrupted it (Esc / Ctrl+C) or it exited normally | keys typed; `SessionEnd`; exit 0 / 130 |
| idle | `--color-status-idle` | Nothing happening / seen | default |
| live | `--color-status-done` (plain disc) | A process that is up — run slot only (T60), not a session status | run started, not exited |

Every status also has a shape, so it reads without telling blue, green and red apart: pulse, halo, check, `!` square, ring, plain disc. With motion off (reduced motion, power saver) working can't pulse, so it shows a half-filled disc instead. The check and `!` are cut out with an alpha mask (the background shows through, so both themes work) and stay legible at `--size-dot-sm`. `preview.html` shows every status at both sizes, in colour and greyscale, with a Motion off toggle.

A project row shows its most urgent session: `waiting > error > working > done > stopped > idle`.

## Type

- UI: system font (SF Pro + Apple SD Gothic Neo). Mono: JetBrains Mono (bundled), D2Coding fallback.
- `--font-size-caption` 11 (meta, labels) · `-label` 12 (tabs, buttons) · `-body` 13 (body, terminal) · `-title` 15.
- Section label: 11 / 600 / uppercase / 0.06em / `--color-text-tertiary`.

## Spacing & radius (by role)

`--space-inline-xs|sm` 4|8 (items in a row) · `--space-inset-sm|md` 8|12 (padding) · `--space-stack-md|lg` 16|24 (groups/sections).
`--radius-badge` 4 · `--radius-control` 6 · `--radius-container` 10.

## Layout — one grid, aligned edges

```
 x=0        x=20                 x=248
 ┌──────────┬────────────────────┬─────────────────────────────────────────────┬──────────────┐  y=0
 │ ● ● ●    (traffic lights)     │ [● Claude 공용 ×] [● Codex ×] +   [공용|개인] │ panel head   │
 ├─────────────────────────────── ┼──────────── one line at y=40 ───────────────┼──────────────┤  y=40  (--size-titlebar = --size-tabbar)
 │   WORK               (label 16)│ ● Claude · data-bahn  (pane head 28)        │              │
 │   ● data-bahn   2   (row 32)   │ ❯ terminal text starts at x = pane + 12     │  panel 416   │
 │   PERSONAL                     │                                             │              │
 │   ● SALT        1              │                                             │              │
 ├────────────────────────────────┤                                             │              │
 │ settings          English      │                                             │              │
 └────────────────────────────────┴─────────────────────────────────────────────┴──────────────┘
   sidebar 248 · content edge x=20 (inset 8 + 12): labels, dots and footer text all start here
```

| Token | px | |
|---|---|---|
| `--size-titlebar` = `--size-tabbar` | 40 | One horizontal line across sidebar, tabs, panel |
| `--size-window-controls` | 0 / 140 | Room for the OS caption buttons at the top-right: 0 on macOS, 140 under `:root[data-platform='win32']` (the last column's tab bar / panel head pads by it) |
| `--size-traffic-lights` | 80 / 0 | Room for the macOS traffic lights at the left of a bare title band (`.c-titlebar`); 0 on Windows |
| `--size-row` | 32 | Sidebar rows; tabs are 32 tall too (40 − 8 top offset) |
| `--size-control` | 28 | Buttons, segmented control |
| `--size-pane-head` | 28 | Split pane header |
| `--size-focus-line` | 2 | Accent line under the focused pane's header (the only focus mark on a pane) |
| `--size-split-handle` | 8 | Grab area of a split divider, centred on the 1px hairline |
| `--size-badge` / `--size-dot` | 16 / 8 | |
| `--size-meter` | 4 | Bar of a meter (usage gauge) |
| `--size-ring` | 12 | Ring meter in a tab (context gauge) |
| `--size-sidebar` / `--size-panel` | 248 / 416 | |
| `--size-panel-wide` | 720 | Changes panel in side-by-side mode (capped at half the window) |
| `--size-panel-min` / `--size-stage-min` | 288 / 480 | Narrowest a side panel gets / width the terminal column keeps; panels shrink first (T49) |
| `--size-pick-list` | 224 | A pick list's height before it scrolls (seven rows; remote folders, T56) |
| `--size-diff-gutter` / `--size-diff-comment` | 40 / 384 | One line-number column in a diff / a line-comment box |
| `--size-dialog` / `--size-dialog-wide` | 440 / 560 | Dialog width / with a checklist (first run) |
| `--size-palette` / `--size-palette-list` | 560 / 352 | Command palette width / list height before it scrolls (11 rows) |
| `--size-find-input` | 200 | Query field of a terminal's find bar (T40) |
| `--size-range` | 96 | Range slider (Designer compare opacity, T62) |
| `--size-modal` / `--size-modal-height` / `--size-modal-aside` | 760 / 520 / 240 | List + detail modal (guide, release notes) / its list column |
| `--size-modal-wide` / `--size-modal-wide-height` / `--size-modal-wide-aside` | 960 / 640 / 320 | `.c-modal--wide` (session history: longer rows, a transcript) / its list column |

## Components (`components.css`)

| Class | What |
|---|---|
| `.c-dot[data-status]` | Status dot |
| `.c-btn` `--primary` `--ghost` `--icon`, `__badge` | Buttons; `__badge` = a small accent dot on an icon button's corner for "something new" (AI trends: a newer CLI). Not a status dot |
| `.c-segment`, `__item[aria-checked]` | Segmented control (account switch) |
| `.c-range` | Native slider in the accent colour (Designer compare opacity) |
| `.c-kbd` | Shortcut hint |
| `.c-elapsed` | How long a session has waited ("12m", mono, waiting color) on a tab or project row |
| `.c-reason` | What a waiting session waits on ("Bash: npm install"), one mono caption line under its project row (aligned with the name); a button that shows the session. `data-risk` = possibly destructive: error color + `.c-risk` |
| `.c-queue`, `__lead` `__text` `__title` `__meta` | A sidebar queue entry (review queue, T58): dot, title and a mono caption meta line, both ellipsised; same edges as `.c-row`; a button |
| `.c-risk` | Warning glyph (⚠) in the error color for a possibly destructive command — on the reason line and the tab |
| `.c-graph`, `__node[data-mark]` `__box` `__label` `__detail` `__mark` `__edge` `__column` | Static SVG node graph (repo skeleton, T64): boxes placed by the caller, curved edges, marks add (diff-add) / change (working) / unfit (waiting, dashed); `data-dim` / `data-highlight` for a hovered step. No animation loop |
| `.c-steps`, `__item[data-off]` `__check` `__title` `__meta` | A plan to tick (T64): checkbox · title + badges / mono files line; unticked steps fade |
| `.c-badge--verdict-apply` `--verdict-partial` `--verdict-skip` | A proposal's verdict (done / waiting / tertiary) |
| `.c-badge` `--claude` `--codex` `--shell` `--account-shared` `--account-personal` `--risk` | Tags (`--risk`: a changed file worth a second look, waiting colour — T57) |
| `.c-badge--host`, `.c-badge__conn[data-conn=connecting\|connected\|reconnecting\|lost]` | Remote host alias (not uppercased) with a connection dot: idle grey / green / orange pulsing / red (T29) |
| `.c-term-overlay__banner` `__banner-text` `__banner-meta` | Bar across the top of a terminal that takes clicks, red edge: connection lost + countdown + an action (T29) |
| `.c-term-find` `__input` `__count[data-empty]` | Find bar at the top-right of a terminal that takes clicks: query · count (red when nothing matches) · case toggle (`aria-pressed`) · previous · next · close; its disabled buttons go tertiary (T40) |
| `.c-term-overlay__chips` `__chips-group` `__chips-label` `__chips-close` | Bar across the top of a terminal that takes clicks (the CLI input stays uncovered): labelled groups of prompt chips + close (Figma link pasted, T34) |
| `.c-titlebar` `__title` `__actions` | Bare title band, tab-bar height, draggable, traffic-light room on the left: lead + truncating title + actions (full window, T37) |
| `.c-label` | Section label |
| `.c-sidebar` `__drag` `__body` `__group` `__add` `__foot` `__lang`, `[data-drop-folder]` | Sidebar (`__drag` = the top band, controls in it stay clickable; `__add` = the "+ Add project" text row under the list; `[data-drop-folder]` = a Finder folder is dragged over it) |
| `.c-meter[data-tone=warn\|danger][data-unknown]` `__head` `__value` `__track` `__fill` `__caption` | A share of a limit: label · value, 4px bar (grey → orange ≥ 75% → red ≥ 90%), caption; unknown limit = outlined empty bar (T30) |
| `.c-usage` `__head` `__est` `__account` `__bars` | Usage band above the sidebar footer: one block per account, two meters side by side (T30) |
| `.c-ring[data-tone=warn\|danger]` `__svg` `__track` `__fill` `__value` | 12px circular meter that fits in a tab, value text optional; grey → orange → red (context gauge, T31) |
| `.c-row[aria-current]` `__name` `__meta` | Project row |
| `.c-row[data-drop=before\|after]` `[data-dragging]`, `.c-sidebar__group[data-drop]`, `.c-sidebar__empty` | Drag to reorder: landing line, dimmed dragged row, empty group as a drop target |
| `.c-tabbar` `__add` `__trailing`, `.c-tab[aria-selected]` `__title` `__branch` `__close` | Tabs (`__branch` = worktree branch, mono, truncates first) |
| `.c-split`, `.c-pane[data-focused]` `__head` `__term` | Split view |
| `.c-split--free`, `.c-split__drop`, `.c-pane__title` `__close` | Split view in the app: absolutely placed panes, drop indicator (glides between zones), pane head title + close |
| `.c-split__divider[data-dir][data-active]`, `.c-split[data-resizing]`, `.c-pane__zoom[aria-pressed]` | Draggable divider (accent line on hover/drag), resize cursor over the stage while dragging, zoom toggle in the pane head |
| `.c-panel` `__head` `__body` `__actions` `__section` `__note` `__bar` `__bar-end`, `.c-panel--wide` | Right panel (slides in; head is a drag region like the tab bar); `__bar` = a wrapping band of controls under the head; `--wide` for side-by-side diffs (≤ half the window); a dragged width comes in as `--panel-width`, `[data-pinned]` = the panel resized last keeps its width while the others give way |
| `.c-resize[data-edge][data-active]` | Draggable panel edge (T49): grab area over the panel's hairline, accent on hover/focus/drag, ←/→ when focused, double-click resets |
| `.c-preview` `__body` `__stage` | Preview panel (T33, on `.c-panel--wide`): the stage is where main lays the native page view; its own content (empty state, load error) shows only while that view is hidden |
| `.c-diff` `__line--add/del/hunk/file/meta`, `__file[aria-current]`, `__num`, `__actions`, `__line[data-commentable][data-commented]`, `.c-diff--split` `__row` `__line--empty`, `__comment` `__comment-actions` | Diff (unified: as wide as its longest line; split: two wrapping halves). Line-number gutters, small actions on file/hunk lines, a marker on commentable/commented lines, a comment box under a line |
| `.c-change`, `__status[data-status]` `__path` `__dir` | Changed file row: colored git status letter, name, dimmed dir |
| `.c-btn--ghost[aria-pressed]` | Toggle button that's on |
| `.c-btn--labelled` `__glyph` `__label` | Glyph + text label (tab-bar Changes / Preview, preview DevTools). The label folds away and the button turns square when the tab bar is under 640px or the preview bar under 400px (container queries `tabbar` / `panelbar`; raw lengths because custom properties can't be used in a container query) |
| `.c-empty` `__title` `__path` `__actions` | Empty state |
| `.c-dialog` `__title` `__body` `__actions` `__check` `__code` `__form` | Modal dialog (native `<dialog>`, rises in) |
| `.c-palette` `__input` `__list` `__item[aria-selected]` `__leading` `__label` `__mark` `__hint` `__empty` `__foot` | Command palette (native `<dialog>` near the top, rises in): input as tall as the title bar, 32px rows, matched letters bold |
| `.c-dialog--wide` | Wider dialog for a checklist |
| `.c-modal` `__head` `__title` `__subtitle` `__body` `__aside` `__search` `__list` `__item[aria-selected]` `__item-label` `__empty` `__main` `__heading` `__text` `__keys` `__foot` | Large list + detail modal (native `<dialog>`, rises in): head and search as tall as the title bar, searchable list on the left, detail on the right (guide; shared with release notes and trends) |
| `.c-modal--wide`, `__tools` `__group-label` `__item-meta` `__actions` `__note` (`--warn`) `__bullets` | Wide modal (session history); a filter row under the search, a folder label over a group of rows, a caption at a row's end (time), the detail's buttons, a caption line (orange = something will be lost), a short bulleted list (a release's "Added" lines, T35) |
| `.c-meta` `__label` `__value` (`--mono`) | Label · value rows (folder, branch, id) |
| `.c-commands`, `.c-command[data-state=ok\|error\|interrupted\|pending]` `__state` `__text` `__time` | Commands an agent ran (T59): how it ended by shape and colour (✓ ✕ ■ …), the command on one mono ellipsised line, marks, time |
| `.c-runs`, `.c-runs__item[aria-current]` `__name` `__state` | Run slot commands (T60): one row each with its dot (`live` / ring / `!` / idle), mono name, state; the current one is highlighted. `.c-run` (panel), `__state`, `__reason`, `__log` lay out the panel |
| `.c-transcript` `__message[data-role]` `__role` `__text` | Read-only conversation: who, then the text as written (wrapped); the user's messages in primary text |
| `.c-media` `__frame` `__placeholder` | 16:10 frame for a screenshot or a short loop; placeholder while there is none |
| `.c-shortcuts` `__group` `__row` `__label` `__keys` | Shortcut sheet: grouped rows, label left, keys right |
| `.c-pick` `__head` `__path` `__list` `__item` `__label` `__empty` | Pick list inside a dialog: mono path head with buttons, then rows to click (remote folder picker, T56) |
| `.c-checklist` `__item` `__lead` `__main` `__title` `__meta` `__actions` `__detail` `__command` | Bordered list of checks: dot on the title line · title (+ badge) / mono meta · buttons, then a full-width detail (install command with Copy, drop zone) |
| `.c-dropzone[data-over]` | Dashed drop area; accent border + selected background while dragging over |
| `.c-field` `__label` `__hint`, `.c-input` (`--multiline`, `--inline`), `.c-select` `__control` | Form field: label, text input / select (focus = blue border), monospace hint (`data-tone="warning"` = waiting orange). `--inline` edits a title in place inside a line (tab rename, T43): the line's font, no fixed height |
| `.c-field__row`, `.c-field-grid` | A control with a button beside it (path + "Change…"); two short fields side by side |

## React components (`design-system/react/`)

Import from `@design-system/react`. App code uses these instead of writing `.c-*` class names; layout-only blocks
(sidebar, tab bar, split/pane, panel, diff) still use their classes inside their widget. The folder must not import
from `src/` (ESLint enforces it). New primitive → add the class to `components.css`, the component here, and a row below.

| Component | Renders |
|---|---|
| `Button` `variant="primary\|ghost"` `icon` `glyph?` `label?` `ref?` | `.c-btn` (`label` → `.c-btn--labelled`) |
| `Dot` `status` `estimated?` `label?` | `.c-dot` |
| `Badge` `tone` | `.c-badge--<tone>` |
| `HostBadge` `host` `conn?` `label?` | `.c-badge--host` (+ `.c-badge__conn`) |
| `Kbd`, `Label` | `.c-kbd`, `.c-label` |
| `Elapsed` `title?` | `.c-elapsed` |
| `Reason` `text` `risk?` `riskLabel?` `onClick?` | `.c-reason` |
| `QueueItem` `leading?` `title` `meta?` `tooltip?` `onClick?` | `.c-queue` |
| `RiskMark` `label` | `.c-risk` |
| `Meter` `label` `value` `fraction` (null = unknown) `tone?` `caption?` `title?` | `.c-meter` |
| `Ring` `fraction` `label` `valueText` `showValue?` `tone?` `title?` | `.c-ring` |
| `Segment` `options` `value` `onChange` | `.c-segment` |
| `Range` `label` `value` `onChange` | `.c-range` |
| `ResizeHandle` `onChange` `onReset` `edge` `label` | `.c-resize` (measures its parent: start width, `min-width`, room its flexible siblings can give) |
| `EmptyState` `title` `path` `actions` | `.c-empty` |
| `Dialog` `open` `title` `onClose` `actions` `wide`, `DialogCheck`, `DialogCode`, `DialogForm` `id` `onSubmit`, `DialogGroup` `ref?` | `.c-dialog` (`DialogGroup` = `.c-dialog__group`, fields kept together and scrolled to) |
| `PickList` `label` `path` `actions` `empty`, `PickItem` `onClick` `trailing` | `.c-pick` |
| `Checklist` `label`, `ChecklistItem` `leading` `title` `tag` `meta` `actions`, `ChecklistCommand` `command` `action` | `.c-checklist` |
| `Dropzone` `over` (+ div props) | `.c-dropzone` |
| `TermOverlay` (+ div props, `ref`), `TermJump` (Button props), `TermNote` `bar?`, `TermHint` `box` `label?` `typed?` | `.c-term-overlay`, `.c-term-overlay__jump`, `.c-term-overlay__note(--bar)`, `.c-term-hint` (helpers over a terminal, T28) |
| `TermBanner` `meta?` `action?` | `.c-term-overlay__banner` (connection lost, T29) |
| `TitleBar` `lead?` `actions?` (+ div props) | `.c-titlebar` (full window, T37) |
| `TermChips` `label` `closeLabel` `onClose`, `TermChipGroup` `label` | `.c-term-overlay__chips`, `.c-term-overlay__chips-group` (prompt chips, T34) |
| `TermFind` `label` `query` `onQuery` `onKeyDown?` `inputRef?` `placeholder?` `count?` `empty?` `caseSensitive` `onToggleCase` `onPrev` `onNext` `onClose` `labels` | `.c-term-find` (find in terminal, T40) |
| `Field` `label` `hint` `warning`, `FieldRow`, `FieldGrid`, `Input`, `InlineInput`, `Textarea`, `Select` `options` `onChange(value)` | `.c-field`, `.c-field__row`, `.c-field-grid`, `.c-input`, `.c-input--inline`, `.c-input--multiline`, `.c-select` |
| `ChangeRow` `status` `path` `badge?` | `.c-change` |
| `Palette` `open` `onClose` `label` `query` `onQueryChange` `listId` `activeId`, `PaletteList`, `PaletteItem` `selected` `label` `marks` `leading` `hint` `kbd`, `PaletteEmpty` | `.c-palette` (combobox + listbox) |
| `Modal` `open` `title` `subtitle?` `onClose` `closeLabel` `aside` `footer` `wide`, `ModalSearch` (focused on open), `ModalList` `id` `label`, `ModalItem` `selected` `label` `meta` `trailing` `onSelect`, `ModalEmpty`, `ModalDetail` `heading` `text` `keys`, `ModalGroup` `label` `hint`, `ModalTools`, `ModalActions` `onSubmit?`, `ModalNote` `warn`, `ModalBullets` `items` | `.c-modal` |
| `MetaList`, `MetaRow` `label` `mono` | `.c-meta` |
| `Transcript` `label`, `TranscriptMessage` `role` `label` | `.c-transcript` |
| `CommandList` `label`, `CommandRow` `state` `stateLabel` `command` `time?` `marks?` | `.c-commands`, `.c-command` |
| `RunList` `label`, `RunItem` `name` `status` `state` `current` `title?` `onClick` | `.c-runs`, `.c-runs__item` |
| `Graph` `width` `height` `label` `nodes` `edges` `columns?` | `.c-graph` |
| `StepList` `label`, `StepItem` `checked` `onToggle` `title` `checkLabel?` `tags?` `meta?` `onHover?` | `.c-steps` |
| `Media` `src` `kind` `poster` `alt` `still` `placeholder` | `.c-media` (video → poster under reduced motion or `still`) |
| `ShortcutSheet` `groups` | `.c-shortcuts` |

## Copy

Korean and English (`src/shared/i18n.ts`). Short and literal; buttons say what happens:
"Claude 열기 / Open Claude". Notifications: `<project>` · `Claude · 작업 완료 / Done`, `입력 필요 / Needs input`.
