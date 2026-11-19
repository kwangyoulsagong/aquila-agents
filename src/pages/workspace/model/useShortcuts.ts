import { useEffect } from 'react';
import type { Config, SessionKind } from '@/shared/api';
import type { Edge, SplitDir } from '@/widgets/split-view';

const ARROWS: Record<string, Edge> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'top',
  ArrowDown: 'bottom',
};

interface Deps {
  config: Config | null;
  activeSessionId: string | null;
  openSession: (kind: SessionKind) => void;
  closeSession: (id: string) => void;
  selectProject: (id: string) => void;
  splitFocused: (dir: SplitDir) => void;
  moveFocus: (edge: Edge) => void;
  /** Close the focused pane (⌘W on an empty pane). */
  closePane: () => void;
  toggleChanges: () => void;
  togglePalette: () => void;
}

/**
 * ⌘T Claude · ⌘⇧T Codex · ⌘⌥T shell · ⌘W close · ⌘1–9 project · ⌘D split right · ⌘⇧D split down ·
 * ⌘⌥←→↑↓ move focus between panes · ⌘⇧G changes panel · ⌘K command palette. Capture phase so xterm doesn't eat them.
 */
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
      if (!e.metaKey) return;
      if (e.code === 'KeyK') {
        e.preventDefault();
        togglePalette();
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        openSession(e.shiftKey ? 'codex' : e.altKey ? 'shell' : 'claude');
      } else if (e.code === 'KeyW') {
        e.preventDefault();
        if (activeSessionId) closeSession(activeSessionId);
        else closePane();
      } else if (e.code === 'KeyG' && e.shiftKey) {
        e.preventDefault();
        toggleChanges();
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        splitFocused(e.shiftKey ? 'column' : 'row');
      } else if (e.altKey && ARROWS[e.key]) {
        e.preventDefault();
        moveFocus(ARROWS[e.key]);
      } else if (/^Digit[1-9]$/.test(e.code) && config) {
        const p = config.projects[Number(e.code.slice(5)) - 1];
        if (p) {
          e.preventDefault();
          selectProject(p.id);
        }
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
