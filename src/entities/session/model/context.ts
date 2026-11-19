import { useSyncExternalStore } from 'react';
import { api, type ContextUpdate, type ContextUsage } from '@/shared/api';

/** From here the gauge shows its number and turns orange: time to think about /compact. */
export const CONTEXT_HINT = 60;
/** Auto-compact is close. */
export const CONTEXT_DANGER = 85;

export function contextTone(percent: number): 'default' | 'warn' | 'danger' {
  return percent >= CONTEXT_DANGER ? 'danger' : percent >= CONTEXT_HINT ? 'warn' : 'default';
}

/** Latest context use per tab, applied in order. */
export function applyContext(
  map: ReadonlyMap<string, ContextUsage>,
  updates: ContextUpdate[],
): Map<string, ContextUsage> {
  const next = new Map(map);
  for (const u of updates) {
    if (u.usage) next.set(u.id, u.usage);
    else next.delete(u.id);
  }
  return next;
}

// One subscription for all tabs, started by the first gauge.
let usage: Map<string, ContextUsage> = new Map();
const listeners = new Set<() => void>();
let started = false;

function emit(updates: ContextUpdate[]): void {
  usage = applyContext(usage, updates);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  if (!started) {
    started = true;
    api.onContext((u) => emit([u]));
    api
      .contextUsage()
      .then(emit)
      .catch(() => {});
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Context use of one tab; undefined until its Claude reports (or when the user has their own statusline). */
export function useContextUsage(id: string): ContextUsage | undefined {
  return useSyncExternalStore(subscribe, () => usage.get(id));
}
