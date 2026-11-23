import type { VaultConfig, VaultViewData } from '@/shared/api';

// Per-source settings (T69), renderer side: what the settings dialog shows of a config, and the small rules the
// views follow. Validation itself is main's (`electron/graph/vault.ts`); the draft here is only text.

export type VaultSection = 'links' | 'properties' | 'templates' | 'companions' | 'views' | 'actions';

/** A config as text in the settings editor. */
export const formatConfig = (c: VaultConfig) => JSON.stringify(c, null, 2);

/** The draft's JSON, or that it isn't JSON (main validates the rest on save). */
export function parseDraft(text: string): { config: VaultConfig } | { error: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'notObject' };
    return { config: v as VaultConfig };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const nameOf = (x: unknown): string => {
  if (!x || typeof x !== 'object') return '';
  const o = x as Record<string, unknown>;
  const n = o.name ?? o.pattern ?? o.key;
  return typeof n === 'string' ? n : '';
};

/** One line per section: how many and their names (a preview of a preset or Claude's suggestion). */
export function summarize(c: Partial<VaultConfig>): { section: VaultSection; names: string[] }[] {
  const out: { section: VaultSection; names: string[] }[] = [];
  const add = (section: VaultSection, items: unknown[]) => {
    const names = items.map(nameOf).filter(Boolean);
    if (names.length) out.push({ section, names });
  };
  add('links', arr(c.links));
  add('properties', arr(c.properties));
  add('templates', arr(c.templates));
  const folders = arr(c.companions?.folders).filter((f): f is string => typeof f === 'string');
  if (folders.length) out.push({ section: 'companions', names: folders });
  add('views', arr(c.views));
  add('actions', arr(c.actions));
  return out;
}

/** A property value as one line. */
export const cellText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? ''));

/** The group left / right of `key` (keyboard move on a board), or null at the edge. */
export function neighbor(data: VaultViewData, key: string, dir: -1 | 1): string | null {
  const keys = data.groups.map((g) => g.key);
  const i = keys.indexOf(key);
  const j = i + dir;
  return i < 0 || j < 0 || j >= keys.length ? null : keys[j]!;
}

/** Where a card was dragged from (kept in the drag data). */
export const DRAG_TYPE = 'application/x-aquila-card';
