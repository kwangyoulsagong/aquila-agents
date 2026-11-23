import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultPresetId, VaultView } from '../../src/shared/api/types';
import {
  applyAction,
  buildView,
  cleanFolder,
  cleanVault,
  companionsOf,
  compileLinkRules,
  insertBlock,
  matchesOf,
  movedRel,
  nameKeys,
  outline,
  parseSuggestion,
  preset,
  readVault,
  renderTemplate,
  setProperty,
  SHARED_FILE,
  VaultService,
  type VaultGraph,
  type VaultNote,
} from './vault';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'vault', 'requirements');
const NOW = new Date(2026, 10, 23, 9, 5);

describe('cleanVault', () => {
  it('keeps a valid config and drops what is unsafe', () => {
    const { config, problems } = cleanVault({
      links: [
        { pattern: 'DB-\\d+', to: 'name' },
        { pattern: '(', to: 'name' },
        { pattern: '.*', to: 'name' },
        { pattern: 'X-\\d+', to: 'url', url: 'javascript:alert(1)' },
        { pattern: 'J-\\d+', to: 'url', url: 'https://jira.example.com/browse/$0' },
      ],
      properties: [
        { key: 'status', type: 'select', options: ['a', 'b'] },
        { key: 'status', type: 'text' },
        { key: 'x', type: 'color' },
      ],
      templates: [
        { name: 'Spec', folder: '../out', file: 'a.md' },
        { name: 'Spec', folder: 'specs', file: '{{title}}.md', body: '# {{title}}' },
      ],
      views: [{ name: 'Board', kind: 'board', group: 'folder', folder: 'specs' }, { kind: 'grid' }],
      actions: [
        { name: 'Log', kind: 'insert', block: '- x' },
        { name: 'Run', kind: 'shell' },
      ],
      companions: { folders: ['a'] },
      newNotes: 'nope',
    });
    expect(config.links.map((l) => l.pattern)).toEqual(['DB-\\d+', 'J-\\d+']);
    expect(config.properties).toEqual([{ key: 'status', type: 'select', options: ['a', 'b'] }]);
    expect(config.templates).toEqual([
      { id: 'spec', name: 'Spec', folder: 'specs', file: '{{title}}.md', body: '# {{title}}' },
    ]);
    expect(config.views).toEqual([
      { id: 'board', name: 'Board', kind: 'board', folder: 'specs', group: 'folder' },
    ]);
    expect(config.actions).toEqual([{ id: 'log', name: 'Log', kind: 'insert', block: '- x' }]);
    expect(config.companions).toBeUndefined();
    expect(config.newNotes).toBeUndefined();
    expect(problems.length).toBe(9);
  });

  it('accepts its own output unchanged (every preset round-trips)', () => {
    for (const id of ['basic', 'status-board', 'daily', 'meeting', 'empty'] satisfies VaultPresetId[])
      for (const lang of ['ko', 'en'] as const) {
        const p = preset(id, lang);
        expect(cleanVault(p)).toEqual({ config: p, problems: [] });
      }
  });

  it('cleans folders', () => {
    expect(cleanFolder('./specs/done/')).toBe('specs/done');
    expect(cleanFolder('')).toBe('');
    expect(cleanFolder('a/../b')).toBeNull();
    expect(cleanFolder('/etc')).toBe('etc');
    expect(cleanFolder('.git')).toBeNull();
  });
});

describe('templates', () => {
  it('fills variables in the file name and body', () => {
    const t = {
      id: 'm',
      name: 'M',
      folder: 'meetings',
      file: '{{date}} {{title}}.md',
      body: 'date: {{date}} {{time}} {{id}} {{nope}}',
    };
    expect(renderTemplate(t, 'DB-12 sync: plan/b', NOW)).toEqual({
      rel: 'meetings/2026-11-23 DB-12 sync- plan-b.md',
      text: 'date: 2026-11-23 09:05 DB-12 {{nope}}',
    });
    expect(renderTemplate({ ...t, folder: '', file: '{{slug}}' }, '로그인 Flow', NOW).rel).toBe(
      '로그인-flow.md',
    );
  });
});

const rels = [
  'specs/to-do/DB-7100-search.md',
  'specs/in-progress/DB-7049-dashboard.md',
  'specs/done/DB-6891-downloads.md',
  'reports/checklists/DB-6891.md',
  'reports/retrospects/DB-6891.md',
  'reports/checklists/DB-7049.md',
];
const companions = { folders: ['specs', 'reports/checklists', 'reports/retrospects'], key: '^([A-Z]+-\\d+)' };

