# Agentrix Design System

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
| `--color-border-subtle` / `-default` / `-focus` | Hairlines / control edges / focus ring |
| `--color-text-primary` / `-secondary` / `-tertiary` / `-on-accent` | Text levels (tertiary = hints only) |
| `--color-action-primary(-hover)` | Primary button |
| `--color-agent-claude` / `-codex` / `-shell` | Session kind |
| `--color-account-shared` / `-personal` | Claude account badge (`claude` / `claude-personal`) |
| `--color-diff-*` | Diff add / del / hunk |
| `--color-terminal-*` | xterm theme (read at runtime) |

### Session status — the core vocabulary

| Status | Token | Meaning | Source |
|---|---|---|---|
| working | `--color-status-working` (pulses) | Agent is running | Claude hook `UserPromptSubmit`/`PostToolUse`; output activity for Codex/shell |
| waiting | `--color-status-waiting` (halo) | Needs you: permission or question | Claude hook `Notification` |
| done | `--color-status-done` | Finished, not yet viewed | Claude hook `Stop`; quiet after ≥3s of activity |
| error | `--color-status-error` | Exited non-zero | pty exit code |
| idle | `--color-status-idle` | Nothing happening / seen | default |

A project row shows its most urgent session: `waiting > error > working > done > idle`.

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
| `--size-badge` / `--size-dot` | 16 / 8 | |
| `--size-sidebar` / `--size-panel` | 248 / 416 | |

## Components (`components.css`)

| Class | What |
|---|---|
| `.c-dot[data-status]` | Status dot |
| `.c-btn` `--primary` `--ghost` `--icon` | Buttons |
| `.c-segment`, `__item[aria-checked]` | Segmented control (account switch) |
| `.c-kbd` | Shortcut hint |
| `.c-badge` `--claude` `--codex` `--shell` `--account-shared` `--account-personal` | Tags |
| `.c-label` | Section label |
| `.c-sidebar` `__drag` `__body` `__group` `__foot` `__lang` | Sidebar |
| `.c-row[aria-current]` `__name` `__meta` | Project row |
| `.c-tabbar` `__add` `__trailing`, `.c-tab[aria-selected]` `__title` `__close` | Tabs |
| `.c-split`, `.c-pane[data-focused]` `__head` `__term` | Split view |
| `.c-split--free`, `.c-split__drop`, `.c-pane__title` `__close` | Split view in the app: absolutely placed panes, drop indicator (glides between zones), pane head title + close |
| `.c-panel` `__head` `__body` | Right panel |
| `.c-diff` `__line--add/del/hunk/file` | Diff |
| `.c-empty` `__title` `__path` `__actions` | Empty state |

## React components (`design-system/react/`)

Import from `@design-system/react`. App code uses these instead of writing `.c-*` class names; layout-only blocks
(sidebar, tab bar, split/pane, panel, diff) still use their classes inside their widget. The folder must not import
from `src/` (ESLint enforces it). New primitive → add the class to `components.css`, the component here, and a row below.

| Component | Renders |
|---|---|
| `Button` `variant="primary\|ghost"` `icon` | `.c-btn` |
| `Dot` `status` | `.c-dot` |
| `Badge` `tone` | `.c-badge--<tone>` |
| `Kbd`, `Label` | `.c-kbd`, `.c-label` |
| `Segment` `options` `value` `onChange` | `.c-segment` |
| `EmptyState` `title` `path` `actions` | `.c-empty` |

## Copy

Korean and English (`src/shared/i18n.ts`). Short and literal; buttons say what happens:
"Claude 열기 / Open Claude". Notifications: `<project>` · `Claude · 작업 완료 / Done`, `입력 필요 / Needs input`.
