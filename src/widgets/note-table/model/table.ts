import type { VaultCard } from '@/shared/api';

// The table view (T78), pure: which columns a source's notes have, and its rows filtered, sorted and grouped. Runs
// on every keystroke over a few thousand notes, so each note's search text is built once per load (`prepare`).

/** Built-in columns; anything else is a frontmatter key. */
export const TITLE = '@title';
export const FOLDER = '@folder';
export const MODIFIED = '@modified';
/** The property the status chips count. */
export const STATUS = 'status';

export interface Row {
  card: VaultCard;
  folder: string;
  /** Lowercased title, path and values, for the text filter. */
  hay: string;
}

export interface Sort {
  key: string;
  dir: 1 | -1;
}

export interface Filter {
  /** Text in the title, path or any value. */
  text: string;
  /** Only notes in this folder (and below); `''` = the whole source. */
  folder: string;
  /** `key = value` (a list matches when it has the value). */
  prop: { key: string; value: string } | null;
  /** Status chip: only notes with this status. */
  status: string | null;
}

export const emptyFilter = (): Filter => ({ text: '', folder: '', prop: null, status: null });

export type Item = { kind: 'group'; key: string; title: string; count: number } | { kind: 'row'; row: Row };

export const folderOf = (rel: string) => {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
};

/** A value as one line (lists joined with `, `). */
export const cellText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? ''));

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

export function prepare(cards: readonly VaultCard[]): Row[] {
  return cards.map((card) => {
    const vals = Object.values(card.props).map(cellText).join('\u0000');
    return {
      card,
      folder: folderOf(card.rel),
      hay: `${card.title}\u0000${card.rel}\u0000${vals}`.toLowerCase(),
    };
  });
}

/** Frontmatter keys found, the most used first (ties by name). */
export function keysOf(rows: readonly Row[]): string[] {
  const n = new Map<string, number>();
  for (const r of rows) for (const k of Object.keys(r.card.props)) n.set(k, (n.get(k) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

/** Columns shown when nothing is chosen: folder, the five most used keys, modified. */
export function defaultColumns(keys: readonly string[]): string[] {
  return [FOLDER, ...keys.slice(0, 5), MODIFIED];
}

/** Values found for a key (list items counted one by one), the most used first. */
export function valuesOf(rows: readonly Row[], key: string): { value: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const v = r.card.props[key];
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) {
      const t = x.trim();
      if (t) n.set(t, (n.get(t) ?? 0) + 1);
    }
  }
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

const has = (v: string | string[] | undefined, want: string) =>
  Array.isArray(v) ? v.some((x) => x.trim() === want) : (v ?? '').trim() === want;

/** Rows passing every filter but the status chip (the chips count over these). */
export function filterRows(rows: readonly Row[], f: Omit<Filter, 'status'>): Row[] {
  const q = f.text.trim().toLowerCase();
  const pre = f.folder ? `${f.folder}/` : '';
  return rows.filter(
    (r) =>
      (!pre || r.card.rel.startsWith(pre)) &&
      (!q || r.hay.includes(q)) &&
      (!f.prop || has(r.card.props[f.prop.key], f.prop.value)),
  );
}

/** Counts per status value (first value of a list), the most used first; empty when no note has a status. */
export function statusCounts(rows: readonly Row[]): { value: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const s = first(r.card.props[STATUS]);
    if (s) n.set(s, (n.get(s) ?? 0) + 1);
  }
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

export function byStatus(rows: readonly Row[], status: string | null): Row[] {
  return status === null ? (rows as Row[]) : rows.filter((r) => first(r.card.props[STATUS]) === status);
}

/** What a row sorts / groups by for a column. */
export function valueOf(r: Row, key: string): string {
  if (key === TITLE) return r.card.title;
  if (key === FOLDER) return r.folder;
  if (key === MODIFIED) return String(r.card.mtime);
  return cellText(r.card.props[key]).trim();
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sorted copy; empty values last in both directions, then by title. */
export function sortRows(rows: readonly Row[], sort: Sort | null): Row[] {
  const out = [...rows];
  if (!sort)
    return out.sort((a, b) => b.card.mtime - a.card.mtime || collator.compare(a.card.title, b.card.title));
  const { key, dir } = sort;
  const keyed = out.map((r) => ({ r, v: key === MODIFIED ? '' : valueOf(r, key) }));
  keyed.sort((a, b) => {
    if (key === MODIFIED) return dir * (a.r.card.mtime - b.r.card.mtime);
    if (!a.v !== !b.v) return a.v ? -1 : 1;
    return dir * collator.compare(a.v, b.v) || collator.compare(a.r.card.title, b.r.card.title);
  });
  return keyed.map((x) => x.r);
}

/**
 * The flat list the grid draws: rows, or (with `group`) a heading per value followed by its rows. Groups follow
 * their value's order; notes without one come last. `''` = no grouping.
 */
export function groupRows(rows: readonly Row[], group: string): Item[] {
  if (!group) return rows.map((row) => ({ kind: 'row', row }));
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = group === FOLDER ? r.folder : first(r.card.props[group]);
    let list = groups.get(g);
    if (!list) groups.set(g, (list = []));
    list.push(r);
  }
  const keys = [...groups.keys()].sort((a, b) => (!a !== !b ? (a ? -1 : 1) : collator.compare(a, b)));
  const out: Item[] = [];
  for (const key of keys) {
    const list = groups.get(key)!;
    out.push({ kind: 'group', key, title: key, count: list.length });
    for (const row of list) out.push({ kind: 'row', row });
  }
  return out;
}

/** Next sort when a column header is clicked: ascending → descending → none. */
export function nextSort(cur: Sort | null, key: string): Sort | null {
  if (!cur || cur.key !== key) return { key, dir: key === MODIFIED ? -1 : 1 };
  if (cur.dir === (key === MODIFIED ? -1 : 1)) return { key, dir: cur.dir === 1 ? -1 : 1 };
  return null;
}

/** A list value typed into a cell: `a, b` → `['a', 'b']`. */
export const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
