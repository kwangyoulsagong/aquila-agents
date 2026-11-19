import { describe, expect, it } from 'vitest';
import { capText, parseBranchLine, parseStatus, statusLetter } from './git';

describe('parseBranchLine', () => {
  it('reads branch, upstream and ahead/behind', () => {
    expect(parseBranchLine('## main...origin/main [ahead 2, behind 1]')).toEqual({
      branch: 'main',
      ahead: 2,
      behind: 1,
    });
    expect(parseBranchLine('## task/T3...origin/task/T3')).toEqual({
      branch: 'task/T3',
      ahead: 0,
      behind: 0,
    });
    expect(parseBranchLine('## feature')).toEqual({ branch: 'feature', ahead: 0, behind: 0 });
  });

  it('handles a fresh repo and a detached HEAD', () => {
    expect(parseBranchLine('## No commits yet on main').branch).toBe('main');
    expect(parseBranchLine('## HEAD (no branch)').branch).toBe('HEAD');
  });
});

describe('parseStatus', () => {
  it('parses -z output with renames and paths with spaces', () => {
    const out = [
      '## main...origin/main [ahead 1]',
      ' M src/app.ts',
      'M  staged.ts',
      'R  new name.ts',
      'old name.ts',
      '?? notes/todo.md',
      'UU conflict.ts',
      '',
    ].join('\0');
    const r = parseStatus(out);
    expect(r.branch).toBe('main');
    expect(r.ahead).toBe(1);
    expect(r.files.map((f) => [f.status, f.path, f.origPath])).toEqual([
      ['M', 'src/app.ts', undefined],
      ['M', 'staged.ts', undefined],
      ['R', 'new name.ts', 'old name.ts'],
      ['?', 'notes/todo.md', undefined],
      ['U', 'conflict.ts', undefined],
    ]);
  });
});

describe('statusLetter', () => {
  it('prefers the worktree change, then the staged one', () => {
    expect(statusLetter('A', 'M')).toBe('M');
    expect(statusLetter('A', ' ')).toBe('A');
    expect(statusLetter(' ', 'D')).toBe('D');
    expect(statusLetter('?', '?')).toBe('?');
  });
});

describe('capText', () => {
  it('cuts at a line end when over the cap', () => {
    const r = capText('aaaa\nbbbb\ncccc\n', 12);
    expect(r).toEqual({ text: 'aaaa\nbbbb\n', truncated: true });
    expect(capText('short\n', 12)).toEqual({ text: 'short\n', truncated: false });
  });
});
