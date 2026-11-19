import { useState } from 'react';
import { Button, Dialog, DialogCheck, DialogCode, Dot } from '@design-system/react';
import { api, type Account, type AccountStatus, type ShellFunctionPreview } from '@/shared/api';
import { useT } from '@/shared/i18n';

interface Props {
  id: string;
  account: Account;
  label: string;
  status: AccountStatus;
  onOpenClaude: () => void;
  onChanged: () => void;
  onClose: () => void;
}

/**
 * Set up one Claude account: create its config dir, then open a Claude session with it (Claude does /login).
 * Optional: preview, then on an explicit click append the `claude-<id>` function to ~/.zshrc.
 */
export default function SetupAccountDialog({
  id,
  account,
  label,
  status,
  onOpenClaude,
  onChanged,
  onClose,
}: Props) {
  const t = useT();
  const dir = account.claudeConfigDir ?? '~/.claude';
  const [error, setError] = useState<string | null>(null);
  const [shell, setShell] = useState<ShellFunctionPreview | null>(null);
  const [added, setAdded] = useState(false);
  const fail = (e: unknown) => setError((e as Error).message);

  const start = async () => {
    try {
      if (!status.configDirExists) await api.prepareAccount(id);
      onChanged();
      onOpenClaude();
      onClose();
    } catch (e) {
      fail(e);
    }
  };

  const install = async () => {
    try {
      setShell(await api.installShellFunction(id));
      setAdded(true);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Dialog
      open
      title={t('setup.title', { account: label })}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.close')}
          </Button>
          <Button variant="primary" onClick={start} autoFocus>
            {status.configDirExists ? t('setup.login') : t('setup.start')}
          </Button>
        </>
      }
    >
      <p>{account.claudeConfigDir ? t('setup.intro', { dir }) : t('setup.introShared')}</p>
      <DialogCheck leading={<Dot status={status.configDirExists ? 'done' : 'idle'} />}>
        {t(status.configDirExists ? 'setup.dirReady' : 'setup.dirMissing', { dir })}
      </DialogCheck>
      <DialogCheck leading={<Dot status={status.loggedIn ? 'done' : 'waiting'} />}>
        {t(status.loggedIn ? 'setup.loggedIn' : 'setup.loggedOut')}
      </DialogCheck>

      {account.claudeConfigDir && (
        <>
          <DialogCheck>
            <span>{t('setup.shellTitle', { name: `claude-${id}` })}</span>
            {!shell && (
              <Button variant="ghost" onClick={() => api.shellFunctionPreview(id).then(setShell, fail)}>
                {t('setup.shellPreview')}
              </Button>
            )}
          </DialogCheck>
          {shell && added && <p>{t('setup.shellAdded')}</p>}
          {shell && !added && shell.defined && <p>{t('setup.shellDefined', { name: shell.name })}</p>}
          {shell && !added && !shell.defined && (
            <>
              <p>{t('setup.shellWillAdd', { rc: shell.rcPath })}</p>
              <DialogCode>{shell.snippet}</DialogCode>
              <div>
                <Button onClick={install}>{t('setup.shellAdd', { rc: shell.rcPath })}</Button>
              </div>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
