import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listRemoteDirs, listScript, parseList } from './browse';
import type { RemoteExec } from './exec';

/** Runs the script with the local sh (the host side is plain POSIX sh). */
const localExec: RemoteExec = async (_host, script) => {
  const stdout = execFileSync('sh', ['-c', script]);
  return { code: 0, stdout, stderr: '', ms: 1 };
};

describe('remote folder list (T56)', () => {
  it('lists folders sorted, marks git repos, skips files and hidden folders', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-browse-'));
    for (const d of ['b-app', 'a-lib', '.hidden', 'b-app/.git', 'with space'])
      fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, 'file.txt'), '');
    const list = await listRemoteDirs({ alias: 'h' }, root, localExec);
    expect(list.exists).toBe(true);
    expect(fs.realpathSync(list.path)).toBe(fs.realpathSync(root));
    expect(list.dirs).toEqual([
      { name: 'a-lib', repo: false },
      { name: 'b-app', repo: true },
      { name: 'with space', repo: false },
    ]);
  });

  it('reports a folder that is not there', async () => {
    const list = await listRemoteDirs({ alias: 'h' }, '/no/such/dir', localExec);
    expect(list).toEqual({ path: '/no/such/dir', exists: false, dirs: [] });
  });

  it('quotes the folder for the shell and expands ~', () => {
    expect(listScript('~/code')).toContain(`cd -- "$HOME"/'code'`);
    expect(listScript('')).toContain('cd -- "$HOME"');
    expect(listScript("x'; rm -rf /")).toContain(`'x'\\''; rm -rf /'`);
  });

  it('throws when ssh fails', async () => {
    const failing: RemoteExec = async () => ({
      code: 255,
      stdout: Buffer.from(''),
      stderr: 'ssh: connect refused',
      ms: 1,
    });
    await expect(listRemoteDirs({ alias: 'h' }, '~', failing)).rejects.toThrow('connect refused');
  });

  it('parses an empty folder', () => {
    expect(parseList('pwd=/home/u\n', '~')).toEqual({ path: '/home/u', exists: true, dirs: [] });
  });
});
