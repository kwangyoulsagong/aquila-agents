import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/shared/api';
import { ago, lensHits } from './lenses';

const DAY = 86_400_000;
const now = 100 * DAY;
const n = (id: string, kind: GraphNode['kind'], mtime?: number): GraphNode => ({
  id,
  kind,
  label: id,
  ...(mtime !== undefined ? { mtime } : {}),
});
const e = (source: string, target: string): GraphEdge => ({
  id: `${source}→${target}`,
  source,
  target,
  kind: 'action',
  strength: 1,
  reasons: [],
});

describe('lensHits', () => {
  it('finds orphans, to-dos, recent sessions and notes the work moved past', () => {
    const view = {
      nodes: [
        n('lonely', 'note'),
        n('spec', 'note', now - 10 * DAY),
        n('fresh', 'note', now - DAY),
        n('s-new', 'session', now - 2 * DAY),
        n('s-old', 'session', now - 30 * DAY),
        n('todo', 'todo'),
      ],
      edges: [e('spec', 's-new'), e('fresh', 's-old'), e('spec', 'todo')],
    };
    const h = lensHits(view, now, new Set(['s-old', 'gone']));
    expect([...h.live]).toEqual(['s-old']);
    expect([...h.orphans]).toEqual(['lonely']);
    expect([...h.todos]).toEqual(['todo']);
    expect([...h.recent]).toEqual(['s-new']);
    expect([...h.untouched]).toEqual(['spec']);
  });
});

describe('ago', () => {
  const t = (k: string, v?: Record<string, string>) => `${k}:${v?.n ?? ''}`;
  it('picks the unit', () => {
    expect(ago(now, now, t, 'en')).toBe('history.ago.now:');
    expect(ago(now - 5 * 60_000, now, t, 'en')).toBe('history.ago.min:5');
    expect(ago(now - 3 * 3_600_000, now, t, 'en')).toBe('history.ago.hour:3');
    expect(ago(now - 2 * DAY, now, t, 'en')).toBe('history.ago.day:2');
  });
});
