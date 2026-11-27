import { describe, expect, it } from 'vitest';
import { createLatest } from './latest';

describe('createLatest', () => {
  it('drops a slow reply for the previous source once another is selected', () => {
    const l = createLatest<string | null>('a');
    const forA = l.start('a');
    l.select('b');
    const forB = l.start('b');
    expect(forA()).toBe(false);
    expect(forB()).toBe(true);
  });

  it('a newer request for the same source wins over an older one still in flight', () => {
    const l = createLatest('a');
    const first = l.start('a');
    const second = l.start('a');
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('switching back does not revive the old reply', () => {
    const l = createLatest('a');
    const old = l.start('a');
    l.select('b');
    l.select('a');
    expect(old()).toBe(false);
  });
});
