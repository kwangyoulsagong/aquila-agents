import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachmentName,
  decodeNote,
  encodeNote,
  imageUrlPath,
  isWebUrl,
  NoteWatcher,
  readNote,
  saveAttachment,
  writeNote,
} from './note-file';
import type { NoteChange } from '../../src/shared/api/types';

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const mdFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? mdFiles(p) : e.name.endsWith('.md') ? [p] : [];
  });

let tmp: string | null = null;
const tmpDir = () => (tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-note-')));
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe('decode / encode', () => {
  it('gives every fixture note back byte for byte', () => {
    const files = [...mdFiles(path.join(FIXTURES, 'graph')), ...mdFiles(path.join(FIXTURES, 'notes'))];
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const buf = fs.readFileSync(f);
      const note = decodeNote(f, buf, 0);
      expect(note.readOnly, f).toBeUndefined();
      expect(encodeNote(note.text, note.bom).equals(buf), f).toBe(true);
    }
  });

  it('splits a BOM off and puts it back', () => {
    const note = decodeNote('x.md', fs.readFileSync(path.join(FIXTURES, 'notes', 'bom-mixed.md')), 0);
    expect(note.bom).toBe(true);
    expect(note.text.startsWith('# Mixed')).toBe(true);
  });

  it('opens bytes that are not UTF-8 read-only', () => {
    expect(decodeNote('x.md', Buffer.from([0x61, 0xff, 0x62]), 0).readOnly).toBe(true);
  });
});

describe('writeNote', () => {
  it('writes in place when the file is the one read, refuses when it changed', () => {
    const file = path.join(tmpDir(), 'a.md');
    fs.writeFileSync(file, 'one');
    const before = fs.statSync(file).ino;
    const note = readNote(file)!;
    const ok = writeNote(file, 'two', false, note.mtime);
    expect(ok.ok).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('two');
    expect(fs.statSync(file).ino).toBe(before);
    expect(writeNote(file, 'three', false, note.mtime - 10_000)).toEqual({ ok: false, reason: 'changed' });
    expect(fs.readFileSync(file, 'utf8')).toBe('two');
  });
});

describe('attachments', () => {
  it('names them after the note and the time, numbered when taken', () => {
    const now = new Date(2026, 10, 23, 15, 30, 12);
    expect(attachmentName('/n/주간 싱크.md', 'png', now, () => false)).toBe('attachments/주간-싱크-20261123-153012.png');
    const taken = new Set(['attachments/a-20261123-153012.png']);
    expect(attachmentName('/n/a.md', 'png', now, (r) => taken.has(r))).toBe('attachments/a-20261123-153012-2.png');
  });

  it('saves images next to the note and refuses other types', () => {
    const dir = tmpDir();
    const note = path.join(dir, 'n.md');
    fs.writeFileSync(note, '');
    const rel = saveAttachment(note, new Uint8Array([1, 2, 3]), 'png')!;
    expect(fs.readFileSync(path.join(dir, rel))).toEqual(Buffer.from([1, 2, 3]));
    expect(saveAttachment(note, new Uint8Array([1]), 'exe')).toBeNull();
  });
});

describe('NoteWatcher', () => {
  it('reports a change to an open note, including a rename over it, and nothing after close', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'n.md');
    fs.writeFileSync(file, 'a');
    const seen: NoteChange[] = [];
    const w = new NoteWatcher((c) => seen.push(c), 20);
    w.watch(file);
    // macOS starts a folder watch asynchronously: a write right away can be missed.
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(dir, 'tmp'), 'b');
    fs.renameSync(path.join(dir, 'tmp'), file);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.some((c) => 'text' in c && c.text === 'b')).toBe(true);
    w.unwatch(file);
    seen.length = 0;
    fs.writeFileSync(file, 'c');
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toEqual([]);
    w.close();
  });
});

describe('editor URLs', () => {
  it('reads the absolute path out of an aquila-note image URL', () => {
    const abs = '/Users/me/노트/a b.png';
    expect(imageUrlPath(`aquila-note://local/${encodeURIComponent(abs)}`)).toBe(abs);
    expect(imageUrlPath('aquila-note://other/x')).toBeNull();
    expect(imageUrlPath('file:///etc/passwd')).toBeNull();
  });
  it('opens only http(s) links', () => {
    expect(isWebUrl('https://example.com')).toBe(true);
    expect(isWebUrl('file:///etc/passwd')).toBe(false);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('NoteWatcher recheck', () => {
  it('looks once more right after a note is opened', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'n.md');
    fs.writeFileSync(file, 'a');
    const seen: NoteChange[] = [];
    const w = new NoteWatcher((c) => seen.push(c), 20);
    w.watch(file);
    await new Promise((r) => setTimeout(r, 400));
    expect(seen.some((c) => 'text' in c && c.text === 'a')).toBe(true);
    w.close();
  });
});
