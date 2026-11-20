import { describe, expect, it } from 'vitest';
import type { WorktreeCandidate } from '@/shared/api';
import { removable, sortCandidates, suggested } from './cleanup';

const c = (branch: string, merged: boolean, clean: boolean, open = false): WorktreeCandidate => ({
  path: `/r-wt/${branch}`,
  branch,
  merged,
  clean,
  open,
});

describe('worktree cleanup', () => {
  it('suggests merged + clean + closed, allows any clean + closed', () => {
    expect(suggested(c('a', true, true))).toBe(true);
    expect(suggested(c('a', false, true))).toBe(false);
    expect(suggested(c('a', true, true, true))).toBe(false);
    expect(removable(c('a', false, true))).toBe(true);
    expect(removable(c('a', true, false))).toBe(false);
    expect(removable(c('a', true, true, true))).toBe(false);
  });

  it('lists suggestions first', () => {
    const list = [c('z', false, true), c('b', true, true), c('a', true, false), c('c', true, true)];
    expect(sortCandidates(list).map((x) => x.branch)).toEqual(['b', 'c', 'a', 'z']);
  });
});
