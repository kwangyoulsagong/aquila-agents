import { describe, expect, it } from 'vitest';
import type { Config } from '@/shared/api';
import { translator } from '@/shared/i18n';
import { buildCommands, commandDetail } from './commands';

const config: Config = {
  language: 'en',
  accounts: {},
  groups: [],
  projects: [{ id: 'p', name: 'App', group: 'g', account: 'shared', path: '/a/app' }],
};

describe('buildCommands worktrees', () => {
  it('lists Claude / Codex / Shell per linked worktree after the actions', () => {
    const list = buildCommands({
      config,
      sessions: [],
      activeProjectId: 'p',
      activeSessionId: null,
      available: new Set(['openWorktree', 'cleanupWorktrees']),
      worktrees: [{ path: '/a/app-wt/feat/x', branch: 'feat/x' }],
      t: translator('en'),
    });
    expect(list.map((c) => c.label)).toEqual([
      'App',
      'Open in worktree',
      'Clean up worktrees',
      'Claude · feat/x',
      'Codex · feat/x',
      'Shell · feat/x',
    ]);
    const codex = list[4];
    expect(codex).toMatchObject({ type: 'worktree', branch: 'feat/x', kind: 'codex' });
    expect(commandDetail(codex)).toBe('Worktree · /a/app-wt/feat/x');
  });
});
