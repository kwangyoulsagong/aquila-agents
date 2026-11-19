import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Config, type HistoryResumeResult, type Session, type SessionKind } from '@/shared/api';
import { toSaved, useSplitLayout } from '@/widgets/split-view';

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
  const { showSession, placeInFocused, forgetSession, restoreLayout } = split;

  // Bring back the tabs and the split layout from the last launch. Main spawns the tabs on screen (Claude and codex
  // resume, shells start under their last output); the others come back dormant and start when first shown.
  const restoring = useRef(false);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!config || restoring.current) return;
    restoring.current = true;
    api
      .restoreSessions()
      .then(({ sessions: tabs, layout }) => {
        if (!tabs.length) return;
        setSessions((list) => [
          ...list,
          ...tabs.filter((r) => !list.some((s) => s.id === r.id)).map((r): Session => ({ ...r, status: 'idle' })),
        ]);
        if (!layout || !restoreLayout(layout, tabs.map((r) => r.id)))
          placeInFocused((tabs.find((r) => !r.dormant) ?? tabs[0]).id);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setRestored(true));
  }, [config, placeInFocused, restoreLayout]);

  // Saved with the tabs in ~/.aquila/state.json — only once restored, so the saved layout isn't overwritten first.
  useEffect(() => {
    if (restored) api.saveLayout(toSaved(split.layout));
  }, [restored, split.layout]);

  useEffect(() => {
    const offStatus = api.onStatus(({ id, status, estimated, reason, since }) =>
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, status, estimated, reason, since } : s))),
    );
    // Main already sent the exit status (stopped / error) on session:status.
    const offExit = api.onExit(({ id }) =>
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, exited: true } : s))),
    );
    const offFocus = api.onFocusSession(({ id }) => showSession(id));
    const offConnection = api.onConnection(({ id, state, retryAt }) =>
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, connection: state, retryAt } : s))),
    );
    return () => {
      offConnection();
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

  // A dormant restored tab starts the first time it's on screen.
  const waking = useRef(new Set<string>());
  useEffect(() => {
    for (const id of visibleSessionIds) {
      if (waking.current.has(id) || !sessions.some((s) => s.id === id && s.dormant)) continue;
      waking.current.add(id);
      api
        .startSession(id)
        .then((info) =>
          setSessions((list) => list.map((s) => (s.id === id ? { ...s, ...info, dormant: undefined } : s))),
        )
        .catch((e: unknown) => {
          setError((e as Error).message);
          forgetSession(id);
          setSessions((list) => list.filter((s) => s.id !== id));
        })
        .finally(() => waking.current.delete(id));
    }
  }, [visibleSessionIds, sessions, forgetSession]);

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

  /** Claude in the worktree of `branch` (created or reused by main). Throws so the dialog can show git's error. */
  const openWorktreeSession = useCallback(
    async (branch: string) => {
      if (!activeProjectId) return;
      const s = await api.createWorktreeSession(activeProjectId, branch, 'claude');
      setSessions((list) => [...list, { ...s, status: 'idle' }]);
      placeInFocused(s.id);
    },
    [activeProjectId, placeInFocused],
  );

  /** A past session resumed from the history panel (main may have added its folder as a project). */
  const adoptResumed = useCallback(
    ({ session, config: next }: HistoryResumeResult) => {
      if (next) setConfig(next);
      setSessions((list) => [...list, { ...session, status: 'idle' }]);
      placeInFocused(session.id);
    },
    [placeInFocused],
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
    openWorktreeSession,
    adoptResumed,
    closeSession,
    forgetProject,
    error,
    showError: setError,
    clearError: () => setError(null),
  };
}
