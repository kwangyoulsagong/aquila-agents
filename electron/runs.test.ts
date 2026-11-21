import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunInfo } from '../src/shared/api/types';
import {
  cleanRunCommands,
  defaultRunCommands,
  findRunError,
  lastVerdict,
  parseSavedRuns,
  readSavedRuns,
  writeSavedRuns,
  runEnv,
  runId,
  RunManager,
  splitLines,
} from './runs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-runs-'));

describe('cleanRunCommands', () => {
  it('keeps named, trimmed, unique commands', () => {
    expect(
      cleanRunCommands([
        { name: ' web ', command: ' npm run dev ' },
        { name: '', command: 'npm test -- --watch' },
        { name: 'web', command: 'other' },
        { name: 'blank', command: '  ' },
        'junk',
        null,
      ]),
    ).toEqual([
      { name: 'web', command: 'npm run dev' },
      { name: 'npm test -- --watch', command: 'npm test -- --watch' },
    ]);
  });
  it('ignores anything but an array', () => {
    expect(cleanRunCommands({ name: 'x', command: 'y' })).toEqual([]);
    expect(
      cleanRunCommands([
        { name: 'api', command: 'go run .', ready: '  Listening on  ' },
        { name: 'web', command: 'vite', ready: '' },
        { name: 'job', command: 'make', ready: 42 },
      ]),
    ).toEqual([
      { name: 'api', command: 'go run .', ready: 'Listening on' },
      { name: 'web', command: 'vite' },
      { name: 'job', command: 'make' },
    ]);
  });
});

describe('defaultRunCommands', () => {
  it('offers npm run dev when package.json has a dev script', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    expect(defaultRunCommands(dir)).toEqual([{ name: 'dev', command: 'npm run dev' }]);
  });
  it('uses the package manager of the lockfile or packageManager', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    expect(defaultRunCommands(dir)).toEqual([{ name: 'dev', command: 'pnpm dev' }]);
    fs.rmSync(path.join(dir, 'pnpm-lock.yaml'));
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    expect(defaultRunCommands(dir)[0].command).toBe('yarn dev');
    fs.rmSync(path.join(dir, 'yarn.lock'));
    fs.writeFileSync(path.join(dir, 'bun.lock'), '');
    expect(defaultRunCommands(dir)[0].command).toBe('bun run dev');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite' }, packageManager: 'pnpm@9.1.0' }),
    );
    expect(defaultRunCommands(dir)[0].command).toBe('pnpm dev');
  });
  it('offers nothing without one', () => {
    const dir = tmp();
    expect(defaultRunCommands(dir)).toEqual([]);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }));
    expect(defaultRunCommands(dir)).toEqual([]);
    fs.writeFileSync(path.join(dir, 'package.json'), '{oops');
    expect(defaultRunCommands(dir)).toEqual([]);
  });
});

describe('output scan', () => {
  it('splits lines across chunks and strips colors', () => {
    const a = splitLines('', 'one\r\ntw');
    expect(a).toEqual({ lines: ['one'], rest: 'tw' });
    expect(splitLines(a.rest, 'o \x1b[1m3\x1b[22m\nfour')).toEqual({ lines: ['two 3'], rest: 'four' });
  });
  it('finds error lines, not harmless words', () => {
    expect(findRunError(['ready in 300 ms', 'TypeError: x is undefined'])).toBe('TypeError: x is undefined');
    expect(findRunError(['Error: listen EADDRINUSE: address already in use :::3000'])).toMatch(/EADDRINUSE/);
    expect(findRunError(['<--- JS stacktrace --->', 'FATAL ERROR: heap out of memory'])).toMatch(
      /out of memory/,
    );
    expect(findRunError(['total: NaN ms'])).toBe('total: NaN ms');
    expect(findRunError(['0 errors, 0 warnings', 'errorHandler mounted', 'Errors: none'])).toBeNull();
  });
  it('takes the latest telling line: an error, or healthy again', () => {
    expect(lastVerdict(['src/App.tsx: TypeError: x', 'hmr update /src/App.tsx'])).toBe('ok');
    expect(lastVerdict(['Found 0 errors. Watching for file changes.'])).toBe('ok');
    expect(lastVerdict(['ready in 300 ms', 'Error: boom'])).toEqual({ error: 'Error: boom' });
    expect(lastVerdict(['webpack compiled with 1 error'])).toBeNull();
    expect(lastVerdict(['GET / 200'])).toBeNull();
  });

  it("counts the command's own ready text as healthy, case-insensitive, even over the error pattern", () => {
    expect(lastVerdict(['Error: boom', 'Server listening on :8080'], 'Listening on')).toBe('ok');
    expect(lastVerdict(['Server listening on :8080', 'Error: boom'], 'Listening on')).toEqual({
      error: 'Error: boom',
    });
    expect(lastVerdict(['pytest: 0 Errors, 12 passed'], '12 passed')).toBe('ok');
    expect(lastVerdict(['Server listening on :8080'])).toBeNull();
    expect(lastVerdict(['Server listening on :8080'], '  ')).toBeNull();
  });
  it('sets PORT only when there is one', () => {
    expect(runEnv(3010)).toEqual({ PORT: '3010', AQUILA_PORT_BASE: '3010' });
    expect(runEnv(undefined)).toEqual({});
  });
});

