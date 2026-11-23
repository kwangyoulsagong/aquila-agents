// Knowledge graph (T65), main-process side: the list of sources (`~/.aquila/graph/sources.json`) and the index
// worker's lifecycle. Nothing runs until the renderer first asks (Settings → Sources, later the graph panel), and
// the worker only runs while at least one source is enabled. The main process keeps no notes — only statuses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { GraphSnapshot, GraphSource, GraphSourceStatus, GraphStatus } from '../../src/shared/api/types';
import type { CodeProject } from './code';
import type { EngineStatus } from './engine';
import type { FromWorker, ToWorker, WorkerInit } from './worker';

const HOME = os.homedir();
export const tildify = (p: string, home = HOME) =>
  p === home ? '~' : p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
export const untildify = (p: string, home = HOME) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);

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
export function addSource(list: readonly GraphSource[], abs: string, home = HOME): GraphSource[] {
  const target = path.resolve(abs);
  for (const s of list) {
    const p = path.resolve(untildify(s.path, home));
    if (inside(target, p) || inside(p, target)) throw new SourceError('overlap');
  }
  const id = sourceId(
    target,
    list.map((s) => s.id),
  );
  return [...list, { id, path: tildify(target, home), enabled: true }];
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

export function writeSources(file: string, sources: readonly GraphSource[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ sources }, null, 2) + '\n');
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
  /** Tests / smoke: a fake folder dialog has nothing to do with this; `home` for `~/…` paths. */
  home?: string;
}

export class GraphService {
  private sources: GraphSource[];
  private worker: Worker | null = null;
  private engine: EngineStatus | null = null;
  private started = false;
  private saver: boolean;
  private req = 0;
  private waiting = new Map<number, (s: GraphSnapshot) => void>();

  constructor(private opts: GraphServiceOptions) {
    this.sources = readSources(this.file);
    this.saver = opts.saver;
  }

  private get file() {
    return path.join(this.opts.dir, 'sources.json');
  }

  /** The first call starts the index (when a source is enabled). */
  status(): GraphStatus {
    this.start();
    return this.current();
  }

  add(abs: string): GraphStatus {
    if (!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw new SourceError('notFolder');
    this.save(addSource(this.sources, abs, this.opts.home));
    return this.status();
  }

  remove(id: string): GraphStatus {
    if (!this.sources.some((s) => s.id === id)) throw new SourceError('unknown');
    this.save(this.sources.filter((s) => s.id !== id));
    return this.status();
  }

  setEnabled(id: string, enabled: boolean): GraphStatus {
    if (!this.sources.some((s) => s.id === id)) throw new SourceError('unknown');
    this.save(this.sources.map((s) => (s.id === id ? { ...s, enabled } : s)));
    return this.status();
  }

  indexNow(id: string): GraphStatus {
    this.start();
    this.post({ type: 'indexNow', id });
    return this.current();
  }

  snapshot(): Promise<GraphSnapshot> {
    this.start();
    const w = this.worker;
    if (!w) return Promise.resolve(EMPTY);
    const req = ++this.req;
    return new Promise((resolve) => {
      this.waiting.set(req, resolve);
      w.postMessage({ type: 'snapshot', req } satisfies ToWorker);
    });
  }

  setSaver(saver: boolean): void {
    this.saver = saver;
    this.post({ type: 'saver', saver });
  }

  close(): void {
    this.stopWorker();
  }

  // ---- internals ----

  private current(): GraphStatus {
    return mergeStatus(this.sources, this.engine);
  }

  private save(next: GraphSource[]): void {
    writeSources(this.file, next);
    this.sources = next;
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
      sources: enabled.map((s) => ({ id: s.id, root: untildify(s.path, this.opts.home) })),
      projects: this.opts.projects(),
    });
  }

  private startWorker(): void {
    const workerData: WorkerInit = { indexFile: path.join(this.opts.dir, 'index.json'), saver: this.saver };
    const w = new Worker(this.opts.workerFile, { workerData });
    this.worker = w;
    w.on('message', (m: FromWorker) => {
      if (m.type === 'status') {
        this.engine = m.status;
        this.opts.onStatus(this.current());
      } else {
        this.waiting.get(m.req)?.(m.snapshot);
        this.waiting.delete(m.req);
      }
    });
    w.on('error', (e) => console.error('[graph] worker failed:', e));
    w.on('exit', () => {
      if (this.worker !== w) return;
      this.worker = null;
      this.engine = null;
      for (const resolve of this.waiting.values()) resolve(EMPTY);
      this.waiting.clear();
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
  }

  private post(m: ToWorker): void {
    this.worker?.postMessage(m);
  }
}
