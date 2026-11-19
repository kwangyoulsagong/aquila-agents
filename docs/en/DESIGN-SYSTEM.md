# Aquila Agents Design System

> 한국어: [../ko/DESIGN-SYSTEM.md](../ko/DESIGN-SYSTEM.md)

One window, many agents. The UI disappears behind the terminals and only speaks up when an agent needs you.

- Source of truth: `design-system/tokens.css` (values), `design-system/components.css` (component styles) and
  `design-system/react/` (React components that render them).
- Preview: `open design-system/preview.html`.
- Rule: **no raw hex/px in app code.** New value → primitive + semantic token first.

## Principles

1. **Terminals are the content.** Chrome (sidebar, tabs) stays dark and quiet; `--color-bg-canvas` is the darkest surface.
2. **Status is the only loud color.** Blue = selection/focus. Orange (`--color-status-waiting`) means
   "you need to act" — never decorative.
3. **One grid.** Everything is a multiple of 4px and edges line up across regions (see Layout).
4. **Dark only (v0.1).** Light theme later = remap semantic tokens only.

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
| `--color-action-primary(-hover)` | Primary button |
| `--color-agent-claude` / `-codex` / `-shell` | Session kind |
| `--color-account-shared` / `-personal` | Claude account badge (`claude` / `claude-personal`) |
| `--color-diff-*` | Diff add / del / hunk |
| `--color-terminal-*` | xterm theme (read at runtime): bg, fg, cursor, selection, scrollbar (+ `-hover`) |

### Session status — the core vocabulary

