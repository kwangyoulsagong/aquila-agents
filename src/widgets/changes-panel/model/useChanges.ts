import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type GitChanges } from '@/shared/api';
import { usePollInterval } from '@/shared/lib/usePowerSaver';

const POLL_MS = 5000;

/** Git changes for a project — or for a worktree session's worktree (`sessionId`) — refreshed on window focus and
 * every 5 s (15 s in power-saver mode) while the window is visible. The panel only mounts while open, so polling stops when it closes. */
export function useChanges(projectId: string | null, sessionId?: string) {
  const pollMs = usePollInterval(POLL_MS);
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const target = projectId && (sessionId ? `${projectId}\n${sessionId}` : projectId);
  const current = useRef(target);
  current.current = target;

  const refresh = useCallback(() => {
    const key = current.current;
    if (!key || inFlight.current) return;
    const [id, session] = key.split('\n');
    inFlight.current = true;
    api
      .gitChanges(id, session)
      .then((c) => {
        if (current.current !== key) return;
        setChanges(c);
        setError(null);
      })
      .catch((e: Error) => current.current === key && setError(e.message))
      .finally(() => (inFlight.current = false));
  }, []);

  useEffect(() => {
    setChanges(null);
    setError(null);
    if (!target) return;
    inFlight.current = false;
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [target, refresh]);

  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), pollMs);
    return () => clearInterval(timer);
  }, [target, refresh, pollMs]);

  return { changes, error, refresh };
}
