import type { Translate } from '@/shared/i18n';
import { fuzzyMatch } from '@/shared/lib/fuzzy';
import { shortcutLabel } from '@/shared/lib/shortcuts';
import { SHORTCUTS_ITEM, type GuideItem } from './registry';
import { buildSheet, shortcutKeys } from './sheet';

/** Below any title match (fuzzy scores are small positive or negative numbers), and finite so the sort can subtract. */
const BODY_SCORE = -1e6;

export interface GuideEntry {
  item: GuideItem;
  title: string;
  body: string;
  keys: string[];
}

/** Items with their text in the current language (bodies get the palette's shortcut from the map). */
export function guideEntries(items: readonly GuideItem[], t: Translate): GuideEntry[] {
  const vars = { palette: shortcutLabel('palette') };
  return items.map((item) => ({
    item,
    title: t(item.titleKey),
    body: t(item.bodyKey, vars),
    keys: item.shortcuts ? shortcutKeys(item.shortcuts) : [],
  }));
}

/**
 * Entries matching `query`, best first: fuzzy on the title, then (below every title match) the body containing the
 * query as typed, case-insensitive. The shortcut sheet also matches on every shortcut's name ("zoom" finds it too).
 * An empty query keeps the registry order.
 */
export function searchGuide(entries: readonly GuideEntry[], query: string, t: Translate): GuideEntry[] {
  const q = query.trim();
  if (!q) return [...entries];
  const needle = q.toLocaleLowerCase();
  const sheetText = buildSheet(t)
    .flatMap((g) => g.rows.map((r) => r.label))
    .join(' · ');
  const scored: { e: GuideEntry; score: number; order: number }[] = [];
  entries.forEach((e, order) => {
    const onTitle = fuzzyMatch(q, e.title);
    if (onTitle) {
      scored.push({ e, score: onTitle.score, order });
      return;
    }
    const detail = e.item.id === SHORTCUTS_ITEM ? `${e.body} · ${sheetText}` : e.body;
    if (detail.toLocaleLowerCase().includes(needle)) scored.push({ e, score: BODY_SCORE, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.e);
}
