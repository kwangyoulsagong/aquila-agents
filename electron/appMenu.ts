// App menu bar (T47, macOS): every command and its shortcut can be found in the menu bar.
// Items carry the accelerators of the one shortcut map (`src/shared/lib/shortcuts.ts`). The renderer already handles
// those keys, so they are display-only here (`registerAccelerator: false`) and a click is sent to the renderer, which
// runs it exactly like the key. Labels follow the app language and are rebuilt when it (or the project list) changes.
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { Config, MenuCommand } from '../src/shared/api/types';
import { translator, type Translate } from '../src/shared/i18n/dictionary';
import { SHORTCUTS, type ShortcutId } from '../src/shared/lib/shortcuts';

type Item = MenuItemConstructorOptions;

export interface MenuOptions {
  /** Project names in sidebar order; the first nine get ⌘1–⌘9. */
  projects: readonly string[];
  /** Adds View ▸ Developer Tools (dev builds only). */
  dev: boolean;
}

/** The whole menu bar. Pure: `send` is called with the command of a clicked item. */
export function appMenuTemplate(t: Translate, opts: MenuOptions, send: (c: MenuCommand) => void): Item[] {
  const cmd = (label: string, command: MenuCommand, key?: ShortcutId): Item => ({
    label,
    // macOS still binds a display-only key to the item: when the key reaches the menu, the renderer has already
    // run it (or deliberately left it to the terminal), so only a real click is sent. Otherwise ⌘K would toggle twice.
    click: (_item, _win, event) => {
      if (!(key && event.triggeredByAccelerator)) send(command);
    },
    ...(key ? { accelerator: SHORTCUTS[key], registerAccelerator: false } : {}),
  });
  // A shortcut of the map: the item sends its own id.
  const sc = (label: string, id: ShortcutId): Item => cmd(label, id, id);
  const sep: Item = { type: 'separator' };
  const projects = opts.projects.slice(0, 9).map((name, i) => sc(name, `project${i + 1}` as ShortcutId));

  return [
    {
      label: 'Aquila',
      submenu: [
        { role: 'about', label: t('menu.about') },
        sep,
        // Not in the renderer's map: the menu owns ⌘, and pops the ⚙ menu.
        { label: t('menu.settings'), accelerator: 'CommandOrControl+,', click: () => send('settings') },
        sep,
        { role: 'services', label: t('menu.services') },
        sep,
        { role: 'hide', label: t('menu.hide') },
        { role: 'hideOthers', label: t('menu.hideOthers') },
        { role: 'unhide', label: t('menu.showAll') },
        sep,
        { role: 'quit', label: t('menu.quit') },
      ],
    },
    {
      label: t('menu.file'),
      submenu: [
        sc(t('action.openClaude'), 'openClaude'),
        sc(t('action.openCodex'), 'openCodex'),
        sc(t('palette.openShell'), 'openShell'),
        sep,
        cmd(t('menu.addProject'), 'addProject'),
        sep,
        sc(t('action.closeSession'), 'closeSession'),
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        // Roles keep their system keys (⌘C/⌘V reach the terminal through these).
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        sep,
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
        sep,
        sc(t('term.copyLastReply'), 'copyLastReply'),
        sc(t('term.quickSelect'), 'quickSelect'),
        sc(t('term.find'), 'find'),
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        sc(t('palette.splitRight'), 'splitRight'),
        sc(t('palette.splitDown'), 'splitDown'),
        {
          label: t('shortcut.focus'),
          submenu: [
            sc(t('menu.left'), 'focusLeft'),
            sc(t('menu.right'), 'focusRight'),
            sc(t('menu.up'), 'focusUp'),
            sc(t('menu.down'), 'focusDown'),
          ],
        },
        {
          label: t('shortcut.resize'),
          submenu: [
            sc(t('menu.left'), 'resizeLeft'),
            sc(t('menu.right'), 'resizeRight'),
            sc(t('menu.up'), 'resizeUp'),
            sc(t('menu.down'), 'resizeDown'),
          ],
        },
        sc(t('action.zoomPane'), 'zoomPane'),
        sc(t('fullscreen.toggle'), 'fullscreen'),
        sep,
        sc(t('changes.toggle'), 'toggleChanges'),
        sc(t('preview.toggle'), 'togglePreview'),
        sc(t('run.toggle'), 'toggleRun'),
        sc(t('history.title'), 'history'),
        sep,
        { role: 'togglefullscreen', label: t('menu.nativeFullScreen') },
        ...(opts.dev ? [sep, { role: 'toggleDevTools', label: t('menu.devTools') } as Item] : []),
      ],
    },
    {
      label: t('menu.window'),
      submenu: [
        sc(t('attention.next'), 'nextWaiting'),
        sc(t('shortcut.palette'), 'palette'),
        ...(projects.length ? [sep, { label: t('menu.projects'), submenu: projects }] : []),
        sep,
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        sep,
        { role: 'front', label: t('menu.front') },
      ],
    },
    {
      role: 'help',
      label: t('menu.help'),
      submenu: [
        sc(t('shortcut.guide'), 'guide'),
        cmd(t('notes.title'), 'whatsNew'),
        sep,
        cmd(t('figma.connectAction'), 'connectFigma'),
      ],
    },
  ];
}

/** Installs the menu bar (macOS only; elsewhere the window has its own title bar). */
export function installAppMenu(opts: { dev: boolean; send: (c: MenuCommand) => void }) {
  const refresh = (config: Config): Config => {
    if (process.platform !== 'darwin') return config;
    const t = translator(config.language);
    const template = appMenuTemplate(
      t,
      { projects: config.projects.map((p) => p.name), dev: opts.dev },
      opts.send,
    );
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return config;
  };
  return { refresh };
}
