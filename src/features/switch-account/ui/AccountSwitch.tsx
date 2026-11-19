import { Segment } from '@design-system/react';
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
  return (
    <Segment
      label={t('account.title')}
      value={project.account}
      options={Object.entries(config.accounts).map(([id, a]) => ({
        value: id,
        label: accountLabel(t, id, a),
      }))}
      onChange={(id) => api.setProjectAccount(project.id, id).then(onChanged)}
    />
  );
}
