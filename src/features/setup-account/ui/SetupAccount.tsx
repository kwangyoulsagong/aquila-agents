import { useState } from 'react';
import { Button, Dot } from '@design-system/react';
import type { Config } from '@/shared/api';
import { accountLabel, useT } from '@/shared/i18n';
import { useAccountStatus } from '../model/useAccountStatus';
import SetupAccountDialog from './SetupAccountDialog';

interface Props {
  config: Config;
  /** Open a Claude session in the current project with this account (Claude runs its own /login). */
  onOpenClaude: (account: string) => void;
}

/** "• Set up Personal" next to the account switch, for each account that isn't logged in yet. */
export default function SetupAccount({ config, onOpenClaude }: Props) {
  const t = useT();
  const { status, refresh } = useAccountStatus();
  const [openId, setOpenId] = useState<string | null>(null);
  if (!status) return null;

  const pending = Object.keys(config.accounts).filter((id) => status[id] && !status[id].loggedIn);
  const open = openId ? config.accounts[openId] : undefined;

  return (
    <>
      {pending.map((id) => (
        <Button key={id} variant="ghost" onClick={() => setOpenId(id)}>
          <Dot status="waiting" />
          {t('setup.button', { account: accountLabel(t, id, config.accounts[id]) })}
        </Button>
      ))}
      {openId && open && status[openId] && (
        <SetupAccountDialog
          id={openId}
          account={open}
          label={accountLabel(t, openId, open)}
          status={status[openId]}
          onOpenClaude={() => onOpenClaude(openId)}
          onChanged={refresh}
          onClose={() => {
            setOpenId(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
