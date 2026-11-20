import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkTool,
  binaryFor,
  finishFirstRun,
  findOnPath,
  firstRunReport,
  loadOverrides,
  parseFirstRunState,
  parseVersion,
  pathExts,
  readFirstRunState,
  setBinaryPath,
} from './detect';

let dir: string;
let stateFile: string;
const savedPath = process.env.PATH;

/** An executable shell script that prints `out` for `--version` and exits with `code`. */
function fakeBin(name: string, out: string, code = 0): string {
  const file = path.join(dir, 'bin', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\necho '${out}'\nexit ${code}\n`, { mode: 0o755 });
  return file;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-detect-'));
  stateFile = path.join(dir, 'aquila', 'first-run.json');
});

afterEach(() => {
  process.env.PATH = savedPath;
  loadOverrides({});
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseVersion', () => {
  it('reads the version out of each CLI', () => {
    expect(parseVersion('2.1.328 (Claude Code)')).toBe('2.1.328');
    expect(parseVersion('codex-cli 0.170.0')).toBe('0.170.0');
    expect(parseVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5');
    expect(parseVersion('nope')).toBeNull();
  });
});

describe('parseFirstRunState', () => {
  it('keeps only known, valid fields', () => {
    expect(
      parseFirstRunState('{"finished":true,"paths":{"claude":"/x/claude","codex":"rel","zsh":"/bin/zsh"}}'),
    ).toEqual({ finished: true, paths: { claude: '/x/claude' } });
    expect(parseFirstRunState('not json')).toEqual({});
    expect(parseFirstRunState('[1]')).toEqual({});
    expect(parseFirstRunState('{"finished":"yes"}')).toEqual({});
  });
});

describe('findOnPath', () => {
  it('finds the first executable, skipping non-executables', () => {
    const a = path.join(dir, 'a');
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, 'claude'), 'not executable', { mode: 0o644 });
    const real = fakeBin('claude', '2.1.0');
    expect(findOnPath('claude', [a, path.dirname(real)].join(':'))).toBe(real);
    expect(findOnPath('codex', a)).toBeNull();
  });
});

describe('checkTool', () => {
  it('reports version and path for a working binary', async () => {
    const bin = fakeBin('codex', 'codex-cli 0.170.0');
    process.env.PATH = path.dirname(bin);
    expect(await checkTool('codex')).toMatchObject({ found: true, path: bin, version: '0.170.0' });
  });

  it('is not found when missing, or when --version fails', async () => {
    process.env.PATH = dir;
    const missing = await checkTool('codex');
    expect(missing).toMatchObject({ found: false, install: expect.stringContaining('codex') });
    const broken = fakeBin('claude', 'boom', 1);
    expect(await checkTool('claude', broken)).toMatchObject({ found: false, path: broken, override: broken });
  });
});

describe('setBinaryPath', () => {
  it('saves a binary that runs and uses it for sessions', async () => {
    const bin = fakeBin("my claude's", '2.1.400 (Claude Code)');
    const check = await setBinaryPath('claude', bin, stateFile);
    expect(check).toMatchObject({ found: true, version: '2.1.400', override: bin });
    expect(readFirstRunState(stateFile).paths?.claude).toBe(bin);
    expect(binaryFor('claude')).toBe(bin);
    expect(binaryFor('codex')).toBe('codex');
  });

  it('rejects a file that does not run, keeping the old choice', async () => {
    const good = fakeBin('claude', '2.1.400');
    await setBinaryPath('claude', good, stateFile);
    const bad = path.join(dir, 'notes.txt');
    fs.writeFileSync(bad, 'hi');
    const check = await setBinaryPath('claude', bad, stateFile);
    expect(check).toMatchObject({ rejected: bad, found: true, override: good });
    expect(readFirstRunState(stateFile).paths?.claude).toBe(good);
  });

  it('goes back to PATH on reset, and puts a picked git first in PATH', async () => {
    const git = fakeBin('git', 'git version 2.50.0');
    await setBinaryPath('git', git, stateFile);
    expect(process.env.PATH?.split(':')[0]).toBe(path.dirname(git));
    await setBinaryPath('git', null, stateFile);
    expect(readFirstRunState(stateFile)).toEqual({});
  });
});

describe('first-run state', () => {
  it('is pending until finished, and finishing keeps picked paths', async () => {
    const bin = fakeBin('claude', '2.1.400');
    await setBinaryPath('claude', bin, stateFile);
    expect((await firstRunReport(true, readFirstRunState(stateFile))).pending).toBe(true);
    finishFirstRun(stateFile);
    const state = readFirstRunState(stateFile);
    expect(state).toEqual({ finished: true, paths: { claude: bin } });
    const report = await firstRunReport(false, state);
    expect(report.pending).toBe(false);
    expect(report.pathRestored).toBe(false);
    expect(report.tools.map((t) => t.tool)).toEqual(['claude', 'codex', 'git']);
  });
});

describe('pathExts', () => {
  it('tries PATHEXT after the bare name on Windows only', () => {
    expect(pathExts('darwin', '.EXE')).toEqual(['']);
    expect(pathExts('win32', '.COM;.EXE;.CMD')).toEqual(['', '.com', '.exe', '.cmd']);
    expect(pathExts('win32', undefined)).toContain('.exe');
  });

  it('finds git.exe for `git`', () => {
    const bin = path.join(dir, 'git.exe');
    fs.writeFileSync(bin, '');
    fs.chmodSync(bin, 0o755);
    expect(findOnPath('git', dir, ['', '.exe'])).toBe(bin);
    expect(findOnPath('git.exe', dir, ['', '.exe'])).toBe(bin);
  });
});
