import { useEffect } from 'react';
import type { Config, SessionKind } from '@/shared/api';
import { matchShortcut, projectIndex } from '@/shared/lib/shortcuts';
import type { Edge, SplitDir } from '@/widgets/split-view';

interface Deps {
  config: Config | null;
  activeSessionId: string | null;
  openSession: (kind: SessionKind) => void;
  closeSession: (id: string) => void;
  selectProject: (id: string) => void;
  splitFocused: (dir: SplitDir) => void;
  moveFocus: (edge: Edge) => void;
  /** Close the focused pane (close-session shortcut on an empty pane). */
  closePane: () => void;
  toggleChanges: () => void;
  togglePalette: () => void;
}

/** Runs the shortcuts of `shared/lib/shortcuts.ts`. Capture phase so xterm doesn't eat them. */
export function useShortcuts({
  config,
  activeSessionId,
  openSession,
  closeSession,
  selectProject,
  splitFocused,
  moveFocus,
  closePane,
  toggleChanges,
  togglePalette,
}: Deps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchShortcut(e);
      if (!id) return;
      const project = projectIndex(id);
      if (project !== null) {
        const p = config?.projects[project];
        if (!p) return;
        e.preventDefault();
        selectProject(p.id);
        return;
      }
      e.preventDefault();
      switch (id) {
        case 'palette':
          return togglePalette();
        case 'openClaude':
          return openSession('claude');
        case 'openCodex':
          return openSession('codex');
        case 'openShell':
          return openSession('shell');
        case 'closeSession':
          return activeSessionId ? closeSession(activeSessionId) : closePane();
        case 'toggleChanges':
          return toggleChanges();
        case 'splitRight':
          return splitFocused('row');
        case 'splitDown':
          return splitFocused('column');
        case 'focusLeft':
          return moveFocus('left');
        case 'focusRight':
          return moveFocus('right');
        case 'focusUp':
          return moveFocus('top');
        case 'focusDown':
          return moveFocus('bottom');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    config,
    activeSessionId,
    openSession,
    closeSession,
    selectProject,
    splitFocused,
    moveFocus,
    closePane,
    toggleChanges,
    togglePalette,
  ]);
}
