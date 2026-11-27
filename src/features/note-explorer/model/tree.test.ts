import { describe, expect, it } from 'vitest';
import type { NoteFsEntry } from '@/shared/api';
import {
  ancestors,
  buildTree,
  filterFiles,
  flatten,
  movedPath,
  naturalCompare,
  nextId,
  projectSourceIds,
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
