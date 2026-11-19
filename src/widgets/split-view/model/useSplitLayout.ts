import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SavedLayout, Session } from '@/shared/api';
import * as L from './layout';

/**
 * Split layout state for the workspace. The focused pane drives the active session; focusing a pane that
 * shows another project's session switches the sidebar/tab bar to that project.
 */
export function useSplitLayout(
  sessions: Session[],
  activeProjectId: string | null,
  setActiveProjectId: (id: string) => void,
) {
  const [layout, setLayout] = useState<L.Layout>(() => L.createLayout());
  /** Last session seen per project, so coming back to a project shows where you left off. */
  const [lastByProject, setLastByProject] = useState<Record<string, string>>({});

  const activeSessionId = L.focusedLeaf(layout).sessionId;
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    if (!activeSession) return;
    if (activeSession.projectId !== activeProjectId) setActiveProjectId(activeSession.projectId);
    setLastByProject((m) =>
      m[activeSession.projectId] === activeSession.id
        ? m
        : { ...m, [activeSession.projectId]: activeSession.id },
    );
  }, [activeSession, activeProjectId, setActiveProjectId]);

  /** Sidebar click: focus a pane already showing this project, else the focused pane takes its last session. */
  const selectProject = useCallback(
    (projectId: string) => {
      setActiveProjectId(projectId);
      const own = sessions.filter((s) => s.projectId === projectId);
      setLayout((l) => {
        const onScreen = L.leaves(l.root).find((leaf) => own.some((s) => s.id === leaf.sessionId));
        if (onScreen) return L.focus(l, onScreen.id);
        const last = own.find((s) => s.id === lastByProject[projectId]) ?? own[0];
        return L.place(l, l.focusedId, last?.id ?? null);
      });
    },
    [sessions, lastByProject, setActiveProjectId],
  );

  /** Tab click / notification click. */
  const showSession = useCallback((id: string) => setLayout((l) => L.show(l, id)), []);

  /** A freshly created session goes into the focused pane. */
  const placeInFocused = useCallback((id: string) => setLayout((l) => L.place(l, l.focusedId, id)), []);

  /** Before removing a session from the list: collapse its pane, or (single pane) show a sibling session. */
  const forgetSession = useCallback(
    (id: string) => {
      const gone = sessions.find((s) => s.id === id);
      setLayout((l) => {
        const shown = new Set(L.leaves(l.root).map((leaf) => leaf.sessionId));
        const fallback = sessions
          .filter((s) => s.id !== id && s.projectId === gone?.projectId && !shown.has(s.id))
          .at(-1);
        return L.removeSession(l, id, fallback?.id ?? null);
      });
    },
    [sessions],
  );

  /** The layout saved at the last quit (T21); false when it doesn't fit the restored sessions. */
  const restoreLayout = useCallback((saved: SavedLayout, sessionIds: string[]) => {
    const next = L.fromSaved(saved, new Set(sessionIds));
    if (!next || !L.leaves(next.root).some((l) => l.sessionId)) return false;
    setLayout(next);
    return true;
  }, []);

  const focusPane = useCallback((paneId: string) => setLayout((l) => L.focus(l, paneId)), []);
  const splitFocused = useCallback(
    (dir: L.SplitDir) => setLayout((l) => L.split(l, l.focusedId, dir === 'row' ? 'right' : 'bottom', null)),
    [],
  );
  const closePane = useCallback(
    (paneId?: string) => setLayout((l) => L.closePane(l, paneId ?? l.focusedId)),
    [],
  );
  const moveFocus = useCallback(
    (edge: L.Edge) =>
      setLayout((l) => {
        const next = L.neighbor(l, edge);
        return next ? L.focus(l, next) : l;
      }),
    [],
  );
  const toggleZoom = useCallback(() => setLayout((l) => L.toggleZoom(l)), []);
  const resizeSplit = useCallback(
    (path: string, ratio: number) => setLayout((l) => L.resize(l, path, ratio)),
    [],
  );
  const nudgeFocused = useCallback((edge: L.Edge) => setLayout((l) => L.nudge(l, edge)), []);
  const dropSession = useCallback(
    (sessionId: string, paneId: string, zone: L.DropZone) =>
      setLayout((l) => L.drop(l, paneId, zone, sessionId)),
    [],
  );

  const visibleSessionIds = useMemo(
    () => L.leaves(layout.root).flatMap((leaf) => (leaf.sessionId ? [leaf.sessionId] : [])),
    [layout],
  );

  return {
    layout,
    activeSessionId,
    visibleSessionIds,
    paneCount: L.paneCount(layout),
    zoomed: !!L.zoomed(layout),
    selectProject,
    showSession,
    placeInFocused,
    forgetSession,
    restoreLayout,
    focusPane,
    splitFocused,
    closePane,
    moveFocus,
    toggleZoom,
    resizeSplit,
    nudgeFocused,
    dropSession,
  };
}

export type SplitLayoutApi = ReturnType<typeof useSplitLayout>;
