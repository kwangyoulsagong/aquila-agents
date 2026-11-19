import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type GitChanges } from '@/shared/api';

const POLL_MS = 5000;

/** Git changes for a project, refreshed on window focus and every 5 s while the window is visible.
 * The panel only mounts while open, so polling stops when it closes. */
export function useChanges(projectId: string | null) {
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const current = useRef(projectId);
  current.current = projectId;

  const refresh = useCallback(() => {
    const id = current.current;
    if (!id || inFlight.current) return;
    inFlight.current = true;
    api
      .gitChanges(id)
      .then((c) => {
        if (current.current !== id) return;
        setChanges(c);
        setError(null);
      })
      .catch((e: Error) => current.current === id && setError(e.message))
      .finally(() => (inFlight.current = false));
  }, []);

  useEffect(() => {
    setChanges(null);
    setError(null);
    if (!projectId) return;
    inFlight.current = false;
    refresh();
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [projectId, refresh]);

  return { changes, error, refresh };
}
