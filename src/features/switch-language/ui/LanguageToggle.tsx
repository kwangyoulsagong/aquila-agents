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
    <button
      className="c-btn c-btn--ghost c-sidebar__lang"
      onClick={() => api.setLanguage(config.language === 'ko' ? 'en' : 'ko').then(onChanged)}
    >
      {t('action.switchLanguage')}
    </button>
  );
}
