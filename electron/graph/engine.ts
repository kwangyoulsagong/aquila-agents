// Knowledge graph (T65): the index. Walks enabled sources, parses changed `.md` files in batches that yield, watches
// each source with one recursive `fs.watch` (no polling), keeps the index in `~/.aquila/graph/index.json`.
// Runs inside the worker thread (`worker.ts`); tests drive it directly. Never writes to the user's files.
import { execFile } from 'node:child_process';
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
  RelatedNote,
} from '../../src/shared/api/types';
import { buildGraph, mentionCache, noteId, type CodeName, type IndexedNote } from './build';
import { collectCodeNames, SKIP_DIRS, yieldNow, type CodeProject } from './code';
import { Extractor, type ExtractorOptions, type RunPrompt } from './extract';
import { parseNote } from './parse';
import { applyRuleOp, decide, pairKey, proposals, readLinks, writeLinks, type LinkData } from './rules';
import { SimilarIndex } from './similar';
import { rankRelated, type RelatedCandidate } from './related';
import { compileLinkRules, SHARED_FILE, type CompiledLinkRule, type VaultNote } from './vault';
import type { VaultLinkRule } from '../../src/shared/api/types';

export interface EngineSource {
  id: string;
  root: string;
  /** T73: folders inside `root` (relative, `/`-separated) that are other sources: not walked or watched here. */
  exclude?: string[];
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
  /** T69: a source's shared settings file (`.aquila-vault.json`) changed. */
  onVaultFile?: (sourceId: string) => void;
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
/**
 * The index file is only a cache (thousands of notes: tens of MB of JSON). Written this long after the last change,
 * not 2 s after every save of a note while someone types; flushed on close.
 */
const SAVE_DELAY_MS = 30_000;
const MAX_FILES = 20_000;
const MAX_NOTE_BYTES = 1024 * 1024;
/** 2: IDs read whole (`FE-REQ-030`, T79) — older caches are parsed again. */
const INDEX_VERSION = 2;

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
  /** T73: folders inside it that belong to another source. */
  exclude: string[];
  /** What `.gitignore` leaves out (read on each walk): not walked, watch events there dropped. */
  gitIgnored: Set<string>;
}

const toPosix = (p: string) => p.split(path.sep).join('/');
const ignored = (rel: string) =>
  rel.split('/').some((part, i, all) => part.startsWith('.') || (i < all.length - 1 && SKIP_DIRS.has(part)));
/** `rel` is in `set` or inside a folder in it. */
const inSet = (rel: string, set: ReadonlySet<string>) => {
  if (!set.size) return false;
  for (let i = rel.indexOf('/'); i > 0; i = rel.indexOf('/', i + 1))
    if (set.has(rel.slice(0, i))) return true;
  return set.has(rel);
};

/**
 * What the repo's `.gitignore` leaves out under `root` (relative, `/`-separated; folders without the slash) — a
 * Unity `Library/PackageCache`, vendored docs: thousands of `.md` nobody wrote. Empty when `root` isn't in a git
 * repo or git isn't there.
 */
export function gitIgnored(root: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [
        'ls-files',
        '-z',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '--no-empty-directory',
      ],
      { cwd: root, timeout: 10_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(new Set());
        resolve(
          new Set(
            stdout
              .split('\0')
              .filter(Boolean)
              .map((x) => x.replace(/\/$/, '')),
          ),
        );
      },
    );
  });
}

/** `rel` is one of `exclude` or inside one. */
const excluded = (rel: string, exclude: readonly string[]) =>
  exclude.some((x) => rel === x || rel.startsWith(`${x}/`));

