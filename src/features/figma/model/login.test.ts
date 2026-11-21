import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { typeWhenSettled, type TypeDeps } from './login';

describe('typeWhenSettled', () => {
  let listener: ((p: { id: string; data: string }) => void) | null;
  let writes: [string, string][];
  let unsubscribed: boolean;
  const deps: TypeDeps = {
    onData: (cb) => {
      listener = cb;
      return () => {
        unsubscribed = true;
      };
    },
    write: (id, data) => writes.push([id, data]),
  };
  beforeEach(() => {
    vi.useFakeTimers();
    listener = null;
    writes = [];
    unsubscribed = false;
  });
  afterEach(() => vi.useRealTimers());

  it('types once the tab has been quiet for a while, ignoring other tabs', async () => {
    const typed = typeWhenSettled('a', '/mcp', deps, { quietMs: 100, maxMs: 5000 });
    listener?.({ id: 'a', data: 'welcome' });
    vi.advanceTimersByTime(80);
    listener?.({ id: 'a', data: 'more' });
    listener?.({ id: 'b', data: 'other' });
    vi.advanceTimersByTime(80);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(30);
    await typed;
    expect(writes).toEqual([['a', '/mcp']]);
    expect(unsubscribed).toBe(true);
  });

  it('types after the cap when the tab never goes quiet or prints nothing', async () => {
    const typed = typeWhenSettled('a', '/mcp', deps, { quietMs: 100, maxMs: 300 });
    vi.advanceTimersByTime(300);
    await typed;
    expect(writes).toEqual([['a', '/mcp']]);
    listener?.({ id: 'a', data: 'late' });
    vi.advanceTimersByTime(500);
    expect(writes).toHaveLength(1);
  });
});
