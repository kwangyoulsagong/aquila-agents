import { HostBadge as Badge } from '@design-system/react';
import type { ConnectionState } from '@/shared/api';
import { useT } from '@/shared/i18n';

/** Remote host alias (T29); with `conn`, a connection dot (connecting / connected / reconnecting / lost). */
export default function HostBadge({ host, conn }: { host: string; conn?: ConnectionState }) {
  const t = useT();
  return <Badge host={host} conn={conn} label={conn ? t(`remote.state.${conn}`) : undefined} />;
}
