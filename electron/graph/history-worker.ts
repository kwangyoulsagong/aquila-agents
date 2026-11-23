/**
 * T70: the lite history scan (titles, edited files, `@mentions`) in a short-lived child process. Reading every
 * transcript (hundreds of MB) leaves the reading process hundreds of MB bigger for good — the allocator keeps it,
 * even for a worker thread — so the scan runs in its own process that exits when done. The parse cache (small
 * without message text) comes back and goes to the next scan, so only changed transcripts are read again.
 *
 * This file is also the child's entry: Electron's `utilityProcess` gives it a `process.parentPort`.
 */
import type { Config, HistoryEntry } from '../../src/shared/api/types';
import { HistoryIndex, type CacheItem, type SessionWork } from '../history';

export interface WorkScanResult {
  entries: HistoryEntry[];
  work: SessionWork[];
}

export interface WorkScanIn {
  config: Config;
  cache: [string, CacheItem][];
}

export type WorkScanOut = (WorkScanResult & { cache: [string, CacheItem][] }) | { error: string };

/** One scan, as the child runs it (also used directly in tests). */
export async function scanWork(input: WorkScanIn): Promise<WorkScanOut> {
  try {
    const index = new HistoryIndex(undefined, undefined, { lite: true });
    index.loadCache(input.cache);
    const list = await index.list(input.config);
    return { entries: list.entries, work: index.work(), cache: index.cacheEntries() };
  } catch (e) {
    return { error: String(e) };
  }
}

interface ParentPort {
  once(event: 'message', cb: (e: { data: WorkScanIn }) => void): void;
  postMessage(m: WorkScanOut): void;
}
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (parentPort)
  parentPort.once('message', (e) => {
    void scanWork(e.data).then((out) => {
      parentPort.postMessage(out);
      setTimeout(() => process.exit(0), 50);
    });
  });

/** Runs scans one at a time (each in a fresh process via `run`), keeping the parse cache between them. */
export class WorkScanner {
  private cache: [string, CacheItem][] = [];
  private running: Promise<WorkScanResult> | null = null;

  constructor(private run: (input: WorkScanIn) => Promise<WorkScanOut>) {}

  scan(config: Config): Promise<WorkScanResult> {
    this.running ??= this.run({ config, cache: this.cache })
      .then((m) => {
        if ('error' in m) throw new Error(m.error);
        this.cache = m.cache;
        return { entries: m.entries, work: m.work };
      })
      .finally(() => (this.running = null));
    return this.running;
  }
}
