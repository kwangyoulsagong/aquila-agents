import { Elapsed } from '@design-system/react';
import { useT } from '@/shared/i18n';
import { elapsedParts } from '@/shared/lib/time';
import { useNow } from '@/shared/lib/useNow';

/** "12m" next to a session that has been waiting for the user at least a minute; nothing otherwise. */
export default function WaitingTime({ since }: { since?: number }) {
  const t = useT();
  const now = useNow(15_000, since !== undefined);
  const parts = since === undefined ? null : elapsedParts(now - since);
  if (!parts) return null;
  const { h, m } = parts;
  const time =
    h === 0
      ? t('time.minutes', { n: String(m) })
      : m === 0
        ? t('time.hours', { h: String(h) })
        : t('time.hoursMinutes', { h: String(h), m: String(m) });
  return <Elapsed title={t('attention.waitingFor', { time })}>{time}</Elapsed>;
}
