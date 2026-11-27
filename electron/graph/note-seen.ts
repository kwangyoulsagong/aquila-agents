// "What changed since I last looked" (T80), main-process side: per note the user opened in the editor, the text as
// it was when they last looked at it ("seen copy"). Kept in `~/.aquila/notes-seen/` — one file per note, named by a
// hash of its path (never next to the note, never inside the user's repo) plus one small index. Recorded when the
// note opens with no outside change pending, when the user's own save starts from the seen version, and on "Mark as
// seen". An outside write (agent, terminal, git) never updates it: that difference is what the review bar shows.
// Capped (MAX_NOTES / MAX_BYTES), least recently used dropped first; text written async, the index debounced.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NoteFile, NoteSeenChange, NoteSeenState } from '../../src/shared/api/types';

export const MAX_NOTES = 2000;
export const MAX_BYTES = 50 * 1024 * 1024;
/** Bigger notes aren't kept (the editor opens them truncated / read-only anyway). */
export const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const INDEX = 'index.json';
const SAVE_DELAY_MS = 1000;

export interface SeenEntry {
  /** Hashed file name (no extension). */
  key: string;
  /** Disk mtime of the version that was seen. */
  mtime: number;
  /** Disk size (bytes, BOM included) of that version: a cheap first check before reading. */
  size: number;
  /** When the user last looked (ms). */
  seenAt: number;
  /** Last read or written (LRU). */
  used: number;
  /** UTF-8 bytes of the stored text (the cap). */
  bytes: number;
}

export interface SeenCopy {
  text: string;
  mtime: number;
  size: number;
  seenAt: number;
}

/** File name for a note path: a hash, so nothing of the path (or the repo) shows up in the folder. */
export const seenKey = (notePath: string) =>
  crypto.createHash('sha256').update(path.resolve(notePath)).digest('hex').slice(0, 40);

/** Bytes on disk of a note's text (what `fs.stat` reports for a file written byte for byte). */
export const diskSize = (text: string, bom: boolean) => Buffer.byteLength(text, 'utf8') + (bom ? 3 : 0);