describe('companions', () => {
  it('finds the same key in the other folders, in folder order', () => {
    expect(companionsOf('reports/checklists/DB-6891.md', rels, companions)).toEqual([
      { label: 'specs', rel: 'specs/done/DB-6891-downloads.md' },
      { label: 'checklists', rel: 'reports/checklists/DB-6891.md' },
      { label: 'retrospects', rel: 'reports/retrospects/DB-6891.md' },
    ]);
    expect(companionsOf('specs/to-do/DB-7100-search.md', rels, companions)).toEqual([]);
    expect(companionsOf('notes/x.md', rels, companions)).toEqual([]);
    // Without a key: the whole file name.
    expect(
      companionsOf('reports/checklists/DB-6891.md', rels, {
        folders: ['reports/checklists', 'reports/retrospects'],
      }),
    ).toHaveLength(2);
  });
});

const note = (rel: string, frontmatter: Record<string, string | string[]> = {}, mtime = 1): VaultNote => ({
  rel,
  abs: `/v/${rel}`,
  title: rel.split('/').pop()!.replace(/\.md$/, ''),
  frontmatter,
  headings: [],
  mtime,
});

describe('views', () => {
  const notes = rels.map((r, i) => note(r, { priority: i % 2 ? 'high' : 'low' }, i));
  it('groups by sub-folder, fixed order first, empty columns kept', () => {
    const view: VaultView = {
      id: 'b',
      name: 'B',
      kind: 'board',
      folder: 'specs',
      group: 'folder',
      order: ['to-do', 'in-progress', 'review', 'done'],
    };
    const data = buildView(cleanVault({}).config, view, notes);
    expect(data.groups.map((g) => [g.key, g.cards.map((c) => c.rel)])).toEqual([
      ['to-do', ['specs/to-do/DB-7100-search.md']],
      ['in-progress', ['specs/in-progress/DB-7049-dashboard.md']],
      ['review', []],
      ['done', ['specs/done/DB-6891-downloads.md']],
    ]);
  });
  it('groups by a property: select options first, none last', () => {
    const cfg = cleanVault({
      properties: [{ key: 'priority', type: 'select', options: ['high', 'mid'] }],
    }).config;
    const view: VaultView = { id: 't', name: 'T', kind: 'table', group: 'property', key: 'priority' };
    const data = buildView(cfg, view, [...notes, note('loose.md')]);
    expect(data.groups.map((g) => [g.key, g.cards.length])).toEqual([
      ['high', 3],
      ['mid', 0],
      ['low', 3],
      ['', 1],
    ]);
  });
  it('moves a card between folder groups', () => {
    const view: VaultView = { id: 'b', name: 'B', kind: 'board', folder: 'specs', group: 'folder' };
    expect(movedRel(view, 'specs/to-do/DB-7100-search.md', 'done')).toBe('specs/done/DB-7100-search.md');
    expect(movedRel(view, 'specs/done/a.md', 'done')).toBeNull();
    expect(movedRel(view, 'specs/done/a.md', '')).toBe('specs/a.md');
    expect(movedRel(view, 'specs/done/a.md', '../x')).toBeNull();
    expect(movedRel(view, 'other/a.md', 'done')).toBeNull();
  });
});

describe('setProperty', () => {
  it('changes only the key line, in the file’s line ending', () => {
    const src = '---\r\ntitle: A\r\nstatus: todo  \r\ntags: [x]\r\n---\r\nbody  \r\n';
    expect(setProperty(src, 'status', 'done')).toBe(
      '---\r\ntitle: A\r\nstatus: done\r\ntags: [x]\r\n---\r\nbody  \r\n',
    );
    expect(setProperty(src, 'owner', 'Kim')).toBe(
      '---\r\ntitle: A\r\nstatus: todo  \r\ntags: [x]\r\nowner: Kim\r\n---\r\nbody  \r\n',
    );
    expect(setProperty(src, 'status', '')).toBe('---\r\ntitle: A\r\ntags: [x]\r\n---\r\nbody  \r\n');
    expect(setProperty(src, 'tags', ['a', 'b, c'])).toBe(
      '---\r\ntitle: A\r\nstatus: todo  \r\ntags: [a, "b, c"]\r\n---\r\nbody  \r\n',
    );
  });
  it('keeps a block list a block list', () => {
    const src = '---\nlabels:\n    - a\n    - b\nx: 1\n---\n';
    expect(setProperty(src, 'labels', ['c'])).toBe('---\nlabels:\n    - c\nx: 1\n---\n');
  });
  it('quotes values YAML would misread', () => {
    expect(setProperty('---\n---\n', 'a', 'x: y')).toBe('---\na: "x: y"\n---\n');
    expect(setProperty('---\nb: 1\n---\n', 'a', '[[Login]]')).toBe('---\nb: 1\na: "[[Login]]"\n---\n');
  });
  it('adds frontmatter when there is none, and leaves the note alone for an empty value', () => {
    expect(setProperty('# A\n', 'status', 'done')).toBe('---\nstatus: done\n---\n# A\n');
    expect(setProperty('# A\n', 'status', '')).toBe('# A\n');
    expect(setProperty('---\nb: 1\n---\n', 'a', '')).toBe('---\nb: 1\n---\n');
  });
});

