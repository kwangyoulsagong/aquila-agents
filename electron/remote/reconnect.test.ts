import { describe, expect, it } from 'vitest';
import { delayFor, Reconnector, STABLE_MS } from './reconnect';

/** Manual clock: timers fire only when `advance` passes them. */
function clock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (h: unknown) => void timers.delete(h as number),
      now: () => now,
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

function setup() {
  const c = clock();
  const states: string[] = [];
  let connects = 0;
  const r = new Reconnector(
    () => {
      connects++;
      r.spawned();
    },
    (s) => states.push(s),
    c.timers,
  );
  return { c, r, states, connects: () => connects };
}

describe('Reconnector', () => {
  it('backs off 3 → 6 → 12 → 60 s and stays at 60', () => {
    expect([0, 1, 2, 3, 4, 9].map(delayFor)).toEqual([3000, 6000, 12000, 60000, 60000, 60000]);
  });

  it('is connected once ssh stays up, and a drop retries after 3 s', () => {
    const { c, r, states, connects } = setup();
    r.spawned();
    c.advance(STABLE_MS);
    expect(r.state).toBe('connected');
    r.dropped();
    expect(r.state).toBe('reconnecting');
    expect(r.retryAt).toBe(STABLE_MS + 3000);
    expect(r.waiting).toBe(true);
    c.advance(2999);
    expect(connects()).toBe(0);
    c.advance(1);
    expect(connects()).toBe(1);
    c.advance(STABLE_MS);
    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'reconnecting', 'connected']);
  });

  it('counts quick failures, shows lost after three, and keeps retrying', () => {
    const { c, r, connects } = setup();
    r.spawned();
    for (const wait of [3000, 6000, 12000]) {
      r.dropped();
      c.advance(wait);
    }
    expect(connects()).toBe(3);
    r.dropped();
    expect(r.state).toBe('lost');
    expect(r.retryAt).toBe(c.timers.now() + 60000);
    c.advance(60000);
    expect(connects()).toBe(4);
    expect(r.state).toBe('lost');
    // It works again: the counter resets.
    c.advance(STABLE_MS);
    expect(r.state).toBe('connected');
    r.dropped();
    expect(r.retryAt).toBe(c.timers.now() + 3000);
  });

  it('reconnects now on request, only while waiting, and never after dispose', () => {
    const { c, r, connects } = setup();
    r.spawned();
    expect(r.now()).toBe(false);
    r.dropped();
    expect(r.now()).toBe(true);
    expect(connects()).toBe(1);
    r.dropped();
    r.dispose();
    c.advance(120_000);
    expect(connects()).toBe(1);
  });
});
