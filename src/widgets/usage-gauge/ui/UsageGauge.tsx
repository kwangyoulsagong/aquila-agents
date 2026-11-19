import { Badge, Button, Label, Meter } from '@design-system/react';
import type { AccountUsage, Config, UsageWindow } from '@/shared/api';
import { accountLabel, useT } from '@/shared/i18n';
import { formatTokens, fraction, otherAccount, tone, windowValue } from '../model/usage';
import { useUsage } from '../model/useUsage';

interface Props {
  config: Config;
  /** Open a new Claude in the current project with this account; undefined when there's no local project to open in. */
  onOpenWith?: (account: string) => void;
}

/** Estimated 5-hour and weekly usage per Claude account, side by side (T30). Hidden until main reports an account. */
export default function UsageGauge({ config, onOpenWith }: Props) {
  const t = useT();
  const list = useUsage();
  if (list.length === 0) return null;
  const locale = config.language === 'ko' ? 'ko-KR' : 'en-US';
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const name = (id: string) => accountLabel(t, id, config.accounts[id]);

  const title = (w: UsageWindow) =>
    w.limit
      ? t('usage.ofLimit', { used: formatTokens(w.used), limit: formatTokens(w.limit) })
      : t('usage.tokens', { used: formatTokens(w.used) });

  const row = (u: AccountUsage) => {
    const other = u.near && onOpenWith ? otherAccount(list, u.account) : null;
    return (
      <div key={u.account} className="c-usage__account">
        <span>
          <Badge tone={`account-${u.account}`}>{name(u.account)}</Badge>
        </span>
        <div className="c-usage__bars">
          <Meter
            label={t('usage.fiveHour')}
            value={windowValue(u.fiveHour)}
            fraction={fraction(u.fiveHour)}
            tone={tone(u.fiveHour)}
            caption={
              u.fiveHour.resetsAt
                ? t('usage.resetsAt', { time: clock(u.fiveHour.resetsAt) })
                : t('usage.notStarted')
            }
            title={title(u.fiveHour)}
          />
          <Meter
            label={t('usage.weekly')}
            value={windowValue(u.weekly)}
            fraction={fraction(u.weekly)}
            tone={tone(u.weekly)}
            caption={t('usage.rolling')}
            title={title(u.weekly)}
          />
        </div>
        {other && onOpenWith && (
          <Button variant="ghost" onClick={() => onOpenWith(other)}>
            {t('usage.openOther', { account: name(other) })}
          </Button>
        )}
      </div>
    );
  };

  return (
    <section className="c-usage" aria-label={t('usage.title')}>
      <div className="c-usage__head">
        <Label>{t('usage.title')}</Label>
        <span className="c-usage__est" title={t('usage.hint')}>
          {t('usage.estimated')}
        </span>
      </div>
      {list.map(row)}
    </section>
  );
}
