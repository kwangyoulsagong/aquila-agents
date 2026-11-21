import { useId, useState } from 'react';
import { Button, Dialog, DialogForm, Field, FieldGrid, FieldRow, Input } from '@design-system/react';
import { api, REMOTE_GROUP, type RemoteHost } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { addBlocker, remoteName, toHost, validHost } from '../model/remote';
import { useRemoteCheck } from '../model/useRemoteCheck';
import RemoteCheckView from './RemoteCheckView';
import RemoteFolderPicker from './RemoteFolderPicker';

export interface RemoteProjectValues {
  name: string;
  group: string;
  path: string;
  remote: RemoteHost;
}

interface Props {
  onClose: () => void;
  onAdd: (values: RemoteProjectValues) => Promise<void>;
}

/**
 * Add a project on an SSH host (T29): host alias, folder there, optional remote Claude config dir, "Check host".
 * Safe by default (T56): Add checks the host first and stops with the next step when it can't connect or has no tmux,
 * and refuses a folder that isn't there; Browse picks the folder from the host.
 */
export default function RemoteProjectDialog({ onClose, onAdd }: Props) {
  const t = useT();
  const formId = useId();
  const hostList = useId();
  const [alias, setAlias] = useState('');
  const [path, setPath] = useState('~/');
  const [name, setName] = useState('');
  const [claudeDir, setClaudeDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const { hosts, check, checking, start } = useRemoteCheck(alias);

  const hostOk = validHost(alias);
  const pathOk = path.trim() !== '' && path.trim() !== '~/';
  const ready = hostOk && pathOk && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const host = toHost(alias, claudeDir);
    try {
      // The check shown is for this alias (it's cleared when the alias changes); a failed one runs again.
      const result = check && !addBlocker(check) ? check : await start(host);
      if (!result) return setBusy(false);
      const blocker = addBlocker(result);
      if (blocker) {
        setError(t(blocker === 'unreachable' ? 'remote.blockedUnreachable' : 'remote.blockedTmux'));
        return setBusy(false);
      }
      const folder = await api.listRemoteDirs(host, path.trim());
      if (!folder.exists) {
        setError(t('remote.folderMissing', { path: path.trim() }));
        return setBusy(false);
      }
      await onAdd({
        name: name.trim() || remoteName(path, alias),
        // Always the built-in Remote group (main enforces it too).
        group: REMOTE_GROUP,
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
            {busy && checking ? t('remote.addChecking') : t('action.add')}
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
            <FieldRow>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="~/code/app"
                spellCheck={false}
              />
              <Button aria-expanded={browsing} disabled={!hostOk} onClick={() => setBrowsing((b) => !b)}>
                {t('remote.browse')}
              </Button>
            </FieldRow>
          </Field>
          <Field label={t('projects.name')}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={pathOk || hostOk ? remoteName(path, alias) : ''}
            />
          </Field>
        </FieldGrid>
        {browsing && hostOk && (
          <RemoteFolderPicker
            key={alias.trim()}
            host={toHost(alias, claudeDir)}
            start={path}
            onPick={(picked) => {
              setPath(picked);
              setBrowsing(false);
            }}
          />
        )}
        <FieldGrid>
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
