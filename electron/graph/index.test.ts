import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addSource,
  autoSources,
  effectiveSources,
  GraphService,
  mergeStatus,
  readAutoPrefs,
  readSources,
  SourceError,
  sourceId,
  tildify,
  withExcludes,
  writeSources,
} from './index';

const HOME = '/Users/me';

describe('addSource', () => {
  it('adds an enabled source with a unique slug id and a ~ path', () => {
    const one = addSource([], '/Users/me/Notes/Meeting Notes', HOME);
    expect(one).toEqual([{ id: 'meeting-notes', path: '~/Notes/Meeting Notes', enabled: true }]);
    const two = addSource(one, '/Volumes/x/meeting notes', HOME);
    expect(two[1]).toEqual({ id: 'meeting-notes-2', path: '/Volumes/x/meeting notes', enabled: true });
  });

  it('refuses the same folder, one inside a source, or one around it', () => {
    const list = addSource([], '/Users/me/notes', HOME);
    for (const p of ['/Users/me/notes', '/Users/me/notes/sub', '/Users/me'])
      expect(() => addSource(list, p, HOME)).toThrow(SourceError);
    expect(() => addSource(list, '/Users/me/notes-2', HOME)).not.toThrow();
  });
});

describe('sourceId / tildify', () => {
  it('slugs Korean names and falls back to "notes"', () => {
    expect(sourceId('/x/회의 노트', [])).toBe('회의-노트');
    expect(sourceId('/x/!!!', ['notes'])).toBe('notes-2');
    expect(tildify('/Users/me', HOME)).toBe('~');
    expect(tildify('/Users/meow', HOME)).toBe('/Users/meow');
  });
});

describe('sources.json', () => {
  it('round-trips and ignores broken entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-sources-'));
    const file = path.join(dir, 'graph', 'sources.json');
    expect(readSources(file)).toEqual([]);
    writeSources(file, [{ id: 'a', path: '~/a', enabled: false }]);
    expect(readSources(file)).toEqual([{ id: 'a', path: '~/a', enabled: false }]);
    fs.writeFileSync(
      file,
      JSON.stringify({ sources: [{ id: 'b' }, { id: 'c', path: '/c', enabled: true }] }),
    );
    expect(readSources(file)).toEqual([{ id: 'c', path: '/c', enabled: true }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('mergeStatus', () => {
  it('disabled sources are off; enabled ones show the worker state, indexing until it reports', () => {
    const st = mergeStatus(
      [
        { id: 'a', path: '~/a', enabled: true },
        { id: 'b', path: '~/b', enabled: false },
        { id: 'c', path: '~/c', enabled: true },
      ],
      {
        sources: [{ id: 'a', state: 'ready', notes: 3 }],
        notes: 3,
        edges: 2,
        idGroups: [],
        version: 4,
        links: { rules: [], proposals: [], ai: [], accepted: 0, rejected: 0 },
      },
    );
    expect(st.sources.map((s) => [s.id, s.state, s.notes])).toEqual([
      ['a', 'ready', 3],
      ['b', 'off', 0],
      ['c', 'indexing', 0],
    ]);
    expect(st).toMatchObject({ notes: 3, edges: 2, version: 4 });
  });
});

describe('notePath', () => {
  it('only gives back Markdown files inside an enabled source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-notepath-'));
    const notes = path.join(dir, 'notes');
    const off = path.join(dir, 'off');
    fs.mkdirSync(notes);
    fs.mkdirSync(off);
    for (const f of [path.join(notes, 'a.md'), path.join(notes, 'a.txt'), path.join(off, 'b.md'), path.join(dir, 'c.md')])
      fs.writeFileSync(f, '# x');
    writeSources(path.join(dir, 'sources.json'), [
      { id: 'notes', path: notes, enabled: true },
      { id: 'off', path: off, enabled: false },
    ]);
    const g = new GraphService({ dir, workerFile: '/nope', saver: false, projects: () => [], onStatus: () => {} });
    expect(g.notePath(path.join(notes, 'a.md'))).toBe(path.join(notes, 'a.md'));
    expect(g.notePath(path.join(notes, '..', 'c.md'))).toBeNull();
    expect(g.notePath(path.join(notes, 'a.txt'))).toBeNull();
    expect(g.notePath(path.join(off, 'b.md'))).toBeNull();
    expect(g.notePath(path.join(notes, 'gone.md'))).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('project folders as sources (T73)', () => {
  const home = '/Users/me';
  const projects = [
    { id: 'home', root: '/Users/me' },
    { id: 'salt', root: '/Users/me/Desktop/SALT' },
    { id: 'inner', root: '/Users/me/Desktop/SALT/salt-server' },
    { id: 'a b', root: '/Users/me/code/a' },
    { id: 'dup', root: '/Users/me/code/a/' },
  ];
  const auto = autoSources(projects, home);

  it('one per project folder: not home, nested ones each their own, the first of duplicates', () => {
    expect(auto.map((s) => [s.id, s.path])).toEqual([
      ['project-salt', '~/Desktop/SALT'],
      ['project-inner', '~/Desktop/SALT/salt-server'],
      ['project-a-b', '~/code/a'],
    ]);
  });

  it("keeps the user's own sources as they are; a project at exactly a user folder is that folder", () => {
    const user = [
      { id: 'requirements', path: '~/Desktop/SALT/requirements', enabled: true, ai: true },
      { id: 'a', path: '~/code/a', enabled: false },
    ];
    const all = effectiveSources(user, auto, home, { 'project-salt': { enabled: false } });
    expect(all.map((s) => [s.id, s.enabled])).toEqual([
      ['requirements', true],
      ['a', false],
      ['project-salt', false],
      ['project-inner', true],
    ]);
    expect(all[0]!.ai).toBe(true);
  });

  it('nested sources: the outer one leaves every inner folder out, on or off', () => {
    const all = effectiveSources(
      [
        { id: 'requirements', path: '~/Desktop/SALT/requirements', enabled: false },
        { id: 'code', path: '~/code', enabled: true },
      ],
      auto,
      home,
    );
    expect(withExcludes(all, home).map((x) => [x.source.id, x.exclude])).toEqual([
      ['requirements', []],
      ['code', ['a']],
      ['project-salt', ['requirements', 'salt-server']],
      ['project-inner', []],
      ['project-a-b', []],
    ]);
  });

  it('settings on project folders round-trip beside the sources', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-auto-'));
    const file = path.join(dir, 'sources.json');
    writeSources(file, [], { 'project-salt': { enabled: false, ai: true } });
    expect(readAutoPrefs(file)).toEqual({ 'project-salt': { enabled: false, ai: true } });
    expect(readSources(file)).toEqual([]);
  });

  it('a new folder never takes an id a project folder has', () => {
    const next = addSource([], '/Users/me/x/project-salt', home, ['project-salt']);
    expect(next[0]!.id).not.toBe('project-salt');
  });
});
