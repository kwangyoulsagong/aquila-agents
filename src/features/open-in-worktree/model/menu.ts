import type { ContextMenuItem, SessionKind, Worktree, WorktreeInfo } from '@/shared/api';
import { kindLabel, type Translate } from '@/shared/i18n';

const KINDS: SessionKind[] = ['claude', 'codex', 'shell'];
const PREFIX = 'worktree:';

/** The repo's linked worktrees (the main checkout is the project itself). */
export const linkedWorktrees = (info: WorktreeInfo | null): Worktree[] =>
  info?.isRepo ? info.worktrees.filter((w) => w.path !== info.repoRoot) : [];

/** What opens a worktree: its branch, or its path when detached (git branch names can't start with `/`). */
export const worktreeRef = (w: Worktree): string => (w.detached ? w.path : w.branch);

/** How a worktree is named in menus: the branch, or `a1b2c3d (detached)`. */
export const worktreeLabel = (t: Translate, w: Worktree): string =>
  w.detached ? t('worktree.detached', { commit: w.branch }) : w.branch;

/**
 * Open-session menu entries for existing worktrees: one submenu per branch with Claude / Codex / Shell.
 * Pick results come back through `parseWorktreeMenuId`.
 */
export function worktreeMenuItems(t: Translate, worktrees: Worktree[]): ContextMenuItem[] {
  return worktrees.map((w) => ({
    label: worktreeLabel(t, w),
    submenu: KINDS.map((kind) => ({ id: `${PREFIX}${kind}:${worktreeRef(w)}`, label: kindLabel(t, kind) })),
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
