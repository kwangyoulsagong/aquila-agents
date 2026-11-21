import { describe, expect, it } from 'vitest';
import type { AccountUsage } from '@/shared/api';
import { formatTokens, fraction, otherAccount, shown, tone, windowLabel, windowValue } from './usage';

const w = (used: number, limit: number | null = null) => ({ used, limit, resetsAt: null });
const acct = (account: string, used: number, limit: number | null, near = false): AccountUsage => ({
  account,
  fiveHour: w(used, limit),
  weekly: w(used),
  near,
});

describe('usage gauge model', () => {
  it('formats token counts', () => {
    expect(formatTokens(980)).toBe('980');
    expect(formatTokens(12_345)).toBe('12.3K');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(250_400_000)).toBe('250M');
  });

  it('shows a percent only with a learned limit', () => {
    expect(fraction(w(50))).toBeNull();
    expect(windowValue(w(50, 200))).toBe('25%');
    expect(windowValue(w(1500))).toBe('1.5K');
  });

  it('tones by share of the limit', () => {
    expect(tone(w(10, 100))).toBe('default');
    expect(tone(w(80, 100))).toBe('warn');
    expect(tone(w(95, 100))).toBe('danger');
    expect(tone(w(1e9))).toBe('default');
  });

  it('suggests the other account with the most room', () => {
    const list = [acct('shared', 95, 100, true), acct('personal', 30, 100), acct('work', 10, 100)];
    expect(otherAccount(list, 'shared')).toBe('work');
    expect(
      otherAccount([acct('shared', 95, 100, true), acct('personal', 99, 100, true)], 'shared'),
    ).toBeNull();
  });

  it('a live percent wins over the estimate', () => {
    const live = { ...w(50, 200), percent: 77 };
    expect(fraction(live)).toBe(0.77);
    expect(windowValue(live)).toBe('77%');
    expect(tone({ ...w(0), percent: 92 })).toBe('danger');
  });

  it('labels windows by length when known', () => {
    expect(windowLabel(w(0), 'weekly')).toBe('weekly');
    expect(windowLabel({ ...w(0), span: 300 }, 'weekly')).toBe('fiveHour');
    expect(windowLabel({ ...w(0), span: 10_080 }, 'fiveHour')).toBe('weekly');
    expect(windowLabel({ ...w(0), span: 43_200 }, 'fiveHour')).toEqual({ days: 30 });
  });

  it('Codex: windows it did not report are hidden, and it is never the "other account"', () => {
    const codex: AccountUsage = {
      account: 'codex',
      kind: 'codex',
      fiveHour: { ...w(0), percent: 1 },
      weekly: { ...w(0), percent: null },
      near: false,
    };
    expect(shown(codex, codex.fiveHour)).toBe(true);
    expect(shown(codex, codex.weekly)).toBe(false);
    expect(otherAccount([acct('shared', 95, 100, true), codex], 'shared')).toBeNull();
  });
});
