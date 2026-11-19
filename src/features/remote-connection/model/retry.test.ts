import { describe, expect, it } from 'vitest';
import { secondsUntil } from './retry';

describe('secondsUntil', () => {
  it('rounds up and stops at zero', () => {
    expect(secondsUntil(undefined, 0)).toBeNull();
    expect(secondsUntil(10_000, 0)).toBe(10);
    expect(secondsUntil(10_000, 9_001)).toBe(1);
    expect(secondsUntil(10_000, 12_000)).toBe(0);
  });
});