describe('insertBlock', () => {
  const doc = '# A\n\n## Changelog\n\n- old\n\n## Notes\n\ntext\n';
  it('adds at the end of the section, before its blank lines', () => {
    expect(insertBlock(doc, '- new\n', 'changelog')).toBe(
      '# A\n\n## Changelog\n\n- old\n- new\n\n## Notes\n\ntext\n',
    );
    expect(insertBlock(doc, '- x', 'Notes')).toBe('# A\n\n## Changelog\n\n- old\n\n## Notes\n\ntext\n- x\n');
  });
  it('adds the heading at the end when it is missing, or the block at the end with no heading', () => {
    expect(insertBlock('# A\nend', '- x', 'Log')).toBe('# A\nend\n\n## Log\n\n- x\n');
    expect(insertBlock('a\r\nb', 'c\nd')).toBe('a\r\nb\r\nc\r\nd\r\n');
  });
  it('ignores headings inside code fences and frontmatter', () => {
    const src = '---\nx: 1\n---\n## Log\n\n```\n## Other\n```\n## Next\n';
    expect(insertBlock(src, '- y', 'Log')).toBe(
      '---\nx: 1\n---\n## Log\n\n```\n## Other\n```\n- y\n## Next\n',
    );
  });
  it('applies an insert action with its properties', () => {
    const src = '---\nrevised: 2026-01-01\n---\n# DB-1\n\n## Changelog\n\n- old\n';
    const out = applyAction(
      src,
      {
        id: 'c',
        name: 'C',
        kind: 'insert',
        under: 'Changelog',
        block: '- **{{date}}**: ',
        set: { revised: '{{date}}' },
      },
      { date: '2026-11-23' },
    );
    expect(out).toBe('---\nrevised: 2026-11-23\n---\n# DB-1\n\n## Changelog\n\n- old\n- **2026-11-23**: \n');
  });
});

describe('link rules', () => {
  it('compiles name / property rules (URL rules stay in the editor) and matches lowercased text', () => {
    const rules = compileLinkRules([
      { pattern: '\\bDB-\\d+\\b', to: 'name' },
      { pattern: 'J-\\d+', to: 'url', url: 'https://j/$0' },
    ]);
    expect(rules).toHaveLength(1);
    expect(matchesOf(rules[0].re, 'see db-12 and DB-12, db-7')).toEqual(['db-12', 'db-7']);
    expect(nameKeys('specs/DB-12-login flow.md')).toEqual(['db-12-login flow', 'db-12-login', 'db-12', 'db']);
  });
});

describe('Make with Claude', () => {
  it('outlines a folder and validates the reply', () => {
    const text = outline([
      { ...note('specs/done/a.md', { status: 'done' }), headings: ['Changelog'] },
      { ...note('specs/done/b.md', { status: 'done' }), headings: ['Changelog'] },
    ]);
    expect(text).toContain('- specs/done/ (2): a.md, b.md');
    expect(text).toContain('- status: done (2)');
    expect(text).toContain('Changelog (2)');
    expect(parseSuggestion('Here:\n{"views":[{"name":"B","kind":"board","group":"folder"}]}')).toMatchObject({
      config: { views: [{ id: 'b' }] },
    });
    expect(parseSuggestion('no')).toEqual({ error: 'noJson' });
    expect(parseSuggestion('{bad}')).toEqual({ error: 'badJson' });
  });
});

