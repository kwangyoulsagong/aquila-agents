import { Button } from '@design-system/react';
import { api, type Config, type Language, type ThemeMode } from '@/shared/api';
import { useT, type Translate } from '@/shared/i18n';

interface SettingsMenuOptions {
  config: Config;
  onChanged: (c: Config) => void;
  /** Settings ▸ Global shortcut… (T41); the page owns the dialog. */
  onGlobalShortcut?: () => void;
  /** Settings ▸ Note sources… (T65); the page owns the dialog. */
  onSources?: () => void;
  /** Settings ▸ Link suggestions… (T68); the page owns the dialog. */
  onLinks?: () => void;
  /** Settings ▸ Folder settings… (T69); the page owns the dialog. */
  onVault?: () => void;
}

/**
 * Pops the ⚙ settings menu at the cursor: Language ▸ 한국어 / English (current one checked), Appearance ▸
 * System / Light / Dark, Notify when done,
 * Global shortcut…, Note sources… and the settings file. Also what the menu bar's Aquila ▸ Settings… (⌘,) opens (T47).
 */
export async function openSettingsMenu(
  t: Translate,
  { config, onChanged, onGlobalShortcut, onSources, onLinks, onVault }: SettingsMenuOptions,
): Promise<void> {
  const id = await api.showContextMenu([
    {
      label: t('settings.language'),
      submenu: [
        { id: 'lang:ko', label: t('language.ko'), checked: config.language === 'ko' },
        { id: 'lang:en', label: t('language.en'), checked: config.language === 'en' },
      ],
    },
    {
      label: t('settings.theme'),
      submenu: (['system', 'light', 'dark'] as const).map((m) => ({
        id: `theme:${m}`,
        label: t(`settings.theme.${m}`),
        checked: (config.theme ?? 'system') === m,
      })),
    },
    { id: 'notifyDone', label: t('settings.notifyDone'), checked: !!config.notifyDone },
    ...(onGlobalShortcut ? [{ id: 'globalShortcut', label: t('globalShortcut.menu') }] : []),
    ...(onSources ? [{ id: 'sources', label: t('sources.menu') }] : []),
    ...(onLinks ? [{ id: 'links', label: t('links.menu') }] : []),
    ...(onVault ? [{ id: 'vault', label: t('vault.menu') }] : []),
    { separator: true },
    { id: 'config', label: t('action.openConfig') },
  ]);
  if (id === 'lang:ko' || id === 'lang:en') {
    const language = id.slice(5) as Language;
    if (language !== config.language) void api.setLanguage(language).then(onChanged);
  } else if (id === 'theme:system' || id === 'theme:light' || id === 'theme:dark')
    void api.setTheme(id.slice(6) as ThemeMode).then(onChanged);
  else if (id === 'notifyDone') void api.setNotifyDone(!config.notifyDone).then(onChanged);
  else if (id === 'globalShortcut') onGlobalShortcut?.();
  else if (id === 'sources') onSources?.();
  else if (id === 'links') onLinks?.();
  else if (id === 'vault') onVault?.();
  else if (id === 'config') void api.openConfig();
}

/**
 * ⚙ at the bottom left: a native menu (see `openSettingsMenu`).
 * The language isn't a bare "English" button any more: next to Korean UI it read like a label, not a switch.
 */
export default function SettingsMenu(props: SettingsMenuOptions) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      onClick={() => void openSettingsMenu(t, props)}
      title={t('settings.menu')}
      aria-haspopup="menu"
    >
      ⚙ {t('settings.menu')}
    </Button>
  );
}
