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

describe('SessionManager on screen (T45)', () => {
  const local: Config = { ...config, projects: [{ ...config.projects[0], path: os.tmpdir() }] };
  let focused: boolean;
  let m: SessionManager;
  beforeEach(() => {
    vi.useFakeTimers();
    focused = true;
    const win = { isFocused: () => focused } as unknown as Electron.BrowserWindow;
    m = new SessionManager({ send: () => {}, getWindow: () => win, hookPort: 0, hookSettingsPath: () => '' });
  });
  afterEach(() => vi.useRealTimers());

  it('every visible pane of the focused window counts, not only the active tab', () => {
    const a = m.create(local, 'a', 'shell');
    const b = m.create(local, 'a', 'shell');
    const c = m.create(local, 'a', 'shell');
    m.setActive(a.id);
    m.setVisible(a.id, true);
    m.setVisible(b.id, true); // the other pane of a split
    expect([a, b, c].map((s) => m.onScreen(s.id))).toEqual([true, true, false]);
    m.setVisible(b.id, false);
    expect(m.onScreen(b.id)).toBe(false);
    focused = false;
    expect(m.onScreen(a.id)).toBe(false);
  });
});

describe('SessionManager waiting reason (T52)', () => {
  const local: Config = { ...config, projects: [{ ...config.projects[0], path: os.tmpdir() }] };
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

  const lastStatus = () =>
    sent.filter((s) => s.channel === IPC.sessionStatus).at(-1)?.payload as
      Record<string, unknown> | undefined;

  it('sends the permission summary with the status, also when it arrives late, and drops it on a new turn', () => {
    const s = m.create(local, 'a', 'claude');
    m.onHook(s.id, { event: 'PermissionRequest' });
    expect(lastStatus()).toMatchObject({ id: s.id, status: 'waiting' });
    expect(lastStatus()?.detail).toBeUndefined();

    m.onHook(s.id, { event: 'PermissionRequest', detail: 'Bash: rm -rf dist' });
    expect(lastStatus()).toMatchObject({ status: 'waiting', detail: 'Bash: rm -rf dist' });

    m.onHook(s.id, { event: 'UserPromptSubmit' });
    expect(lastStatus()).toMatchObject({ status: 'working' });
    expect(lastStatus()?.detail).toBeUndefined();
  });
});

describe('SessionManager reopen (T54)', () => {
  let m: SessionManager;
  const local: Config = { ...config, projects: [{ ...config.projects[0], path: os.tmpdir() }] };
  beforeEach(() => {
    vi.useFakeTimers();
    m = new SessionManager({
      send: () => {},
      getWindow: () => null,
      hookPort: 0,
      hookSettingsPath: () => '',
    });
  });
  afterEach(() => vi.useRealTimers());

  it('restarts an agent tab under a new id in the same slot, keeping its title', () => {
    const first = m.create(local, 'a', 'shell');
    const agent = m.create(local, 'a', 'codex');
    const last = m.create(local, 'a', 'shell');
    m.rename(agent.id, 'Mine');
    const next = m.reopen(local, agent.id);
    expect(next.id).not.toBe(agent.id);
    expect(next).toMatchObject({ kind: 'codex', title: 'Mine' });
    expect(m.tabs().map((t) => t.kind)).toEqual(['shell', 'codex', 'shell']);
    expect(m.has(first.id) && m.has(last.id) && m.has(next.id)).toBe(true);
  });

  it('refuses shells and unknown tabs', () => {
    const shell = m.create(local, 'a', 'shell');
    expect(() => m.reopen(local, shell.id)).toThrow();
    expect(() => m.reopen(local, 'nope')).toThrow();
  });
});
