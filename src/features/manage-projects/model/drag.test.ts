import { describe, expect, it } from 'vitest';
import type { Project } from '@/shared/api';
import { dropPos, dropTarget } from './drag';

const p = (id: string, group: string): Project => ({
  id,
  name: id,
  group,
  account: 'shared',
  path: `~/${id}`,
});
const projects = [p('a', 'work'), p('b', 'work'), p('c', 'work'), p('x', 'personal')];

describe('dropTarget', () => {
  it('indexes among the group without the dragged project', () => {
    expect(dropTarget(projects, 'a', 'c', 'after')).toEqual({ group: 'work', index: 2 });
    expect(dropTarget(projects, 'a', 'c', 'before')).toEqual({ group: 'work', index: 1 });
    expect(dropTarget(projects, 'c', 'a', 'before')).toEqual({ group: 'work', index: 0 });
  });

  it('moves across groups', () => {
    expect(dropTarget(projects, 'a', 'x', 'before')).toEqual({ group: 'personal', index: 0 });
    expect(dropTarget(projects, 'x', 'b', 'after')).toEqual({ group: 'work', index: 2 });
  });

  it('ignores dropping on itself or an unknown row', () => {
    expect(dropTarget(projects, 'a', 'a', 'after')).toBeNull();
    expect(dropTarget(projects, 'a', 'zz', 'after')).toBeNull();
  });
});

describe('dropPos', () => {
  it('splits the row in halves', () => {
    expect(dropPos(10, { top: 0, height: 32 })).toBe('before');
    expect(dropPos(20, { top: 0, height: 32 })).toBe('after');
  });
});