export class NoteSeenStore {
  private index: Map<string, SeenEntry> | null = null;
  /** Texts written but maybe not on disk yet (key → text), so a read right after a write sees it. */
  private pending = new Map<string, string>();
  /** One write chain per key, so an older text never lands after a newer one. */
  private chains = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly dir: string,
    private limits = { notes: MAX_NOTES, bytes: MAX_BYTES },
    private now = () => Date.now(),
  ) {}

  /** Where a note's seen copy lives (always inside `dir`). */
  fileOf(notePath: string): string {
    return path.join(this.dir, `${seenKey(notePath)}.txt`);
  }

  private load(): Map<string, SeenEntry> {
    if (this.index) return this.index;
    this.index = new Map();
    try {
      const v: unknown = JSON.parse(fs.readFileSync(path.join(this.dir, INDEX), 'utf8'));
      if (v && typeof v === 'object' && !Array.isArray(v))
        for (const [p, e] of Object.entries(v as Record<string, SeenEntry>))
          if (e && typeof e.key === 'string' && typeof e.mtime === 'number') this.index.set(p, e);
    } catch {
      // none yet / unreadable: start empty
    }
    return this.index;
  }

  entry(notePath: string): SeenEntry | undefined {
    return this.load().get(path.resolve(notePath));
  }

  /** Every note with a seen copy, most recently used first. */
  entries(): [string, SeenEntry][] {
    return [...this.load()].sort((a, b) => b[1].used - a[1].used);
  }

  async get(notePath: string): Promise<SeenCopy | null> {
    const p = path.resolve(notePath);
    const e = this.load().get(p);
    if (!e) return null;
    e.used = this.now();
    this.schedule();
    const pending = this.pending.get(e.key);
    if (pending !== undefined) return { text: pending, mtime: e.mtime, size: e.size, seenAt: e.seenAt };
    try {
      const text = await fs.promises.readFile(path.join(this.dir, `${e.key}.txt`), 'utf8');
      return { text, mtime: e.mtime, size: e.size, seenAt: e.seenAt };
    } catch {
      // The copy is gone (cleared by hand): forget the entry, the next open records a new one.
      if (this.load().get(p) === e) {
        this.load().delete(p);
        this.schedule();
      }
      return null;
    }
  }

  /** Records `text` as seen. `seen` false: the same text with a new mtime / size (a user's own save), seenAt kept. */
  record(notePath: string, text: string, mtime: number, size: number, seen = true): boolean {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_NOTE_BYTES) return false;
    const p = path.resolve(notePath);
    const idx = this.load();
    const key = seenKey(p);
    const now = this.now();
    const old = idx.get(p);
    idx.delete(p);
    idx.set(p, { key, mtime, size, bytes, used: now, seenAt: seen || !old ? now : old.seenAt });
    this.pending.set(key, text);
    this.write(key, text);
    this.evict();
    this.schedule();
    return true;
  }

  /** The seen version's mtime moved without its text changing (a touch, same bytes). */
  touch(notePath: string, mtime: number): void {
    const e = this.entry(notePath);
    if (!e || e.mtime === mtime) return;
    e.mtime = mtime;
    this.schedule();
  }

  private write(key: string, text: string): void {
    const file = path.join(this.dir, `${key}.txt`);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        await fs.promises.mkdir(this.dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, text, 'utf8');
        await fs.promises.rename(tmp, file);
      })
      .catch((e: unknown) => console.error('[note-seen] write failed:', e))
      .finally(() => {
        if (this.chains.get(key) === next) {
          this.chains.delete(key);
          if (this.pending.get(key) === text) this.pending.delete(key);
        }
      });
    this.chains.set(key, next);
  }

  private evict(): void {
    const idx = this.load();
    let total = 0;
    for (const e of idx.values()) total += e.bytes;
    if (idx.size <= this.limits.notes && total <= this.limits.bytes) return;
    // Oldest use first.
    const byAge = [...idx].sort((a, b) => a[1].used - b[1].used);
    for (const [p, e] of byAge) {
      if (idx.size <= this.limits.notes && total <= this.limits.bytes) break;
      // Always keep the one just written.
      if (idx.size === 1) break;
      idx.delete(p);
      total -= e.bytes;
      this.remove(e.key);
    }
  }

  private remove(key: string): void {
    const file = path.join(this.dir, `${key}.txt`);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => fs.promises.rm(file, { force: true })).catch(() => undefined);
    this.pending.delete(key);
    this.chains.set(key, next);
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => void this.saveIndex(), SAVE_DELAY_MS);
    this.timer.unref?.();
  }

  private async saveIndex(): Promise<void> {
    this.timer = null;
    if (!this.index) return;
    const file = path.join(this.dir, INDEX);
    try {
      await fs.promises.mkdir(this.dir, { recursive: true });
      await fs.promises.writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(this.index)));
      await fs.promises.rename(`${file}.tmp`, file);
    } catch (e) {
      console.error('[note-seen] index save failed:', e);
    }
  }

  /** Waits for every pending write (tests, quit). */
  async settle(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      await this.saveIndex();
    }
    await Promise.all([...this.chains.values()]);
  }

  /** On quit: the index, synchronously (texts already written or in flight). */
  flush(): void {
    if (!this.timer || !this.index) return;
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, INDEX), JSON.stringify(Object.fromEntries(this.index)));
    } catch {
      // next start reads the previous index
    }
  }
}

/** Who most likely changed a note: a Claude session whose turns touched it (newest last in `turnFiles`). */
export function changedBy(notePath: string, turnFiles: Record<string, string[]>): 'claude' | null {
  const p = path.resolve(notePath);
  for (const files of Object.values(turnFiles)) if (files.some((f) => path.resolve(f) === p)) return 'claude';
  return null;
}

export interface NoteSeenDeps {
  store: NoteSeenStore;
  read: (file: string) => NoteFile | null;
  /** Files Claude turns changed, by session (`TurnFiles.all()`). */
  turnFiles: () => Record<string, string[]>;
  stat?: (file: string) => Promise<{ mtimeMs: number; size: number } | null>;
}

