import { Button } from '@design-system/react';
import { api, type Config, type Language } from '@/shared/api';
import { useT } from '@/shared/i18n';

/**
 * ⚙ at the bottom left: a native menu with Language ▸ 한국어 / English (current one checked) and the settings file.
 * The language isn't a bare "English" button any more: next to Korean UI it read like a label, not a switch.
 */
export default function SettingsMenu({
  config,
  onChanged,
  onGlobalShortcut,
}: {
  config: Config;
  onChanged: (c: Config) => void;
  /** Settings ▸ Global shortcut… (T41); the page owns the dialog. */
  onGlobalShortcut?: () => void;
}) {
  const t = useT();
  const pick = (language: Language) => {
    if (language !== config.language) void api.setLanguage(language).then(onChanged);
  };
  const open = async () => {
    const id = await api.showContextMenu([
      {
        label: t('settings.language'),
        submenu: [
          { id: 'lang:ko', label: t('language.ko'), checked: config.language === 'ko' },
          { id: 'lang:en', label: t('language.en'), checked: config.language === 'en' },
        ],
      },
      { id: 'notifyDone', label: t('settings.notifyDone'), checked: !!config.notifyDone },
      ...(onGlobalShortcut ? [{ id: 'globalShortcut', label: t('globalShortcut.menu') }] : []),
      { separator: true },
      { id: 'config', label: t('action.openConfig') },
    ]);
    if (id === 'lang:ko' || id === 'lang:en') pick(id.slice(5) as Language);
    else if (id === 'notifyDone') void api.setNotifyDone(!config.notifyDone).then(onChanged);
    else if (id === 'globalShortcut') onGlobalShortcut?.();
    else if (id === 'config') void api.openConfig();
  };
  return (
    <Button variant="ghost" onClick={() => void open()} title={t('settings.menu')} aria-haspopup="menu">
      ⚙ {t('settings.menu')}
    </Button>
  );
}
