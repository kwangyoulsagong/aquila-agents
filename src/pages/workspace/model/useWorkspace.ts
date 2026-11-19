import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Config, type Session, type SessionKind } from '@/shared/api';
import { useSplitLayout } from '@/widgets/split-view';

/** Workspace state: config, sessions, which project is selected and the split layout (what's on screen). */
export function useWorkspace() {
  const [config, setConfig] = useState<Config | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => {
      setConfig(c);
      setActiveProjectId(c.projects[0]?.id ?? null);
      if (c.error) setError(c.error);
    });
  }, []);

  const split = useSplitLayout(sessions, activeProjectId, setActiveProjectId);
  const { showSession, placeInFocused, forgetSession } = split;

  // Bring back the tabs from the last launch (main spawns them; Claude resumes, codex resumes --last).
  const restoring = useRef(false);
  useEffect(() => {
    if (!config || restoring.current) return;
    restoring.current = true;
    const firstProjectId = config.projects[0]?.id;
    api
      .restoreSessions()
      .then((restored) => {
        if (!restored.length) return;
        setSessions((list) => [
          ...list,
          ...restored
            .filter((r) => !list.some((s) => s.id === r.id))
            .map((r): Session => ({ ...r, status: 'idle' })),
        ]);
        placeInFocused((restored.find((r) => r.projectId === firstProjectId) ?? restored[0]).id);
      })
      .catch((e: unknown) => setError((e as Error).message));
  }, [config, placeInFocused]);

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
    const offFocus = api.onFocusSession(({ id }) => showSession(id));
    return () => {
      offStatus();
      offExit();
      offFocus();
    };
  }, [showSession]);

  const projectSessions = useMemo(
    () => sessions.filter((s) => s.projectId === activeProjectId),
    [sessions, activeProjectId],
  );
  const { activeSessionId, visibleSessionIds } = split;
  const project = config?.projects.find((p) => p.id === activeProjectId);

  // Tell main which session is focused (for notifications) and clear "done" once a session is on screen.
  useEffect(() => {
    api.setActive(activeSessionId);
  }, [activeSessionId]);
  useEffect(() => {
    visibleSessionIds.forEach((id) => api.markSeen(id));
  }, [visibleSessionIds]);

  const openSession = useCallback(
    /** `account` overrides the project's Claude account for this session (account setup). */
    async (kind: SessionKind, account?: string) => {
      if (!activeProjectId) return;
      try {
        const s = await api.createSession(activeProjectId, kind, account);
        setSessions((list) => [...list, { ...s, status: 'idle' }]);
        placeInFocused(s.id);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activeProjectId, placeInFocused],
  );

  const closeSession = useCallback(
    (id: string) => {
      api.kill(id);
      forgetSession(id);
      setSessions((list) => list.filter((s) => s.id !== id));
    },
    [forgetSession],
  );

  /** A project left the config: close its sessions; if it was selected, select the first one left. */
  const forgetProject = useCallback(
    (projectId: string, next: Config) => {
      sessions.filter((s) => s.projectId === projectId).forEach((s) => closeSession(s.id));
      if (projectId === activeProjectId && next.projects[0]) split.selectProject(next.projects[0].id);
    },
    [sessions, closeSession, activeProjectId, split],
  );

  return {
    config,
    setConfig,
    sessions,
    projectSessions,
    project,
    activeProjectId,
    selectProject: split.selectProject,
    activeSessionId,
    selectSession: showSession,
    split,
    openSession,
    closeSession,
    forgetProject,
    error,
    showError: setError,
    clearError: () => setError(null),
  };
}
