// Knowledge graph (T65), main-process side: the list of sources (`~/.aquila/graph/sources.json`) and the index
// worker's lifecycle. Nothing runs until the renderer first asks (Settings → Sources, later the graph panel), and
// the worker only runs while at least one source is enabled. The main process keeps no notes — only statuses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  GraphDecision,
  GraphNode,
  GraphRuleOp,
  GraphSnapshot,
  GraphSource,
  GraphSourceStatus,
  GraphStatus,
  VaultLinkRule,
} from '../../src/shared/api/types';
import type { AppGraph } from './app-nodes';
import type { CodeProject } from './code';
import type { EngineStatus } from './engine';
import type { VaultGraph, VaultNote } from './vault';
import type { AiConfig, FromWorker, ToWorker, WorkerInit } from './worker';

const HOME = os.homedir();
export const tildify = (p: string, home = HOME) =>
  p === home ? '~' : p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
export const untildify = (p: string, home = HOME) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);

/** Worker crashes after which the index stays off until the app restarts. */
const MAX_CRASHES = 3;

export class SourceError extends Error {
  constructor(readonly code: 'notFolder' | 'overlap' | 'unknown') {
    super(code);
  }
}

const inside = (child: string, parent: string) =>
  child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** Slug of the folder name, made unique. */
export function sourceId(abs: string, taken: readonly string[]): string {
  const base =
    path
      .basename(abs)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'notes';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** Adds a folder (enabled). The same folder, or one inside / around a source, is refused (notes would count twice). */
export function addSource(
  list: readonly GraphSource[],
  abs: string,
  home = HOME,
  /** Ids in use elsewhere (T73: the project folders'), so the new one doesn't take one. */
  taken: readonly string[] = [],
): GraphSource[] {
  const target = path.resolve(abs);
  for (const s of list) {
    const p = path.resolve(untildify(s.path, home));
    if (inside(target, p) || inside(p, target)) throw new SourceError('overlap');
  }
  const id = sourceId(target, [...list.map((s) => s.id), ...taken]);
  return [...list, { id, path: tildify(target, home), enabled: true }];
}

/**
 * T73: every local project's folder is a source with no setup, so a project's notes are in the graph wherever its
 * repo keeps them (no folder names assumed). Not the home folder or above it (a project at `~` would index
 * everything). Nested projects each keep theirs; the outer one leaves the inner folder out (`withExcludes`).
 */
export function autoSources(projects: readonly CodeProject[], home = HOME): GraphSource[] {
  const h = path.resolve(home);
  // The same folder twice (two projects on one repo): the first one names it.
  const byRoot = new Map<string, string>();
  for (const p of projects) if (!byRoot.has(path.resolve(p.root))) byRoot.set(path.resolve(p.root), p.id);
  return [...byRoot]
    .filter(([root]) => root !== h && !inside(h, root))
    .map(([root, id]) => ({
      id: `project-${id.replace(/[^\w-]/g, '-')}`,
      path: tildify(root, home),
      enabled: true,
      auto: true,
    }));
}

/** T73: what the user set on a project folder (it isn't in the `sources` list): off, AI extraction. */
export type AutoPrefs = Record<string, { enabled?: boolean; ai?: boolean }>;

/**
 * What is listed and indexed: the user's own sources (as they were: ids, AI, vault settings), then the project
 * folders with the user's settings on them. A project folder that is exactly a user source is that source.
 */
export function effectiveSources(
  user: readonly GraphSource[],
  auto: readonly GraphSource[],
  home = HOME,
  prefs: AutoPrefs = {},
): GraphSource[] {
  const abs = (s: GraphSource) => path.resolve(untildify(s.path, home));
  const roots = new Set(user.map(abs));
  return [
    ...user,
    ...auto.filter((a) => !roots.has(abs(a))).map((a) => ({ ...a, ...prefs[a.id] })),
  ];
}

/**
 * T73: sources may nest (a folder the user added inside a project, a project inside another): each folder is
 * indexed by the most specific source, so the outer one leaves the inner ones out — on or off (an inner source
 * turned off stays out of the graph).
 */
export function withExcludes(
  sources: readonly GraphSource[],
  home = HOME,
): { source: GraphSource; root: string; exclude: string[] }[] {
  const roots = sources.map((s) => path.resolve(untildify(s.path, home)));
  return sources.map((source, i) => ({
    source,
    root: roots[i]!,
    exclude: roots
      .filter((r, j) => j !== i && r !== roots[i] && inside(r, roots[i]!))
      .map((r) => path.relative(roots[i]!, r).split(path.sep).join('/')),
  }));
}

export function readSources(file: string): GraphSource[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { sources?: unknown };
    if (!Array.isArray(data.sources)) return [];
    return data.sources.filter(
      (s): s is GraphSource =>
        !!s &&
        typeof (s as GraphSource).id === 'string' &&
        typeof (s as GraphSource).path === 'string' &&
        typeof (s as GraphSource).enabled === 'boolean',
    );
  } catch {
    return [];
  }
}

