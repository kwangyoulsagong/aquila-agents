# Agentrix — agent guide

Shared rules for **every** coding agent working on this repo (Claude Code reads this via CLAUDE.md, Codex reads it directly).

## What this is

A macOS Electron app: one window that holds many real terminal sessions (`claude`, `codex`, shell, ssh)
across many projects, with status dots and notifications. It **embeds the real CLIs** in a pty —
we never reimplement chat, permissions or slash commands.

Read before working: `docs/en/ARCHITECTURE.md` (how it fits together) and `docs/en/TASKS.md` (what to build, who owns which files).
Korean docs live in `docs/ko/` — **keep both languages in sync** when you change a doc.

## Commands

| Command | What |
|---|---|
| `npm run dev` | Vite + tsc watch + Electron with hot reload of the renderer |
| `npm run check` | **typecheck + lint + test — must pass before you finish** |
| `npm run typecheck` | Both tsconfigs (renderer + electron) |
| `npm test` | Vitest |
| `npm run smoke` | Build + launch + open a real pty session + screenshot `dist/smoke.png` (exit 0/1) |
| `npm run build` | Production build |
| `open design-system/preview.html` | See every token and component |

## Layout

```
electron/          main process (Node, CommonJS output) — pty, config, hooks, IPC handlers, smoke
src/               React renderer, Feature-Sliced Design:
  app/             entry, global styles
  pages/           workspace (state + shortcuts)
  widgets/         sidebar, session-tabs, session-stage
  features/        switch-account, switch-language, open-session
  entities/        session (xterm, status), project
  shared/          api (types, IPC names, bridge), i18n (dictionary + useT)
design-system/     tokens.css (primitive → semantic), components.css, preview.html
docs/en, docs/ko   README, ARCHITECTURE, DESIGN-SYSTEM, TASKS (English / Korean, kept in sync)
```

## Rules

1. **TypeScript strict everywhere.** No `any` unless commented why. No `.js`/`.jsx` source files.
2. **IPC goes through `src/shared/api/types.ts`.** New channel → add to `IPC`, add the method to `AgentrixApi`,
   implement in `electron/preload.ts` + `electron/main.ts`. The renderer uses `api` from `@/shared/api` — never
   `window.agentrix` or `ipcRenderer` directly.
2b. **Feature-Sliced Design in `src/`.** `app → pages → widgets → features → entities → shared`; import only downward,
   other slices only via their `index.ts`, `@/` alias between slices. ESLint enforces it. Put new code in the lowest
   layer that makes sense (a reusable view of a thing → `entities`; a user action → `features`; a composed block → `widgets`).
3. **Design tokens are semantic.** In `src/` and `components.css` use only `--color-*`, `--font-*`, `--space-*`,
   `--radius-*`, `--size-*`, `--motion-*`. Never `--p-*` primitives, never raw hex/px (1px hairlines, 0, 50% are fine).
   New value → add a primitive + semantic token in `design-system/tokens.css` and document it in `docs/*/DESIGN-SYSTEM.md`.
4. **Everything on the 4px grid, edges aligned.** Sidebar top band = tab bar = panel head (`--size-titlebar`).
   Sidebar content edge is 20px. Check `design-system/preview.html` after visual changes.
4b. **Micro-interactions** use `--motion-*` tokens only, are short (≤320ms), confirm an action or a state change,
   and are disabled under `prefers-reduced-motion` (already global in `components.css`).
5. **Components look like the design system.** Reuse `.c-*` classes from `components.css`; add new ones there
   (BEM: `.c-x`, `.c-x__part`, `.c-x--variant`, state via `aria-*`/`data-*`). `src/styles/app.css` is layout only.
6. **Don't touch the user's CLI setup.** Claude hooks are injected only via `--settings ~/.agentrix/claude-hooks.json`
   for sessions we spawn. Never write to `~/.claude*`, `~/.codex`, or shell rc files — except the explicit,
   user-confirmed actions specified in T2 (zshrc alias) and T11 (move sessions/memory to Trash).
7. **UI copy in Korean and English.** Every string goes through `src/shared/i18n/dictionary.ts` (both `ko` and `en`; the typecheck
   fails if one is missing). Short and literal ("Claude 열기" / "Open Claude"). Code, comments, commits in English.
8. **Stay in your task's files** (see `docs/en/TASKS.md` → Owns). Need to change a shared file
   (`pages/workspace/*`, `src/shared/api/types.ts`, `src/shared/i18n/dictionary.ts`, `electron/main.ts`,
   `electron/preload.ts`, `components.css`)? Keep the edit small and additive.
9. **Commits:** Conventional Commits (`feat(split): ...`, `fix(sessions): ...`), one task per branch `task/<id>-<slug>`.

## Done means

- `npm run check` passes.
- `npm run smoke` passes, and for UI work you looked at `dist/smoke.png` or ran `npm run dev`
  (or say clearly that you could not).
- `docs/en/TASKS.md` and `docs/ko/TASKS.md`: your task's checkbox ticked, with one line on anything left over.
