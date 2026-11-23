// Knowledge graph (T65): the worker thread that owns the index, so parsing and graph building never run on the
// main process. Started by `index.ts` on the first graph call; talks in `ToWorker` / `FromWorker` messages.
import { parentPort, workerData } from 'node:worker_threads';
import type { GraphSnapshot } from '../../src/shared/api/types';
import type { CodeProject } from './code';
import { GraphEngine, type EngineSource, type EngineStatus } from './engine';

export type ToWorker =
  | { type: 'sources'; sources: EngineSource[]; projects: CodeProject[] }
  | { type: 'saver'; saver: boolean }
  | { type: 'indexNow'; id: string }
  | { type: 'snapshot'; req: number }
  | { type: 'stop' };

export type FromWorker =
  { type: 'status'; status: EngineStatus } | { type: 'snapshot'; req: number; snapshot: GraphSnapshot };

export interface WorkerInit {
  indexFile: string;
  saver: boolean;
}

if (parentPort) {
  const port = parentPort;
  const init = workerData as WorkerInit;
  const post = (m: FromWorker) => port.postMessage(m);
  const engine = new GraphEngine({
    indexFile: init.indexFile,
    saver: init.saver,
    onStatus: (status) => post({ type: 'status', status }),
  });
  // Source changes one at a time, in order (indexing itself runs on in the engine).
  let queue = Promise.resolve();
  port.on('message', (m: ToWorker) => {
    if (m.type === 'saver') return engine.setSaver(m.saver);
    if (m.type === 'stop') {
      engine.close();
      return process.exit(0);
    }
    if (m.type === 'snapshot') return post({ type: 'snapshot', req: m.req, snapshot: engine.snapshot() });
    if (m.type === 'indexNow') return engine.indexNow(m.id);
    queue = queue.then(() => engine.setSources(m.sources, m.projects)).catch(() => undefined);
  });
}
