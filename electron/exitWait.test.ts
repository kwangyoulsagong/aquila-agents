import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForExits, type Exitable } from './exitWait';

function fakePty(exitOn: string[] = []) {
  const listeners = new Set<() => void>();
  const kills: (string | undefined)[] = [];
  const p: Exitable & { exit: () => void; kills: typeof kills; listeners: typeof listeners } = {
    kills,
    listeners,
    onExit: (l) => {
      listeners.add(l);
      return { dispose: () => listeners.delete(l) };
    },
    kill: (signal) => {
      kills.push(signal);
      if (signal && exitOn.includes(signal)) p.exit();
    },
    exit: () => [...listeners].forEach((l) => l()),
  };
  return p;
}

describe('waitForExits', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves right away with nothing to wait for', async () => {
    await expect(waitForExits([])).resolves.toBeUndefined();
  });

  it('resolves once every pty has exited, without force-killing', async () => {
    const a = fakePty();
    const b = fakePty();
    let resolved = false;
    void waitForExits([a, b]).then(() => (resolved = true));
    a.exit();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);
    b.exit();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    expect(a.kills).toEqual([]);
    expect(a.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.kills).toEqual([]);
  });

  it('SIGKILLs only the stragglers after the grace period', async () => {
    const quick = fakePty();
    const stubborn = fakePty(['SIGKILL']);
    let resolved = false;
    void waitForExits([quick, stubborn], { graceMs: 100, forceSignal: 'SIGKILL' }).then(
      () => (resolved = true),
    );
    quick.exit();
    await vi.advanceTimersByTimeAsync(100);
    expect(quick.kills).toEqual([]);
    expect(stubborn.kills).toEqual(['SIGKILL']);
    expect(resolved).toBe(true);
  });

  it('gives up after the force period when even SIGKILL gets no exit', async () => {
    const hung = fakePty();
    let resolved = false;
    void waitForExits([hung], { graceMs: 100, forceMs: 50 }).then(() => (resolved = true));
    await vi.advanceTimersByTimeAsync(149);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});
