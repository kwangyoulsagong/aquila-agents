import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Config, type Session, type SessionKind } from '@/shared/api';

/** Workspace state: config, sessions, which project/session is on screen. */
export function useWorkspace() {
  const [config, setConfig] = useState<Config | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeByProject, setActiveByProject] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => {
      setConfig(c);
      setActiveProjectId(c.projects[0]?.id ?? null);
      if (c.error) setError(c.error);
    });
  }, []);

  useEffect(() => {
    const offStatus = api.onStatus(({ id, status }) =>
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, status } : s))),
    );
    const offExit = api.onExit(({ id, exitCode }) =>
      setSessions((list) =>
        list.map((s) =>
          s.id === id ? { ...s, status: exitCode === 0 ? 'idle' : 'error', exited: true } : s,
        ),
      ),
    );
    const offFocus = api.onFocusSession(({ id }) =>
      setSessions((list) => {
        const s = list.find((x) => x.id === id);
        if (s) {
          setActiveProjectId(s.projectId);
          setActiveByProject((m) => ({ ...m, [s.projectId]: id }));
        }
        return list;
      }),
    );
    return () => {
      offStatus();
      offExit();
      offFocus();
    };
  }, []);

  const projectSessions = useMemo(
    () => sessions.filter((s) => s.projectId === activeProjectId),
    [sessions, activeProjectId],
  );
  const activeSessionId =
    (activeProjectId && activeByProject[activeProjectId]) || projectSessions[0]?.id || null;
  const project = config?.projects.find((p) => p.id === activeProjectId);

  // Tell main which session is on screen (for notifications) and clear "done" once seen.
  useEffect(() => {
    api.setActive(activeSessionId);
    if (activeSessionId) api.markSeen(activeSessionId);
  }, [activeSessionId]);

  const openSession = useCallback(
    async (kind: SessionKind) => {
      if (!activeProjectId) return;
      try {
        const s = await api.createSession(activeProjectId, kind);
        setSessions((list) => [...list, { ...s, status: 'idle' }]);
        setActiveByProject((m) => ({ ...m, [activeProjectId]: s.id }));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activeProjectId],
  );

  const closeSession = useCallback((id: string) => {
    api.kill(id);
    setSessions((list) => list.filter((s) => s.id !== id));
  }, []);

  const selectSession = useCallback(
    (id: string) => activeProjectId && setActiveByProject((m) => ({ ...m, [activeProjectId]: id })),
    [activeProjectId],
  );

  return {
    config,
    setConfig,
    sessions,
    projectSessions,
    project,
    activeProjectId,
    setActiveProjectId,
    activeSessionId,
    selectSession,
    openSession,
    closeSession,
    error,
    clearError: () => setError(null),
  };
}
