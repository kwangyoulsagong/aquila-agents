import { afterEach, describe, expect, it } from 'vitest';
import { countText, initialQuery } from './search';
import { closeFind, findState, openFind } from './store';

describe('countText', () => {
  it('is empty before a search, then says no results, the position, or the limit', () => {
    expect(countText(null, 'No results')).toBe('');
    expect(countText({ resultIndex: -1, resultCount: 0 }, 'No results')).toBe('No results');
    expect(countText({ resultIndex: 2, resultCount: 17 }, 'No results')).toBe('3/17');
    expect(countText({ resultIndex: -1, resultCount: 1000 }, 'No results')).toBe('1000+');
  });
});

describe('initialQuery', () => {
  it('takes a short one-line selection, else keeps the last query', () => {
    expect(initialQuery('  ENOENT  ', 'old')).toBe('ENOENT');
    expect(initialQuery('', 'old')).toBe('old');
    expect(initialQuery('two\nlines', 'old')).toBe('old');
    expect(initialQuery('x'.repeat(201), 'old')).toBe('old');
  });
});

describe('find store', () => {
  afterEach(() => closeFind());

  it('opens on one session, reopening bumps n, and closes only for that session', () => {
    openFind('a');
    const n = findState().n;
    openFind('a');
    expect(findState()).toEqual({ open: 'a', n: n + 1 });
    closeFind('b');
    expect(findState().open).toBe('a');
    openFind('b');
    expect(findState().open).toBe('b');
    closeFind('b');
    expect(findState().open).toBeNull();
  });
});
