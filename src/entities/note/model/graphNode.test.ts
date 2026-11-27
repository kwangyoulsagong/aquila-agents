import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@/shared/api';

const mocks = vi.hoisted(() => ({
  sessionAgentIds: vi.fn(),
  historyResume: vi.fn(),
}));
vi.mock('@/shared/api', () => ({ api: mocks }));

const { openSessionNode, sessionRef } = await import('./graphNode');

const tab = (id: string, extra: Partial<Session> = {}) => ({ id, kind: 'claude', ...extra }) as Session;

describe('session nodes outside the graph', () => {
  beforeEach(() => {
    mocks.sessionAgentIds.mockReset();
    mocks.historyResume.mockReset();
  });

  it('reads the history ref from the node id', () => {
    expect(sessionRef({ id: 'session:codex:abc:1' })).toEqual({ agent: 'codex', id: 'abc:1' });
    expect(sessionRef({ id: 'file:/x' })).toBeNull();
  });

  it('brings an open tab to the front, else resumes (adding the folder when the node has no project)', async () => {
    const onShow = vi.fn();
    const onResumed = vi.fn();
    const onError = vi.fn();
    mocks.sessionAgentIds.mockResolvedValue([{ tabId: 't1', agent: 'claude', sessionId: 's1' }]);
    await openSessionNode({ id: 'session:claude:s1' }, { sessions: [tab('t1')], onShow, onResumed, onError });
    expect(onShow).toHaveBeenCalledWith('t1');
    expect(mocks.historyResume).not.toHaveBeenCalled();

    // A dormant tab isn't running it: resume.
    mocks.historyResume.mockResolvedValue({ session: { id: 'new' } });
    await openSessionNode(
      { id: 'session:claude:s1', projects: ['p'] },
      { sessions: [tab('t1', { dormant: true })], onShow, onResumed, onError },
    );
    expect(mocks.historyResume).toHaveBeenCalledWith({ agent: 'claude', id: 's1' }, false);
    expect(onResumed).toHaveBeenCalledWith({ session: { id: 'new' } });

    mocks.historyResume.mockRejectedValue(new Error('gone'));
    await openSessionNode({ id: 'session:claude:s2' }, { sessions: [], onShow, onResumed, onError });
    expect(onError).toHaveBeenCalledWith('gone');
  });
});
