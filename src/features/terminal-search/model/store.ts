// Which session's find bar is open (T40). The workspace opens it on the focused session (⌘F, palette); the
// `TerminalSearch` of that session shows the bar. One bar at a time, like quick select.
import { useSyncExternalStore } from 'react';

interface State {
  /** Session whose find bar is open. */
  open: string | null;
  /** Bumped on every open, so ⌘F on an open bar focuses and selects its query again. */
  n: number;
}

let state: State = { open: null, n: 0 };
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

export const findState = (): State => state;

export function useFindState(): State {
  return useSyncExternalStore(subscribe, findState);
}

/** Opens the find bar on a session's terminal (already open there: focuses its query). */
export function openFind(sessionId: string): void {
  set({ open: sessionId, n: state.n + 1 });
}

/** Closes the find bar (only if it is open on `sessionId`, when given). */
export function closeFind(sessionId?: string): void {
  if (state.open && (sessionId === undefined || state.open === sessionId)) set({ open: null });
}
