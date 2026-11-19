// Commands for a session's terminal helpers. The workspace (shortcuts, palette) calls these with the focused
// session's id; the `TerminalHelpers` of that session reacts.
import { useSyncExternalStore } from 'react';
import { api } from '@/shared/api';

export type FlashKey = 'copied' | 'pasted' | 'noReply' | 'noTargets';

interface State {
  /** Session whose quick select is open. */
  picking: string | null;
  /** A short confirmation over one terminal; `n` restarts it when the same message repeats. */
  flash: { sessionId: string; key: FlashKey; n: number } | null;
}

let state: State = { picking: null, flash: null };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function useHelpersState(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function flash(sessionId: string, key: FlashKey): void {
  set({ flash: { sessionId, key, n: (state.flash?.n ?? 0) + 1 } });
}

export function clearFlash(n: number): void {
  if (state.flash?.n === n) set({ flash: null });
}

/** Opens quick select on a session's terminal (again = close). */
export function toggleQuickSelect(sessionId: string): void {
  set({ picking: state.picking === sessionId ? null : sessionId });
}

/** Closes quick select (only if it is open on `sessionId`, when given). */
export function closeQuickSelect(sessionId?: string): void {
  if (state.picking && (sessionId === undefined || state.picking === sessionId)) set({ picking: null });
}

/** Copies the last agent reply of a Claude/Codex session and confirms over its terminal. */
export async function copyLastReply(sessionId: string): Promise<void> {
  let text: string | null = null;
  try {
    text = await api.lastReply(sessionId);
  } catch {
    // treated as "nothing to copy"
  }
  if (!text) return flash(sessionId, 'noReply');
  api.copyText(text);
  flash(sessionId, 'copied');
}
