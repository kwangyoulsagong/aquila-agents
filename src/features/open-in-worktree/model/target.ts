import type { WorktreeInfo } from '@/shared/api';

/** What opening `branch` will do — mirrors `ensureWorktree` in electron/worktrees.ts. */
export type WorktreeTarget =
  | { kind: 'reuse'; path: string }
  | { kind: 'checkout'; path: string }
  | { kind: 'create'; path: string; from: string };

export function worktreeTarget(info: WorktreeInfo, input: string): WorktreeTarget | null {
  const branch = input.trim();
  if (!info.isRepo || !branch) return null;
  const existing = info.worktrees.find((w) => !w.detached && w.branch === branch);
  if (existing) return { kind: 'reuse', path: existing.path };
  const path = `${info.root}/${branch}`;
  return info.branches.includes(branch) ? { kind: 'checkout', path } : { kind: 'create', path, from: info.base };
}
