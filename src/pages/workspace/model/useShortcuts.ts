import { useEffect } from 'react';
import { api, type Config, type MenuCommand, type SessionKind } from '@/shared/api';
import { matchShortcut, projectIndex, yieldsToText, type KeyTarget, type ShortcutId } from '@/shared/lib/shortcuts';
import type { Edge, SplitDir } from '@/widgets/split-view';

/** xterm's own input is a textarea too: it counts as the terminal, not a text field. */
function keyTarget(t: EventTarget | null): KeyTarget {
  if (!(t instanceof Element)) return 'other';
  if (t.closest('.xterm')) return 'terminal';
  if (t.closest('.cm-editor')) return 'noteEditor';
  if (t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return 'textField';
  return 'other';
}

interface Deps {
  config: Config | null;
  activeSessionId: string | null;
  openSession: (kind: SessionKind) => void;
  closeSession: (id: string) => void;
  selectProject: (id: string) => void;
  splitFocused: (dir: SplitDir) => void;
  moveFocus: (edge: Edge) => void;
  toggleZoom: () => void;
  /** Full window (T37); a no-op where it isn't offered. */
  toggleFullscreen: () => void;
  /** Keyboard resize of the focused pane's divider. */
  nudgePane: (edge: Edge) => void;
  /** Close the focused pane (close-session shortcut on an empty pane). */
  closePane: () => void;
  toggleChanges: () => void;
  togglePreview: () => void;
  /** Run slot panel (T60). */
  toggleRun: () => void;
  /** Knowledge graph panel (T66). */
  toggleGraph: () => void;
  /** ⌘O: find a note and open it in the editor (T67). */
  quickOpen: () => void;
  togglePalette: () => void;
  toggleGuide: () => void;
  toggleHistory: () => void;
  /** Jump to the next session that needs the user (any project). */
  nextWaiting: () => void;
  /** Terminal helpers (T28) on the focused session. */
  copyLastReply: () => void;
  quickSelect: () => void;
  /** Find bar on the focused session (T40). */
  find: () => void;
  /** Menu-only commands of the app menu bar (T47). */
  menu: Record<Exclude<MenuCommand, ShortcutId>, () => void>;
}

/**
 * Runs the shortcuts of `shared/lib/shortcuts.ts`: from the keyboard (capture phase so xterm doesn't eat them)
 * and from the app menu bar (T47), whose items only display the keys.
 */
export function useShortcuts({
  config,
  activeSessionId,
  openSession,
  closeSession,
  selectProject,
  splitFocused,
  moveFocus,
  toggleZoom,
  toggleFullscreen,
  nudgePane,
  closePane,
  toggleChanges,
  togglePreview,
  toggleRun,
  toggleGraph,
  quickOpen,
  togglePalette,
  toggleGuide,
  toggleHistory,
  nextWaiting,
  copyLastReply,
  quickSelect,
  find,
  menu,
}: Deps) {
  useEffect(() => {
    const run = (id: ShortcutId) => {
      const project = projectIndex(id);
      if (project !== null) {
        const p = config?.projects[project];
        if (p) selectProject(p.id);
        return;
      }
      switch (id) {
        case 'palette':
          return togglePalette();
        case 'guide':
          return toggleGuide();
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
        case 'togglePreview':
          return togglePreview();
        case 'toggleRun':
          return toggleRun();
        case 'toggleGraph':
          return toggleGraph();
        case 'quickOpen':
          return quickOpen();
        case 'history':
          return toggleHistory();
        case 'nextWaiting':
          return nextWaiting();
        case 'copyLastReply':
          return copyLastReply();
        case 'quickSelect':
          return quickSelect();
        case 'find':
          return find();
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
        case 'zoomPane':
          return toggleZoom();
        case 'fullscreen':
          return toggleFullscreen();
        case 'resizeLeft':
          return nudgePane('left');
        case 'resizeRight':
          return nudgePane('right');
        case 'resizeUp':
          return nudgePane('top');
        case 'resizeDown':
          return nudgePane('bottom');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const id = matchShortcut(e);
      if (!id) return;
      // In the note editor (T67) and inputs some keys edit text instead (⌘W never closes a session from there).
      if (yieldsToText(id, keyTarget(e.target))) return;
      // A project key with no project there stays the terminal's.
      const project = projectIndex(id);
      if (project !== null && !config?.projects[project]) return;
      e.preventDefault();
      run(id);
    };
    const onMenu = (c: MenuCommand) => {
      if (c === 'settings' || c === 'addProject' || c === 'whatsNew' || c === 'connectFigma') menu[c]();
      else run(c);
    };
    window.addEventListener('keydown', onKey, true);
    const offMenu = api.onMenuCommand(onMenu);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      offMenu();
    };
  }, [
    config,
    activeSessionId,
    openSession,
    closeSession,
    selectProject,
    splitFocused,
    moveFocus,
    toggleZoom,
    toggleFullscreen,
    nudgePane,
    closePane,
    toggleChanges,
    togglePreview,
    toggleRun,
    toggleGraph,
    quickOpen,
    togglePalette,
    toggleGuide,
    toggleHistory,
    nextWaiting,
    copyLastReply,
    quickSelect,
    find,
    menu,
  ]);
}
