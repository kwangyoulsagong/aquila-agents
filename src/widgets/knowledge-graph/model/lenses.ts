import type { GraphView } from './view';

// Lenses: the questions people actually open a whole-vault graph for (forum.obsidian.md threads on "what do you
// use the graph view for": stragglers with no links, what's unfinished, what changed lately). Each lights the
// nodes that answer it on the map; everything else fades.

export type LensId = 'orphans' | 'todos' | 'recent' | 'untouched';
export const LENSES: readonly LensId[] = ['untouched', 'todos', 'orphans', 'recent'];

const DAY = 86_400_000;
/** "Recent" sessions: this far back. */
export const RECENT_DAYS = 7;

/** Node ids per lens, over the filtered view. */
export function lensHits(view: GraphView, now = Date.now()): Record<LensId, Set<string>> {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const linked = new Set<string>();
  for (const e of view.edges) {
    linked.add(e.source);
    linked.add(e.target);
  }
  const out: Record<LensId, Set<string>> = {
    orphans: new Set(),
    todos: new Set(),
    recent: new Set(),
    untouched: new Set(),
  };
  for (const n of view.nodes) {
    if (n.kind === 'note' && !linked.has(n.id)) out.orphans.add(n.id);
    if (n.kind === 'todo') out.todos.add(n.id);
    if (n.kind === 'session' && (n.mtime ?? 0) >= now - RECENT_DAYS * DAY) out.recent.add(n.id);
  }
  // A note a session worked from (or changed) after the note itself was last edited: the work moved on, the note
  // may not say so yet.
  for (const e of view.edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const [note, session] =
      a.kind === 'note' && b.kind === 'session'
        ? [a, b]
        : b.kind === 'note' && a.kind === 'session'
          ? [b, a]
          : [];
    if (note && session && (session.mtime ?? 0) > (note.mtime ?? 0) + DAY) out.untouched.add(note.id);
  }
  return out;
}

type T = (
  key: 'history.ago.now' | 'history.ago.min' | 'history.ago.hour' | 'history.ago.day',
  vars?: Record<string, string>,
) => string;

/** "3일 전" / "3 days ago"; past 30 days a short date. */
export function ago(ms: number, now: number, t: T, locale: string): string {
  const min = Math.floor(Math.max(0, now - ms) / 60_000);
  if (min < 1) return t('history.ago.now');
  if (min < 60) return t('history.ago.min', { n: String(min) });
  const h = Math.floor(min / 60);
  if (h < 24) return t('history.ago.hour', { n: String(h) });
  const d = Math.floor(h / 24);
  if (d < 30) return t('history.ago.day', { n: String(d) });
  return new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
