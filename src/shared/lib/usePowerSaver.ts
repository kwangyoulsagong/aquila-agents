import { useSyncExternalStore } from 'react';
import { api } from '@/shared/api';

// One subscription for the whole renderer; components read `saver` through the hook.
let saver = false;
const listeners = new Set<() => void>();
let started = false;

function start(): void {
  if (started) return;
  started = true;
  const set = (next: boolean) => {
    if (next === saver) return;
    saver = next;
    for (const l of listeners) l();
  };
  void api.powerState().then((s) => set(s.saver));
  api.onPower((s) => set(s.saver));
}

function subscribe(cb: () => void): () => void {
  start();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** True while main says to use less power (on battery, throttled or hot — T9). */
export function usePowerSaver(): boolean {
  return useSyncExternalStore(subscribe, () => saver);
}

/** Polling interval for the current power profile: 3× longer in saver mode. */
export function usePollInterval(ms: number): number {
  return usePowerSaver() ? ms * 3 : ms;
}
