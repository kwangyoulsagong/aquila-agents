// Knowledge graph (T65): the index. Walks enabled sources, parses changed `.md` files in batches that yield, watches
// each source with one recursive `fs.watch` (no polling), keeps the index in `~/.aquila/graph/index.json`.
// Runs inside the worker thread (`worker.ts`); tests drive it directly. Never writes to the user's files.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  GraphDecision,
  GraphIdGroup,
  GraphLinksState,
  GraphRuleOp,
  GraphSnapshot,
  GraphSourceState,
} from '../../src/shared/api/types';
import { buildGraph, noteId, type CodeName, type IndexedNote } from './build';
import { collectCodeNames, SKIP_DIRS, yieldNow, type CodeProject } from './code';
import { Extractor, type ExtractorOptions, type RunPrompt } from './extract';
import { parseNote } from './parse';
import { applyRuleOp, decide, pairKey, proposals, readLinks, writeLinks, type LinkData } from './rules';
import { SimilarIndex } from './similar';

export interface EngineSource {
  id: string;
  root: string;
}

export interface EngineSourceStatus {
  id: string;
  state: Exclude<GraphSourceState, 'off'>;
  notes: number;
  total?: number;
  error?: string;
}

export interface EngineStatus {
  sources: EngineSourceStatus[];
  notes: number;
  edges: number;
  idGroups: GraphIdGroup[];
  version: number;
  links: GraphLinksState;
}

export interface EngineOptions {
  /** Where the index is kept; none = memory only. */
  indexFile?: string;
  /** T68: decisions and rules (`links.json`) and AI extracts (`ai.json`); none = memory only. */
  linksFile?: string;
  aiFile?: string;
  /** T68: extractor knobs (tests). */
  extractor?: Omit<ExtractorOptions, 'file' | 'onChange'>;
  saver?: boolean;
  onStatus?: (s: EngineStatus) => void;
  /** Watch sources for changes (off in tests). */
  watch?: boolean;
  /** Override the project scan (tests). */
  codeNames?: (projects: readonly CodeProject[]) => Promise<Map<string, CodeName>>;
  /** A first index with more files than this pauses in power saver. */
  largeSource?: number;
  batch?: number;
}

/** Watcher debounce normally / in power saver. */
export const DEBOUNCE_MS = 400;
export const SAVER_DEBOUNCE_MS = 2000;
const SAVE_DELAY_MS = 2000;
const MAX_FILES = 20_000;
const MAX_NOTE_BYTES = 1024 * 1024;
const INDEX_VERSION = 1;

interface SavedIndex {
  v: number;
  notes: IndexedNote[];
}

interface SourceState {
  id: string;
  root: string;
  state: EngineSourceStatus['state'];
  total?: number;
  error?: string;
  watcher?: fs.FSWatcher;
  pending: Set<string>;
  /** A change that may be a folder (rename / delete): walk the whole source again. */
  rescan: boolean;
  timer?: NodeJS.Timeout;
  /** Bumped when the source is removed or re-added: a running walk stops. */
  epoch: number;
}

const toPosix = (p: string) => p.split(path.sep).join('/');
const ignored = (rel: string) =>
  rel.split('/').some((part, i, all) => part.startsWith('.') || (i < all.length - 1 && SKIP_DIRS.has(part)));

