import fs from 'node:fs';
import path from 'node:path';

// Extension `storage` (T71): 10 MB per extension, measured like Chrome's `chrome.storage.local` (every key's length
// plus the JSON of every value). Built for speed and battery, without a database:
// - Reads come from memory: each extension's file is read once (async, never blocking the main process).
// - A `set` serializes only its own value; sizes are kept per key, so the total never needs re-measuring.
// - Disk writes are an append-only log, one line per changed key (`[key, value]`, `[key]` = removed): a 100-byte
//   change writes ~100 bytes, not the whole store. Changes in one second go out together; a key set many times in
//   that second is written once. No timers or disk access while nothing changes.
// - When the log has grown to twice the data, it is rewritten (compacted) key by key, yielding between chunks, into
//   a temp file swapped in with a rename. A crash mid-append leaves a broken last line, which loading skips.
// - A closed extension's store is written and dropped from memory; the next call reads it again.

export const STORAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Changes within this long go to disk as one write. */
export const STORE_WRITE_MS = 1000;
/** Compact when the log is over twice the data (plus this, so small stores don't compact on every write). */
const COMPACT_SLACK = 64 * 1024;
/** Loading a store gives other work a turn this often. */
const LOAD_SLICE_MS = 4;
/** Compaction writes this much, then lets other work run. */
const COMPACT_CHUNK = 256 * 1024;

interface Store {
  /** No prototype: a key named `__proto__` is just a key. */
  data: Record<string, unknown>;
  /** Each key's measured size (key length + value JSON bytes). */
  sizes: Map<string, number>;
  used: number;
  /** Each key's line in a compacted log, and their total: what the log shrinks to (`used` counts differently). */
  lines: Map<string, number>;
  lineTotal: number;
  /** Bytes in the log file now. */
  logBytes: number;
  /** Changed since the last write: key → value JSON, or null when removed. */
  pending: Map<string, string | null>;
  /** Read from the old single-file format (`<id>.json`): the next write rewrites it as a log. */
  legacy: boolean;
}

/** Bytes of `[<key>,<value>]\n` for a value of `bytes`. */
const lineBytes = (key: string, bytes: number) => Buffer.byteLength(JSON.stringify(key)) + bytes + 4;
const line = (key: string, json: string | null) =>
  json === null ? `[${JSON.stringify(key)}]\n` : `[${JSON.stringify(key)},${json}]\n`;

/** A key's sizes after it is set to a value of `bytes` JSON bytes, or removed (null). */
function account(s: Store, key: string, bytes: number | null): void {
  s.used -= s.sizes.get(key) ?? 0;
  s.lineTotal -= s.lines.get(key) ?? 0;
  if (bytes === null) {
    s.sizes.delete(key);
    s.lines.delete(key);
    return;
  }
  const size = key.length + bytes;
  const line = lineBytes(key, bytes);
  s.sizes.set(key, size);
  s.lines.set(key, line);
  s.used += size;
  s.lineTotal += line;
}