/** `.md` files under `root` (relative, `/`-separated), hidden and build folders skipped, capped. */
export async function walkMarkdown(
  root: string,
  max = MAX_FILES,
  exclude: readonly string[] = [],
  skip: ReadonlySet<string> = new Set(),
): Promise<string[]> {
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
        if (
          !SKIP_DIRS.has(e.name) &&
          e.name !== 'node_modules' &&
          !excluded(child, exclude) &&
          !skip.has(child)
        )
          stack.push(child);
      } else if (e.isFile() && /\.md$/i.test(e.name) && !skip.has(child)) {
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
  /** T76: title mentions per note, kept between snapshots. */
  private mentions = mentionCache();
  private links: LinkData;
  private extractor: Extractor;
  private vaultLinks = new Map<string, CompiledLinkRule[]>();
  private vaultKey = '';

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
    const excludeKey = (x: readonly string[] | undefined) => [...(x ?? [])].sort().join('\n');
    for (const [id, s] of this.sources) {
      const w = wanted.get(id);
      // Another source appeared inside it (or went): walk it again with the new folders left out.
      if (!w || w.root !== s.root || excludeKey(w.exclude) !== excludeKey(s.exclude)) this.dropSource(id);
    }
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
        exclude: [...(s.exclude ?? [])],
        gitIgnored: new Set(),
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

  /** T69: each source's link rules; the graph is rebuilt only when they changed. */
  setVaultLinks(rules: Readonly<Record<string, readonly VaultLinkRule[]>>): void {
    const key = JSON.stringify(rules);
    if (key === this.vaultKey) return;
    this.vaultKey = key;
    this.vaultLinks = new Map(
      Object.entries(rules)
        .map(([id, list]) => [id, compileLinkRules(list)] as const)
        .filter(([, list]) => list.length),
    );
    this.changed();
  }

  /** T69: a source's notes as views, companions and "Make with Claude" see them. */
  sourceNotes(id: string): VaultNote[] {
    const out: VaultNote[] = [];
    for (const n of this.notes.values())
      if (n.sourceId === id)
        out.push({
          rel: n.rel,
          abs: n.abs,
          title: n.note.title,
          frontmatter: n.note.frontmatter,
          headings: n.note.headings.filter((h) => h.level === 2).map((h) => h.text),
          mtime: n.mtime,
        });
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }

  /**
   * T81: notes related to a text that isn't a note — its IDs (plus `extraIds` the model named) and the nearest by
   * shared words. Uses the index as it is (the snapshot's similarity pass, built once per change); no rescan.
   */
  related(text: string, extraIds: readonly string[] = [], k = 6): RelatedNote[] {
    this.snapshot();
    const ids = [...new Set([...parseNote('brief.md', text).ids, ...extraIds])];
    const similar = this.similar.query(text, k + 2);
    const candidate = (id: string, n: IndexedNote): RelatedCandidate => ({
      id,
      abs: n.abs,
      title: n.note.title,
      rel: n.rel,
      sourceId: n.sourceId,
      ids: n.note.ids,
    });
    const notes: RelatedCandidate[] = [];
    if (ids.length) for (const [id, n] of this.notes) notes.push(candidate(id, n));
    else
      for (const s of similar) {
        const n = this.notes.get(s.id);
        if (n) notes.push(candidate(s.id, n));
      }
    return rankRelated(ids, similar, notes, k);
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
        mentions: this.mentions,
        ai: this.extractor.extracts(),
        links: this.links,
        vaultLinks: this.vaultLinks,
      });
      // T75: each note's telling body words, for naming the Map's groups by what the notes say.
      for (const n of this.cache.nodes)
        if (n.kind === 'note') {
          const terms = this.similar.terms(n.id);
          if (terms.length) n.terms = terms;
        }
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

  /** Walks a source and reads what is new or changed. True when the index changed (a rescan often finds nothing). */
  private async indexSource(id: string, force: boolean): Promise<boolean> {
    const s = this.sources.get(id);
    if (!s) return false;
    let changed = false;
    const before = s.state;
    const epoch = s.epoch;
    const live = () => !this.closed && this.sources.get(id) === s && s.epoch === epoch;
    try {
      const st = await fsp.stat(s.root).catch(() => null);
      if (!st?.isDirectory()) {
        s.state = 'missing';
        this.emit();
        return false;
      }
      s.gitIgnored = await gitIgnored(s.root);
      if (!live()) return false;
      const rels = await walkMarkdown(s.root, undefined, s.exclude, s.gitIgnored);
      if (!live()) return false;
      const known = new Set<string>();
      for (const n of this.notes.values()) if (n.sourceId === id) known.add(n.rel);
      const firstIndex = known.size === 0;
      // Files gone while we weren't looking.
      const present = new Set(rels);
      for (const rel of known) if (!present.has(rel) && this.notes.delete(noteId(id, rel))) changed = true;

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
        return changed;
      }
      // Nothing to read (the usual rescan after a folder event): no "indexing" flash for the open panel.
      if (todo.length) {
        s.state = 'indexing';
        this.emit();
      }
      const batch = this.opts.batch ?? 50;
      for (let i = 0; i < todo.length; i += batch) {
        for (const rel of todo.slice(i, i + batch)) if (await this.readOne(s, rel)) changed = true;
        if (!live()) return changed;
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
    if (changed || s.state !== before) this.emit();
    return changed;
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
        if (rel === SHARED_FILE) return this.opts.onVaultFile?.(s.id);
        if (rel && (ignored(rel) || excluded(rel, s.exclude) || inSet(rel, s.gitIgnored))) return;
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
      // Only a real change moves the version: every move makes the open graph refetch and redraw.
      if (await this.indexSource(s.id, true)) this.changed();
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
