import { describe, expect, it } from 'vitest';
import type { WorktreeInfo } from '@/shared/api';
import { translator } from '@/shared/i18n';
import { linkedWorktrees, parseWorktreeMenuId, worktreeMenuItems } from './menu';

const info: WorktreeInfo = {
  isRepo: true,
  repoRoot: '/a/repo',
  root: '/a/repo-wt',
  current: 'main',
  base: 'main',
  branches: ['main', 'feat/x'],
  worktrees: [
    { path: '/a/repo', branch: 'main' },
    { path: '/a/repo-wt/feat/x', branch: 'feat/x' },
  ],
};

describe('worktree menu', () => {
  it('lists linked worktrees only', () => {
    expect(linkedWorktrees(info)).toEqual([{ path: '/a/repo-wt/feat/x', branch: 'feat/x' }]);
    expect(linkedWorktrees({ ...info, isRepo: false })).toEqual([]);
    expect(linkedWorktrees(null)).toEqual([]);
  });

  it('round-trips a pick through the menu id, branches with colons included', () => {
    const items = worktreeMenuItems(translator('en'), [{ path: '/p', branch: 'fix:a/b' }]);
    expect(items[0].label).toBe('fix:a/b');
    expect(items[0].submenu?.map((i) => i.label)).toEqual(['Claude', 'Codex', 'Shell']);
    expect(parseWorktreeMenuId(items[0].submenu![1].id!)).toEqual({ kind: 'codex', branch: 'fix:a/b' });
  });

  it('names a detached worktree by its commit and opens it by path', () => {
    const items = worktreeMenuItems(translator('ko'), [{ path: '/a/repo-wt/tmp', branch: 'a1b2c3d', detached: true }]);
    expect(items[0].label).toBe('a1b2c3d (분리됨)');
    expect(parseWorktreeMenuId(items[0].submenu![0].id!)).toEqual({ kind: 'claude', branch: '/a/repo-wt/tmp' });
  });

  it('ignores other ids', () => {
    expect(parseWorktreeMenuId(null)).toBeNull();
    expect(parseWorktreeMenuId('claude')).toBeNull();
    expect(parseWorktreeMenuId('worktree:vim:x')).toBeNull();
    expect(parseWorktreeMenuId('worktree:claude:')).toBeNull();
  });
});
