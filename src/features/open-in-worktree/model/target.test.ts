import { describe, expect, it } from 'vitest';
import type { WorktreeInfo } from '@/shared/api';
import { worktreeTarget } from './target';

const info: WorktreeInfo = {
  isRepo: true,
  repoRoot: '/a/repo',
  root: '/a/repo-wt',
  current: 'main',
  base: 'main',
  branches: ['main', 'feat/x', 'old'],
  worktrees: [
    { path: '/a/repo', branch: 'main' },
    { path: '/a/repo-wt/feat/x', branch: 'feat/x' },
  ],
};

describe('worktreeTarget', () => {
  it('reuses a worktree, checks out an existing branch, or creates one from the current branch', () => {
    expect(worktreeTarget(info, 'feat/x')).toEqual({ kind: 'reuse', path: '/a/repo-wt/feat/x' });
    expect(worktreeTarget(info, ' old ')).toEqual({ kind: 'checkout', path: '/a/repo-wt/old' });
    expect(worktreeTarget(info, 'feat/y')).toEqual({
      kind: 'create',
      path: '/a/repo-wt/feat/y',
      from: 'main',
    });
  });

  it('is empty without a branch or a repo', () => {
    expect(worktreeTarget(info, '  ')).toBeNull();
    expect(worktreeTarget({ ...info, isRepo: false }, 'x')).toBeNull();
  });
});
