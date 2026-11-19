import { api, type Config, type Project } from '@/shared/api';
import { accountLabel, useT } from '@/shared/i18n';

interface Props {
  config: Config;
  project: Project;
  onChanged: (config: Config) => void;
}

/** Shared (`claude`) vs Personal (`claude-personal`) for NEW Claude sessions in this project. */
export default function AccountSwitch({ config, project, onChanged }: Props) {
  const t = useT();
  const ids = Object.keys(config.accounts);
  const index = Math.max(0, ids.indexOf(project.account));
  return (
    <div
      className="c-segment"
      role="radiogroup"
      aria-label={t('account.title')}
      title={t('account.title')}
      style={{ '--segment-count': ids.length, '--segment-index': index } as React.CSSProperties}
    >
      <span className="c-segment__thumb" aria-hidden />
      {ids.map((id) => (
        <button
          key={id}
          className="c-segment__item"
          role="radio"
          aria-checked={project.account === id}
          onClick={() => api.setProjectAccount(project.id, id).then(onChanged)}
        >
          {accountLabel(t, id, config.accounts[id])}
        </button>
      ))}
    </div>
  );
}
