import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtStorage, STORAGE_MAX_BYTES, STORE_WRITE_MS } from './ext-storage';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-storage-'));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

const log = (id = 'a') => fs.readFileSync(path.join(dir, `${id}.log`), 'utf8');

describe('ExtStorage', () => {
  it('reads back what was set, from memory and after a restart', async () => {
    const s = new ExtStorage(dir);
    await s.set('a', 'n', 1);
    await s.set('a', 'o', { x: [1, 2] });
    await s.remove('a', 'n');
    expect(await s.get('a', 'n')).toBeNull();
    expect(await s.get('a', 'o')).toEqual({ x: [1, 2] });
    await s.settle();
    const again = new ExtStorage(dir);
    expect(await again.keys('a')).toEqual(['o']);
    expect(await again.get('a', 'o')).toEqual({ x: [1, 2] });
  });

  it('appends only the changed keys, once per key per write', async () => {
    const s = new ExtStorage(dir);
    await s.set('a', 'big', 'x'.repeat(100_000));
    await s.settle();
    const before = log().length;
    for (let i = 0; i < 50; i++) await s.set('a', 'n', i);
    await s.settle();
    expect(log().length - before).toBe('["n",49]\n'.length);
  });

  it('writes at most once a second, and not at all when nothing changes', async () => {
    vi.useFakeTimers();
    const s = new ExtStorage(dir);
    await s.set('a', 'n', 1);
    expect(fs.existsSync(path.join(dir, 'a.log'))).toBe(false);
    await s.set('a', 'n', 2);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(STORE_WRITE_MS);
    await s.settle();
    expect(log()).toBe('["n",2]\n');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('measures like Chrome and refuses a set over 10 MB, keeping what was there', async () => {
    const s = new ExtStorage(dir);
    const half = 'x'.repeat(STORAGE_MAX_BYTES / 2);
    await s.set('a', 'one', half);
    await expect(s.set('a', 'two', half)).rejects.toThrow('over 10 MB');
    expect(await s.keys('a')).toEqual(['one']);
    // Replacing a key counts only the new value.
    await s.set('a', 'one', half);
  });

  it('compacts a log that has grown past twice the data', async () => {
    const s = new ExtStorage(dir);
    const one = `["v",${JSON.stringify('y'.repeat(5_000) + 10)}]\n`.length;
    let max = 0;
    for (let i = 10; i < 99; i++) {
      await s.set('a', 'v', 'y'.repeat(5_000) + i);
      await s.settle();
      max = Math.max(max, log().length);
    }
    // Rewritten whenever it passes 2 × data + 64 KB: never more than one write past that.
    expect(max).toBeLessThanOrEqual(2 * one + 64 * 1024 + one);
    expect(fs.existsSync(path.join(dir, 'a.log.tmp'))).toBe(false);
    expect(await new ExtStorage(dir).get('a', 'v')).toBe('y'.repeat(5_000) + 98);
  });

  it('skips a line cut short by a crash', async () => {
    fs.writeFileSync(path.join(dir, 'a.log'), '["k",1]\n["k",2]\n["half",{"x":');
    const s = new ExtStorage(dir);
    expect(await s.keys('a')).toEqual(['k']);
    expect(await s.get('a', 'k')).toBe(2);
  });

  it('moves the old single-file format to the log on the next write', async () => {
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ k: 'v' }));
    const s = new ExtStorage(dir);
    expect(await s.get('a', 'k')).toBe('v');
    await s.set('a', 'n', 1);
    await s.settle();
    expect(fs.existsSync(path.join(dir, 'a.json'))).toBe(false);
    const again = new ExtStorage(dir);
    expect(await again.get('a', 'k')).toBe('v');
    expect(await again.get('a', 'n')).toBe(1);
  });

  it('treats __proto__ as a plain key', async () => {
    const s = new ExtStorage(dir);
    await s.set('a', '__proto__', { polluted: true });
    expect(await s.get('a', '__proto__')).toEqual({ polluted: true });
    expect(await s.get('a', 'polluted')).toBeNull();
    expect(await s.get('a', 'toString')).toBeNull();
  });

  it('writes what is left at quit, and after release reads it again', async () => {
    const s = new ExtStorage(dir);
    await s.set('a', 'n', 1);
    s.dispose();
    expect(await new ExtStorage(dir).get('a', 'n')).toBe(1);

    const t = new ExtStorage(dir);
    await t.set('b', 'n', 2);
    t.release('b');
    await t.settle();
    expect(await t.get('b', 'n')).toBe(2);
  });
});
