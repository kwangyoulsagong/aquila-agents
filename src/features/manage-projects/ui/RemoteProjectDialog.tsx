import { useId, useState } from 'react';
import { Button, Dialog, DialogForm, Field, FieldGrid, FieldRow, Input, Select } from '@design-system/react';
import type { Config, RemoteHost } from '@/shared/api';
import { groupLabel, useT } from '@/shared/i18n';
import { remoteName, toHost, validHost } from '../model/remote';
import { useRemoteCheck } from '../model/useRemoteCheck';
import RemoteCheckView from './RemoteCheckView';

export interface RemoteProjectValues {
  name: string;
  group: string;
  path: string;
  remote: RemoteHost;
}

interface Props {
  config: Config;
  defaultGroup?: string;
  onClose: () => void;
  onAdd: (values: RemoteProjectValues) => Promise<void>;
}

/** Add a project on an SSH host (T29): host alias, folder there, optional remote Claude config dir, "Check host". */
export default function RemoteProjectDialog({ config, defaultGroup, onClose, onAdd }: Props) {
  const t = useT();
  const formId = useId();
  const hostList = useId();
  const [alias, setAlias] = useState('');
  const [path, setPath] = useState('~/');
  const [name, setName] = useState('');
  const [claudeDir, setClaudeDir] = useState('');
  const [group, setGroup] = useState(() =>
    defaultGroup && config.groups.some((g) => g.id === defaultGroup)
      ? defaultGroup
      : (config.groups[0]?.id ?? ''),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { hosts, check, checking, start } = useRemoteCheck(alias);

  const hostOk = validHost(alias);
  const pathOk = path.trim() !== '' && path.trim() !== '~/';
  const ready = hostOk && pathOk && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd({
        name: name.trim() || remoteName(path, alias),
        group,
        path: path.trim(),
        remote: toHost(alias, claudeDir),
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      wide
      title={t('remote.addTitle')}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!ready}>
            {t('action.add')}
          </Button>
        </>
      }
    >
      <DialogForm id={formId} onSubmit={submit}>
        <Field
          label={t('remote.host')}
          hint={t('remote.hostHint')}
          warning={alias.trim() && !hostOk ? t('remote.hostInvalid') : undefined}
        >
          <FieldRow>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              list={hostList}
              placeholder="devbox"
              spellCheck={false}
              autoFocus
            />
            <Button onClick={() => void start(toHost(alias, claudeDir))} disabled={!hostOk || checking}>
              {checking ? t('remote.checking') : t('remote.check')}
            </Button>
          </FieldRow>
        </Field>
        <datalist id={hostList}>
          {hosts.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
        {check && <RemoteCheckView check={check} host={alias.trim()} />}
        <FieldGrid>
          <Field label={t('remote.path')}>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/code/app"
              spellCheck={false}
            />
          </Field>
          <Field label={t('projects.name')}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={pathOk || hostOk ? remoteName(path, alias) : ''}
            />
          </Field>
        </FieldGrid>
        <FieldGrid>
          <Field label={t('projects.group')}>
            <Select
              value={group}
              onChange={setGroup}
              options={config.groups.map((g) => ({ value: g.id, label: groupLabel(t, g) }))}
            />
          </Field>
          <Field label={t('remote.claudeDir')} hint={t('remote.claudeDirHint')}>
            <Input
              value={claudeDir}
              onChange={(e) => setClaudeDir(e.target.value)}
              placeholder="~/.claude"
              spellCheck={false}
            />
          </Field>
        </FieldGrid>
      </DialogForm>
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
