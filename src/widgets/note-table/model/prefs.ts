import type { Sort } from './table';

// What the table view remembers per source (columns, sort, grouping) and which source it showed last. Browser
// storage only: losing it just means the defaults again.

export interface TablePrefs {
  /** Columns shown, in order; null = the defaults for the source's keys. */
  cols: string[] | null;
  sort: Sort | null;
  /** Group by this column; `''` = none. */
  group: string;
}

const LAST = 'aquila.table.source';
const key = (sourceId: string) => `aquila.table.${sourceId}`;

export const defaultPrefs = (): TablePrefs => ({ cols: null, sort: null, group: '' });

export function readPrefs(sourceId: string): TablePrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(sourceId)) ?? 'null');
    if (!raw || typeof raw !== 'object') return defaultPrefs();
    const o = raw as Record<string, unknown>;
    const cols = Array.isArray(o.cols) ? o.cols.filter((c): c is string => typeof c === 'string') : null;
    const s = o.sort as Record<string, unknown> | null | undefined;
    const sort =
      s && typeof s.key === 'string' && (s.dir === 1 || s.dir === -1) ? { key: s.key, dir: s.dir as 1 | -1 } : null;
    return { cols, sort, group: typeof o.group === 'string' ? o.group : '' };
  } catch {
    return defaultPrefs();
  }
}

export function writePrefs(sourceId: string, p: TablePrefs): void {
  try {
    localStorage.setItem(key(sourceId), JSON.stringify(p));
  } catch {
    // not remembered
  }
}

export function readLastSource(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

export function writeLastSource(id: string): void {
  try {
    localStorage.setItem(LAST, id);
  } catch {
    // not remembered
  }
}