describe('saved runs', () => {
  it('round-trips and drops malformed entries', () => {
    const file = path.join(tmp(), 'sub', 'runs.json');
    expect(readSavedRuns(file)).toEqual([]);
    writeSavedRuns(file, [{ projectId: 'p', name: 'dev' }, { projectId: 'p', worktree: '/w', name: 'test' }]);
    expect(readSavedRuns(file)).toEqual([
      { projectId: 'p', name: 'dev' },
      { projectId: 'p', worktree: '/w', name: 'test' },
    ]);
    expect(parseSavedRuns('{"runs":[{"projectId":"p"},{"name":"x"},null,{"projectId":"q","name":"d","worktree":""}]}')).toEqual([
      { projectId: 'q', name: 'd' },
    ]);
    expect(parseSavedRuns('nope')).toEqual([]);
  });
});

describe('RunManager (real processes)', () => {
  const managers: RunManager[] = [];
  afterEach(async () => {
    await Promise.all(managers.map((m) => m.stopAll()));
    managers.length = 0;
  });

  const make = () => {
    const changes: RunInfo[][] = [];
    let data = '';
    const m: RunManager = new RunManager({
      onChange: (projectId, worktree) => changes.push(m.list(projectId, worktree, []).runs),
      onData: (_id, d) => (data += d),
      shell: '/bin/sh',
    });
    managers.push(m);
    return { m, changes, data: () => data };
  };

  const until = async (check: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('runs a server with PORT, finds its address, and Stop leaves no process behind', async () => {
    const dir = tmp();
    // A server that also starts a child of its own (like vite → esbuild): both must go on Stop.
    fs.writeFileSync(
      path.join(dir, 'server.js'),
      `const http = require('http');
       const { spawn } = require('child_process');
       const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
       http.createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT), () => {
         console.log('kid ' + kid.pid);
         console.log('ready on http://localhost:' + process.env.PORT + '/');
       });`,
    );
    const { m, data } = make();
    const commands = [{ name: 'dev', command: `"${process.execPath}" server.js` }];
    await m.start({ projectId: 'p', name: 'dev', command: commands[0].command, cwd: dir, port: 45731 });
    const id = runId('p', undefined, 'dev');
    await until(() => !!m.list('p', undefined, commands).runs[0].url);
    const info = m.list('p', undefined, commands).runs[0];
    expect(info).toMatchObject({
      state: 'running',
      alive: true,
      url: 'http://localhost:45731/',
      port: 45731,
    });
    await until(() => data().includes('ready on'));
    expect(m.log(id)).toContain('ready on http://localhost:45731/');
    const kid = Number(/kid (\d+)/.exec(m.log(id))?.[1]);
    expect(alive(kid)).toBe(true);

    await m.stop(id);
    expect(m.list('p', undefined, commands).runs[0]).toMatchObject({ state: 'exited', alive: false });
    expect(alive(kid)).toBe(false);
  }, 15000);

  it('marks a non-zero exit and an error line as error', async () => {
    const dir = tmp();
    const { m } = make();
    const commands = [
      { name: 'fail', command: 'exit 3' },
      { name: 'taken', command: 'echo "Error: listen EADDRINUSE :::3000"; sleep 30' },
    ];
    await m.start({ projectId: 'p', worktree: dir, name: 'fail', command: 'exit 3', cwd: dir });
    await m.start({ projectId: 'p', worktree: dir, name: 'taken', command: commands[1].command, cwd: dir });
    await until(() => m.list('p', dir, commands).runs.every((r) => r.state === 'error'));
    const [fail, taken] = m.list('p', dir, commands).runs;
    expect(fail).toMatchObject({ alive: false, exitCode: 3, reason: 'exit 3' });
    expect(taken).toMatchObject({ alive: true, reason: 'Error: listen EADDRINUSE :::3000' });
    expect(m.active()).toEqual([{ projectId: 'p', worktree: dir, name: 'taken' }]);
    // Other dirs don't see them.
    expect(m.list('p', undefined, commands).runs.every((r) => r.state === 'idle')).toBe(true);
  }, 15000);

  it('turns back to running when a watcher is healthy again', async () => {
    const dir = tmp();
    const { m } = make();
    const command = 'echo "TypeError: x"; sleep 0.3; echo "hmr update /src/a.ts"; sleep 30';
    const commands = [{ name: 'w', command }];
    await m.start({ projectId: 'p', name: 'w', command, cwd: dir });
    await until(() => m.list('p', undefined, commands).runs[0].state === 'error');
    expect(m.list('p', undefined, commands).runs[0].reason).toBe('TypeError: x');
    await until(() => m.list('p', undefined, commands).runs[0].state === 'running');
    expect(m.list('p', undefined, commands).runs[0]).not.toHaveProperty('reason');
  }, 15000);

  it("turns back to running on the command's own ready text", async () => {
    const dir = tmp();
    const { m } = make();
    const command = 'echo "Error: db down"; sleep 0.3; echo "API listening on :9000"; sleep 30';
    const commands = [{ name: 'api', command, ready: 'listening on' }];
    await m.start({ projectId: 'p', name: 'api', command, ready: 'listening on', cwd: dir });
    await until(() => m.list('p', undefined, commands).runs[0].state === 'error');
    await until(() => m.list('p', undefined, commands).runs[0].state === 'running');
  }, 15000);

  it('restarts a running command and keeps a removed one listed while it runs', async () => {
    const dir = tmp();
    const { m } = make();
    await m.start({ projectId: 'p', name: 'w', command: 'sleep 30', cwd: dir });
    const first = m.list('p', undefined, [{ name: 'w', command: 'sleep 30' }]).runs[0];
    await new Promise((r) => setTimeout(r, 5));
    await m.start({ projectId: 'p', name: 'w', command: 'sleep 30', cwd: dir });
    const second = m.list('p', undefined, [{ name: 'w', command: 'sleep 30' }]).runs[0];
    expect(second.alive).toBe(true);
    expect(second.startedAt).toBeGreaterThan(first.startedAt!);
    expect(m.list('p', undefined, []).runs).toHaveLength(1);
  }, 15000);
});