| Status | Token | Meaning | Source |
|---|---|---|---|
| working | `--color-status-working` (pulses) | Agent is running | OSC 7501 `working`; Claude hooks; output activity for programs that don't report |
| waiting | `--color-status-waiting` (halo) | Needs you: permission or question | OSC 7501 `blocked`; Claude hook `PermissionRequest` / `Notification` |
| done | `--color-status-done` | Finished, not yet viewed | OSC 7501 `done`; Claude hook `Stop` |
| done (estimated) | `--color-status-done-estimated` (`data-estimated`, dimmed) | Probably finished: guessed from output going quiet | output activity (codex/shell that don't report) |
| error | `--color-status-error` | Failed: API error (rate limit, auth, billing, server) or non-zero exit; the reason is the dot's label | OSC 7501 `error`; Claude hook `StopFailure`; pty exit code |
| stopped | `--color-status-stopped` (ring) | You interrupted it (Esc / Ctrl+C) or it exited normally | keys typed; `SessionEnd`; exit 0 / 130 |
| idle | `--color-status-idle` | Nothing happening / seen | default |

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
| `--size-row` | 32 | Sidebar rows; tabs are 32 tall too (40 − 8 top offset) |
| `--size-control` | 28 | Buttons, segmented control |
| `--size-pane-head` | 28 | Split pane header |
| `--size-focus-line` | 2 | Accent line under the focused pane's header (the only focus mark on a pane) |
| `--size-split-handle` | 8 | Grab area of a split divider, centred on the 1px hairline |
| `--size-badge` / `--size-dot` | 16 / 8 | |
| `--size-sidebar` / `--size-panel` | 248 / 416 | |
| `--size-panel-wide` | 720 | Changes panel in side-by-side mode (capped at half the window) |
| `--size-diff-gutter` / `--size-diff-comment` | 40 / 384 | One line-number column in a diff / a line-comment box |
| `--size-dialog` / `--size-dialog-wide` | 440 / 560 | Dialog width / with a checklist (first run) |
| `--size-palette` / `--size-palette-list` | 560 / 352 | Command palette width / list height before it scrolls (11 rows) |
| `--size-modal` / `--size-modal-height` / `--size-modal-aside` | 760 / 520 / 240 | List + detail modal (guide, release notes) / its list column |

## Components (`components.css`)

| Class | What |
|---|---|
| `.c-dot[data-status]` | Status dot |
| `.c-btn` `--primary` `--ghost` `--icon` | Buttons |
| `.c-segment`, `__item[aria-checked]` | Segmented control (account switch) |
| `.c-kbd` | Shortcut hint |
| `.c-elapsed` | How long a session has waited ("12m", mono, waiting color) on a tab or project row |
| `.c-badge` `--claude` `--codex` `--shell` `--account-shared` `--account-personal` | Tags |
| `.c-label` | Section label |
| `.c-sidebar` `__drag` `__body` `__group` `__foot` `__lang` | Sidebar |
| `.c-row[aria-current]` `__name` `__meta` | Project row |
| `.c-row[data-drop=before\|after]` `[data-dragging]`, `.c-sidebar__group[data-drop]`, `.c-sidebar__empty` | Drag to reorder: landing line, dimmed dragged row, empty group as a drop target |
| `.c-tabbar` `__add` `__trailing`, `.c-tab[aria-selected]` `__title` `__branch` `__close` | Tabs (`__branch` = worktree branch, mono, truncates first) |
| `.c-split`, `.c-pane[data-focused]` `__head` `__term` | Split view |
| `.c-split--free`, `.c-split__drop`, `.c-pane__title` `__close` | Split view in the app: absolutely placed panes, drop indicator (glides between zones), pane head title + close |
| `.c-split__divider[data-dir][data-active]`, `.c-split[data-resizing]`, `.c-pane__zoom[aria-pressed]` | Draggable divider (accent line on hover/drag), resize cursor over the stage while dragging, zoom toggle in the pane head |
| `.c-panel` `__head` `__body` `__actions` `__section` `__note` `__bar` `__bar-end`, `.c-panel--wide` | Right panel (slides in; head is a drag region like the tab bar); `__bar` = a wrapping band of controls under the head; `--wide` for side-by-side diffs (≤ half the window) |
| `.c-diff` `__line--add/del/hunk/file/meta`, `__file[aria-current]`, `__num`, `__actions`, `__line[data-commentable][data-commented]`, `.c-diff--split` `__row` `__line--empty`, `__comment` `__comment-actions` | Diff (unified: as wide as its longest line; split: two wrapping halves). Line-number gutters, small actions on file/hunk lines, a marker on commentable/commented lines, a comment box under a line |
| `.c-change`, `__status[data-status]` `__path` `__dir` | Changed file row: colored git status letter, name, dimmed dir |
| `.c-btn--ghost[aria-pressed]` | Toggle button that's on |
| `.c-empty` `__title` `__path` `__actions` | Empty state |
| `.c-dialog` `__title` `__body` `__actions` `__check` `__code` `__form` | Modal dialog (native `<dialog>`, rises in) |
| `.c-palette` `__input` `__list` `__item[aria-selected]` `__leading` `__label` `__mark` `__hint` `__empty` `__foot` | Command palette (native `<dialog>` near the top, rises in): input as tall as the title bar, 32px rows, matched letters bold |
| `.c-dialog--wide` | Wider dialog for a checklist |
| `.c-modal` `__head` `__title` `__body` `__aside` `__search` `__list` `__item[aria-selected]` `__item-label` `__empty` `__main` `__heading` `__text` `__keys` `__foot` | Large list + detail modal (native `<dialog>`, rises in): head and search as tall as the title bar, searchable list on the left, detail on the right (guide; shared with release notes and trends) |
| `.c-media` `__frame` `__placeholder` | 16:10 frame for a screenshot or a short loop; placeholder while there is none |
| `.c-shortcuts` `__group` `__row` `__label` `__keys` | Shortcut sheet: grouped rows, label left, keys right |
| `.c-checklist` `__item` `__lead` `__main` `__title` `__meta` `__actions` `__detail` `__command` | Bordered list of checks: dot on the title line · title (+ badge) / mono meta · buttons, then a full-width detail (install command with Copy, drop zone) |
| `.c-dropzone[data-over]` | Dashed drop area; accent border + selected background while dragging over |
| `.c-field` `__label` `__hint`, `.c-input` (`--multiline`), `.c-select` `__control` | Form field: label, text input / select (focus = blue border), monospace hint |

## React components (`design-system/react/`)

Import from `@design-system/react`. App code uses these instead of writing `.c-*` class names; layout-only blocks
(sidebar, tab bar, split/pane, panel, diff) still use their classes inside their widget. The folder must not import
from `src/` (ESLint enforces it). New primitive → add the class to `components.css`, the component here, and a row below.

| Component | Renders |
|---|---|
| `Button` `variant="primary\|ghost"` `icon` `ref?` | `.c-btn` |
| `Dot` `status` `estimated?` `label?` | `.c-dot` |
| `Badge` `tone` | `.c-badge--<tone>` |
| `Kbd`, `Label` | `.c-kbd`, `.c-label` |
| `Elapsed` `title?` | `.c-elapsed` |
| `Segment` `options` `value` `onChange` | `.c-segment` |
| `EmptyState` `title` `path` `actions` | `.c-empty` |
| `Dialog` `open` `title` `onClose` `actions` `wide`, `DialogCheck`, `DialogCode`, `DialogForm` `id` `onSubmit` | `.c-dialog` |
| `Checklist` `label`, `ChecklistItem` `leading` `title` `tag` `meta` `actions`, `ChecklistCommand` `command` `action` | `.c-checklist` |
| `Dropzone` `over` (+ div props) | `.c-dropzone` |
| `Field` `label` `hint`, `Input`, `Textarea`, `Select` `options` `onChange(value)` | `.c-field`, `.c-input`, `.c-input--multiline`, `.c-select` |
| `ChangeRow` `status` `path` | `.c-change` |
| `Palette` `open` `onClose` `label` `query` `onQueryChange` `listId` `activeId`, `PaletteList`, `PaletteItem` `selected` `label` `marks` `leading` `hint` `kbd`, `PaletteEmpty` | `.c-palette` (combobox + listbox) |
| `Modal` `open` `title` `onClose` `closeLabel` `aside` `footer`, `ModalSearch` (focused on open), `ModalList` `id` `label`, `ModalItem` `selected` `label` `trailing` `onSelect`, `ModalEmpty`, `ModalDetail` `heading` `text` `keys` | `.c-modal` |
| `Media` `src` `kind` `poster` `alt` `still` `placeholder` | `.c-media` (video → poster under reduced motion or `still`) |
| `ShortcutSheet` `groups` | `.c-shortcuts` |

## Copy

Korean and English (`src/shared/i18n.ts`). Short and literal; buttons say what happens:
"Claude 열기 / Open Claude". Notifications: `<project>` · `Claude · 작업 완료 / Done`, `입력 필요 / Needs input`.
