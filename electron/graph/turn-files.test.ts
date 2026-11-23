import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { changedBetween, gitStatusOf, parsePorcelainZ, TurnFiles } from './turn-files';

const tmp: string[] = [];
afterEach(() => tmp.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmpDir = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-turns-')));
  tmp.push(d);
  return d;
};

describe('turn files', () => {
  it('parses porcelain -z, renames keep the new path', () => {
    expect(parsePorcelainZ(' M src/a.ts\0R  new.ts\0old.ts\0?? x y.md\0')).toEqual([
      'src/a.ts',
      'new.ts',
      'x y.md',
    ]);
  });

  it('a file is changed when it appears, goes or its mtime moves', () => {
    const before = new Map<string, number | null>([
      ['/a', 1],
      ['/b', 2],
      ['/gone', 3],
    ]);
    const after = new Map<string, number | null>([
      ['/a', 1],
      ['/b', 5],
      ['/new', 1],
    ]);
    expect(changedBetween(before, after).sort()).toEqual(['/b', '/gone', '/new']);
  });

  it('start → stop records what the turn changed, already-dirty files untouched stay out', async () => {
    const dir = tmpDir();
    let status = ['/r/dirty.ts'];
    const mtimes: Record<string, number> = { '/r/dirty.ts': 1 };
    let changes = 0;
    const turns = new TurnFiles({
      file: path.join(dir, 'turns.json'),
      status: async () => status,
      mtime: (f) => mtimes[f] ?? null,
      onChange: () => changes++,
    });
    turns.start('s1', '/r');
    status = ['/r/dirty.ts', '/r/gen.ts'];
    mtimes['/r/gen.ts'] = 9;
    expect(await turns.stop('s1')).toEqual(['/r/gen.ts']);
    expect(turns.all()).toEqual({ s1: ['/r/gen.ts'] });
    expect(changes).toBe(1);
    // No start: nothing.
    expect(await turns.stop('s2')).toEqual([]);
    turns.flush();
    expect(new TurnFiles({ file: path.join(dir, 'turns.json') }).all()).toEqual({ s1: ['/r/gen.ts'] });
  });

  it('git: lists changed and untracked files as absolute paths; null outside a repo', async () => {
    const dir = tmpDir();
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    git('add', '.');
    git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'a');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'b');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'n.md'), 'n');
    expect((await gitStatusOf(path.join(dir, 'sub')))?.sort()).toEqual(
      [path.join(dir, 'a.txt'), path.join(dir, 'sub', 'n.md')].sort(),
    );
    expect(await gitStatusOf(tmpDir())).toBeNull();
  });
});
