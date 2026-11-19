import { describe, expect, it } from 'vitest';
import { elapsedParts } from './time';

describe('elapsedParts', () => {
  it('is null under a minute', () => {
    expect(elapsedParts(0)).toBeNull();
    expect(elapsedParts(59_999)).toBeNull();
    expect(elapsedParts(-5000)).toBeNull();
  });
  it('splits whole hours and minutes', () => {
    expect(elapsedParts(60_000)).toEqual({ h: 0, m: 1 });
    expect(elapsedParts(12 * 60_000 + 59_000)).toEqual({ h: 0, m: 12 });
    expect(elapsedParts(65 * 60_000)).toEqual({ h: 1, m: 5 });
    expect(elapsedParts(120 * 60_000)).toEqual({ h: 2, m: 0 });
  });
});
