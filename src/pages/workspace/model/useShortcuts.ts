import { useEffect } from 'react';
import type { Config, SessionKind } from '@/shared/api';

interface Deps {
  config: Config | null;
  activeSessionId: string | null;
  openSession: (kind: SessionKind) => void;
  closeSession: (id: string) => void;
  selectProject: (id: string) => void;
}

/** ⌘T Claude · ⌘⇧T Codex · ⌘⌥T shell · ⌘W close · ⌘1–9 project. Capture phase so xterm doesn't eat them. */
export function useShortcuts({ config, activeSessionId, openSession, closeSession, selectProject }: Deps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.code === 'KeyT') {
        e.preventDefault();
        openSession(e.shiftKey ? 'codex' : e.altKey ? 'shell' : 'claude');
      } else if (e.code === 'KeyW' && activeSessionId) {
        e.preventDefault();
        closeSession(activeSessionId);
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
  }, [config, activeSessionId, openSession, closeSession, selectProject]);
}
