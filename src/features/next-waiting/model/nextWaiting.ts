import type { Session } from '@/shared/api';

/** Order of "needs you": a question first, then a failure, then finished work. */
const TIER = { waiting: 0, error: 1, done: 2 } as const;

const tierOf = (s: Session): number | null => {
  if (s.exited) return null;
  if (s.status === 'error' && s.reason === 'exit') return null;
  return s.status in TIER ? TIER[s.status as keyof typeof TIER] : null;
};

/** Sessions that need the user, most urgent first; within a tier the one that has waited longest. */
export function attentionQueue(sessions: Session[]): Session[] {
  return sessions
    .map((s, order) => ({ s, order, tier: tierOf(s) }))
    .filter((x): x is { s: Session; order: number; tier: number } => x.tier !== null)
    .sort((a, b) => a.tier - b.tier || (a.s.since ?? Infinity) - (b.s.since ?? Infinity) || a.order - b.order)
    .map((x) => x.s);
}

/**
 * Where "next waiting session" goes from `activeId`: the one after it in the queue (wrapping), or the head
 * of the queue when the focused session isn't in it. Null when nothing needs the user.
 */
export function nextWaiting(sessions: Session[], activeId: string | null): string | null {
  const queue = attentionQueue(sessions);
  if (!queue.length) return null;
  const i = queue.findIndex((s) => s.id === activeId);
  return queue[(i + 1) % queue.length].id;
}
