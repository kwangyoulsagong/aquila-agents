import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/shared/api';
import { BURST, dayLabel, isBurst, tabWork, weekList, type WeekItem } from './week';
import type { GraphView } from './view';

const NOW = new Date(2026, 10, 26, 15, 0).getTime();
const H = 3_600_000;
const node = (id: string, kind: GraphNode['kind'], hoursAgo: number | null): GraphNode => ({
  id,
  kind,
  label: id,
  ...(hoursAgo !== null ? { mtime: NOW - hoursAgo * H } : {}),
});
const edge = (a: string, b: string): GraphEdge => ({
  id: `${a}→${b}`,
  source: a,
  target: b,
  kind: 'action',
  strength: 1,
  reasons: [],
});

const view: GraphView = {
  nodes: [
    node('note:today', 'note', 2),
    node('session:claude:1', 'session', 1),
    node('file:a.ts', 'file', 1),
    node('note:yesterday', 'note', 20),
    node('note:old', 'note', 24 * 10),
    node('tag:x', 'tag', null),
    node('apply:1', 'apply', 40),
  ],
  edges: [
    edge('note:today', 'session:claude:1'),
    edge('session:claude:1', 'file:a.ts'),
    edge('note:old', 'tag:x'),
  ],
};

describe('weekList', () => {
  it('last 7 days, newest first, by local day, with what each touched', () => {
    const { days, counts } = weekList(view, { now: NOW });
    expect(days.map((d) => d.rows.map((i) => (i as WeekItem).node.id))).toEqual([
      ['file:a.ts', 'session:claude:1', 'note:today'],
      ['note:yesterday'],
      ['apply:1'],
    ]);
    expect(counts).toEqual({ all: 5, note: 2, session: 1, file: 1, other: 1 });
    const session = days[0]!.rows[1] as WeekItem;
    expect([session.notes, session.files, session.sessions]).toEqual([1, 1, 0]);
  });

  it('a kind narrows the list but not the counts', () => {
    const { days, counts } = weekList(view, { now: NOW, kind: 'note' });
    expect(days.flatMap((d) => d.rows.map((i) => (i as WeekItem).node.id))).toEqual([
      'note:today',
      'note:yesterday',
    ]);
    expect(counts.all).toBe(5);
  });

  it('"only" with no time limit: one piece of work, however old', () => {
    const { days } = weekList(view, { now: NOW, since: null, only: new Set(['note:old', 'file:a.ts']) });
    expect(days.flatMap((d) => d.rows.map((i) => (i as WeekItem).node.id))).toEqual([
      'file:a.ts',
      'note:old',
    ]);
  });
});

describe('bursts', () => {
  it('many changes in one minute fold into one row; the rest stay rows', () => {
    const pulled = Array.from({ length: BURST + 2 }, (_, i) => ({
      id: `note:p${i}`,
      kind: 'note' as const,
      label: `p${i}`,
      mtime: NOW - 5 * H + i * 1000, // within one minute
    }));
    const v: GraphView = {
      nodes: [node('note:worked', 'note', 1), ...pulled, node('note:other', 'note', 6)],
      edges: [],
    };
    const [day] = weekList(v, { now: NOW }).days;
    expect(day!.count).toBe(BURST + 4);
    expect(day!.rows.map((r) => (isBurst(r) ? `burst ${r.items.length}` : r.node.id))).toEqual([
      'note:worked',
      `burst ${BURST + 2}`,
      'note:other',
    ]);
  });
});

describe('tabWork', () => {
  it("is the tab's conversation and what it touched", () => {
    expect([...tabWork(view, ['session:claude:1'])].sort()).toEqual(
      ['file:a.ts', 'note:today', 'session:claude:1'].sort(),
    );
  });
  it('is empty when the conversation is not in the graph yet', () => {
    expect(tabWork(view, ['session:claude:new']).size).toBe(0);
  });
});

describe('dayLabel', () => {
  const t = (k: string) => (k === 'graph.week.today' ? 'today' : 'yesterday');
  it('today, yesterday, then a date', () => {
    const today = new Date(2026, 10, 26).getTime();
    expect(dayLabel(today, NOW, t, 'en')).toBe('today');
    expect(dayLabel(new Date(2026, 10, 25).getTime(), NOW, t, 'en')).toBe('yesterday');
    expect(dayLabel(new Date(2026, 10, 23).getTime(), NOW, t, 'en')).toMatch(/Nov/);
  });
});
