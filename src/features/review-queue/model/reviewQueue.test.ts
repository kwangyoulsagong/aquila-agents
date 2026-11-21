import { describe, expect, it } from 'vitest';
import type { Session, SessionStatus } from '@/shared/api';
import { nextReview, reconcileReview, type ReviewEntry } from './reviewQueue';

const session = (id: string, status: SessionStatus, since?: number): Session =>
  ({ id, projectId: 'p', kind: 'claude', status, since }) as Session;

const statuses = (list: Session[]) => new Map(list.map((s) => [s.id, s.status]));
const none = new Set<string>();

describe('reconcileReview', () => {
  it('adds sessions that finish off screen, oldest first', () => {
    const before = [session('a', 'working'), session('b', 'working'), session('c', 'working')];
    const after = [session('a', 'done', 20), session('b', 'done', 10), session('c', 'done', 30)];
    const q = reconcileReview([], statuses(before), after, new Set(['c']), 99);
    expect(q).toEqual([
      { id: 'b', at: 10 },
      { id: 'a', at: 20 },
    ]);
  });

  it('viewing one removes only that one', () => {
    const list = [session('a', 'done', 10), session('b', 'done', 20)];
    const q: ReviewEntry[] = [
      { id: 'a', at: 10 },
      { id: 'b', at: 20 },
    ];
    expect(reconcileReview(q, statuses(list), list, new Set(['a']), 99)).toEqual([{ id: 'b', at: 20 }]);
  });

  it('a session already done before does not come back after it was seen', () => {
    const list = [session('a', 'done', 10)];
    expect(reconcileReview([], statuses(list), list, none, 99)).toEqual([]);
  });

  it('stays after main clears done to idle, leaves when it runs again or the tab closes', () => {
    const q: ReviewEntry[] = [
      { id: 'a', at: 10 },
      { id: 'b', at: 20 },
    ];
    const prev = statuses([session('a', 'done'), session('b', 'done')]);
    expect(reconcileReview(q, prev, [session('a', 'idle'), session('b', 'done')], none, 99)).toEqual(q);
    expect(reconcileReview(q, prev, [session('a', 'working')], none, 99)).toEqual([]);
  });

  it('a session done while on screen never joins', () => {
    const q = reconcileReview([], statuses([session('a', 'working')]), [session('a', 'done', 5)], new Set(['a']), 9);
    expect(q).toEqual([]);
  });

  it('falls back to now without since', () => {
    const q = reconcileReview([], statuses([session('a', 'working')]), [session('a', 'done')], none, 42);
    expect(q).toEqual([{ id: 'a', at: 42 }]);
  });
});

describe('nextReview', () => {
  const q: ReviewEntry[] = [
    { id: 'a', at: 1 },
    { id: 'b', at: 2 },
  ];
  it('goes to the oldest, then cycles', () => {
    expect(nextReview(q, null)).toBe('a');
    expect(nextReview(q, 'a')).toBe('b');
    expect(nextReview(q, 'b')).toBe('a');
    expect(nextReview([], 'a')).toBeNull();
  });
});
