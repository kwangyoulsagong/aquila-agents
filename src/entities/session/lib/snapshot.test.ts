import { describe, expect, it } from 'vitest';
import { snapshotText, type BufferLike } from './snapshot';

const buffer = (rows: [string, boolean?][]): BufferLike => ({
  length: rows.length,
  getLine: (y) => {
    const r = rows[y];
    return r && { isWrapped: !!r[1], translateToString: () => r[0] };
  },
});

describe('snapshotText', () => {
  it('joins wrapped rows and drops trailing blank lines', () => {
    expect(snapshotText(buffer([['$ echo '], ['hello', true], ['hello'], [''], ['  ']]))).toBe('$ echo hello\nhello');
  });

  it('keeps the newest lines', () => {
    expect(snapshotText(buffer([['a'], ['b'], ['c']]), 2)).toBe('b\nc');
    expect(snapshotText(buffer([]))).toBe('');
  });
});