const sameTime = (a: number, b: number) => Math.abs(a - b) <= 1;
/** Same-size candidates read in full per list (the rest count as changed: the bar corrects it on open). */
const MAX_LIST_READS = 50;

/** The IPC side: open / save hooks, the bar's state, "Mark as seen" and the "changed outside" list. */
export class NoteSeen {
  private readonly stat: NonNullable<NoteSeenDeps['stat']>;

  constructor(private deps: NoteSeenDeps) {
    this.stat =
      deps.stat ??
      ((f) =>
        fs.promises.stat(f).then(
          (st) => ({ mtimeMs: st.mtimeMs, size: st.size }),
          () => null,
        ));
  }

  private keepable = (n: NoteFile) => !n.readOnly && !n.truncated;

  /** The note opened in the editor: first time → recorded; the same text under a new mtime → re-stamped. */
  async opened(file: string, note: NoteFile): Promise<void> {
    if (!this.keepable(note)) return;
    const { store } = this.deps;
    const e = store.entry(file);
    const size = diskSize(note.text, note.bom);
    if (!e || sameTime(e.mtime, note.mtime)) {
      store.record(file, note.text, note.mtime, size);
      return;
    }
    // Changed since: left as it was (the bar shows what changed) unless only the mtime moved.
    const seen = await store.get(file);
    if (seen && seen.text === note.text) store.record(file, note.text, note.mtime, size);
  }

  /** The user's own save: follows along only when it started from the seen version (no outside change pending). */
  saved(file: string, text: string, bom: boolean, baseMtime: number, mtime: number): void {
    const e = this.deps.store.entry(file);
    if (e && sameTime(e.mtime, baseMtime))
      this.deps.store.record(file, text, mtime, diskSize(text, bom), false);
  }

  /** What the bar shows: the seen text when the note on disk differs from it, else null. */
  async state(file: string): Promise<NoteSeenState | null> {
    const { store } = this.deps;
    const e = store.entry(file);
    if (!e) return null;
    const note = this.deps.read(file);
    if (!note || !this.keepable(note) || sameTime(e.mtime, note.mtime)) return null;
    const seen = await store.get(file);
    if (!seen) return null;
    if (seen.text === note.text) {
      store.touch(file, note.mtime);
      return null;
    }
    return {
      seenText: seen.text,
      seenAt: seen.seenAt,
      changedAt: note.mtime,
      by: changedBy(file, this.deps.turnFiles()),
    };
  }

  /** "Mark as seen": the note as it is on disk now. */
  mark(file: string): boolean {
    const note = this.deps.read(file);
    if (!note || !this.keepable(note)) return false;
    return this.deps.store.record(file, note.text, note.mtime, diskSize(note.text, note.bom));
  }

  /**
   * Notes changed outside since they were last seen, newest first: an mtime check per note, a full read only when
   * the size didn't move (a touch, `git checkout` of the same bytes). No diff.
   */
  async changed(isNote: (file: string) => boolean, limit = 20): Promise<NoteSeenChange[]> {
    const { store } = this.deps;
    const turnFiles = this.deps.turnFiles();
    const out: NoteSeenChange[] = [];
    let reads = 0;
    const entries = store.entries();
    const stats = await Promise.all(entries.map(([p]) => this.stat(p)));
    for (let i = 0; i < entries.length; i++) {
      const [p, e] = entries[i]!;
      const st = stats[i];
      // Only moved notes are checked against the sources (a disabled source's notes aren't listed).
      if (!st || sameTime(st.mtimeMs, e.mtime) || st.size > MAX_NOTE_BYTES || !isNote(p)) continue;
      if (st.size === e.size && reads < MAX_LIST_READS) {
        reads++;
        const [seen, now] = await Promise.all([
          store.get(p),
          fs.promises.readFile(p).then(
            (b) => (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b).toString('utf8'),
            () => null,
          ),
        ]);
        if (seen && now !== null && seen.text === now) {
          store.touch(p, st.mtimeMs);
          continue;
        }
      }
      out.push({ path: p, changedAt: st.mtimeMs, by: changedBy(p, turnFiles) });
    }
    return out.sort((a, b) => b.changedAt - a.changedAt).slice(0, limit);
  }
}