describe('files and the service', () => {
  let tmp: string;
  let root: string;
  let changed: string[];
  let refreshed: number;
  let svc: VaultService;
  const graph = (): VaultGraph => ({
    sourceRoot: (id) => (id === 'req' ? root : null),
    sourceOf: (abs) => {
      const rel = path.relative(root, abs);
      return rel.startsWith('..') ? null : { id: 'req', root, rel: rel.split(path.sep).join('/') };
    },
    notes: async () => walk(root).map((rel) => note(rel)),
    refreshVaults: () => refreshed++,
  });
  const walk = (dir: string, base = ''): string[] =>
    fs.readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((e) => {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.name.startsWith('.')) return [];
      return e.isDirectory() ? walk(dir, rel) : rel.endsWith('.md') ? [rel] : [];
    });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-vault-'));
    root = path.join(tmp, 'requirements');
    fs.cpSync(FIXTURE, root, { recursive: true });
    changed = [];
    refreshed = 0;
    svc = new VaultService({
      dir: path.join(tmp, 'vaults'),
      graph: graph(),
      lang: () => 'en',
      run: () => async () => '{"views":[]}',
      onChanged: (id) => changed.push(id),
      now: () => NOW,
    });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reads the fixture’s shared config: status board, companions, Changelog action', async () => {
    const s = svc.state('req');
    expect(s.scope).toBe('shared');
    expect(s.problems).toEqual([]);
    const board = await svc.view('req', 'board');
    expect(board?.groups.map((g) => [g.key, g.cards.length])).toEqual([
      ['to-do', 1],
      ['in-progress', 1],
      ['done', 1],
    ]);
    const spec = path.join(root, 'specs', 'done', 'DB-6891-downloads.md');
    const info = await svc.noteInfo(spec);
    expect(info?.companions.map((c) => c.label)).toEqual(['specs', 'checklists', 'retrospects']);
    expect(info?.actions.map((a) => a.name)).toContain('Changelog');
    const text = fs.readFileSync(spec, 'utf8');
    const out = svc.edit(spec, text, { action: 'changelog' });
    expect(out && 'text' in out && out.text).toContain('- **2026-11-23**: ');
    expect(out && 'text' in out && out.text).toContain('revised: 2026-11-23');
    // The Changelog action is only on specs.
    const checklist = await svc.noteInfo(path.join(root, 'reports', 'checklists', 'DB-6891.md'));
    expect(checklist?.actions.map((a) => a.id)).not.toContain('changelog');
  });

  it('mine wins over shared; shared saves drop mine; files stay outside the folder until asked', () => {
    const shared = fs.readFileSync(path.join(root, SHARED_FILE), 'utf8');
    svc.save('req', preset('daily'), 'personal');
    expect(svc.state('req')).toMatchObject({ scope: 'personal', hasShared: true });
    expect(fs.readFileSync(path.join(root, SHARED_FILE), 'utf8')).toBe(shared);
    expect(changed).toEqual(['req']);
    expect(refreshed).toBe(1);
    expect(svc.removePersonal('req').scope).toBe('shared');
    svc.save('req', preset('empty'), 'shared');
    expect(JSON.parse(fs.readFileSync(path.join(root, SHARED_FILE), 'utf8'))).toEqual(preset('empty'));
    expect(readVault(path.join(tmp, 'vaults', 'req.json'), root).scope).toBe('shared');
  });

  it('moves a card between folders, refusing to overwrite', async () => {
    const from = path.join(root, 'specs', 'to-do', 'DB-7100-search.md');
    const r = await svc.move(from, 'board', 'in-progress');
    expect(r).toEqual({ ok: true, path: path.join(root, 'specs', 'in-progress', 'DB-7100-search.md') });
    expect(fs.existsSync(from)).toBe(false);
    fs.writeFileSync(from, '# again');
    expect(await svc.move(from, 'board', 'in-progress')).toEqual({ ok: false, reason: 'exists' });
  });

  it('sets a property when the view groups by one', async () => {
    svc.save(
      'req',
      { views: [{ id: 'p', name: 'P', kind: 'board', group: 'property', key: 'priority' }] },
      'personal',
    );
    const file = path.join(root, 'specs', 'to-do', 'DB-7100-search.md');
    const before = fs.readFileSync(file, 'utf8');
    expect(await svc.move(file, 'p', 'low')).toEqual({ ok: true, path: file });
    expect(fs.readFileSync(file, 'utf8')).toBe(before.replace('priority: high', 'priority: low'));
  });

  it('creates notes from templates, never overwriting', () => {
    const p = svc.createNote('req', null, 'DB-7200 export');
    expect(p).toBe(path.join(root, 'specs', 'to-do', 'DB-7200-db-7200-export.md'));
    expect(fs.readFileSync(p!, 'utf8')).toContain('id: DB-7200');
    fs.writeFileSync(p!, 'mine');
    expect(svc.createNote('req', null, 'DB-7200 export')).toBe(p);
    expect(fs.readFileSync(p!, 'utf8')).toBe('mine');
    expect(svc.createNote('nope', null, 'x')).toBeNull();
  });

  it('turns a Claude action into a prompt with the note', () => {
    svc.save('req', { actions: [{ name: 'Ask', kind: 'claude', prompt: 'Review {{title}}' }] }, 'personal');
    const file = path.join(root, 'specs', 'done', 'DB-6891-downloads.md');
    expect(svc.edit(file, '# Downloads\n', { action: 'ask' })).toEqual({
      prompt: `Review Downloads\n\n@${file}`,
    });
    expect(svc.edit(file, '# x\n', { property: 'status', value: 'done' })).toEqual({
      text: '---\nstatus: done\n---\n# x\n',
    });
  });
});
