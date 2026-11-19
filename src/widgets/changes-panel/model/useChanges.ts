import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type GitChanges, type GitScope } from '@/shared/api';
import { usePollInterval } from '@/shared/lib/usePowerSaver';

/** Safety net only: main's fs.watch (debounced) drives refreshes; this catches what it misses (e.g. a worktree's index). */
const POLL_MS = 45_000;

/**
 * Git changes for a project — or for one of its sessions (`sessionId`: its worktree, and with scope 'session' the
 * commit it started at). Refreshed when main's watcher reports a change, on window focus, and every 45 s as a safety
 * net. The panel only mounts while open, so watching stops when it closes.
 */
export function useChanges(projectId: string | null, sessionId?: string, scope: GitScope = 'worktree') {
  const pollMs = usePollInterval(POLL_MS);
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  /** A refresh was asked for while one ran: run once more after it (watch events must not get lost). */
  const again = useRef(false);
  const target = projectId && [projectId, sessionId ?? '', scope].join('\n');
  const current = useRef(target);
  current.current = target;

  const refresh = useCallback(() => {
    const key = current.current;
    if (!key) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const [id, session, sc] = key.split('\n');
    inFlight.current = true;
    api
      .gitChanges(id, session || undefined, sc as GitScope)
      .then((c) => {
        if (current.current !== key) return;
        setChanges(c);
        setError(null);
      })
      .catch((e: Error) => current.current === key && setError(e.message))
      .finally(() => {
        inFlight.current = false;
        if (again.current) {
          again.current = false;
          refresh();
        }
      });
  }, []);

  useEffect(() => {
    setChanges(null);
    setError(null);
    if (!projectId) return;
    inFlight.current = false;
    again.current = false;
    refresh();
    api.gitWatch({ projectId, sessionId });
    const off = api.onGitChanged(refresh);
    window.addEventListener('focus', refresh);
    return () => {
      off();
      api.gitWatch(null);
      window.removeEventListener('focus', refresh);
    };
  }, [target, projectId, sessionId, refresh]);

  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), pollMs);
    return () => clearInterval(timer);
  }, [target, refresh, pollMs]);

  return { changes, error, refresh };
}
