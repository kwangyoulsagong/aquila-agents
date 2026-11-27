import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '../../src/shared/api/types';
import { cleanName, cleanPrefs, NoteFs, resolveInside } from './note-fs';
import type { VaultNote } from './vault';

let tmp: string[] = [];
const tmpDir = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-notefs-')));
  tmp.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
  tmp = [];
});

const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

/** A fake index over the folder: every `.md`, links read with a tiny regex (enough for these tests). */
function setup(
  files: Record<string, string>,
  draft?: { name: string; text: string },
  /** Like the real index (`EdgeSet.add`): one edge per pair, a mutual link kept in the first direction only. */
  onePerPair = false,
) {
  const root = tmpDir();
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      return e.isDirectory() ? walk(rel) : e.name.endsWith('.md') ? [rel] : [];
    });
  const notes = (): VaultNote[] =>
    walk('').map((rel) => ({
      rel,
      abs: path.join(root, rel),
      title: rel,
      frontmatter: {},
      headings: [],
      mtime: 0,
    }));
  const snapshot = async (): Promise<GraphSnapshot> => {
    const ns = notes();
    const id = (rel: string) => `note:s:${rel}`;
    const edges = ns.flatMap((n) => {
      const text = fs.readFileSync(n.abs, 'utf8');
      return [...text.matchAll(/\[\[([^\]|#]+)/g)]
        .map((m) => ns.find((o) => path.basename(o.rel, '.md') === m[1]!.trim()))
        .filter((o): o is VaultNote => !!o)
        .map((o) => ({
          id: `${id(n.rel)}→${id(o.rel)}`,
          source: id(n.rel),
          target: id(o.rel),
          kind: 'explicit' as const,
          strength: 1,
          reasons: [{ via: 'link' as const }],
        }));
    });
    const seen = new Set<string>();
    const kept = onePerPair
      ? edges.filter((e) => {
          const key = [e.source, e.target].sort().join('|');
          return !seen.has(key) && !!seen.add(key);
        })
      : edges;
    return {
      nodes: ns.map((n) => ({
        id: id(n.rel),
        kind: 'note' as const,
        label: n.rel,
        sourceId: 's',
        path: n.abs,
      })),
      edges: kept,
      idGroups: [],
      version: 1,
    } as GraphSnapshot;
  };
  const trashed: string[] = [];
  const nfs = new NoteFs({
    graph: {
      sourceRoot: (id) => (id === 's' ? root : null),
      enabledIds: () => ['s'],
      notes: async () => notes(),
      snapshot,
    },
    draft: (_id, title) => (draft ? { name: draft.name.replace('{t}', title), text: draft.text } : null),
    trash: async (abs) => {
      trashed.push(abs);
      fs.rmSync(abs, { recursive: true });
    },
    prefsFile: path.join(root, '..', `prefs-${path.basename(root)}.json`),
  });
  return { root, nfs, trashed, read: (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8') };
}

describe('names and paths', () => {
  it('refuses names that are not one name', () => {
    for (const bad of ['', ' ', '.', '..', '.hidden', 'a/b', 'a\\b', 'a:b', 'x'.repeat(201)])
      expect(cleanName(bad), bad).toBeNull();
    expect(cleanName('  기획 메모 ')).toBe('기획 메모');
  });

  it('keeps every path inside the source', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'a'));
    expect(resolveInside(root, 'a/new.md')).toBe(path.join(root, 'a', 'new.md'));
    expect(resolveInside(root, '')).toBe(root);
    for (const bad of ['../x.md', 'a/../../x', 'a//b', '/etc', '.git/x', 'a/./b'])
      expect(resolveInside(root, bad), bad).toBeNull();
  });

  it('refuses a symlink that leads out of the source', () => {
    const root = tmpDir();
    const outside = tmpDir();
    fs.symlinkSync(outside, path.join(root, 'out'));
    expect(resolveInside(root, 'out/x.md')).toBeNull();
    expect(resolveInside(root, 'out')).toBe(path.join(root, 'out')); // the link itself may be renamed / trashed
  });
});

describe('create', () => {
  it('makes a folder and a note from the template, never over an existing one', async () => {
    const { nfs, read } = setup(
      { 'a/one.md': '# one\n' },
      { name: '{t}.md', text: '---\nstatus: todo\n---\n# T\n' },
    );
    expect(nfs.mkdir('s', 'a', 'sub')).toEqual({ ok: true, rel: 'a/sub' });
    expect(nfs.mkdir('s', 'a', 'sub')).toEqual({ ok: false, error: 'exists' });
    expect(nfs.mkdir('s', 'a', '../x')).toEqual({ ok: false, error: 'badName' });
    const r = nfs.createNote('s', 'a/sub', 'FE-REQ-031');
    expect(r).toMatchObject({ ok: true, rel: 'a/sub/FE-REQ-031.md' });
    expect(read('a/sub/FE-REQ-031.md')).toBe('---\nstatus: todo\n---\n# T\n');
    expect(nfs.createNote('s', 'a', 'one')).toEqual({ ok: false, error: 'exists' });
    expect(nfs.dirs('s', 'a')).toEqual([]); // sub has a file now
    nfs.mkdir('s', 'a', 'empty');
    expect(nfs.dirs('s', 'a')).toEqual(['empty']);
  });

  it('falls back to `# Title`', () => {
    const { nfs, read } = setup({});
    nfs.createNote('s', '', 'Plain');
    expect(read('Plain.md')).toBe('# Plain\n\n');
  });

  it('refuses an unknown source', () => {
    const { nfs } = setup({});
    expect(nfs.mkdir('nope', '', 'x')).toEqual({ ok: false, error: 'refused' });
  });
});

describe('rename and move', () => {
  it('renames, then lists the notes whose links point at it, and fixes only those spans', async () => {
    const { nfs, read } = setup({
      'specs/Old.md': '# Old\n',
      'notes/a.md': 'See [[Old|the spec]] and [x](../specs/Old.md)\r\n',
      'notes/b.md': 'nothing here\n',
    });
    const r = await nfs.rename('s', 'specs/Old.md', 'New');
    expect(r).toMatchObject({ ok: true, moved: [{ from: 'specs/Old.md', to: 'specs/New.md' }] });
    if (!r.ok) return;
    expect(r.links).toEqual([{ rel: 'notes/a.md', count: 2 }]);
    expect(read('notes/a.md')).toContain('[[Old|'); // nothing written before the yes
    const fixed = nfs.fixLinks(
      's',
      r.files,
      r.links.map((l) => l.rel),
    );
    expect(fixed).toEqual({ fixed: 2, failed: [] });
    expect(read('notes/a.md')).toBe('See [[New|the spec]] and [x](../specs/New.md)\r\n');
  });

  it('finds a linker whose mutual link the index stored in the other direction', async () => {
    // A↔B is stored once, as A→B; renaming A must still offer B (which links to A).
    const { nfs, read } = setup({ 'A.md': 'to [[B]]\n', 'B.md': 'back to [[A]]\n' }, undefined, true);
    const r = await nfs.rename('s', 'A.md', 'C');
    expect(r.ok && r.links).toEqual([{ rel: 'B.md', count: 1 }]);
    if (!r.ok) return;
    nfs.fixLinks(
      's',
      r.files,
      r.links.map((l) => l.rel),
    );
    expect(read('B.md')).toBe('back to [[C]]\n');
  });

  it('refuses a taken name and a move into itself', async () => {
    const { nfs } = setup({ 'a/x.md': '', 'a/y.md': '', 'b/z.md': '' });
    expect(await nfs.rename('s', 'a/x.md', 'y')).toEqual({ ok: false, error: 'exists' });
    expect(await nfs.move('s', ['a'], 'a')).toEqual({ ok: false, error: 'refused' });
    expect(await nfs.move('s', ['a/x.md'], 'b/../..')).toEqual({ ok: false, error: 'refused' });
  });

  it('moving into the same folder does nothing', async () => {
    const { nfs } = setup({ 'a/x.md': '' });
    expect(await nfs.move('s', ['a/x.md'], 'a')).toEqual({ ok: true, moved: [], files: [], links: [] });
  });

  it("moves a folder with its notes and fixes a moved note's relative links", async () => {
    const { nfs, read, root } = setup({
      'a/x.md': '[i](../index.md)\n',
      'index.md': '[x](a/x.md)\n',
      'b/.keep': '',
    });
    const r = await nfs.move('s', ['a'], 'b');
    expect(r.ok && r.files).toEqual([{ from: 'a/x.md', to: 'b/a/x.md' }]);
    expect(fs.existsSync(path.join(root, 'b/a/x.md'))).toBe(true);
    if (!r.ok) return;
    expect(r.links.map((l) => l.rel).sort()).toEqual(['b/a/x.md']);
    nfs.fixLinks(
      's',
      r.files,
      r.links.map((l) => l.rel),
    );
    expect(read('b/a/x.md')).toBe('[i](../../index.md)\n');
  });

  it('leaves a note that changed since it was read', async () => {
    const { nfs, read } = setup({ 'Old.md': '', 'a.md': '[[Old]]\n' });
    const r = await nfs.rename('s', 'Old.md', 'New');
    if (!r.ok) throw new Error('rename failed');
    // A read-only (not UTF-8) note is reported, not written.
    fs.writeFileSync(
      path.join(path.dirname(nfs.existing('s', 'a.md')!), 'a.md'),
      Buffer.from([0x5b, 0x5b, 0xff]),
    );
    expect(nfs.fixLinks('s', r.files, ['a.md']).failed).toEqual(['a.md']);
    expect(read('a.md')).not.toContain('New');
  });
});

describe('trash and undo', () => {
  it('trashes, and undoes a new note only while untouched', async () => {
    const { nfs, trashed, root } = setup({ 'a.md': '' });
    expect(await nfs.trash('s', ['a.md', '../x'])).toEqual(['a.md']);
    expect(trashed).toEqual([path.join(root, 'a.md')]);
    const made = nfs.createNote('s', '', 'n');
    if (!made.ok) throw new Error('create failed');
    expect(await nfs.undoCreate('s', made.rel, made.mtime! - 100)).toBe(false);
    expect(await nfs.undoCreate('s', made.rel, made.mtime)).toBe(true);
    nfs.mkdir('s', '', 'd');
    expect(await nfs.undoCreate('s', 'd')).toBe(true);
  });
});

describe('prefs', () => {
  it('are cleaned and kept per source', () => {
    expect(cleanPrefs({ pins: ['a.md', 3], sort: 'weird' })).toEqual({
      pins: ['a.md'],
      recent: [],
      sort: 'name',
    });
    const { nfs } = setup({});
    nfs.setPrefs('s', { pins: ['x.md'], recent: [], sort: 'modified' });
    expect(nfs.prefs('s')).toEqual({ pins: ['x.md'], recent: [], sort: 'modified' });
    expect(nfs.prefs('other')).toEqual({ pins: [], recent: [], sort: 'name' });
  });

  it('keep the view toggles and the links answer only when they differ from the defaults', () => {
    const base = { pins: [], recent: [], sort: 'name' };
    expect(
      cleanPrefs({ ...base, group: 'status', folderNotes: false, compact: false, links: 'always' }),
    ).toEqual({ ...base, group: 'status', folderNotes: false, compact: false, links: 'always' });
    expect(cleanPrefs({ ...base, group: 'folder', folderNotes: true, compact: 1, links: 'ask' })).toEqual(
      base,
    );
    expect(cleanPrefs({ ...base, links: 'never', group: 'weird' })).toEqual({ ...base, links: 'never' });
    const { nfs } = setup({});
    nfs.setPrefs('s', { ...base, links: 'never' });
    expect(nfs.prefs('s').links).toBe('never');
  });
});
