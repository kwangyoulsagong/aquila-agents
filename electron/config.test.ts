import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/shared/api/types';
import { applyProjectEdit, migrateLegacyDir, projectForPath, slugify, tildify } from './config';

const tmp: string[] = [];
const dir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-test-'));
  tmp.push(d);
  return d;
};
afterEach(() => tmp.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe('migrateLegacyDir', () => {
  it('copies the old config and state, skipping the hook settings', () => {
    const from = dir();
    const to = path.join(dir(), '.aquila');
    fs.writeFileSync(path.join(from, 'config.json'), '{"language":"en"}');
    fs.writeFileSync(path.join(from, 'state.json'), '{}');
    fs.writeFileSync(path.join(from, 'claude-hooks.json'), '{}');

    expect(migrateLegacyDir(from, to)).toBe(true);
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toBe('{"language":"en"}');
    expect(fs.existsSync(path.join(to, 'state.json'))).toBe(true);
    expect(fs.existsSync(path.join(to, 'claude-hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(from, 'config.json'))).toBe(true);
  });

  it('does nothing when the new config exists or there is no old one', () => {
    const from = dir();
    const to = dir();
    fs.writeFileSync(path.join(from, 'config.json'), '{"language":"en"}');
    fs.writeFileSync(path.join(to, 'config.json'), '{"language":"ko"}');
    expect(migrateLegacyDir(from, to)).toBe(false);
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toBe('{"language":"ko"}');
    expect(migrateLegacyDir(dir(), path.join(dir(), 'x'))).toBe(false);
  });
});

const base = (): Config => ({
  language: 'en',
  accounts: { shared: { claudeConfigDir: null }, personal: { claudeConfigDir: '~/.claude-personal' } },
  groups: [{ id: 'work' }, { id: 'personal' }],
  projects: [
    { id: 'a', name: 'A', group: 'work', account: 'shared', path: '~/a' },
    { id: 'b', name: 'B', group: 'personal', account: 'shared', path: '~/b' },
    { id: 'c', name: 'C', group: 'work', account: 'shared', path: '~/c' },
  ],
});
const ids = (c: Config, group?: string) =>
  c.projects.filter((p) => !group || p.group === group).map((p) => p.id);

describe('applyProjectEdit', () => {
  it('adds a project at the end of its group with a unique id and a ~ path', () => {
    const c = applyProjectEdit(
      base(),
      { op: 'addProject', path: '/home/me/code/A', name: '', group: 'work', account: 'personal' },
      '/home/me',
    );
    const added = c.projects.find((p) => p.path === '~/code/A')!;
    expect(added).toMatchObject({ id: 'a-2', name: 'A', group: 'work', account: 'personal' });
    expect(ids(c)).toEqual(['a', 'b', 'c', 'a-2']);
  });

  it('adds a remote project with its host, keeping the remote path as typed', () => {
    const c = applyProjectEdit(
      base(),
      {
        op: 'addProject',
        path: '~/code/api',
        name: '',
        group: 'work',
        account: 'shared',
        remote: { alias: ' devbox ', claudeConfigDir: ' ' },
      },
      '/home/me',
    );
    expect(c.projects.at(-1)).toMatchObject({ name: 'api', path: '~/code/api', remote: { alias: 'devbox' } });
    expect(c.projects.at(-1)!.remote).toEqual({ alias: 'devbox' });
    // Invalid host or no path: nothing is added.
    const bad = { op: 'addProject', name: '', group: 'work', account: 'shared' } as const;
    expect(applyProjectEdit(base(), { ...bad, path: '/x', remote: { alias: '-oX' } }).projects).toHaveLength(
      3,
    );
    expect(
      applyProjectEdit(base(), { ...bad, path: ' ', remote: { alias: 'devbox' } }).projects,
    ).toHaveLength(3);
  });

  it('updates a remote project host and path without tildifying', () => {
    const added = applyProjectEdit(
      base(),
      {
        op: 'addProject',
        path: '/srv/a',
        name: 'R',
        group: 'work',
        account: 'shared',
        remote: { alias: 'a' },
      },
      '/srv',
    );
    const id = added.projects.at(-1)!.id;
    const c = applyProjectEdit(
      added,
      { op: 'updateProject', id, path: '/srv/b', remote: { alias: 'b', claudeConfigDir: '~/.claude-w' } },
      '/srv',
    );
    expect(c.projects.at(-1)).toMatchObject({
      path: '/srv/b',
      remote: { alias: 'b', claudeConfigDir: '~/.claude-w' },
    });
  });

  it('falls back to a known group/account and keeps paths outside home as they are', () => {
    const c = applyProjectEdit(
      base(),
      { op: 'addProject', path: '/srv/x', name: ' 사이드 ', group: 'nope', account: 'nope' },
      '/home/me',
    );
    expect(c.projects.at(-1)).toMatchObject({
      id: 'project',
      name: '사이드',
      group: 'work',
      account: 'shared',
      path: '/srv/x',
    });
  });

  it('renames, regroups and switches account, ignoring blanks and unknown values', () => {
    let c = applyProjectEdit(base(), { op: 'updateProject', id: 'a', name: '  New  ', group: 'personal' });
    expect(c.projects[0]).toMatchObject({ name: 'New', group: 'personal' });
    c = applyProjectEdit(c, { op: 'updateProject', id: 'a', name: ' ', group: 'nope', account: 'nope' });
    expect(c.projects[0]).toMatchObject({ name: 'New', group: 'personal', account: 'shared' });
  });

  it('saves project settings and clears them with blanks', () => {
    let c = applyProjectEdit(
      base(),
      {
        op: 'updateProject',
        id: 'a',
        path: '/home/me/code/a2',
        defaultAgent: 'codex',
        defaultBranch: ' develop ',
        setupScript: 'npm ci\ncp .env.example .env\n\n',
        portBase: 3100,
        openIn: 'Cursor',
      },
      '/home/me',
    );
    expect(c.projects[0]).toMatchObject({
      path: '~/code/a2',
      defaultAgent: 'codex',
      defaultBranch: 'develop',
      setupScript: 'npm ci\ncp .env.example .env',
      portBase: 3100,
      openIn: 'Cursor',
    });
    // Invalid values are ignored; blank / null / 'claude' clear.
    c = applyProjectEdit(c, { op: 'updateProject', id: 'a', portBase: 80, defaultAgent: 'vim' as never });
    expect(c.projects[0]).toMatchObject({ portBase: 3100, defaultAgent: 'codex' });
    c = applyProjectEdit(c, {
      op: 'updateProject',
      id: 'a',
      defaultAgent: 'claude',
      defaultBranch: ' ',
      setupScript: '',
      portBase: null,
      openIn: '',
    });
    for (const key of ['defaultAgent', 'defaultBranch', 'setupScript', 'portBase', 'openIn'])
      expect(c.projects[0]).not.toHaveProperty(key);
  });

  it('finds the project of a folder, tilde or absolute', () => {
    const c = applyProjectEdit(base(), { op: 'updateProject', id: 'a', path: '/home/me/x' }, '/home/me');
    expect(projectForPath(c, '/home/me/x/', '/home/me')).toBe('a');
    expect(projectForPath(c, '~/x', '/home/me')).toBe('a');
    expect(projectForPath(c, '/home/me/x/sub', '/home/me')).toBeNull();
  });

  it('moves a project within and across groups', () => {
    let c = applyProjectEdit(base(), { op: 'moveProject', id: 'c', group: 'work', index: 0 });
    expect(ids(c, 'work')).toEqual(['c', 'a']);
    c = applyProjectEdit(c, { op: 'moveProject', id: 'a', group: 'personal', index: 0 });
    expect(ids(c, 'personal')).toEqual(['a', 'b']);
    c = applyProjectEdit(c, { op: 'moveProject', id: 'c', group: 'personal', index: 99 });
    expect(ids(c, 'personal')).toEqual(['a', 'b', 'c']);
    expect(ids(c, 'work')).toEqual([]);
    expect(applyProjectEdit(c, { op: 'moveProject', id: 'c', group: 'nope', index: 0 })).toBe(c);
  });

  it('removes a project', () => {
    expect(ids(applyProjectEdit(base(), { op: 'removeProject', id: 'b' }))).toEqual(['a', 'c']);
  });

  it('adds, renames, reorders and removes groups', () => {
    let c = applyProjectEdit(base(), { op: 'addGroup', label: 'Side Projects' });
    expect(c.groups.at(-1)).toEqual({ id: 'side-projects', label: 'Side Projects' });
    c = applyProjectEdit(c, { op: 'addGroup', label: 'Side projects' });
    expect(c.groups.at(-1)?.id).toBe('side-projects-2');
    expect(applyProjectEdit(c, { op: 'addGroup', label: '  ' })).toBe(c);

    c = applyProjectEdit(c, { op: 'renameGroup', id: 'work', label: 'Day job' });
    expect(c.groups[0]).toEqual({ id: 'work', label: 'Day job' });
    c = applyProjectEdit(c, { op: 'renameGroup', id: 'work', label: '' });
    expect(c.groups[0]).toEqual({ id: 'work' });

    c = applyProjectEdit(c, { op: 'moveGroup', id: 'side-projects', index: 0 });
    expect(c.groups.map((g) => g.id)).toEqual(['side-projects', 'work', 'personal', 'side-projects-2']);

    expect(applyProjectEdit(c, { op: 'removeGroup', id: 'work' })).toBe(c); // not empty
    c = applyProjectEdit(c, { op: 'removeGroup', id: 'side-projects' });
    expect(c.groups.map((g) => g.id)).toEqual(['work', 'personal', 'side-projects-2']);
  });
});

describe('helpers', () => {
  it('tildify / slugify', () => {
    expect(tildify('/home/me', '/home/me')).toBe('~');
    expect(tildify('/home/me/x', '/home/me')).toBe('~/x');
    expect(tildify('/home/meow', '/home/me')).toBe('/home/meow');
    expect(slugify('Road-To-PRO!', 'p')).toBe('road-to-pro');
    expect(slugify('한글', 'p')).toBe('p');
  });
});
