import { useEffect, useState } from 'react';
import { api, type Worktree } from '@/shared/api';
import { linkedWorktrees } from './menu';

/** Linked worktrees of `projectId`, re-read every time `active` turns on (⌘K opening); [] without a project. */
export function useLinkedWorktrees(projectId: string | undefined, active: boolean): Worktree[] {
  const [list, setList] = useState<Worktree[]>([]);
  useEffect(() => {
    if (!projectId || !active) return;
    let live = true;
    api
      .worktreeInfo(projectId)
      .then((info) => live && setList(linkedWorktrees(info)))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [projectId, active]);
  return projectId ? list : [];
}

/** Linked worktrees read on demand (right-click on +); [] when git fails. */
export const loadLinkedWorktrees = (projectId: string): Promise<Worktree[]> =>
  api.worktreeInfo(projectId).then(linkedWorktrees, () => []);
