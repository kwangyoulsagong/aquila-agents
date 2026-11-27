import { describe, expect, it } from 'vitest';
import type { NoteFsEntry } from '@/shared/api';
import {
  ancestors,
  buildTree,
  compareStatus,
  edgeScroll,
  filterFiles,
  flatten,
  groupByStatus,
  movedPath,
  naturalCompare,
  nextId,
  projectSourceIds,
  stickyRows,
  STATUS_PREFIX,
} from './tree';

const e = (rel: string, mtime = 0, extra: Partial<NoteFsEntry> = {}): NoteFsEntry => ({
  rel,
  title: rel,
  mtime,
  ...extra,
});

describe('natural sort', () => {
  it('orders numbers by value, Korean first (the ko collation)', () => {
    const names = ['note 10', 'note 2', 'FE-REQ-030', 'FE-REQ-2', '나', '가', 'B', 'a'];
    expect([...names].sort(naturalCompare)).toEqual([
      '가',
      '나',
      'a',
      'B',
      'FE-REQ-2',
      'FE-REQ-030',
      'note 2',
      'note 10',
    ]);
  });
});

describe('buildTree / flatten', () => {
  const files = [
    e('specs/in-progress/FE-REQ-10.md', 3),
    e('specs/in-progress/FE-REQ-9.md', 5),
    e('specs/done/FE-REQ-1.md'),
    e('README.md'),
    e('a.md'),
  ];

  it('puts folders first, counts notes, adds empty folders', () => {
    const tree = buildTree(files, new Map([['specs', ['empty']]]));
    expect(tree.count).toBe(5);
    expect(tree.folders.map((f) => f.name)).toEqual(['specs']);
    expect(tree.files.map((f) => f.name)).toEqual(['a', 'README']);
    const specs = tree.folders[0]!;
    expect(specs.count).toBe(3);
    expect(specs.folders.map((f) => f.name)).toEqual(['done', 'empty', 'in-progress']);
    expect(specs.folders[2]!.files.map((f) => f.name)).toEqual(['FE-REQ-9', 'FE-REQ-10']);
  });

  it('sorts notes by modified time when asked', () => {
    const tree = buildTree(files, new Map(), 'modified');
    expect(tree.folders[0]!.folders[1]!.files.map((f) => f.name)).toEqual(['FE-REQ-9', 'FE-REQ-10']);
    const t2 = buildTree([e('x.md', 1), e('y.md', 9)], new Map(), 'modified');
    expect(t2.files.map((f) => f.name)).toEqual(['y', 'x']);
  });

  it('shows only open folders', () => {
    const tree = buildTree(files);
    expect(flatten(tree, new Set()).map((r) => r.rel)).toEqual(['specs', 'a.md', 'README.md']);
    expect(flatten(tree, new Set(['specs', 'specs/done'])).map((r) => `${r.depth}:${r.rel}`)).toEqual([
      '0:specs',
      '1:specs/done',
      '2:specs/done/FE-REQ-1.md',
      '1:specs/in-progress',
      '0:a.md',
      '0:README.md',
    ]);
  });

  it('stays quick for 4,000 notes', () => {
    const many = Array.from({ length: 4000 }, (_, i) => e(`f${i % 40}/sub${i % 7}/note ${i}.md`, i));
    const t0 = performance.now();
    const tree = buildTree(many);
    flatten(tree, new Set(['f1', 'f1/sub1']));
    expect(tree.count).toBe(4000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('filter', () => {
  const files = [
    e('requirements/specs/FE-REQ-030.md', 0, { title: 'Remember me' }),
    e('requirements/checklists/FE-REQ-030.md'),
    e('meetings/2026-11-20 회의.md'),
    e('other.md'),
  ];
  it('matches the path, IDs and Korean, and opens matched folders', () => {
    const m = filterFiles(files, 'FE-REQ-030');
    expect([...m.keys()].sort()).toEqual([
      'requirements/checklists/FE-REQ-030.md',
      'requirements/specs/FE-REQ-030.md',
    ]);
    expect(filterFiles(files, '회의').has('meetings/2026-11-20 회의.md')).toBe(true);
    expect(filterFiles(files, 'specs030').has('requirements/specs/FE-REQ-030.md')).toBe(true);
    expect(filterFiles(files, 'remember').has('requirements/specs/FE-REQ-030.md')).toBe(true);
    const rows = flatten(buildTree(files), new Set(), filterFiles(files, '회의'));
    expect(rows.map((r) => r.rel)).toEqual(['meetings', 'meetings/2026-11-20 회의.md']);
    expect(rows[1]!.matches).toEqual([11, 12]);
  });
  it('matches nothing for an empty query', () => {
    expect(filterFiles(files, '  ').size).toBe(0);
  });
});

describe('next ID', () => {
  it('suggests the next number of a shared prefix, same width', () => {
    expect(nextId(['FE-REQ-029', 'FE-REQ-030 login', 'notes'])).toBe('FE-REQ-031');
    expect(nextId(['DB-9', 'DB-10'])).toBe('DB-11');
    expect(nextId(['FE-REQ-029', 'other'])).toBeNull();
    expect(nextId([])).toBeNull();
  });
});

describe('paths', () => {
  it('follows moves and lists ancestors', () => {
    const moves = [{ from: 'a', to: 'b/a' }];
    expect(movedPath('a/x.md', moves)).toBe('b/a/x.md');
    expect(movedPath('a', moves)).toBe('b/a');
    expect(movedPath('ab/x.md', moves)).toBe('ab/x.md');
    expect(ancestors('a/b/c.md')).toEqual(['a', 'a/b']);
  });

  it("scopes sources to the tab's project like the graph", () => {
    const sources = [
      { id: 'repo', path: '~/code/repo' },
      { id: 'inner', path: '~/code/repo/sub' },
      { id: 'memo', path: '~/memo' },
    ];
    const projects = [
      { id: 'p', path: '~/code/repo' },
      { id: 'q', path: '~/code/repo/sub' },
    ];
    expect(projectSourceIds(sources, projects, 'p')).toEqual(['repo']);
    expect(projectSourceIds(sources, projects, 'q')).toEqual(['inner']);
    expect(projectSourceIds(sources, projects, null)).toEqual([]);
  });
});

describe('group by status', () => {
  const files = [
    e('a/one.md', 1, { status: 'done' }),
    e('b/two.md', 5, { status: 'In-Progress' }),
    e('three.md', 2),
    e('c/four.md', 3, { status: 'review' }),
    e('d/five.md', 4, { status: 'todo' }),
    e('six.md', 6, { status: 'blocked' }),
    e('seven.md', 7, { status: 'in-progress' }),
    e('eight.md', 8, { status: 'draft' }),
  ];

  it('orders values todo / draft → in progress → review → done → others → no status', () => {
    expect(['done', '', 'zzz', 'review', 'draft', 'todo', 'doing', 'abc'].sort(compareStatus)).toEqual([
      'todo',
      'draft',
      'doing',
      'review',
      'done',
      'abc',
      'zzz',
      '',
    ]);
    expect(compareStatus('진행', '완료')).toBeLessThan(0);
  });

  it('makes one virtual folder per value (case ignored), notes inside by the sort, real paths kept', () => {
    const tree = groupByStatus(files, 'modified');
    expect(tree.folders.map((f) => [f.rel, f.name, f.count])).toEqual([
      [`${STATUS_PREFIX}todo`, 'todo', 1],
      [`${STATUS_PREFIX}draft`, 'draft', 1],
      [`${STATUS_PREFIX}in-progress`, 'In-Progress', 2],
      [`${STATUS_PREFIX}review`, 'review', 1],
      [`${STATUS_PREFIX}done`, 'done', 1],
      [`${STATUS_PREFIX}blocked`, 'blocked', 1],
      [STATUS_PREFIX, '', 1],
    ]);
    expect(tree.folders[2]!.files.map((f) => f.rel)).toEqual(['seven.md', 'b/two.md']);
    // Groups are open until closed (the set holds closed groups).
    const rows = flatten(tree, new Set([`${STATUS_PREFIX}done`]));
    expect(rows.find((r) => r.rel === `${STATUS_PREFIX}done`)).toMatchObject({ open: false, virtual: true });
    expect(rows.some((r) => r.rel === 'a/one.md')).toBe(false);
    expect(rows.find((r) => r.rel === 'b/two.md')).toMatchObject({
      depth: 1,
      parent: `${STATUS_PREFIX}in-progress`,
    });
  });
});

describe('folder notes', () => {
  const files = [
    e('specs/index.md'),
    e('specs/README.md'),
    e('specs/a.md'),
    e('docs/README.md'),
    e('docs/b.md'),
    e('in-progress/In-Progress.md'),
    e('in-progress/FE-REQ-1.md'),
    e('plain/c.md'),
    e('README.md'),
  ];

  it('index.md, then README.md, then a note named like the folder opens from the folder; hidden from its notes', () => {
    const tree = buildTree(files, new Map(), 'name', { folderNotes: true });
    const by = (n: string) => tree.folders.find((f) => f.name === n)!;
    expect(by('specs').note?.rel).toBe('specs/index.md');
    expect(by('specs').files.map((f) => f.name)).toEqual(['a', 'README']);
    expect(by('docs').note?.rel).toBe('docs/README.md');
    expect(by('in-progress').note?.rel).toBe('in-progress/In-Progress.md');
    expect(by('in-progress').files.map((f) => f.name)).toEqual(['FE-REQ-1']);
    expect(by('plain').note).toBeUndefined();
    // The source root has no row: its README stays a note; counts include folder notes.
    expect(tree.files.map((f) => f.name)).toEqual(['README']);
    expect(by('specs').count).toBe(3);
    const rows = flatten(tree, new Set(['docs']));
    expect(rows.find((r) => r.rel === 'docs')).toMatchObject({ note: 'docs/README.md' });
    expect(rows.filter((r) => r.parent === 'docs').map((r) => r.rel)).toEqual(['docs/b.md']);
  });

  it('off: folder notes are ordinary notes; a filter still finds a folder note', () => {
    expect(buildTree(files).folders.every((f) => !f.note)).toBe(true);
    const tree = buildTree(files, new Map(), 'name', { folderNotes: true });
    const rows = flatten(tree, new Set(), filterFiles(files, 'docs/READ'));
    expect(rows.map((r) => r.rel)).toEqual(['docs', 'docs/README.md']);
  });
});

describe('compact folder chains', () => {
  const files = [e('a/b/c/x.md'), e('a/b/c/y.md'), e('top/one/n.md'), e('top/two/m.md'), e('z.md')];

  it('a folder holding only one folder is one row named by every segment; the row is the last folder', () => {
    const tree = buildTree(files);
    const rows = flatten(tree, new Set(['a/b/c']), null, { compact: true });
    expect(rows.map((r) => [r.depth, r.rel, r.name, r.parent])).toEqual([
      [0, 'a/b/c', 'a / b / c', ''],
      [1, 'a/b/c/x.md', 'x', 'a/b/c'],
      [1, 'a/b/c/y.md', 'y', 'a/b/c'],
      [0, 'top', 'top', ''],
      [0, 'z.md', 'z', ''],
    ]);
    expect(rows[0]!.chain).toEqual(['a', 'a/b', 'a/b/c']);
    expect(rows[0]!.open).toBe(true);
    // Closed by its last segment; an empty folder found later ends the chain there.
    expect(flatten(tree, new Set(), null, { compact: true })[0]).toMatchObject({ rel: 'a/b/c', open: false });
    const withEmpty = buildTree(files, new Map([['a/b', ['empty']]]));
    expect(flatten(withEmpty, new Set(), null, { compact: true })[0]).toMatchObject({
      rel: 'a/b',
      name: 'a / b',
    });
  });

  it('a folder with a folder note stops the chain; off or filtering shows every folder', () => {
    const tree = buildTree([...files, e('a/b/index.md')], new Map(), 'name', { folderNotes: true });
    expect(flatten(tree, new Set(), null, { compact: true })[0]).toMatchObject({
      rel: 'a/b',
      name: 'a / b',
      note: 'a/b/index.md',
    });
    expect(flatten(buildTree(files), new Set())[0]).toMatchObject({ rel: 'a', name: 'a' });
    const only = filterFiles(files, 'x');
    expect(flatten(buildTree(files), new Set(), only, { compact: true }).map((r) => r.rel)).toEqual([
      'a',
      'a/b',
      'a/b/c',
      'a/b/c/x.md',
    ]);
  });
});

describe('sticky parent rows', () => {
  // 0 specs ▸ 1 in-progress ▸ 2..11 notes, 12 done ▸ 13 note, 14 z.md
  const parents = [-1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 12, -1];

  it('pins the folders the first row in view sits in, outermost first', () => {
    expect(stickyRows(parents, 0)).toEqual([]);
    expect(stickyRows(parents, 1)).toEqual([0, 1]);
    expect(stickyRows(parents, 5)).toEqual([0, 1]);
    expect(stickyRows(parents, 11)).toEqual([0]);
    expect(stickyRows(parents, 9)).toEqual([0, 1]);
    // "done" holds one note: its pinned row would cover a row outside it, so nothing is pinned.
    expect(stickyRows(parents, 12)).toEqual([]);
    expect(stickyRows(parents, 13)).toEqual([]);
    expect(stickyRows(parents, 14)).toEqual([]);
    expect(stickyRows(parents, 5, 1)).toEqual([0]);
  });
});

describe('auto-scroll while dragging', () => {
  it('scrolls up near the top, down near the bottom, faster closer to the edge, not in the middle', () => {
    expect(edgeScroll(150, 100, 500, 36)).toBe(0);
    expect(edgeScroll(300, 100, 500, 36)).toBe(0);
    expect(edgeScroll(102, 100, 500, 36)).toBeLessThan(edgeScroll(130, 100, 500, 36));
    expect(edgeScroll(130, 100, 500, 36)).toBeLessThan(0);
    expect(edgeScroll(495, 100, 500, 36)).toBeGreaterThan(edgeScroll(470, 100, 500, 36));
    expect(edgeScroll(470, 100, 500, 36)).toBeGreaterThan(0);
    expect(edgeScroll(90, 100, 500, 36, 16)).toBe(-16);
    expect(edgeScroll(1000, 100, 500, 36)).toBe(0);
  });
});
