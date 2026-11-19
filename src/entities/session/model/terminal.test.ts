import { describe, expect, it } from 'vitest';
import { SCROLLBACK, sizeChanged } from './terminal';

describe('sizeChanged', () => {
  const cur = { cols: 120, rows: 32 };
  it('is false for the same size or no proposal', () => {
    expect(sizeChanged(cur, { cols: 120, rows: 32 })).toBe(false);
    expect(sizeChanged(cur, undefined)).toBe(false);
  });
  it('ignores sizes of a hidden or zero-sized host', () => {
    expect(sizeChanged(cur, { cols: 0, rows: 10 })).toBe(false);
    expect(sizeChanged(cur, { cols: NaN, rows: 10 })).toBe(false);
  });
  it('is true when cols or rows change', () => {
    expect(sizeChanged(cur, { cols: 80, rows: 32 })).toBe(true);
    expect(sizeChanged(cur, { cols: 120, rows: 40 })).toBe(true);
  });
});

describe('SCROLLBACK', () => {
  it('keeps the most history for shells', () => {
    expect(SCROLLBACK.shell).toBeGreaterThan(SCROLLBACK.claude);
  });
});
