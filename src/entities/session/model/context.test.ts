import { describe, expect, it } from 'vitest';
import { applyContext, contextTone } from './context';

const u = (percent: number) => ({ percent, usedTokens: percent * 2000, windowTokens: 200_000 });

describe('context gauge model', () => {
  it('keeps the latest use per tab and drops cleared tabs', () => {
    let m = applyContext(new Map(), [
      { id: 'a', usage: u(10) },
      { id: 'b', usage: u(20) },
    ]);
    m = applyContext(m, [
      { id: 'a', usage: u(30) },
      { id: 'b', usage: null },
    ]);
    expect([...m]).toEqual([['a', u(30)]]);
  });
  it('hints at 60% and warns near auto-compact', () => {
    expect(contextTone(59.4)).toBe('default');
    expect(contextTone(60)).toBe('warn');
    expect(contextTone(85)).toBe('danger');
  });
});
