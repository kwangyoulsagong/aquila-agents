import { Badge } from '@design-system/react';
import { accountLabel, useT } from '@/shared/i18n';
import type { Config } from '@/shared/api';

export default function AccountBadge({ config, account }: { config: Config; account: string }) {
  const t = useT();
  return <Badge tone={`account-${account}`}>{accountLabel(t, account, config.accounts[account])}</Badge>;
}
