// Note explorer (T83): the right-click menu, the view menu and the keys as data, so they can be tested without the
// native menu. Every item's `id` is the action it runs — the same action the hover buttons and the keys dispatch.
import type { ContextMenuItem, NoteFsLinks, NoteFsPrefs } from '@/shared/api';
import type { Translate } from '@/shared/i18n';

export type ExplorerAction =
  'newNote' | 'newFolder' | 'rename' | 'move' | 'pin' | 'finder' | 'open' | 'copy' | 'copyRel' | 'trash';

export const EXPLORER_ACTIONS: readonly ExplorerAction[] = [
  'newNote',
  'newFolder',
  'rename',
  'move',
  'pin',
  'finder',
  'open',
  'copy',
  'copyRel',
  'trash',
];

export const isExplorerAction = (id: string | null): id is ExplorerAction =>
  !!id && (EXPLORER_ACTIONS as readonly string[]).includes(id);

/** What was right-clicked: a note, a folder, several selected rows, or the tree's empty space (the source root). */
export type MenuTarget =
  | { kind: 'file'; pinned: boolean }
  | { kind: 'folder' }
  | { kind: 'multi'; count: number; folder: boolean }
  | { kind: 'empty' };

/** Keys (while the tree has focus) → actions. `accelerator` is how the menu shows the same key. */
export const KEY_ACTIONS: readonly {
  key: string;
  mod: boolean;
  action: ExplorerAction;
  accelerator?: string;
}[] = [
  { key: 'F2', mod: false, action: 'rename', accelerator: 'F2' },
  { key: 'Backspace', mod: true, action: 'trash', accelerator: 'CommandOrControl+Backspace' },
  { key: 'Delete', mod: false, action: 'trash' },
  { key: 'n', mod: true, action: 'newNote', accelerator: 'CommandOrControl+N' },
];

/** The action a key runs in the tree, or null. `KeyN` by code so it works on any layout (Korean too). */
export function keyAction(e: {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}): ExplorerAction | null {
  const mod = !!(e.metaKey || e.ctrlKey);
  const key = e.code === 'KeyN' ? 'n' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.shiftKey) return null;
  return KEY_ACTIONS.find((k) => k.key === key && k.mod === mod)?.action ?? null;
}

const accel = (a: ExplorerAction) => KEY_ACTIONS.find((k) => k.action === a && k.accelerator)?.accelerator;

/** Hover buttons on a row, in order (the "more" button opens the menu below). */
export const HOVER_ACTIONS: Readonly<Record<'folder' | 'file', readonly ExplorerAction[]>> = {
  folder: ['newNote', 'newFolder'],
  file: [],
};

export const ACTION_LABEL: Readonly<Record<ExplorerAction, Parameters<Translate>[0]>> = {
  newNote: 'explorer.newNote',
  newFolder: 'explorer.newFolder',
  rename: 'explorer.rename',
  move: 'explorer.moveTo',
  pin: 'explorer.pin',
  finder: 'explorer.finder',
  open: 'explorer.openDefault',
  copy: 'explorer.copyPath',
  copyRel: 'explorer.copyRel',
  trash: 'explorer.delete',
};

/** The right-click menu for a target. Item ids are `ExplorerAction`s. */
export function menuTemplate(target: MenuTarget, t: Translate): ContextMenuItem[] {
  const item = (id: ExplorerAction, enabled = true, label = t(ACTION_LABEL[id])): ContextMenuItem => {
    const a = accel(id);
    return { id, label, ...(enabled ? {} : { enabled: false }), ...(a ? { accelerator: a } : {}) };
  };
  const sep: ContextMenuItem = { separator: true };
  if (target.kind === 'empty') return [item('newNote'), item('newFolder'), sep, item('finder'), item('copy')];
  const one = target.kind !== 'multi';
  const file = target.kind === 'file' || (target.kind === 'multi' && !target.folder);
  return [
    item('newNote'),
    item('newFolder'),
    sep,
    item('rename', one),
    item('move'),
    ...(target.kind === 'file'
      ? [item('pin', true, target.pinned ? t('explorer.unpin') : t('explorer.pin'))]
      : []),
    sep,
    item('finder', one),
    ...(file ? [item('open', one)] : []),
    item('copy'),
    item('copyRel'),
    sep,
    item('trash'),
  ];
}

export type ViewAction = 'view:group' | 'view:folderNotes' | 'view:compact' | `links:${NoteFsLinks}`;

/** The explorer's ⋯ menu: view toggles (per source) and what to do about links after a rename / move. */
export function viewMenuTemplate(prefs: NoteFsPrefs, t: Translate): ContextMenuItem[] {
  const links = prefs.links ?? 'ask';
  return [
    { id: 'view:group', label: t('explorer.groupStatus'), checked: prefs.group === 'status' },
    { id: 'view:folderNotes', label: t('explorer.folderNotes'), checked: prefs.folderNotes !== false },
    { id: 'view:compact', label: t('explorer.compact'), checked: prefs.compact !== false },
    { separator: true },
    {
      label: t('explorer.links.pref'),
      submenu: (['ask', 'always', 'never'] as const).map((v) => ({
        id: `links:${v}`,
        label: t(`explorer.links.pref.${v}`),
        checked: links === v,
      })),
    },
  ];
}

/** Prefs after a view menu pick (unknown ids: unchanged). */
export function applyView(prefs: NoteFsPrefs, id: string | null): NoteFsPrefs {
  if (id === 'view:group') return { ...prefs, group: prefs.group === 'status' ? 'folder' : 'status' };
  if (id === 'view:folderNotes') return { ...prefs, folderNotes: prefs.folderNotes === false };
  if (id === 'view:compact') return { ...prefs, compact: prefs.compact === false };
  const m = /^links:(ask|always|never)$/.exec(id ?? '');
  if (m) return { ...prefs, links: m[1] as NoteFsLinks };
  return prefs;
}
