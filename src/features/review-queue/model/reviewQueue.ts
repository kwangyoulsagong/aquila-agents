import type { Session, SessionStatus } from '@/shared/api';

/** A session that finished while off screen (T58), and when it joined the queue. */
export interface ReviewEntry {
  id: string;
  at: number;
}

/** A finished session stays "to review" through these; anything else (it runs again, asks, fails) takes it out. */
const KEEP: ReadonlySet<SessionStatus> = new Set<SessionStatus>(['done', 'idle', 'stopped']);

/**
 * The next review queue. A session joins when it turns `done` while not on screen; it leaves when it is on screen,
 * its tab is closed, or it starts working / waiting / failing again. Oldest first.
 *
 * `prevStatus` is each session's status at the last call, so only a change *into* `done` counts — a session that was
 * already done (e.g. seen and left done) doesn't come back.
 */
export function reconcileReview(
  queue: readonly ReviewEntry[],
  prevStatus: ReadonlyMap<string, SessionStatus>,
  sessions: readonly Session[],
  visible: ReadonlySet<string>,
  now: number,
): ReviewEntry[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const next = queue.filter((e) => {
    const s = byId.get(e.id);
    return !!s && !visible.has(e.id) && KEEP.has(s.status);
  });
  for (const s of sessions) {
    if (s.status !== 'done' || prevStatus.get(s.id) === 'done' || visible.has(s.id)) continue;
    if (next.some((e) => e.id === s.id)) continue;
    next.push({ id: s.id, at: s.since ?? now });
  }
  return next.sort((a, b) => a.at - b.at);
}

/** Where "Next to review" goes from `activeId`: the entry after it (wrapping), else the oldest. */
export function nextReview(queue: readonly ReviewEntry[], activeId: string | null): string | null {
  if (!queue.length) return null;
  const i = queue.findIndex((e) => e.id === activeId);
  return queue[(i + 1) % queue.length].id;
}
