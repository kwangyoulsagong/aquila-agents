import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pasteWhenReady, type PasteDeps } from './paste';

const T = { quietMs: 100, maxMs: 1000, trustMs: 5000 };

function fakeTab() {
  let cb: ((p: { id: string; data: string }) => void) | null = null;
  const writes: string[] = [];
  const deps: PasteDeps = {
    onData: (f) => {
      cb = f;
      return () => (cb = null);
    },
    write: (_id, d) => writes.push(d),
  };
  return { deps, writes, emit: (data: string, id = 't1') => cb?.({ id, data }), listening: () => !!cb };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pasteWhenReady', () => {
  it('pastes bracketed once the output settles', async () => {
    const tab = fakeTab();
    const p = pasteWhenReady('t1', 'steps', tab.deps, T);
    tab.emit('\x1b[2J╭ Claude Code ╮');
    tab.emit('other tab', 't2');
    await vi.advanceTimersByTimeAsync(150);
    expect(tab.writes).toEqual(['\x1b[200~steps\x1b[201~']);
    await expect(p).resolves.toBe(true);
    expect(tab.listening()).toBe(false);
  });

  it('strips control characters, so text from a feed cannot end the bracketed paste early', async () => {
    const tab = fakeTab();
    const p = pasteWhenReady('t1', 'a\x1b[201~rm -rf ~\r\x03b', tab.deps, T);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe(true);
    expect(tab.writes).toEqual(['\x1b[200~a[201~rm -rf ~\rb\x1b[201~']);
  });

  it('pastes after the cap when the CLI stays silent', async () => {
    const tab = fakeTab();
    const p = pasteWhenReady('t1', 'steps', tab.deps, T);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe(true);
  });

  it('waits through the trust question (drawn without spaces) until the user answered', async () => {
    const tab = fakeTab();
    const p = pasteWhenReady('t1', 'steps', tab.deps, T);
    tab.emit('Quick\x1b[1Csafety\x1b[1Ccheck:\x1b[1CIs\x1b[1Cthis\x1b[1Ca\x1b[1Cproject…\r\n');
    tab.emit('❯ No, exit\r\n  Yes, I trust this folder');
    await vi.advanceTimersByTimeAsync(3000); // past maxMs: still waiting
    expect(tab.writes).toEqual([]);
    tab.emit('\x1b[2J╭ Claude Code ╮ > ');
    await vi.advanceTimersByTimeAsync(150);
    expect(tab.writes).toHaveLength(1);
    await expect(p).resolves.toBe(true);
  });

  it('gives up when the trust question is never answered', async () => {
    const tab = fakeTab();
    const p = pasteWhenReady('t1', 'steps', tab.deps, T);
    tab.emit('Do you trust the files in this folder?');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe(false);
    expect(tab.writes).toEqual([]);
  });
});