/** `.md` files under `root` (relative, `/`-separated), hidden and build folders skipped, capped. */
export async function walkMarkdown(root: string, max = MAX_FILES): Promise<string[]> {
  const out: string[] = [];
  const stack = [''];
  while (stack.length && out.length < max) {
    const rel = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && e.name !== 'node_modules') stack.push(child);
      } else if (e.isFile() && /\.md$/i.test(e.name)) {
        out.push(child);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

export class GraphEngine {
  private notes = new Map<string, IndexedNote>();
  private sources = new Map<string, SourceState>();
  private codeNames = new Map<string, CodeName>();
  private projectsKey = '';
  private saver: boolean;
  private version = 0;
  private cache: GraphSnapshot | null = null;
  private edgeCount = 0;
  private saveTimer?: NodeJS.Timeout;
  private loaded = false;
  private closed = false;
  private running = new Set<Promise<void>>();
  private similar = new SimilarIndex();
  private links: LinkData;
  private extractor: Extractor;

  constructor(private opts: EngineOptions = {}) {
    this.saver = !!opts.saver;
    this.links = readLinks(opts.linksFile);
    this.extractor = new Extractor({
      ...opts.extractor,
      ...(opts.aiFile ? { file: opts.aiFile } : {}),
      onChange: (extracts) => (extracts ? this.changed() : this.emit()),
    });
    this.extractor.setSaver(this.saver);
  }

  /** Sources to index (enabled only) and projects whose code names count. Removed sources drop their notes. */
  async setSources(sources: readonly EngineSource[], projects: readonly CodeProject[] = []): Promise<void> {
    this.load();
    const wanted = new Map(sources.map((s) => [s.id, s]));
    for (const [id, s] of this.sources)
      if (!wanted.has(id) || wanted.get(id)!.root !== s.root) this.dropSource(id);
    // Notes of sources that are gone (removed while the app was closed, or disabled) cost nothing.
    for (const [key, n] of this.notes) if (!wanted.has(n.sourceId)) this.notes.delete(key);

    const added = sources.filter((s) => !this.sources.has(s.id));
    for (const s of added)
      this.sources.set(s.id, {
        id: s.id,
        root: s.root,
        state: 'indexing',
        pending: new Set(),
        rescan: false,
        epoch: 0,
      });
    this.emit();
    // Indexing runs on: a later change of sources (a source turned off mid-index) doesn't wait for it.
    for (const src of added) this.track(this.indexSource(src.id, false).then(() => this.changed()));
    // Code names come after the notes (a scan of every project can take a while); the graph is rebuilt when ready.
    const key = JSON.stringify(projects.map((p) => [p.id, p.root]));
    if (key !== this.projectsKey) {
      this.projectsKey = key;
      this.track(
        (this.opts.codeNames ?? collectCodeNames)(projects).then((names) => {
          if (this.projectsKey !== key || this.closed) return;
          this.codeNames = names;
          this.changed();
        }),
      );
    }
  }

  /** Resolves when no indexing is running (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }

  setSaver(saver: boolean): void {
    this.saver = saver;
    this.extractor.setSaver(saver);
  }

  /** T68: accept / reject a suggested or mentioned connection. */
  decide(d: GraphDecision): void {
    const key = pairKey(d.source, d.target);
    const edge = this.snapshot().edges.find((e) => pairKey(e.source, e.target) === key);
    this.links = decide(this.links, d, edge, Date.now());
    this.saveLinks();
    this.changed();
  }

  /** T68: add / edit / remove a rule, dismiss a proposal. */
  ruleOp(op: GraphRuleOp): void {
    const next = applyRuleOp(this.links, op, Date.now());
    if (next === this.links) return;
    this.links = next;
    this.saveLinks();
    this.changed();
  }

  /** T68: sources with AI extraction on, and how to reach Claude (null: nothing runs). */
  configureAi(sources: readonly string[], run: RunPrompt | null): void {
    this.extractor.configure(sources, run);
    this.emit();
  }

  /** T68: "Run now" for a source's queued notes. */
  extractNow(id: string): Promise<void> {
    return this.extractor.runNow(id);
  }

  /** Resolves when no AI extraction is running (tests). */
  extractIdle(): Promise<void> {
    return this.extractor.idle();
  }

  /** Starts a first index that was paused in saver. */
  indexNow(id: string): void {
    const s = this.sources.get(id);
    if (!s || s.state !== 'paused') return;
    this.track(this.indexSource(id, true).then(() => this.changed()));
  }

  snapshot(): GraphSnapshot {
    if (!this.cache) {
      // Only notes whose file changed are scored / queued again.
      const docs = [...this.notes.entries()].map(([id, n]) => ({
        id,
        sourceId: n.sourceId,
        abs: n.abs,
        title: n.note.title,
        sig: `${n.mtime}:${n.size}`,
        text: n.note.text,
      }));
      this.similar.sync(docs);
      this.extractor.sync(docs);
      this.cache = buildGraph(this.notes.values(), this.codeNames, this.version, {
        similar: this.similar.all(),
        ai: this.extractor.extracts(),
        links: this.links,
      });
      this.edgeCount = this.cache.edges.length;
    }
    return this.cache;
  }

  status(): EngineStatus {
    const count = new Map<string, number>();
    for (const n of this.notes.values()) count.set(n.sourceId, (count.get(n.sourceId) ?? 0) + 1);
    return {
      sources: [...this.sources.values()].map((s) => ({
        id: s.id,
        state: s.state,
        notes: count.get(s.id) ?? 0,
        ...(s.total !== undefined ? { total: s.total } : {}),
        ...(s.error ? { error: s.error } : {}),
      })),
      notes: this.notes.size,
      edges: this.edgeCount,
      idGroups: this.cache?.idGroups ?? [],
      version: this.version,
      links: {
        rules: this.links.rules,
        proposals: proposals(this.links),
        ai: this.extractor.state(),
        accepted: this.links.accepted.length,
        rejected: this.links.rejected.length,
      },
    };
  }

  /** Re-reads these files of a source (what the watcher does after the debounce). */
  async refresh(id: string, rels: readonly string[]): Promise<void> {
    const s = this.sources.get(id);
    if (!s) return;
    let any = false;
    for (const rel of rels) if (await this.readOne(s, rel)) any = true;
    if (any) this.changed();
  }

  close(): void {
    this.closed = true;
    this.extractor.close();
    for (const id of [...this.sources.keys()]) this.stopSource(id);
    this.flushSave();
  }

  // ---- internals ----

  private track(p: Promise<void>): void {
    const done = p.finally(() => this.running.delete(done));
    this.running.add(done);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.opts.indexFile) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.opts.indexFile, 'utf8')) as SavedIndex;
      if (saved.v !== INDEX_VERSION || !Array.isArray(saved.notes)) return;
      for (const n of saved.notes) this.notes.set(noteId(n.sourceId, n.rel), n);
    } catch {
      // none yet, or unreadable: index from scratch
    }
  }

  private async indexSource(id: string, force: boolean): Promise<void> {
    const s = this.sources.get(id);
    if (!s) return;
    const epoch = s.epoch;
    const live = () => !this.closed && this.sources.get(id) === s && s.epoch === epoch;
    try {
      const st = await fsp.stat(s.root).catch(() => null);
      if (!st?.isDirectory()) {
        s.state = 'missing';
        this.emit();
        return;
      }
      const rels = await walkMarkdown(s.root);
      if (!live()) return;
      const known = new Set<string>();
      for (const n of this.notes.values()) if (n.sourceId === id) known.add(n.rel);
      const firstIndex = known.size === 0;
      // Files gone while we weren't looking.
      const present = new Set(rels);
      for (const rel of known) if (!present.has(rel)) this.notes.delete(noteId(id, rel));

      const todo: string[] = [];
      for (const rel of rels) {
        const prev = this.notes.get(noteId(id, rel));
        if (!prev) {
          todo.push(rel);
          continue;
        }
        const stat = await fsp.stat(path.join(s.root, rel)).catch(() => null);
        if (!stat || stat.mtimeMs !== prev.mtime || stat.size !== prev.size) todo.push(rel);
      }
      s.total = rels.length;
      if (firstIndex && !force && this.saver && todo.length > (this.opts.largeSource ?? 500)) {
        s.state = 'paused';
        this.startWatch(s);
        this.emit();
        return;
      }
      s.state = 'indexing';
      this.emit();
      const batch = this.opts.batch ?? 50;
      for (let i = 0; i < todo.length; i += batch) {
        for (const rel of todo.slice(i, i + batch)) await this.readOne(s, rel);
        if (!live()) return;
        if (i + batch < todo.length) {
          this.emit();
          await yieldNow();
        }
      }
      s.state = 'ready';
      s.total = undefined;
      s.error = undefined;
      this.startWatch(s);
    } catch (e) {
      s.state = 'error';
      s.error = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  /** Parses one file (or forgets it when it's gone). True when the index changed. */
  private async readOne(s: SourceState, rel: string): Promise<boolean> {
    const key = noteId(s.id, rel);
    const abs = path.join(s.root, rel);
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat?.isFile() || !/\.md$/i.test(rel) || ignored(rel)) return this.notes.delete(key);
    const prev = this.notes.get(key);
    if (prev && prev.mtime === stat.mtimeMs && prev.size === stat.size) return false;
    if (stat.size > MAX_NOTE_BYTES) return this.notes.delete(key);
    try {
      const src = await fsp.readFile(abs, 'utf8');
      this.notes.set(key, {
        sourceId: s.id,
        rel,
        abs,
        mtime: stat.mtimeMs,
        size: stat.size,
        note: parseNote(path.posix.basename(rel), src),
      });
      return true;
    } catch {
      return this.notes.delete(key);
    }
  }

  private startWatch(s: SourceState): void {
    if (s.watcher || this.opts.watch === false) return;
    try {
      s.watcher = fs.watch(s.root, { recursive: true }, (_event, filename) => {
        const rel = filename ? toPosix(filename.toString()) : '';
        if (rel && ignored(rel)) return;
        if (rel && /\.md$/i.test(rel)) s.pending.add(rel);
        else if (!rel || !/\.[^/]+$/.test(rel))
          s.rescan = true; // a folder (or unknown): walk again
        else return; // another kind of file
        clearTimeout(s.timer);
        s.timer = setTimeout(() => void this.flush(s), this.saver ? SAVER_DEBOUNCE_MS : DEBOUNCE_MS);
      });
      s.watcher.on('error', () => {
        s.watcher?.close();
        s.watcher = undefined;
      });
    } catch {
      // can't watch (a network folder): the index is refreshed when the app opens it again
    }
  }

  private async flush(s: SourceState): Promise<void> {
    if (this.sources.get(s.id) !== s) return;
    const rels = [...s.pending];
    const rescan = s.rescan;
    s.pending.clear();
    s.rescan = false;
    if (rescan && s.state !== 'paused') {
      await this.indexSource(s.id, true);
      this.changed();
    } else if (s.state !== 'paused') await this.refresh(s.id, rels);
  }

  private stopSource(id: string): void {
    const s = this.sources.get(id);
    if (!s) return;
    s.epoch++;
    clearTimeout(s.timer);
    s.watcher?.close();
    this.sources.delete(id);
  }

  private dropSource(id: string): void {
    this.stopSource(id);
    for (const [key, n] of this.notes) if (n.sourceId === id) this.notes.delete(key);
    this.changed();
  }

  /** The index changed: new version, snapshot rebuilt on the next ask, saved a little later. */
  private changed(): void {
    this.version++;
    this.cache = null;
    this.snapshot(); // built once per change (in the worker), for the status's edge count and the next ask
    this.scheduleSave();
    this.emit();
  }

  private emit(): void {
    this.opts.onStatus?.(this.status());
  }

  private saveLinks(): void {
    if (!this.opts.linksFile) return;
    try {
      writeLinks(this.opts.linksFile, this.links);
    } catch {
      // kept in memory; the next decision tries again
    }
  }

  private scheduleSave(): void {
    if (!this.opts.indexFile || this.closed) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  private flushSave(): void {
    if (!this.opts.indexFile || !this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const file = this.opts.indexFile;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      const data: SavedIndex = { v: INDEX_VERSION, notes: [...this.notes.values()] };
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch {
      // the next change tries again
    }
  }
}
