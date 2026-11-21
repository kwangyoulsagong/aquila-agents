import { describe, expect, it } from 'vitest';
import type { Session } from '@/shared/api';
import { pickTarget } from './pickTarget';

const claude: Session = { id: 's1', projectId: 'p', kind: 'claude', status: 'idle' };

describe('pickTarget', () => {
  it('pastes into a live Claude or Codex tab', () => {
    expect(pickTarget(claude)).toEqual({ kind: 'paste', session: claude });
    const codex = { ...claude, kind: 'codex' as const, status: 'working' as const };
    expect(pickTarget(codex)).toEqual({ kind: 'paste', session: codex });
  });

  it('never pastes into a tab waiting on a question or permission', () => {
    const waiting = { ...claude, status: 'waiting' as const };
    expect(pickTarget(waiting)).toEqual({ kind: 'busy', session: waiting });
  });

  it('copies when there is nothing to paste into', () => {
    expect(pickTarget(undefined)).toEqual({ kind: 'none' });
    expect(pickTarget({ ...claude, kind: 'shell' })).toEqual({ kind: 'none' });
    expect(pickTarget({ ...claude, dormant: true })).toEqual({ kind: 'none' });
    expect(pickTarget({ ...claude, exited: true })).toEqual({ kind: 'none' });
    expect(pickTarget({ ...claude, remote: 'box', connection: 'lost' })).toEqual({ kind: 'none' });
  });

  it('pastes into a connected remote tab', () => {
    const remote = { ...claude, remote: 'box', connection: 'connected' as const };
    expect(pickTarget(remote)).toEqual({ kind: 'paste', session: remote });
  });
});
