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

describe('buildCommands session titles (T43)', () => {
  it('lists sessions by title, numbering only titles that repeat', () => {
    const base = { projectId: 'p', status: 'idle' as const };
    const list = buildCommands({
      config,
      sessions: [
        { ...base, id: '1', kind: 'claude', prompt: 'Add dark mode' },
        { ...base, id: '2', kind: 'claude', prompt: 'Fix login', title: 'Auth' },
        { ...base, id: '3', kind: 'shell' },
        { ...base, id: '4', kind: 'shell' },
        { ...base, id: '5', kind: 'codex', worktree: { path: '/a/app-wt/feat/x', branch: 'feat/x' } },
      ],
      activeProjectId: 'p',
      activeSessionId: null,
      available: new Set(),
      t: translator('en'),
    });
    expect(list.filter((c) => c.type === 'session').map((c) => c.label)).toEqual([
      'Add dark mode · App',
      'Auth · App',
      'Shell 1 · App',
      'Shell 2 · App',
      'feat/x · App',
    ]);
  });
});
