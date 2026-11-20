// Pure helpers for the session history panel (T11): title, filter, group by folder, relative time.
import type { Config, HistoryAgent, HistoryEntry, HistoryRef } from '@/shared/api';
import type { Translate } from '@/shared/i18n';

export type HistoryFilter = 'all' | 'favorites' | HistoryAgent;

/** Same as main's: `agent:id`, plus `@host` for a session on an SSH host (T36). */
export const refKey = (r: HistoryRef) => `${r.agent}:${r.id}${r.host ? `@${r.host}` : ''}`;

/** `refKey` back to a ref (ids never contain `@`). */
export function parseRefKey(key: string): HistoryRef {
  const i = key.indexOf(':');
  const rest = key.slice(i + 1);
  const at = rest.indexOf('@');
  const agent = key.slice(0, i) as HistoryAgent;
  return at < 0 ? { agent, id: rest } : { agent, id: rest.slice(0, at), host: rest.slice(at + 1) };
}

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
  /** Folder + host: the same path on two machines is two groups. */
  key: string;
  cwd: string;
  /** SSH host (T36). */
  host?: string;
  /** Project name (· subfolder), else the folder's last two segments. */
  label: string;
  entries: HistoryEntry[];
}

const tail = (p: string, n: number) => p.split('/').filter(Boolean).slice(-n).join('/');

/** Groups by the folder recorded in the transcript (and host); groups ordered by their most recent session. */
export function groupHistory(entries: readonly HistoryEntry[], config: Config): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const e of entries) {
    const key = e.host ? `${e.host}:${e.cwd}` : e.cwd;
    let g = groups.get(key);
    if (!g) {
      const project = e.projectId ? config.projects.find((p) => p.id === e.projectId) : undefined;
      const base = tail(e.cwd, 1);
      const label = project
        ? tail(project.path, 1) === base
          ? project.name
          : `${project.name} · ${base}`
        : e.host
          ? `${e.host} · ${tail(e.cwd, 1)}`
          : tail(e.cwd, 2);
      g = { key, cwd: e.cwd, ...(e.host ? { host: e.host } : {}), label: label || e.cwd, entries: [] };
      groups.set(key, g);
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
