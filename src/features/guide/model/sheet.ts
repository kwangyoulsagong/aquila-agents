import type { Translate } from '@/shared/i18n';
import { projectIndex, shortcutLabel, type Platform, type ShortcutId } from '@/shared/lib/shortcuts';

type Key = Parameters<Translate>[0];

interface SheetRow {
  id: string;
  labelKey: Key;
  /** `project1` + `project9` is shown as one range. */
  ids: readonly ShortcutId[];
}

/** The full shortcut sheet. A test checks it lists every shortcut of the map exactly once. */
export const SHEET: readonly { titleKey: Key; rows: readonly SheetRow[] }[] = [
  {
    titleKey: 'guide.group.general',
    rows: [
      { id: 'palette', labelKey: 'shortcut.palette', ids: ['palette'] },
      { id: 'guide', labelKey: 'shortcut.guide', ids: ['guide'] },
      { id: 'nextWaiting', labelKey: 'attention.next', ids: ['nextWaiting'] },
      { id: 'toggleChanges', labelKey: 'changes.toggle', ids: ['toggleChanges'] },
      { id: 'history', labelKey: 'history.title', ids: ['history'] },
    ],
  },
  {
    titleKey: 'guide.group.sessions',
    rows: [
      { id: 'openClaude', labelKey: 'action.openClaude', ids: ['openClaude'] },
      { id: 'openCodex', labelKey: 'action.openCodex', ids: ['openCodex'] },
      { id: 'openShell', labelKey: 'palette.openShell', ids: ['openShell'] },
      { id: 'closeSession', labelKey: 'action.closeSession', ids: ['closeSession'] },
      { id: 'project', labelKey: 'shortcut.project', ids: ['project1', 'project9'] },
    ],
  },
  {
    titleKey: 'guide.group.panes',
    rows: [
      { id: 'splitRight', labelKey: 'palette.splitRight', ids: ['splitRight'] },
      { id: 'splitDown', labelKey: 'palette.splitDown', ids: ['splitDown'] },
      {
        id: 'focus',
        labelKey: 'shortcut.focus',
        ids: ['focusLeft', 'focusRight', 'focusUp', 'focusDown'],
      },
      { id: 'zoomPane', labelKey: 'action.zoomPane', ids: ['zoomPane'] },
      {
        id: 'resize',
        labelKey: 'shortcut.resize',
        ids: ['resizeLeft', 'resizeRight', 'resizeUp', 'resizeDown'],
      },
    ],
  },
];

/** Every shortcut a list of ids stands for (`project1` + `project9` → `project1`…`project9`). */
export function expandIds(ids: readonly ShortcutId[]): ShortcutId[] {
  const first = ids.length === 2 ? projectIndex(ids[0]) : null;
  const last = ids.length === 2 ? projectIndex(ids[1]) : null;
  if (first === null || last === null) return [...ids];
  const out: ShortcutId[] = [];
  for (let i = first; i <= last; i++) out.push(`project${i + 1}` as ShortcutId);
  return out;
}

/** Key labels for a list of ids: `['⌘T', '⇧⌘T']`, or one `⌘1–⌘9` for a project range. */
export function shortcutKeys(ids: readonly ShortcutId[], platform?: Platform): string[] {
  if (ids.length === 2 && projectIndex(ids[0]) !== null && projectIndex(ids[1]) !== null)
    return [`${shortcutLabel(ids[0], platform)}–${shortcutLabel(ids[1], platform)}`];
  return ids.map((id) => shortcutLabel(id, platform));
}

/** The sheet with labels and keys, ready for `ShortcutSheet`. */
export function buildSheet(t: Translate, platform?: Platform) {
  return SHEET.map((g) => ({
    title: t(g.titleKey),
    rows: g.rows.map((r) => ({ id: r.id, label: t(r.labelKey), keys: shortcutKeys(r.ids, platform) })),
  }));
}
