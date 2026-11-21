import type { Session } from '@/shared/api';

/**
 * Where a picked element goes:
 * - `paste` into the focused Claude/Codex tab;
 * - `busy`: that tab is on a question or permission prompt, where a paste would answer it, so it's copied instead;
 * - `none`: no live Claude/Codex tab is focused, so it's copied.
 */
export type PickTarget =
  { kind: 'paste'; session: Session } | { kind: 'busy'; session: Session } | { kind: 'none' };

export function pickTarget(session: Session | undefined): PickTarget {
  if (!session || session.kind === 'shell' || session.dormant || session.exited) return { kind: 'none' };
  // Remote tabs that lost their connection would swallow the paste.
  if (session.connection && session.connection !== 'connected') return { kind: 'none' };
  if (session.status === 'waiting') return { kind: 'busy', session };
  return { kind: 'paste', session };
}
