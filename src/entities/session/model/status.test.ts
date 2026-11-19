import { describe, expect, it } from 'vitest';
import { mostUrgent } from './status';

describe('mostUrgent', () => {
  it('prefers waiting over everything', () => {
    expect(mostUrgent(['done', 'working', 'waiting'])).toBe('waiting');
  });
  it('orders error > working > done > idle', () => {
    expect(mostUrgent(['done', 'error', 'working'])).toBe('error');
    expect(mostUrgent(['done', 'working'])).toBe('working');
    expect(mostUrgent(['idle', 'done'])).toBe('done');
  });
  it('puts stopped between done and idle', () => {
    expect(mostUrgent(['idle', 'stopped'])).toBe('stopped');
    expect(mostUrgent(['stopped', 'done'])).toBe('done');
  });
  it('is idle with no sessions', () => {
    expect(mostUrgent([])).toBe('idle');
  });
});
