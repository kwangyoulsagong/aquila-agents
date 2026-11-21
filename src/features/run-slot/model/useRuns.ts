import { useCallback, useEffect, useState } from 'react';
import { api, type RunList } from '@/shared/api';

/** The run commands of a project dir / worktree with their live state (T60). */
export function useRuns(projectId: string, worktree?: string) {
  const [list, setList] = useState<RunList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = useCallback(
    (l: RunList) => l.projectId === projectId && l.worktree === worktree,
    [projectId, worktree],
  );
  useEffect(() => {
    let live = true;
    void api.runList(projectId, worktree).then((l) => live && mine(l) && setList(l));
    const off = api.onRunsChanged((l) => mine(l) && setList(l));
    return () => {
      live = false;
      off();
    };
  }, [projectId, worktree, mine]);
  const start = useCallback(
    (name: string) => {
      setError(null);
      api
        .runStart(projectId, worktree, name)
        .then((l) => mine(l) && setList(l))
        .catch((e: unknown) => setError((e as Error).message));
    },
    [projectId, worktree, mine],
  );
  const stop = useCallback((id: string) => {
    setError(null);
    api.runStop(id).catch((e: unknown) => setError((e as Error).message));
  }, []);
  return { runs: list && mine(list) ? list.runs : null, error, start, stop };
}
