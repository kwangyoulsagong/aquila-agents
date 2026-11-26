import type { GraphNode } from '@/shared/api';
import type { GraphView } from './view';

// "This week" (T74): what changed lately as a list, newest first, by day — the question people open a graph for
// most ("what did I / the AI work on?") is answered faster by a list than by a drawing. "This tab" narrows it to
// the work of the tab in front: its conversation and what it touched.

export type WeekKind = 'note' | 'session' | 'file' | 'other';
export const WEEK_KINDS: readonly WeekKind[] = ['note', 'session', 'file', 'other'];
export const WEEK_DAYS = 7;
const DAY = 86_400_000;

export const weekKind = (n: GraphNode): WeekKind =>
  n.kind === 'note' || n.kind === 'session' || n.kind === 'file' ? n.kind : 'other';

export interface WeekItem {
  node: GraphNode;
  kind: WeekKind;
  /** Linked notes / sessions / files (what it touched or what touched it), for the meta line. */
  notes: number;
  sessions: number;
  files: number;
}

/**
 * Many files changed in the same minute: a checkout, a pull, a format run — not work to read one by one. Folded
 * into one row (opened on demand) so it doesn't bury what was actually worked on.
 */
export interface WeekBurst {
  burst: true;
  /** Start of the minute. */
  at: number;
  items: WeekItem[];
}
export const BURST = 8;

export interface WeekDay {
  /** Local midnight of the day. */
  start: number;
  /** Newest first; bursts in place of their items. */
  rows: (WeekItem | WeekBurst)[];
  /** Items in the day (bursts counted by their items). */
  count: number;
}

export const isBurst = (r: WeekItem | WeekBurst): r is WeekBurst => 'burst' in r;

export interface WeekList {
  days: WeekDay[];
  /** Per kind before the kind filter (the chips' numbers); `all` = every item. */
  counts: Record<WeekKind | 'all', number>;
}

const midnight = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Items with a time, newest first, grouped by local day. `since` null: any time (the "This tab" list, which is about
 * one piece of work, not a week). `only`: just these node ids. `kind`: one kind (the chip).
 */
export function weekList(
  view: GraphView,
  {
    now = Date.now(),
    since = now - WEEK_DAYS * DAY,
    only = null,
    kind = null,
  }: { now?: number; since?: number | null; only?: ReadonlySet<string> | null; kind?: WeekKind | null } = {},
): WeekList {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const links = new Map<string, { notes: number; sessions: number; files: number }>();
  const bump = (id: string, other: GraphNode | undefined) => {
    if (!other) return;
    const l = links.get(id) ?? { notes: 0, sessions: 0, files: 0 };
    if (other.kind === 'note') l.notes++;
    else if (other.kind === 'session') l.sessions++;
    else if (other.kind === 'file') l.files++;
    links.set(id, l);
  };
  for (const e of view.edges) {
    bump(e.source, byId.get(e.target));
    bump(e.target, byId.get(e.source));
  }
  const counts: WeekList['counts'] = { all: 0, note: 0, session: 0, file: 0, other: 0 };
  const items: WeekItem[] = [];
  for (const n of view.nodes) {
    if (!n.mtime || (since !== null && n.mtime < since) || n.mtime > now + DAY) continue;
    if (only && !only.has(n.id)) continue;
    const k = weekKind(n);
    counts[k]++;
    counts.all++;
    if (kind && k !== kind) continue;
    items.push({ node: n, kind: k, ...(links.get(n.id) ?? { notes: 0, sessions: 0, files: 0 }) });
  }
  items.sort((a, b) => b.node.mtime! - a.node.mtime! || a.node.label.localeCompare(b.node.label));
  // By local day; within a day, runs of the same minute long enough to be a checkout or a pull fold into a burst.
  const minute = (it: WeekItem) => Math.floor(it.node.mtime! / 60_000) * 60_000;
  const days: WeekDay[] = [];
  let run: WeekItem[] = [];
  const flush = () => {
    const day = days[days.length - 1];
    if (!day || !run.length) return;
    if (run.length >= BURST) day.rows.push({ burst: true, at: minute(run[0]!), items: run });
    else day.rows.push(...run);
    run = [];
  };
  for (const it of items) {
    const start = midnight(it.node.mtime!);
    if (days[days.length - 1]?.start !== start) {
      flush();
      days.push({ start, rows: [], count: 0 });
    } else if (run.length && minute(run[0]!) !== minute(it)) flush();
    days[days.length - 1]!.count++;
    run.push(it);
  }
  flush();
  return { days, counts };
}

/**
 * The work of one tab: its conversation's node(s) and what they touched (notes sent or changed, files changed, the
 * trend decision it ran). Empty when the tab's conversation hasn't touched a note yet (it isn't in the graph).
 */
export function tabWork(view: GraphView, sessionIds: readonly string[]): Set<string> {
  const out = new Set(sessionIds.filter((id) => view.nodes.some((n) => n.id === id)));
  if (!out.size) return out;
  const seeds = new Set(out);
  for (const e of view.edges) {
    if (seeds.has(e.source)) out.add(e.target);
    if (seeds.has(e.target)) out.add(e.source);
  }
  return out;
}

type T = (key: 'graph.week.today' | 'graph.week.yesterday') => string;

/** "오늘" / "어제" / "11월 24일 (월)". */
export function dayLabel(start: number, now: number, t: T, locale: string): string {
  const today = midnight(now);
  if (start === today) return t('graph.week.today');
  if (start === midnight(today - DAY / 2)) return t('graph.week.yesterday');
  return new Date(start).toLocaleDateString(locale, { month: 'short', day: 'numeric', weekday: 'short' });
}
