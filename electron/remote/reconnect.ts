// Reconnect policy for one remote session (T29): 3 → 6 → 12 → 60 s, then every 60 s until it works or the tab
// closes. A connection counts as up once ssh has stayed alive for `STABLE_MS` (ssh prints its own errors, so
// "got output" doesn't mean connected). After `LOST_AFTER` failed attempts the state is "lost" (banner), but it
// keeps retrying.
import type { ConnectionState } from '../../src/shared/api/types';

export const RECONNECT_DELAYS_MS = [3_000, 6_000, 12_000, 60_000];
export const STABLE_MS = 2_500;
export const LOST_AFTER = 3;

/** Delay before attempt `n` (0-based) after a drop. */
export const delayFor = (attempt: number): number =>
  RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
  now: () => Date.now(),
};

export class Reconnector {
  private failures = 0;
  private stableTimer: unknown = null;
  private retryTimer: unknown = null;
  private disposed = false;
  state: ConnectionState = 'connecting';
  retryAt: number | undefined;

  constructor(
    /** Spawn ssh again. */
    private readonly connect: () => void,
    private readonly onState: (state: ConnectionState, retryAt?: number) => void,
    private readonly timers: Timers = realTimers,
  ) {}

  /** ssh was (re)spawned. */
  spawned(): void {
    if (this.disposed) return;
    this.clearTimers();
    this.retryAt = undefined;
    this.set(this.failures >= LOST_AFTER ? 'lost' : this.failures > 0 ? 'reconnecting' : 'connecting');
    this.stableTimer = this.timers.set(() => {
      this.stableTimer = null;
      this.failures = 0;
      this.set('connected');
    }, STABLE_MS);
  }

  /** ssh exited with its own error: schedule the next attempt. */
  dropped(): void {
    if (this.disposed) return;
    this.clearTimers();
    const wait = delayFor(this.failures);
    this.failures++;
    this.retryAt = this.timers.now() + wait;
    this.set(this.failures >= LOST_AFTER ? 'lost' : 'reconnecting');
    this.retryTimer = this.timers.set(() => {
      this.retryTimer = null;
      this.retryAt = undefined;
      this.connect();
    }, wait);
  }

  /** Waiting for a retry (no ssh running). */
  get waiting(): boolean {
    return this.retryTimer !== null;
  }

  /** "Reconnect now": skip the wait. Only while waiting. */
  now(): boolean {
    if (this.disposed || this.retryTimer === null) return false;
    this.timers.clear(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = undefined;
    this.connect();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  private set(state: ConnectionState): void {
    this.state = state;
    this.onState(state, this.retryAt);
  }

  private clearTimers(): void {
    if (this.stableTimer !== null) this.timers.clear(this.stableTimer);
    if (this.retryTimer !== null) this.timers.clear(this.retryTimer);
    this.stableTimer = this.retryTimer = null;
  }
}
