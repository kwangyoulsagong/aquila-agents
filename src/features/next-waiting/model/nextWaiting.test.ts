import { describe, expect, it } from 'vitest';
import type { Session } from '@/shared/api';
import { attentionQueue, nextWaiting } from './nextWaiting';

const s = (id: string, status: Session['status'], extra: Partial<Session> = {}): Session => ({
  id,
  projectId: 'p',
  kind: 'claude',
  status,
  ...extra,
});

describe('attentionQueue', () => {
  it('orders waiting > error > done and leaves the rest out', () => {
    const list = [s('d', 'done'), s('w', 'working'), s('e', 'error'), s('q', 'waiting'), s('i', 'idle')];
    expect(attentionQueue(list).map((x) => x.id)).toEqual(['q', 'e', 'd']);
  });
  it('puts the one that has waited longest first within a tier', () => {
    const list = [s('a', 'waiting', { since: 300 }), s('b', 'waiting', { since: 100 }), s('c', 'waiting')];
    expect(attentionQueue(list).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
  it('skips exited sessions and exit errors', () => {
    const list = [
      s('x', 'error', { reason: 'exit' }),
      s('y', 'done', { exited: true }),
      s('z', 'error', { reason: 'rateLimit' }),
    ];
    expect(attentionQueue(list).map((x) => x.id)).toEqual(['z']);
  });
});

describe('nextWaiting', () => {
  const list = [s('d', 'done'), s('q', 'waiting', { since: 1 }), s('e', 'error')];
  it('goes to the head of the queue from a session that is not in it', () => {
    expect(nextWaiting(list, null)).toBe('q');
    expect(nextWaiting([...list, s('w', 'working')], 'w')).toBe('q');
  });
  it('cycles through the queue and wraps', () => {
    expect(nextWaiting(list, 'q')).toBe('e');
    expect(nextWaiting(list, 'e')).toBe('d');
    expect(nextWaiting(list, 'd')).toBe('q');
  });
  it('is null when nothing needs the user', () => {
    expect(nextWaiting([s('w', 'working'), s('i', 'idle')], 'w')).toBeNull();
  });
});
