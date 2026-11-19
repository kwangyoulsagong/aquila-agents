@AGENTS.md

## Claude Code specifics

- Project hooks (`.claude/settings.json`) auto-format edited files with Prettier and run `npm run typecheck`
  when you stop. If the stop hook reports type errors, fix them before finishing.
- Prefer parallel work in separate worktrees: one task from `docs/en/TASKS.md` per session.
- For UI changes, open `design-system/preview.html` or run `npm run dev` and look before saying it's done.
