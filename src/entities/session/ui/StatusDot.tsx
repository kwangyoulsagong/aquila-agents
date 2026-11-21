import { Dot } from '@design-system/react';
import type { ErrorReason, SessionStatus } from '@/shared/api';
import { useT } from '@/shared/i18n';

interface Props {
  status: SessionStatus;
  /** Guessed from output activity: shown dimmed. */
  estimated?: boolean;
  reason?: ErrorReason;
}

export default function StatusDot({ status, estimated, reason }: Props) {
  const t = useT();
  const label =
    status === 'error' && reason
      ? t(`status.reason.${reason}`)
      : estimated
        ? t('status.estimated')
        : undefined;
  return <Dot status={status} estimated={estimated} label={label} />;
}
