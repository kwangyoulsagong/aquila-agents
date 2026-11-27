import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedBy, diskSize, NoteSeen, NoteSeenStore, seenKey } from './note-seen';
import { readNote } from './note-file';

const tmps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-seen-'));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('NoteSeenStore', () => {
  it('writes and reads a seen copy, also before the write lands', async () => {
    const dir = tmp();
    const store = new NoteSeenStore(dir);
    store.record('/repo/spec.md', 'hello\n', 100, 6);
    expect((await store.get('/repo/spec.md'))?.text).toBe('hello\n');
    await store.settle();
    expect(fs.readFileSync(store.fileOf('/repo/spec.md'), 'utf8')).toBe('hello\n');
    // A fresh store reads the index from disk.
    const again = new NoteSeenStore(dir);
    expect(await again.get('/repo/spec.md')).toMatchObject({ text: 'hello\n', mtime: 100, size: 6 });
    expect(await again.get('/repo/other.md')).toBeNull();
  });

  it('names files by a hash of the path, inside its own folder only', async () => {
    const dir = tmp();
    const repo = tmp();
    const note = path.join(repo, 'docs', 'secret-plan.md');
    const store = new NoteSeenStore(dir);
    store.record(note, 'x', 1, 1);
    await store.settle();
    expect(store.fileOf(note)).toBe(path.join(dir, `${seenKey(note)}.txt`));
    expect(seenKey(note)).toMatch(/^[0-9a-f]{40}$/);
    expect(seenKey(note)).not.toBe(seenKey(`${note}x`));
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f.includes('secret'))).toBe(false);
    // Nothing written into the repo.
    expect(fs.readdirSync(repo)).toEqual([]);
  });

  it('drops the least recently used notes past the count and size caps', async () => {
    let t = 0;
    const store = new NoteSeenStore(tmp(), { notes: 3, bytes: 10 }, () => ++t);
    store.record('/a.md', 'aaa', 1, 3);
    store.record('/b.md', 'bbb', 1, 3);
    store.record('/c.md', 'ccc', 1, 3);
    await store.get('/a.md'); // a used again: b is now the oldest
    store.record('/d.md', 'd', 1, 1);
    expect(
      store
        .entries()
        .map(([p]) => p)
        .sort(),
    ).toEqual(['/a.md', '/c.md', '/d.md']);
    // Size: a 3 + c 3 + d 1 + e 6 = 13 > 10 → the oldest (c) goes, 10 fits.
    store.record('/e.md', 'eeeeee', 1, 6);
    expect(store.entries().map(([p]) => p)).toEqual(['/e.md', '/d.md', '/a.md']);
    await store.settle();
    expect(fs.existsSync(store.fileOf('/b.md'))).toBe(false);
    expect(await store.get('/b.md')).toBeNull();
  });

  it("doesn't keep notes over 2 MB", () => {
    const store = new NoteSeenStore(tmp());
    expect(store.record('/big.md', 'x'.repeat(2 * 1024 * 1024 + 1), 1, 1)).toBe(false);
    expect(store.entry('/big.md')).toBeUndefined();
  });
});

describe('NoteSeen', () => {
  const setup = () => {
    const repo = tmp();
    const note = path.join(repo, 'spec.md');
    fs.writeFileSync(note, 'one\ntwo\n');
    const store = new NoteSeenStore(tmp());
    const turns: Record<string, string[]> = {};
    const seen = new NoteSeen({ store, read: (f) => readNote(f), turnFiles: () => turns });
    return { note, store, seen, turns };
  };
  const bump = (file: string, text: string) => {
    fs.writeFileSync(file, text);
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(file, t, t);
  };

  it('shows an outside change until marked as seen', async () => {
    const { note, seen, turns } = setup();
    await seen.opened(note, readNote(note)!);
    expect(await seen.state(note)).toBeNull();
    bump(note, 'one\nTWO\nthree\n');
    turns['s1'] = [note];
    // Reopening doesn't swallow it.
    await seen.opened(note, readNote(note)!);
    const st = await seen.state(note);
    expect(st).toMatchObject({ seenText: 'one\ntwo\n', by: 'claude' });
    expect(await seen.changed(() => true)).toMatchObject([{ path: note, by: 'claude' }]);
    expect(seen.mark(note)).toBe(true);
    expect(await seen.state(note)).toBeNull();
    expect(await seen.changed(() => true)).toEqual([]);
  });

  it("follows the user's own saves, but not over a pending outside change", async () => {
    const { note, seen } = setup();
    const n = readNote(note)!;
    await seen.opened(note, n);
    seen.saved(note, 'mine\n', false, n.mtime, n.mtime + 10);
    fs.writeFileSync(note, 'mine\n');
    fs.utimesSync(note, new Date(n.mtime + 10), new Date(n.mtime + 10));
    expect(await seen.state(note)).toBeNull();
    bump(note, 'agent\n');
    const after = readNote(note)!;
    seen.saved(note, 'agent + mine\n', false, after.mtime, after.mtime + 10);
    expect((await seen.state(note))?.seenText).toBe('mine\n');
  });

  it('a touch with the same bytes is not a change', async () => {
    const { note, seen } = setup();
    await seen.opened(note, readNote(note)!);
    bump(note, 'one\ntwo\n');
    expect(await seen.changed(() => true)).toEqual([]);
    expect(await seen.state(note)).toBeNull();
  });

  it('lists only notes the caller still accepts', async () => {
    const { note, seen } = setup();
    await seen.opened(note, readNote(note)!);
    bump(note, 'changed\n');
    expect(await seen.changed(() => false)).toEqual([]);
  });
});

describe('helpers', () => {
  it('diskSize counts UTF-8 bytes and the BOM', () => {
    expect(diskSize('한', false)).toBe(3);
    expect(diskSize('a', true)).toBe(4);
  });
  it('changedBy finds a Claude session that touched the file', () => {
    expect(changedBy('/r/a.md', { s: ['/r/b.md', '/r/a.md'] })).toBe('claude');
    expect(changedBy('/r/a.md', { s: ['/r/b.md'] })).toBeNull();
  });
});
