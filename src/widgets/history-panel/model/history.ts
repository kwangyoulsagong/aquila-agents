// Pure helpers for the session history panel (T11): title, filter, group by folder, relative time.
import type { Config, HistoryAgent, HistoryEntry, HistoryRef } from '@/shared/api';
import type { Translate } from '@/shared/i18n';

export type HistoryFilter = 'all' | 'favorites' | HistoryAgent;

export const refKey = (r: HistoryRef) => `${r.agent}:${r.id}`;

/** Our name, else the CLI's name, else its auto title, else the first message. */
export const historyTitle = (e: HistoryEntry) => e.name || e.title || e.autoTitle || e.firstMessage || e.id;

/**
 * Entries that pass the filter and match the query: as typed (case-insensitive) in the title, first message, folder,
 * branch or id — or a full-text hit from main (`matches`, keyed by `refKey`). Order is kept (most recent first).
 */
export function filterHistory(
  entries: readonly HistoryEntry[],
  query: string,
  filter: HistoryFilter,
  matches: ReadonlyMap<string, string> = new Map(),
): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter === 'favorites' && !e.favorite) return false;
    if ((filter === 'claude' || filter === 'codex') && e.agent !== filter) return false;
    if (!q) return true;
    return matches.has(refKey(e)) || matchesListed(e, q);
  });
}

/** The query (lower-cased) is in what the row and detail show: title, first message, folder, branch or id. */
export function matchesListed(e: HistoryEntry, q: string): boolean {
  return [historyTitle(e), e.title, e.autoTitle, e.firstMessage, e.cwd, e.branch, e.id].some((s) =>
    s?.toLowerCase().includes(q),
  );
}

export interface HistoryGroup {
  cwd: string;
  /** Project name (· subfolder), else the folder's last two segments. */
  label: string;
  entries: HistoryEntry[];
}

const tail = (p: string, n: number) => p.split('/').filter(Boolean).slice(-n).join('/');

/** Groups by the folder recorded in the transcript; groups ordered by their most recent session. */
export function groupHistory(entries: readonly HistoryEntry[], config: Config): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const e of entries) {
    let g = groups.get(e.cwd);
    if (!g) {
      const project = e.projectId ? config.projects.find((p) => p.id === e.projectId) : undefined;
      const base = tail(e.cwd, 1);
      const label = project
        ? tail(project.path, 1) === base
          ? project.name
          : `${project.name} · ${base}`
        : tail(e.cwd, 2);
      g = { cwd: e.cwd, label: label || e.cwd, entries: [] };
      groups.set(e.cwd, g);
    }
    g.entries.push(e);
  }
  return [...groups.values()].sort((a, b) => b.entries[0].updatedAt - a.entries[0].updatedAt);
}

/** "just now", "12 min ago", "3 h ago", "5 d ago", then a date. */
export function relativeTime(ms: number, now: number, t: Translate, locale: string): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return t('history.ago.now');
  if (min < 60) return t('history.ago.min', { n: String(min) });
  const h = Math.floor(min / 60);
  if (h < 24) return t('history.ago.hour', { n: String(h) });
  const d = Math.floor(h / 24);
  if (d < 30) return t('history.ago.day', { n: String(d) });
  return new Date(ms).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Whole days until Claude deletes the transcript, when that's within `warnDays`; null otherwise. */
export function daysLeft(e: HistoryEntry, now: number, warnDays = 7): number | null {
  if (!e.expiresAt) return null;
  const d = Math.max(0, Math.floor((e.expiresAt - now) / 86_400_000));
  return d <= warnDays ? d : null;
}
