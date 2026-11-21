import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

vi.mock('electron', () => ({ Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() } }));

import { appMenuTemplate } from './appMenu';
import { translator } from '../src/shared/i18n/dictionary';
import { SHORTCUTS, SHORTCUT_IDS } from '../src/shared/lib/shortcuts';
import type { MenuCommand } from '../src/shared/api/types';

type Item = MenuItemConstructorOptions;

const NINE = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

function flat(items: Item[]): Item[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
}

function build(lang: 'ko' | 'en', projects = NINE, dev = false) {
  const sent: MenuCommand[] = [];
  const template = appMenuTemplate(translator(lang), { projects, dev }, (c) => sent.push(c));
  return { template, items: flat(template), sent };
}

type Click = (item: unknown, win: unknown, event: { triggeredByAccelerator?: boolean }) => void;
const click = (i: Item, triggeredByAccelerator = false) =>
  (i.click as unknown as Click)(null, null, { triggeredByAccelerator });

describe('appMenuTemplate', () => {
  it('shows every shortcut of the map (so every one in the guide), with its key, display-only', () => {
    const { items, sent } = build('en');
    for (const i of items) if (i.registerAccelerator === false) click(i);
    expect([...sent].sort()).toEqual([...SHORTCUT_IDS].sort());
    for (const id of SHORTCUT_IDS) {
      const item = items.find((i) => i.accelerator === SHORTCUTS[id]);
      expect(item?.registerAccelerator, id).toBe(false);
    }
  });

  it("ignores a display-only key that reached the menu (the renderer already ran it)", () => {
    const { items, sent } = build('en');
    for (const i of items) if (i.registerAccelerator === false) click(i, true);
    expect(sent).toEqual([]);
    click(items.find((i) => i.label === 'Settings…') as Item, true);
    expect(sent).toEqual(['settings']);
  });

  it('sends the menu-only commands', () => {
    const { items, sent } = build('en');
    for (const label of ['Settings…', 'Add project…', "What's new"]) {
      const item = items.find((i) => i.label === label);
      expect(item, label).toBeDefined();
      click(item as Item);
    }
    expect(sent).toEqual(['settings', 'addProject', 'whatsNew']);
    // ⌘, isn't the renderer's: the menu registers it.
    expect(items.find((i) => i.label === 'Settings…')?.registerAccelerator).toBeUndefined();
  });

  it('relabels for the language', () => {
    const tops = (lang: 'ko' | 'en') => build(lang).template.map((i) => i.label);
    expect(tops('en')).toEqual(['Aquila', 'File', 'Edit', 'View', 'Window', 'Help']);
    expect(tops('ko')).toEqual(['Aquila', '파일', '편집', '보기', '윈도우', '도움말']);
    const labels = (lang: 'ko' | 'en') => build(lang).items.map((i) => i.label ?? '');
    expect(labels('ko')).toContain('Claude 열기');
    expect(labels('en')).not.toContain('Claude 열기');
  });

  it('lists the first nine projects and drops the submenu when there are none', () => {
    const { items } = build('en');
    const projects = items.find((i) => i.label === 'Projects');
    expect((projects?.submenu as Item[]).map((i) => i.label)).toEqual(NINE.slice(0, 9));
    expect(build('en', []).items.find((i) => i.label === 'Projects')).toBeUndefined();
  });

  it('offers developer tools only in dev', () => {
    expect(build('en').items.some((i) => i.role === 'toggleDevTools')).toBe(false);
    expect(build('en', NINE, true).items.some((i) => i.role === 'toggleDevTools')).toBe(true);
  });
});
