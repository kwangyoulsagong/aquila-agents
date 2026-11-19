// Native context menus for the renderer (right-click on a project or group).
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { ContextMenuItem } from '../src/shared/api/types';

function template(items: ContextMenuItem[], pick: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    if (item.separator) return { type: 'separator' };
    if (item.submenu)
      return { label: item.label, enabled: item.enabled, submenu: template(item.submenu, pick) };
    return {
      label: item.label,
      enabled: item.enabled,
      ...(item.checked !== undefined ? { type: 'checkbox', checked: item.checked } : {}),
      // The renderer handles the keys; the menu only shows them.
      ...(item.accelerator ? { accelerator: item.accelerator, registerAccelerator: false } : {}),
      click: () => item.id && pick(item.id),
    };
  });
}

/** Pops the menu at the cursor; resolves with the clicked item's id, or null when dismissed. */
export function showContextMenu(win: BrowserWindow | null, items: ContextMenuItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate(template(items, resolve));
    menu.popup({
      ...(win ? { window: win } : {}),
      // On macOS `callback` (menu closed) can run before the item's click handler: give the click a moment.
      callback: () => setTimeout(() => resolve(null), 100),
    });
  });
}
