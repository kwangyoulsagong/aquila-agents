import type { AccountUsage, UsageWindow } from '@/shared/api';
import { formatTokens } from '@/shared/lib/tokens';

export { formatTokens };

/** Same threshold as main's notice (`electron/usage.ts` NEAR). */
export const NEAR = 0.9;
const WARN = 0.75;

/** Share of the limit: the CLI's live percent, else the learned limit; null when neither is known. */
export const fraction = (w: UsageWindow): number | null =>
  typeof w.percent === 'number' ? w.percent / 100 : w.limit ? w.used / w.limit : null;

/** A Codex window the CLI didn't report (no secondary window on its plan): not drawn. */
export const shown = (u: AccountUsage, w: UsageWindow): boolean => u.kind !== 'codex' || typeof w.percent === 'number';

/** Which label a window gets: by its length when known, else its slot. */
export function windowLabel(w: UsageWindow, slot: 'fiveHour' | 'weekly'): 'fiveHour' | 'weekly' | { days: number } {
  if (w.span === undefined) return slot;
  if (w.span === 300) return 'fiveHour';
  if (w.span === 10_080) return 'weekly';
  return { days: Math.round(w.span / 1440) };
}

export function tone(w: UsageWindow): 'default' | 'warn' | 'danger' {
  const f = fraction(w) ?? 0;
  return f >= NEAR ? 'danger' : f >= WARN ? 'warn' : 'default';
}

/** "72%" with a learned limit, else the token count. */
export const windowValue = (w: UsageWindow): string => {
  if (typeof w.percent === 'number') return `${Math.round(w.percent)}%`;
  const f = fraction(w);
  return f === null ? formatTokens(w.used) : `${Math.round(f * 100)}%`;
};

/** The account to suggest when `account` is near its limit: another one with the most room; null if none. */
export function otherAccount(list: AccountUsage[], account: string): string | null {
  const share = (u: AccountUsage) => Math.max(fraction(u.fiveHour) ?? 0, fraction(u.weekly) ?? 0);
  const others = list
    .filter((u) => u.kind !== 'codex' && u.account !== account && !u.near)
    .sort((a, b) => share(a) - share(b) || a.fiveHour.used - b.fiveHour.used);
  return others[0]?.account ?? null;
}
