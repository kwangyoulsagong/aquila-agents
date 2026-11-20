import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { dock: { setBadge: () => {} } },
  Notification: class {
    static isSupported = () => false;
  },
}));
vi.mock('node-pty', () => ({
  spawn: () => ({
    pid: 1,
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    pause: () => {},
    resume: () => {},
    write: () => {},
    resize: () => {},
    kill: () => {},
  }),
}));

import { SessionManager } from './sessions';
import { planRestore, readState, writeState, type RestorePlan } from './state';
import { IPC, type Config } from '../src/shared/api/types';

const KEY = '9b2d6f1e-3c4a-4e8b-9f0a-1d2c3b4a5e6f';
const config: Config = {
  language: 'en',
  accounts: {},
  groups: [],
  projects: [{ id: 'a', name: 'A', group: 'work', account: 'shared', path: '/tmp/a' }],
};

describe('SessionManager titles (T43)', () => {
  let sent: { channel: string; payload: unknown }[];
  let m: SessionManager;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    m = new SessionManager({
      send: (channel, payload) => sent.push({ channel, payload }),
      getWindow: () => null,
      hookPort: 0,
      hookSettingsPath: () => '',
    });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps a rename through a restart', () => {
    const plan: RestorePlan = {
      key: KEY,
      projectId: 'a',
      kind: 'shell',
      cold: true,
      prompt: 'Add dark mode',
    };
    const tab = m.prepare(config, plan);
    expect(tab).toMatchObject({ prompt: 'Add dark mode', dormant: true });

    m.rename(tab.id, '  Dark   mode  ');
    expect(sent).toEqual([
      { channel: IPC.sessionTitle, payload: { id: tab.id, title: 'Dark mode', prompt: 'Add dark mode' } },
    ]);

    // Quit → state.json → relaunch.
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-titles-')), 'state.json');
    writeState(m.tabs(), null, file);
    const [next] = planRestore(readState(file), config);
    const restored = new SessionManager({
      send: () => {},
      getWindow: () => null,
      hookPort: 0,
      hookSettingsPath: () => '',
    }).prepare(config, next);
    expect(restored).toMatchObject({ title: 'Dark mode', prompt: 'Add dark mode' });
  });

  it('a restored tab that starts keeps its title and prompt', () => {
    const local: Config = { ...config, projects: [{ ...config.projects[0], path: os.tmpdir() }] };
    const tab = m.prepare(local, {
      key: KEY,
      projectId: 'a',
      kind: 'shell',
      cold: true,
      title: 'T',
      prompt: 'P',
    });
    expect(m.wake(local, tab.id)).toMatchObject({ id: tab.id, title: 'T', prompt: 'P' });
    expect(m.tabs()[0]).toMatchObject({ title: 'T', prompt: 'P' });
  });

  it('an empty rename goes back to the automatic title; unknown tabs are ignored', () => {
    const tab = m.prepare(config, { key: KEY, projectId: 'a', kind: 'shell', cold: true, title: 'Mine' });
    m.rename(tab.id, '   ');
    expect(sent.at(-1)?.payload).toEqual({ id: tab.id });
    expect(m.tabs()[0].title).toBeUndefined();
    m.rename('nope', 'x');
    expect(sent).toHaveLength(1);
  });
});
