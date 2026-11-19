import { Ring } from '@design-system/react';
import { useT } from '@/shared/i18n';
import { formatTokens } from '@/shared/lib/tokens';
import { CONTEXT_HINT, contextTone, useContextUsage } from '../model/context';

/** Context use of a Claude tab (T31): a small ring, with the number from 60%. Nothing until Claude reports. */
export default function ContextGauge({ id }: { id: string }) {
  const t = useT();
  const u = useContextUsage(id);
  if (!u) return null;
  const percent = `${Math.round(u.percent)}%`;
  const tokens = u.windowTokens
    ? t('context.ofWindow', { used: formatTokens(u.usedTokens), size: formatTokens(u.windowTokens) })
    : '';
  const hint = u.percent >= CONTEXT_HINT ? t('context.hint') : '';
  return (
    <Ring
      fraction={u.percent / 100}
      label={t('context.label')}
      valueText={percent}
      showValue={u.percent >= CONTEXT_HINT}
      tone={contextTone(u.percent)}
      title={[`${t('context.label')} ${percent}`, tokens, hint].filter(Boolean).join('\n')}
    />
  );
}
