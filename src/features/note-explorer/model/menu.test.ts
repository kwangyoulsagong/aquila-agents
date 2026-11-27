import { describe, expect, it } from 'vitest';
import type { ContextMenuItem, NoteFsPrefs } from '@/shared/api';
import { translator } from '@/shared/i18n';
import {
  ACTION_LABEL,
  applyView,
  EXPLORER_ACTIONS,
  HOVER_ACTIONS,
  isExplorerAction,
  KEY_ACTIONS,
  keyAction,
  menuTemplate,
  viewMenuTemplate,
  type MenuTarget,
} from './menu';

const t = translator('en');
const ids = (items: ContextMenuItem[]) => items.map((i) => (i.separator ? '—' : i.id));
const off = (items: ContextMenuItem[]) => items.filter((i) => i.enabled === false).map((i) => i.id);

describe('right-click menu', () => {
  const cases: [string, MenuTarget, string[], string[]][] = [
    [
      'a note',
      { kind: 'file', pinned: false },
      [
        'newNote',
        'newFolder',
        '—',
        'rename',
        'move',
        'pin',
        '—',
        'finder',
        'open',
        'copy',
        'copyRel',
        '—',
        'trash',
      ],
      [],
    ],
    [
      'a folder',
      { kind: 'folder' },
      ['newNote', 'newFolder', '—', 'rename', 'move', '—', 'finder', 'copy', 'copyRel', '—', 'trash'],
      [],
    ],
    [
      'several notes',
      { kind: 'multi', count: 3, folder: false },
      ['newNote', 'newFolder', '—', 'rename', 'move', '—', 'finder', 'open', 'copy', 'copyRel', '—', 'trash'],
      ['rename', 'finder', 'open'],
    ],
    [
      'several rows with a folder clicked',
      { kind: 'multi', count: 2, folder: true },
      ['newNote', 'newFolder', '—', 'rename', 'move', '—', 'finder', 'copy', 'copyRel', '—', 'trash'],
      ['rename', 'finder'],
    ],
    ['empty space', { kind: 'empty' }, ['newNote', 'newFolder', '—', 'finder', 'copy'], []],
  ];

  it.each(cases)('items and enabled states for %s', (_name, target, want, disabled) => {
    const items = menuTemplate(target, t);
    expect(ids(items)).toEqual(want);
    expect(off(items)).toEqual(disabled);
  });

  it('labels come from the dictionary; Pin says Unpin on a pinned note', () => {
    const items = menuTemplate({ kind: 'file', pinned: false }, t);
    expect(items.find((i) => i.id === 'rename')?.label).toBe('Rename');
    expect(items.find((i) => i.id === 'trash')?.label).toBe('Move to Trash');
    expect(menuTemplate({ kind: 'file', pinned: true }, t).find((i) => i.id === 'pin')?.label).toBe('Unpin');
    for (const a of EXPLORER_ACTIONS) expect(t(ACTION_LABEL[a])).not.toBe(ACTION_LABEL[a]);
  });

  it('every item id is an action the explorer dispatches', () => {
    const all = cases.flatMap(([, target]) => menuTemplate(target, t)).filter((i) => !i.separator);
    for (const i of all) expect(isExplorerAction(i.id ?? null)).toBe(true);
    expect(isExplorerAction('view:group')).toBe(false);
    expect(isExplorerAction(null)).toBe(false);
  });
});

describe('the action map: menu, keys and hover buttons run the same actions', () => {
  /** An accelerator as the key event that types it. */
  const eventOf = (accel: string) => {
    const parts = accel.split('+');
    const key = parts.pop()!;
    const mod = parts.includes('CommandOrControl');
    return {
      key: key.length === 1 ? key.toLowerCase() : key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      metaKey: mod,
    };
  };

  it('a menu item that shows a key: that key runs the item', () => {
    const items = menuTemplate({ kind: 'file', pinned: false }, t).filter((i) => i.accelerator);
    expect(items.map((i) => i.id)).toEqual(['newNote', 'rename', 'trash']);
    for (const i of items) expect(keyAction(eventOf(i.accelerator!))).toBe(i.id);
  });

  it('keys: F2, ⌘⌫ / Delete, ⌘N (by code, any layout); nothing else', () => {
    expect(keyAction({ key: 'F2' })).toBe('rename');
    expect(keyAction({ key: 'Backspace', metaKey: true })).toBe('trash');
    expect(keyAction({ key: 'Delete' })).toBe('trash');
    expect(keyAction({ key: 'ㅜ', code: 'KeyN', metaKey: true })).toBe('newNote');
    expect(keyAction({ key: 'n', code: 'KeyN', ctrlKey: true })).toBe('newNote');
    expect(keyAction({ key: 'Backspace' })).toBeNull();
    expect(keyAction({ key: 'n', code: 'KeyN' })).toBeNull();
    expect(keyAction({ key: 'n', code: 'KeyN', metaKey: true, shiftKey: true })).toBeNull();
    expect(keyAction({ key: 'z', code: 'KeyZ', metaKey: true })).toBeNull();
    for (const k of KEY_ACTIONS) expect(EXPLORER_ACTIONS).toContain(k.action);
  });

  it('hover buttons are items of the same row menu', () => {
    const folderMenu = ids(menuTemplate({ kind: 'folder' }, t));
    for (const a of HOVER_ACTIONS.folder) expect(folderMenu).toContain(a);
    expect(HOVER_ACTIONS.file).toEqual([]);
  });
});

describe('view menu', () => {
  const base: NoteFsPrefs = { pins: [], recent: [], sort: 'name' };

  it('shows the defaults: by folder, folder notes and compact on, links asked', () => {
    const items = viewMenuTemplate(base, t);
    expect(items.slice(0, 3).map((i) => [i.id, i.checked])).toEqual([
      ['view:group', false],
      ['view:folderNotes', true],
      ['view:compact', true],
    ]);
    expect(items[4]!.submenu!.map((i) => [i.id, i.checked])).toEqual([
      ['links:ask', true],
      ['links:always', false],
      ['links:never', false],
    ]);
  });

  it('each pick flips its pref; unknown picks change nothing', () => {
    expect(applyView(base, 'view:group').group).toBe('status');
    expect(applyView({ ...base, group: 'status' }, 'view:group').group).toBe('folder');
    expect(applyView(base, 'view:folderNotes').folderNotes).toBe(false);
    expect(applyView({ ...base, folderNotes: false }, 'view:folderNotes').folderNotes).toBe(true);
    expect(applyView(base, 'view:compact').compact).toBe(false);
    expect(applyView(base, 'links:never').links).toBe('never');
    expect(viewMenuTemplate({ ...base, links: 'always' }, t)[4]!.submenu![1]!.checked).toBe(true);
    expect(applyView(base, null)).toBe(base);
    expect(applyView(base, 'links:sometimes')).toBe(base);
  });
});
