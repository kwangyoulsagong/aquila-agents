import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Session, type SessionStatus } from '@/shared/api';
import { nextReview, reconcileReview, type ReviewEntry } from './reviewQueue';

/** What the queue shows about a session's tree: read once when it joins (one `git:changes`). */
export interface ReviewInfo {
  branch?: string;
  files?: number;
}

export interface ReviewItem extends ReviewEntry {
  session: Session;
  info?: ReviewInfo;
}

/**
 * The review queue (T58): sessions that finished while off screen and haven't been looked at since. In memory only.
 * `visible` = the sessions in a split pane right now.
 */
export function useReviewQueue(sessions: Session[], visible: string[]) {
  const [queue, setQueue] = useState<ReviewEntry[]>([]);
  const [info, setInfo] = useState<Record<string, ReviewInfo>>({});
  const prevStatus = useRef(new Map<string, SessionStatus>());

  useEffect(() => {
    const shown = new Set(visible);
    // Captured now: the updater runs later, after prevStatus already holds these statuses.
    const prev = prevStatus.current;
    const now = Date.now();
    setQueue((q) => {
      const next = reconcileReview(q, prev, sessions, shown, now);
      const same = next.length === q.length && next.every((e, i) => e.id === q[i].id && e.at === q[i].at);
      return same ? q : next;
    });
    prevStatus.current = new Map(sessions.map((s) => [s.id, s.status]));
  }, [sessions, visible]);

  // Branch and changed-file count for each new entry (its worktree when it has one). Errors leave it blank.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const e of queue) {
      if (asked.current.has(e.id)) continue;
      const s = sessions.find((x) => x.id === e.id);
      if (!s || s.dormant) continue;
      asked.current.add(e.id);
      api
        .gitChanges(s.projectId, s.id)
        .then((c) =>
          setInfo((all) => ({
            ...all,
            [e.id]: c.isRepo ? { branch: c.branch, files: c.files.length } : {},
          })),
        )
        .catch(() => setInfo((all) => ({ ...all, [e.id]: {} })));
    }
    // Left the queue: read again if it finishes again later.
    for (const id of asked.current) if (!queue.some((e) => e.id === id)) asked.current.delete(id);
  }, [queue, sessions]);

  const items = useMemo(
    () =>
      queue.flatMap((e): ReviewItem[] => {
        const session = sessions.find((s) => s.id === e.id);
        return session ? [{ ...e, session, info: info[e.id] }] : [];
      }),
    [queue, sessions, info],
  );

  return { items, next: (activeId: string | null) => nextReview(queue, activeId) };
}
