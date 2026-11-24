import { describe, expect, it } from 'vitest';
import { dropSide, moveSession } from './order';

const tabs = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe('moveSession', () => {
  const list = tabs('a', 'b', 'c', 'd');

  it('moves a tab before or after another', () => {
    expect(ids(moveSession(list, 'a', 'c', 'after'))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(moveSession(list, 'a', 'c', 'before'))).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(moveSession(list, 'd', 'a', 'before'))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(moveSession(list, 'b', 'd', 'after'))).toEqual(['a', 'c', 'd', 'b']);
  });

  it('returns the same list when nothing moves', () => {
    expect(moveSession(list, 'b', 'b', 'after')).toBe(list);
    expect(moveSession(list, 'b', 'c', 'before')).toBe(list);
    expect(moveSession(list, 'b', 'a', 'after')).toBe(list);
    expect(moveSession(list, 'x', 'a', 'before')).toBe(list);
    expect(moveSession(list, 'a', 'x', 'before')).toBe(list);
  });

  it('keeps the other items (tabs of other projects) in place', () => {
    const mixed = [
      { id: 'a', p: 1 },
      { id: 'x', p: 2 },
      { id: 'b', p: 1 },
      { id: 'c', p: 1 },
    ];
    expect(ids(moveSession(mixed, 'c', 'a', 'before'))).toEqual(['c', 'a', 'x', 'b']);
    expect(moveSession(mixed, 'c', 'a', 'before')[0]).toBe(mixed[3]);
  });
});

describe('dropSide', () => {
  const rect = { left: 100, width: 80 };
  it('splits a tab at its middle', () => {
    expect(dropSide(110, rect)).toBe('before');
    expect(dropSide(139, rect)).toBe('before');
    expect(dropSide(140, rect)).toBe('after');
    expect(dropSide(179, rect)).toBe('after');
  });
});
