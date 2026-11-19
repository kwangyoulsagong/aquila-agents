import { Button } from '@design-system/react';
import { api, type Config } from '@/shared/api';
import { useT } from '@/shared/i18n';

export default function LanguageToggle({
  config,
  onChanged,
}: {
  config: Config;
  onChanged: (c: Config) => void;
}) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      className="c-sidebar__lang"
      onClick={() => api.setLanguage(config.language === 'ko' ? 'en' : 'ko').then(onChanged)}
    >
      {t('action.switchLanguage')}
    </Button>
  );
}
