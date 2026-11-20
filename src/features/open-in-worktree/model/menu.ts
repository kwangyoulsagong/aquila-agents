import type { ContextMenuItem, SessionKind, Worktree, WorktreeInfo } from '@/shared/api';
import { kindLabel, type Translate } from '@/shared/i18n';

const KINDS: SessionKind[] = ['claude', 'codex', 'shell'];
const PREFIX = 'worktree:';

/** The repo's linked worktrees that have a branch (the main checkout is the project itself). */
export const linkedWorktrees = (info: WorktreeInfo | null): Worktree[] =>
  info?.isRepo ? info.worktrees.filter((w) => w.path !== info.repoRoot) : [];

/**
 * Open-session menu entries for existing worktrees: one submenu per branch with Claude / Codex / Shell.
 * Pick results come back through `parseWorktreeMenuId`.
 */
export function worktreeMenuItems(t: Translate, worktrees: Worktree[]): ContextMenuItem[] {
  return worktrees.map((w) => ({
    label: w.branch,
    submenu: KINDS.map((kind) => ({ id: `${PREFIX}${kind}:${w.branch}`, label: kindLabel(t, kind) })),
  }));
}

/** `worktree:<kind>:<branch>` → what to open; null for any other menu id. */
export function parseWorktreeMenuId(id: string | null): { kind: SessionKind; branch: string } | null {
  if (!id?.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  const colon = rest.indexOf(':');
  const kind = rest.slice(0, colon) as SessionKind;
  const branch = rest.slice(colon + 1);
  return colon > 0 && KINDS.includes(kind) && branch ? { kind, branch } : null;
}
