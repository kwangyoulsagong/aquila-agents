import { useEffect, useState } from 'react';
import { api, type Session, type SessionStatus } from '@/shared/api';

export interface LiveSession {
  tabId: string;
  status: SessionStatus;
}

/** Asked again this long after the tabs or their statuses last changed (a conversation id arrives with a hook). */
const SETTLE_MS = 400;

/**
 * Graph session nodes (`session:<agent>:<id>`) that are open in a tab right now, with the tab's status (T72).
 * Main knows each tab's conversation id; it's asked again when the set of tabs or a status changes.
 */
export function useLiveSessions(sessions: readonly Session[] | undefined): Map<string, LiveSession> {
  const [live, setLive] = useState<Map<string, LiveSession>>(() => new Map());
  const key = (sessions ?? [])
    .filter((s) => s.kind !== 'shell' && !s.remote && !s.dormant)
    .map((s) => `${s.id}:${s.status}`)
    .join('|');
  useEffect(() => {
    if (!key) {
      setLive(new Map());
      return;
    }
    const status = new Map((sessions ?? []).map((s) => [s.id, s.status]));
    let stale = false;
    const timer = window.setTimeout(() => {
      api
        .sessionAgentIds()
        .then((ids) => {
          if (stale) return;
          const next = new Map<string, LiveSession>();
          for (const { tabId, agent, sessionId } of ids) {
            const st = status.get(tabId);
            if (st) next.set(`session:${agent}:${sessionId}`, { tabId, status: st });
          }
          setLive(next);
        })
        .catch(() => undefined);
    }, SETTLE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
    // `key` carries everything that matters about `sessions`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return live;
}