/** T73: settings on project folders (`auto` in sources.json). */
export function readAutoPrefs(file: string): AutoPrefs {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { auto?: unknown };
    const out: AutoPrefs = {};
    if (!data.auto || typeof data.auto !== 'object') return out;
    for (const [id, v] of Object.entries(data.auto as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const { enabled, ai } = v as { enabled?: unknown; ai?: unknown };
      out[id] = {
        ...(typeof enabled === 'boolean' ? { enabled } : {}),
        ...(typeof ai === 'boolean' ? { ai } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSources(file: string, sources: readonly GraphSource[], auto: AutoPrefs = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const prefs = Object.keys(auto).length ? { auto } : {};
  fs.writeFileSync(tmp, JSON.stringify({ sources, ...prefs }, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** Sources as the UI shows them: disabled = `off`; enabled ones as the worker reports (indexing until it does). */
export function mergeStatus(sources: readonly GraphSource[], engine: EngineStatus | null): GraphStatus {
  const byId = new Map(engine?.sources.map((s) => [s.id, s]));
  const list: GraphSourceStatus[] = sources.map((s) => {
    const e = s.enabled ? byId.get(s.id) : undefined;
    if (!s.enabled) return { ...s, state: 'off', notes: 0 };
    return {
      ...s,
      state: e?.state ?? 'indexing',
      notes: e?.notes ?? 0,
      ...(e?.total !== undefined ? { total: e.total } : {}),
      ...(e?.error ? { error: e.error } : {}),
    };
  });
  return {
    sources: list,
    notes: list.reduce((n, s) => n + s.notes, 0),
    edges: engine?.edges ?? 0,
    idGroups: engine?.idGroups ?? [],
    version: engine?.version ?? 0,
    ...(engine?.links ? { links: engine.links } : {}),
  };
}

const EMPTY: GraphSnapshot = { nodes: [], edges: [], idGroups: [], version: 0 };

export interface GraphServiceOptions {
  /** `~/.aquila/graph`: sources.json + index.json. */
  dir: string;
  /** The compiled `worker.js`. */
  workerFile: string;
  saver: boolean;
  /** Local projects whose code names count. */
  projects: () => CodeProject[];
  onStatus: (s: GraphStatus) => void;
  /** T68: how AI extraction reaches Claude (the shared account; a fixture reply in smoke). */
  claude?: () => Omit<AiConfig, 'sources'>;
  /** T69: link rules of these (enabled) sources, sent to the index. */
  vaultLinks?: (ids: string[]) => Record<string, VaultLinkRule[]>;
  /** T69: a source's `.aquila-vault.json` changed on disk. */
  onVaultFile?: (id: string) => void;
  /** T70: sessions, changed files, trends and applies for the index's nodes (merged into every snapshot). */
  app?: (nodes: GraphNode[]) => Promise<AppGraph>;
  /**
   * T73: project folders are sources with no setup (default on). Off in smoke, whose project is this repo and
   * whose fixture sources live inside it.
   */
  autoProjects?: boolean;
  /** Tests / smoke: a fake folder dialog has nothing to do with this; `home` for `~/…` paths. */
  home?: string;
}

export class GraphService implements VaultGraph {
  /** The user's own sources (sources.json). */
  private stored: GraphSource[];
  /** T73: the user's settings on project folders (sources.json `auto`). */
  private autoPrefs: AutoPrefs;
  /** What is indexed: the user's sources + the project folders (T73), worked out on each `sync`. */
  private sources: GraphSource[];
  private worker: Worker | null = null;
  private engine: EngineStatus | null = null;
  private started = false;
  /** Worker exits nobody asked for (an exception in it). Restarted on the next graph call, up to MAX_CRASHES. */
  private crashes = 0;
  private saver: boolean;
  private req = 0;
  private waiting = new Map<number, (s: GraphSnapshot) => void>();
  private waitingNotes = new Map<number, (n: VaultNote[]) => void>();
  /** T70: goes up when the app's part changed (added to the index version, so the open graph refetches). */
  private appVersion = 0;
  private appTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: GraphServiceOptions) {
    this.stored = readSources(this.file);
    this.autoPrefs = readAutoPrefs(this.file);
    this.sources = this.effective();
    this.saver = opts.saver;
  }

  private effective(): GraphSource[] {
    const auto = this.opts.autoProjects === false ? [] : autoSources(this.opts.projects(), this.opts.home);
    return effectiveSources(this.stored, auto, this.opts.home, this.autoPrefs);
  }

  /** T73: projects were added, moved or removed — their folders follow. */
  projectsChanged(): void {
    const next = this.effective();
    if (JSON.stringify(next) === JSON.stringify(this.sources)) return;
    this.sources = next;
    if (this.started) this.sync();
    this.opts.onStatus(this.current());
  }

  private get file() {
    return path.join(this.opts.dir, 'sources.json');
  }

  /** The first call starts the index (when a source is enabled). */
  status(): GraphStatus {
    // Projects changed some way we weren't told about (config.json edited by hand): catch up (no-op otherwise).
    this.projectsChanged();
    this.start();
    return this.current();
  }

  add(abs: string): GraphStatus {
    if (!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw new SourceError('notFolder');
    // Overlap only with the user's own sources: a folder inside a project folder (or holding one) becomes a source
    // of its own, and the outer one leaves it out (`withExcludes`). Ids stay unique across both.
    const added = addSource(
      this.stored,
      abs,
      this.opts.home,
      this.sources.map((s) => s.id),
    ).at(-1)!;
    this.save([...this.stored, added]);
    return this.status();
  }

  remove(id: string): GraphStatus {
    if (!this.stored.some((s) => s.id === id)) throw new SourceError('unknown');
    this.save(this.stored.filter((s) => s.id !== id));
    return this.status();
  }

  setEnabled(id: string, enabled: boolean): GraphStatus {
    if (this.isAuto(id)) return this.setAuto(id, { enabled });
    if (!this.stored.some((s) => s.id === id)) throw new SourceError('unknown');
    this.save(this.stored.map((s) => (s.id === id ? { ...s, enabled } : s)));
    return this.status();
  }

  private isAuto(id: string): boolean {
    return this.sources.some((s) => s.id === id && s.auto);
  }

  /** T73: a project folder's setting, kept beside the sources (the folder itself follows the project). */
  private setAuto(id: string, patch: { enabled?: boolean; ai?: boolean }): GraphStatus {
    this.autoPrefs = { ...this.autoPrefs, [id]: { ...this.autoPrefs[id], ...patch } };
    this.save(this.stored);
    return this.status();
  }

  /** T68: AI extraction on/off for a source (stored in sources.json). */
  setAi(id: string, ai: boolean): GraphStatus {
    if (this.isAuto(id)) return this.setAuto(id, { ai });
    if (!this.stored.some((s) => s.id === id)) throw new SourceError('unknown');
    this.save(this.stored.map((s) => (s.id === id ? { ...s, ai } : s)));
    return this.status();
  }

  decide(d: GraphDecision): void {
    this.start();
    this.post({ type: 'decide', d });
  }

  rule(op: GraphRuleOp): void {
    this.start();
    this.post({ type: 'rule', op });
  }

  extractNow(id: string): void {
    this.start();
    this.post({ type: 'extractNow', id });
  }

  indexNow(id: string): GraphStatus {
    this.start();
    this.post({ type: 'indexNow', id });
    return this.current();
  }

  async snapshot(): Promise<GraphSnapshot> {
    this.start();
    const w = this.worker;
    if (!w) return EMPTY;
    const req = ++this.req;
    const appVersion = this.appVersion;
    const snap = await new Promise<GraphSnapshot>((resolve) => {
      this.waiting.set(req, resolve);
      w.postMessage({ type: 'snapshot', req } satisfies ToWorker);
    });
    if (!this.opts.app || snap === EMPTY) return snap;
    const app = await this.opts.app(snap.nodes);
    const ids = new Set(snap.nodes.map((n) => n.id));
    const nodes = [...snap.nodes, ...app.nodes.filter((n) => !ids.has(n.id))];
    for (const n of app.nodes) ids.add(n.id);
    const edges = [...snap.edges, ...app.edges.filter((e) => ids.has(e.source) && ids.has(e.target))];
    return { ...snap, nodes, edges, version: snap.version + appVersion };
  }

  /**
   * T70: the app's part changed (a turn ended, an apply was decided). Coalesced; costs nothing until the graph was
   * first asked for — the open panel refetches on the new version, a closed one doesn't.
   */
  appChanged(): void {
    if (!this.started || this.appTimer) return;
    this.appTimer = setTimeout(() => {
      this.appTimer = null;
      this.appVersion++;
      this.opts.onStatus(this.current());
    }, 1000);
    this.appTimer.unref?.();
  }

  /**
   * The absolute path of a Markdown file inside an enabled source, or null — so "open note" (T66) can't be pointed
   * at anything else.
   */
  notePath(abs: string): string | null {
    return this.sourceFile(abs, /\.md$/i);
  }

  /** An existing file inside an enabled source whose name matches `ext` (an image next to a note, T67), or null. */
  sourceFile(abs: string, ext: RegExp): string | null {
    const file = path.resolve(abs);
    if (!ext.test(file) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return null;
    return this.ownerOf(file)?.source.enabled ? file : null;
  }

  /** T70: some source is enabled (the graph is in use, so turns' changed files are worth recording). */
  hasEnabled(): boolean {
    return this.sources.some((s) => s.enabled);
  }

  /** T70: enabled sources, in the order they were added. */
  enabledIds(): string[] {
    return this.sources.filter((s) => s.enabled).map((s) => s.id);
  }

  /** T69: a source's folder (enabled or not), or null. */
  sourceRoot(id: string): string | null {
    const s = this.sources.find((x) => x.id === id);
    return s ? untildify(s.path, this.opts.home) : null;
  }

  /** T69: the enabled source a `.md` file is in, with its path inside the source. */
  sourceOf(abs: string): { id: string; root: string; rel: string } | null {
    const file = this.notePath(abs);
    if (!file) return null;
    const owner = this.ownerOf(file);
    return owner ? { id: owner.source.id, root: owner.root, rel: owner.rel } : null;
  }

  /** The source a file is in: the most specific one when sources nest (T73), on or off. */
  private ownerOf(file: string): { source: GraphSource; root: string; rel: string } | null {
    let best: { source: GraphSource; root: string; rel: string } | null = null;
    for (const s of this.sources) {
      const root = untildify(s.path, this.opts.home);
      const rel = path.relative(root, file);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      if (!best || root.length > best.root.length) best = { source: s, root, rel: rel.split(path.sep).join('/') };
    }
    return best;
  }

  /** T69: an enabled source's notes from the index (starts it like any graph call). */
  notes(id: string): Promise<VaultNote[]> {
    this.start();
    const w = this.worker;
    if (!w || !this.sources.some((s) => s.id === id && s.enabled)) return Promise.resolve([]);
    const req = ++this.req;
    return new Promise((resolve) => {
      this.waitingNotes.set(req, resolve);
      w.postMessage({ type: 'notes', req, id } satisfies ToWorker);
    });
  }

  /** T69: settings changed — send the link rules again. */
  refreshVaults(): void {
    if (this.started) this.postVaultLinks();
  }

  setSaver(saver: boolean): void {
    this.saver = saver;
    this.post({ type: 'saver', saver });
  }

  close(): void {
    if (this.appTimer) clearTimeout(this.appTimer);
    this.stopWorker();
  }

  // ---- internals ----

  private current(): GraphStatus {
    const st = mergeStatus(this.sources, this.engine);
    return { ...st, version: st.version + this.appVersion };
  }

  private save(next: GraphSource[]): void {
    writeSources(this.file, next, this.autoPrefs);
    this.stored = next;
    this.sources = this.effective();
    if (this.started) this.sync();
    this.opts.onStatus(this.current());
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.sync();
  }

  /** Tells the worker which sources to index; starts it for the first enabled source, stops it after the last. */
  private sync(): void {
    const enabled = this.sources.filter((s) => s.enabled);
    if (!enabled.length) {
      this.stopWorker();
      return;
    }
    if (!this.worker) this.startWorker();
    this.post({
      type: 'sources',
      // Nested sources: each folder is indexed once, by the most specific one (T73).
      sources: withExcludes(this.sources, this.opts.home)
        .filter((x) => x.source.enabled)
        .map((x) => ({ id: x.source.id, root: x.root, exclude: x.exclude })),
      projects: this.opts.projects(),
    });
    const claude = this.opts.claude?.();
    const ai = enabled.filter((s) => s.ai).map((s) => s.id);
    this.post({ type: 'ai', config: { binary: 'claude', ...claude, sources: claude ? ai : [] } });
    this.postVaultLinks();
  }

  private postVaultLinks(): void {
    if (!this.worker || !this.opts.vaultLinks) return;
    const ids = this.sources.filter((s) => s.enabled).map((s) => s.id);
    this.post({ type: 'vaultLinks', rules: this.opts.vaultLinks(ids) });
  }

  private startWorker(): void {
    const workerData: WorkerInit = {
      indexFile: path.join(this.opts.dir, 'index.json'),
      linksFile: path.join(this.opts.dir, 'links.json'),
      aiFile: path.join(this.opts.dir, 'ai.json'),
      saver: this.saver,
    };
    // A small young generation: indexing makes short-lived garbage in bursts, and V8's default (16 MB semi-spaces)
    // keeps that headroom resident for the worker's life. Measured with 2,000 notes: −13 MB, same index time.
    // No old-generation cap: a big vault must not run the worker out of memory.
    const w = new Worker(this.opts.workerFile, { workerData, resourceLimits: { maxYoungGenerationSizeMb: 4 } });
    this.worker = w;
    w.on('message', (m: FromWorker) => {
      if (m.type === 'status') {
        this.engine = m.status;
        this.opts.onStatus(this.current());
      } else if (m.type === 'vaultFile') this.opts.onVaultFile?.(m.id);
      else if (m.type === 'notes') {
        this.waitingNotes.get(m.req)?.(m.notes);
        this.waitingNotes.delete(m.req);
      } else {
        this.waiting.get(m.req)?.(m.snapshot);
        this.waiting.delete(m.req);
      }
    });
    w.on('error', (e) => console.error('[graph] worker failed:', e));
    w.on('exit', (code) => {
      if (this.worker !== w) return; // stopped on purpose (stopWorker cleared it first)
      this.worker = null;
      this.engine = null;
      for (const resolve of this.waiting.values()) resolve(EMPTY);
      this.waiting.clear();
      for (const resolve of this.waitingNotes.values()) resolve([]);
      this.waitingNotes.clear();
      // Crashed: the next graph call starts it again (not right away, so a note that crashes it can't loop).
      this.crashes++;
      console.error(`[graph] worker exited (${code}), crash ${this.crashes}/${MAX_CRASHES}`);
      if (this.crashes < MAX_CRASHES) this.started = false;
      this.opts.onStatus(this.current());
    });
  }

  private stopWorker(): void {
    const w = this.worker;
    if (!w) return;
    this.worker = null;
    this.engine = null;
    w.postMessage({ type: 'stop' } satisfies ToWorker);
    // Saves its index on stop; cut it off if it hangs.
    setTimeout(() => void w.terminate(), 2000).unref();
    for (const resolve of this.waiting.values()) resolve(EMPTY);
    this.waiting.clear();
    for (const resolve of this.waitingNotes.values()) resolve([]);
    this.waitingNotes.clear();
  }

  private post(m: ToWorker): void {
    this.worker?.postMessage(m);
  }
}
