import { Badge, Button, Label, Meter } from '@design-system/react';
import type { AccountUsage, Config, UsageWindow } from '@/shared/api';
import { accountLabel, useT } from '@/shared/i18n';
import { formatTokens, fraction, otherAccount, shown, tone, windowLabel, windowValue } from '../model/usage';
import { useUsage } from '../model/useUsage';

interface Props {
  config: Config;
  /** Open a new Claude in the current project with this account; undefined when there's no local project to open in. */
  onOpenWith?: (account: string) => void;
}

/**
 * 5-hour and weekly usage per Claude account, side by side (T30), plus Codex. Real percentages when the CLIs report them
 * (T30b), else the transcript estimate. Hidden until main reports an account.
 */
export default function UsageGauge({ config, onOpenWith }: Props) {
  const t = useT();
  const list = useUsage();
  if (list.length === 0) return null;
  const locale = config.language === 'ko' ? 'ko-KR' : 'en-US';
  // A reset days away gets a short date and a 24-hour time ("11/24 11:00"): the half-width caption has no room for more.
  const clock = (ms: number, withDate: boolean) => {
    const d = new Date(ms);
    if (!withDate) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const hm = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  };
  const name = (u: AccountUsage) =>
    u.kind === 'codex' ? t('usage.codex') : accountLabel(t, u.account, config.accounts[u.account]);
  const allLive = list.every((u) => u.live);

  const title = (u: AccountUsage, w: UsageWindow) => {
    if (typeof w.percent === 'number') {
      const percent = String(Math.round(w.percent));
      return t(u.kind === 'codex' ? 'usage.codexTitle' : 'usage.liveTitle', { percent });
    }
    return w.limit
      ? t('usage.ofLimit', { used: formatTokens(w.used), limit: formatTokens(w.limit) })
      : t('usage.tokens', { used: formatTokens(w.used) });
  };

  const meter = (u: AccountUsage, w: UsageWindow, slot: 'fiveHour' | 'weekly') => {
    if (!shown(u, w)) return null;
    const kind = windowLabel(w, slot);
    const label = typeof kind === 'string' ? t(`usage.${kind}`) : t('usage.days', { n: String(kind.days) });
    const live = typeof w.percent === 'number';
    const caption = w.resetsAt
      ? t('usage.resetsAt', { time: clock(w.resetsAt, kind !== 'fiveHour') })
      : slot === 'fiveHour' && !live
        ? t('usage.notStarted')
        : !live
          ? t('usage.rolling')
          : undefined;
    return (
      <Meter
        key={slot}
        label={label}
        value={windowValue(w)}
        fraction={fraction(w)}
        tone={tone(w)}
        caption={caption}
        title={title(u, w)}
      />
    );
  };

  const row = (u: AccountUsage) => {
    const other = u.near && onOpenWith && u.kind !== 'codex' ? otherAccount(list, u.account) : null;
    return (
      <div key={u.account} className="c-usage__account">
        <span>
          <Badge tone={u.kind === 'codex' ? 'codex' : `account-${u.account}`}>{name(u)}</Badge>
        </span>
        <div className="c-usage__bars">
          {meter(u, u.fiveHour, 'fiveHour')}
          {meter(u, u.weekly, 'weekly')}
        </div>
        {other && onOpenWith && (
          <Button variant="ghost" onClick={() => onOpenWith(other)}>
            {t('usage.openOther', { account: accountLabel(t, other, config.accounts[other]) })}
          </Button>
        )}
      </div>
    );
  };

  return (
    <section className="c-usage" aria-label={t('usage.title')}>
      <div className="c-usage__head">
        <Label>{t('usage.title')}</Label>
        <span className="c-usage__est" title={allLive ? t('usage.liveHint') : t('usage.hint')}>
          {allLive ? t('usage.live') : t('usage.estimated')}
        </span>
      </div>
      {list.map(row)}
    </section>
  );
}
