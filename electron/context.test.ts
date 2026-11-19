import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextUpdate } from '../src/shared/api/types';
import {
  ContextWatcher,
  readContextWindow,
  statusLineCommand,
  statusLineSettings,
  statusLineSources,
  userHasStatusLine,
} from './context';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-context-'));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const statusJson = (cw: unknown) => JSON.stringify({ session_id: 'x', model: { id: 'm' }, context_window: cw });

describe('readContextWindow', () => {
  it('takes used_percentage and the current usage tokens', () => {
    expect(
      readContextWindow(
        statusJson({
          context_window_size: 200_000,
          used_percentage: 42.5,
          current_usage: { input_tokens: 500, cache_creation_input_tokens: 4500, cache_read_input_tokens: 80_000 },
        }),
      ),
    ).toEqual({ percent: 42.5, usedTokens: 85_000, windowTokens: 200_000 });
  });
  it('computes the percentage when Claude gives only tokens', () => {
    expect(
      readContextWindow(statusJson({ context_window_size: 200_000, current_usage: { input_tokens: 50_000 } })),
    ).toEqual({ percent: 25, usedTokens: 50_000, windowTokens: 200_000 });
  });
  it('is null before the first message, without context_window, or for broken JSON', () => {
    expect(readContextWindow(statusJson({ context_window_size: 200_000, current_usage: null }))).toBeNull();
    expect(readContextWindow(JSON.stringify({ model: {} }))).toBeNull();
    expect(readContextWindow('{nope')).toBeNull();
  });
});

describe('statusLineCommand', () => {
  it('writes stdin to <dir>/$AQUILA_TAB_ID.json and prints nothing', () => {
    const dir = path.join(tmp(), "it's here");
    dirs.push(path.dirname(dir));
    const out = execFileSync('/bin/sh', ['-c', statusLineCommand(dir)], {
      input: '{"a":1}',
      env: { ...process.env, AQUILA_TAB_ID: 'tab-1' },
    });
    expect(out.toString()).toBe('');
    expect(fs.readFileSync(path.join(dir, 'tab-1.json'), 'utf8')).toBe('{"a":1}');
    expect(fs.existsSync(path.join(dir, 'tab-1.tmp'))).toBe(false);
  });
  it('does nothing outside our tabs', () => {
    const dir = path.join(tmp(), 'c');
    dirs.push(path.dirname(dir));
    const env = { ...process.env };
    delete env.AQUILA_TAB_ID;
    execFileSync('/bin/sh', ['-c', statusLineCommand(dir)], { input: '{}', env });
    expect(fs.existsSync(dir)).toBe(false);
  });
  it('is a command statusLine', () => {
    expect(statusLineSettings('/x').statusLine).toMatchObject({ type: 'command' });
  });
});

describe('userHasStatusLine', () => {
  it('looks at the account settings and the project settings', () => {
    const home = tmp();
    const cwd = tmp();
    dirs.push(home, cwd);
    const sources = statusLineSources(cwd, undefined, home);
    expect(sources.slice(0, 3)).toEqual([
      path.join(home, '.claude', 'settings.json'),
      path.join(cwd, '.claude', 'settings.json'),
      path.join(cwd, '.claude', 'settings.local.json'),
    ]);
    expect(statusLineSources(cwd, '/acc', home)[0]).toBe(path.join('/acc', 'settings.json'));
    const own = sources.slice(0, 3);
    expect(userHasStatusLine(own)).toBe(false);
    fs.mkdirSync(path.join(cwd, '.claude'));
    fs.writeFileSync(own[1], JSON.stringify({ permissions: {} }));
    expect(userHasStatusLine(own)).toBe(false);
    fs.writeFileSync(own[2], JSON.stringify({ statusLine: { type: 'command', command: 'echo hi' } }));
    expect(userHasStatusLine(own)).toBe(true);
  });
});

describe('ContextWatcher', () => {
  it('clears old files at start, reports changes once, and clears on remove', () => {
    const dir = path.join(tmp(), 'context');
    dirs.push(path.dirname(dir));
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'old.json'), '{}');
    const got: ContextUpdate[] = [];
    const w = new ContextWatcher((u) => got.push(u), dir);
    w.start();
    expect(fs.readdirSync(dir)).toEqual([]);
    const body = statusJson({ context_window_size: 1000, used_percentage: 61, current_usage: { input_tokens: 610 } });
    fs.writeFileSync(path.join(dir, 't1.json'), body);
    w.read('t1');
    w.read('t1'); // same numbers: no second update
    expect(got).toEqual([{ id: 't1', usage: { percent: 61, usedTokens: 610, windowTokens: 1000 } }]);
    expect(w.all()).toEqual(got);
    w.remove('t1');
    w.remove('t1');
    w.stop();
    expect(got.at(-1)).toEqual({ id: 't1', usage: null });
    expect(got).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, 't1.json'))).toBe(false);
  });
});
