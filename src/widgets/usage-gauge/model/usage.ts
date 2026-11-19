import type { AccountUsage, UsageWindow } from '@/shared/api';

/** Same threshold as main's notice (`electron/usage.ts` NEAR). */
export const NEAR = 0.9;
const WARN = 0.75;

/** Share of the learned limit; null when none was learned yet. */
export const fraction = (w: UsageWindow): number | null => (w.limit ? w.used / w.limit : null);

export function tone(w: UsageWindow): 'default' | 'warn' | 'danger' {
  const f = fraction(w) ?? 0;
  return f >= NEAR ? 'danger' : f >= WARN ? 'warn' : 'default';
}

/** 980 · 12.3K · 1.2M · 3.4B */
export function formatTokens(n: number): string {
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, unit] of units) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${unit}`;
    }
  }
  return String(Math.round(n));
}

/** "72%" with a learned limit, else the token count. */
export const windowValue = (w: UsageWindow): string => {
  const f = fraction(w);
  return f === null ? formatTokens(w.used) : `${Math.round(f * 100)}%`;
};

/** The account to suggest when `account` is near its limit: another one with the most room; null if none. */
export function otherAccount(list: AccountUsage[], account: string): string | null {
  const share = (u: AccountUsage) => Math.max(fraction(u.fiveHour) ?? 0, fraction(u.weekly) ?? 0);
  const others = list
    .filter((u) => u.account !== account && !u.near)
    .sort((a, b) => share(a) - share(b) || a.fiveHour.used - b.fiveHour.used);
  return others[0]?.account ?? null;
}
