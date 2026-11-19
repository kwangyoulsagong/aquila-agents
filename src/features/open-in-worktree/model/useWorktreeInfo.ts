import { useEffect, useState } from 'react';
import { api, type WorktreeInfo } from '@/shared/api';

/** The project's repo, branches and worktrees, read once when the dialog opens. */
export function useWorktreeInfo(projectId: string) {
  const [info, setInfo] = useState<WorktreeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .worktreeInfo(projectId)
      .then((i) => live && setInfo(i))
      .catch((e: unknown) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [projectId]);
  return { info, error };
}