export class ExtStorage {
  private stores = new Map<string, Store>();
  private loading = new Map<string, Promise<Store>>();
  private dirty = new Set<string>();
  /** Being written right now (a quit must rewrite these too: the write in flight won't land). */
  private busy = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Writes run one after another, so two never touch one file at once. */
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly dir: string) {}

  async get(id: string, key: string): Promise<unknown> {
    const s = await this.load(id);
    return Object.hasOwn(s.data, key) ? s.data[key] : null;
  }

  async keys(id: string): Promise<string[]> {
    return Object.keys((await this.load(id)).data);
  }

  async set(id: string, key: string, value: unknown): Promise<void> {
    const s = await this.load(id);
    // Only this value is serialized, once: for the size and for the log line.
    const json = JSON.stringify(value ?? null) ?? 'null';
    const bytes = Buffer.byteLength(json);
    if (s.used - (s.sizes.get(key) ?? 0) + key.length + bytes > STORAGE_MAX_BYTES)
      throw new Error('storage: over 10 MB');
    account(s, key, bytes);
    s.data[key] = JSON.parse(json) as unknown;
    this.changed(id, s, key, json);
  }

  async remove(id: string, key: string): Promise<void> {
    const s = await this.load(id);
    if (!Object.hasOwn(s.data, key)) return;
    delete s.data[key];
    account(s, key, null);
    this.changed(id, s, key, null);
  }

  /** The extension closed: write what's left, then free its memory. */
  release(id: string): void {
    // Still loading: release once it's in, or it would stay in memory for good.
    const loading = this.loading.get(id);
    if (loading) {
      void loading.then(() => this.release(id));
      return;
    }
    if (!this.stores.has(id)) return;
    this.chain = this.chain
      .then(() => this.write(id))
      .then(() => {
        if (!this.dirty.has(id)) this.stores.delete(id);
      });
  }

  /** At quit: everything still only in memory, written now (sync; the process is about to end). */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    for (const id of new Set([...this.dirty, ...this.busy])) {
      const s = this.stores.get(id);
      if (!s) continue;
      try {
        // A whole rewrite: an async append or compaction still in flight can't land after this one (`disposed`).
        fs.mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.file(id)}.quit`;
        fs.writeFileSync(
          tmp,
          Object.keys(s.data)
            .map((k) => line(k, JSON.stringify(s.data[k])))
            .join(''),
        );
        fs.renameSync(tmp, this.file(id));
        if (s.legacy) fs.rmSync(path.join(this.dir, `${id}.json`), { force: true });
      } catch {
        // Nothing left to retry with.
      }
    }
    this.dirty.clear();
  }

  /** Waits for writes in flight (tests). */
  async settle(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.log`);
  }

  private changed(id: string, s: Store, key: string, json: string | null): void {
    s.pending.set(key, json);
    this.dirty.add(id);
    this.schedule();
  }

  /** Not reset by later changes: at most one write a second however often an extension saves. */
  private schedule(): void {
    if (this.disposed) return;
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, STORE_WRITE_MS);
  }

  private flush(): Promise<void> {
    const ids = [...this.dirty];
    this.chain = this.chain.then(async () => {
      for (const id of ids) await this.write(id);
    });
    return this.chain;
  }

  private async write(id: string): Promise<void> {
    const s = this.stores.get(id);
    if (!s || this.disposed) return;
    this.dirty.delete(id);
    this.busy.add(id);
    try {
      const text = [...s.pending].map(([k, v]) => line(k, v)).join('');
      s.pending.clear();
      // The log would pass twice the data: rewrite it instead of appending (the rewrite holds these changes too).
      if (s.legacy || s.logBytes + Buffer.byteLength(text) > 2 * s.lineTotal + COMPACT_SLACK) {
        await this.compact(id, s);
        if (s.legacy) {
          s.legacy = false;
          await fs.promises.rm(path.join(this.dir, `${id}.json`), { force: true });
        }
        return;
      }
      if (!text) return;
      await fs.promises.mkdir(this.dir, { recursive: true });
      const fh = await fs.promises.open(this.file(id), 'a');
      try {
        if (this.disposed) return; // Quit rewrote the file meanwhile.
        await fh.write(text);
      } finally {
        await fh.close();
      }
      s.logBytes += Buffer.byteLength(text);
    } catch {
      // Disk full / gone: write everything on the next try (a second later; no retry loop beyond that rhythm).
      s.logBytes = Infinity;
      this.dirty.add(id);
      this.schedule();
    } finally {
      this.busy.delete(id);
    }
  }

  /** The whole store as a fresh log, a chunk at a time (other work runs between), swapped in with a rename. */
  private async compact(id: string, s: Store): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(id)}.tmp`;
    const fh = await fs.promises.open(tmp, 'w');
    let bytes = 0;
    try {
      let chunk = '';
      // Keys changed while this runs are also in `pending`: appended after the swap, so the newest value wins.
      for (const k of Object.keys(s.data)) {
        if (!Object.hasOwn(s.data, k)) continue;
        chunk += line(k, JSON.stringify(s.data[k]));
        if (chunk.length >= COMPACT_CHUNK) {
          await fh.write(chunk);
          bytes += Buffer.byteLength(chunk);
          chunk = '';
        }
      }
      await fh.write(chunk);
      bytes += Buffer.byteLength(chunk);
    } finally {
      await fh.close();
    }
    if (this.disposed) return;
    await fs.promises.rename(tmp, this.file(id));
    s.logBytes = bytes;
  }

  private load(id: string): Promise<Store> {
    const s = this.stores.get(id);
    if (s) return Promise.resolve(s);
    let p = this.loading.get(id);
    if (!p) {
      p = this.read(id).then((store) => {
        this.loading.delete(id);
        this.stores.set(id, store);
        return store;
      });
      this.loading.set(id, p);
    }
    return p;
  }

  private async read(id: string): Promise<Store> {
    const s: Store = {
      data: Object.create(null) as Record<string, unknown>,
      sizes: new Map(),
      used: 0,
      lines: new Map(),
      lineTotal: 0,
      logBytes: 0,
      pending: new Map(),
      legacy: false,
    };
    /** `bytes`: the value's JSON size, or null when removed. */
    const put = (key: string, value: unknown, bytes: number | null) => {
      account(s, key, bytes);
      if (bytes === null) delete s.data[key];
      else s.data[key] = value;
    };
    let text: string | null = null;
    try {
      text = await fs.promises.readFile(this.file(id), 'utf8');
    } catch {
      // No log yet.
    }
    if (text !== null) {
      // Cut short by a crash (no final newline): rewrite the log on the next write, so the next line isn't appended
      // onto the broken one and lost with it.
      s.logBytes = text.endsWith('\n') ? Buffer.byteLength(text) : Infinity;
      let since = performance.now();
      for (const l of text.split('\n')) {
        if (!l) continue;
        try {
          // One parse per line. The value's size is read off the line itself (`[<key>,<value>]`, as written here)
          // instead of re-serializing it.
          const e = JSON.parse(l) as unknown;
          if (!Array.isArray(e) || typeof e[0] !== 'string') continue;
          const key = e[0];
          put(key, e[1], e.length > 1 ? Buffer.byteLength(l) - Buffer.byteLength(JSON.stringify(key)) - 3 : null);
        } catch {
          // A line cut short by a crash: skipped.
        }
        // Many keys: let other work run every few ms instead of holding the main process for the whole file.
        if (performance.now() - since > LOAD_SLICE_MS) {
          await new Promise((r) => setImmediate(r));
          since = performance.now();
        }
      }
      return s;
    }
    try {
      const d = JSON.parse(await fs.promises.readFile(path.join(this.dir, `${id}.json`), 'utf8')) as unknown;
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        for (const [k, v] of Object.entries(d)) put(k, v, Buffer.byteLength(JSON.stringify(v) ?? 'null'));
        s.legacy = true;
      }
    } catch {
      // Nothing stored yet.
    }
    return s;
  }
}
