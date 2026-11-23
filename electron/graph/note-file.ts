// Note editor (T67), main-process side: read / write / watch the Markdown files open in the editor, and save
// pasted images next to them. Every path is checked by `GraphService.notePath` first (a `.md` inside an enabled
// source), so the renderer can't read or write anything else. Bytes are kept exactly: a UTF-8 BOM is split off
// and put back; a file that isn't valid UTF-8 opens read-only instead of being re-encoded on save.
import fs from 'node:fs';
import path from 'node:path';
import type { NoteChange, NoteFile, NoteWriteResult } from '../../src/shared/api/types';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Decodes a note's bytes. `readOnly` when decoding and re-encoding wouldn't give the same bytes back. */
export function decodeNote(file: string, buf: Buffer, mtime: number): NoteFile {
  const bom = buf.subarray(0, 3).equals(BOM);
  const body = bom ? buf.subarray(3) : buf;
  const text = body.toString('utf8');
  const exact = Buffer.from(text, 'utf8').equals(body);
  return { path: file, text, bom, mtime, ...(exact ? {} : { readOnly: true }) };
}

export function encodeNote(text: string, bom: boolean): Buffer {
  const body = Buffer.from(text, 'utf8');
  return bom ? Buffer.concat([BOM, body]) : body;
}

export function readNote(file: string): NoteFile | null {
  try {
    const st = fs.statSync(file);
    return decodeNote(file, fs.readFileSync(file), st.mtimeMs);
  } catch {
    return null;
  }
}

/**
 * Writes in place (keeps the inode, so links, permissions and other watchers stay intact). Refused with
 * `changed` when the file on disk isn't the version the editor started from — the editor then shows its banner.
 */
export function writeNote(file: string, text: string, bom: boolean, baseMtime: number): NoteWriteResult {
  try {
    const st = fs.statSync(file);
    if (Math.abs(st.mtimeMs - baseMtime) > 1) return { ok: false, reason: 'changed' };
    fs.writeFileSync(file, encodeNote(text, bom));
    return { ok: true, mtime: fs.statSync(file).mtimeMs };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
/** Images the editor may show inline (through `aquila-note://`). */
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
/** `aquila-note://local/<encoded absolute path>` → the absolute path (the renderer builds these, main checks them). */
export function imageUrlPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'aquila-note:' || u.host !== 'local') return null;
    return decodeURIComponent(u.pathname.slice(1));
  } catch {
    return null;
  }
}
/** Links the editor may open in the browser: http(s) only. */
export const isWebUrl = (url: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
const pad = (n: number) => String(n).padStart(2, '0');

/** `attachments/<note>-20261123-153012.png` next to the note; a number is added when the name is taken. */
export function attachmentName(
  note: string,
  ext: string,
  now: Date,
  taken: (rel: string) => boolean,
): string {
  const base = path
    .basename(note, path.extname(note))
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const stem = `attachments/${base || 'image'}-${stamp}`;
  let rel = `${stem}.${ext}`;
  for (let i = 2; taken(rel); i++) rel = `${stem}-${i}.${ext}`;
  return rel;
}

/** Saves a pasted image next to the note; returns the path to write in the link (relative, `/`), or null. */
export function saveAttachment(note: string, data: Uint8Array, ext: string, now = new Date()): string | null {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (!IMAGE_EXT.has(e) || !data.byteLength || data.byteLength > 20 * 1024 * 1024) return null;
  const dir = path.dirname(note);
  const rel = attachmentName(note, e === 'jpeg' ? 'jpg' : e, now, (r) => fs.existsSync(path.join(dir, r)));
  try {
    fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data, { flag: 'wx' });
    return rel;
  } catch {
    return null;
  }
}

/**
 * Watches only the notes open in the editor. Watches the folder, not the file: agents and editors often save by
 * writing a new file and renaming it over the old one, which a file watch would lose.
 */
export class NoteWatcher {
  private open = new Map<string, number>();
  private dirs = new Map<string, fs.FSWatcher>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private onChange: (c: NoteChange) => void,
    private debounceMs = 150,
  ) {}

  watch(file: string): void {
    this.open.set(file, (this.open.get(file) ?? 0) + 1);
    // macOS starts a folder watch asynchronously: look once more after it's surely up, so a write right after the
    // note was read isn't missed (the renderer ignores the same bytes).
    setTimeout(() => this.touched(file), this.debounceMs + 200).unref?.();
    const dir = path.dirname(file);
    if (this.dirs.has(dir)) return;
    try {
      const w = fs.watch(dir, (_event, name) => {
        if (name) this.touched(path.join(dir, name.toString()));
        // No name (some platforms): any open note in this folder may have changed.
        else for (const f of this.open.keys()) if (path.dirname(f) === dir) this.touched(f);
      });
      w.on('error', () => this.dropDir(dir));
      this.dirs.set(dir, w);
    } catch {
      /* the folder is gone: nothing to watch */
    }
  }

  unwatch(file: string): void {
    const n = (this.open.get(file) ?? 0) - 1;
    if (n > 0) {
      this.open.set(file, n);
      return;
    }
    this.open.delete(file);
    clearTimeout(this.timers.get(file));
    this.timers.delete(file);
    const dir = path.dirname(file);
    if (![...this.open.keys()].some((f) => path.dirname(f) === dir)) this.dropDir(dir);
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const dir of [...this.dirs.keys()]) this.dropDir(dir);
    this.open.clear();
  }

  private dropDir(dir: string): void {
    this.dirs.get(dir)?.close();
    this.dirs.delete(dir);
  }

  private touched(file: string): void {
    if (!this.open.has(file)) return;
    clearTimeout(this.timers.get(file));
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file);
        if (!this.open.has(file)) return;
        const note = readNote(file);
        this.onChange(note ?? { path: file, deleted: true });
      }, this.debounceMs),
    );
  }
}
