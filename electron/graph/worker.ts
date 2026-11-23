// Knowledge graph (T65): the worker thread that owns the index, so parsing and graph building never run on the
// main process. Started by `index.ts` on the first graph call; talks in `ToWorker` / `FromWorker` messages.
import { parentPort, workerData } from 'node:worker_threads';
import type { GraphDecision, GraphRuleOp, GraphSnapshot, VaultLinkRule } from '../../src/shared/api/types';
import type { CodeProject } from './code';
import { GraphEngine, type EngineSource, type EngineStatus } from './engine';
import { fixtureRun, runClaudeHaiku } from './extract';
import type { VaultNote } from './vault';

/** T68: sources with AI extraction on and how to run Claude (`fixture`: a canned reply, smoke). */
export interface AiConfig {
  sources: string[];
  binary: string;
  configDir?: string;
  fixture?: string;
}

export type ToWorker =
  | { type: 'sources'; sources: EngineSource[]; projects: CodeProject[] }
  | { type: 'saver'; saver: boolean }
  | { type: 'indexNow'; id: string }
  | { type: 'snapshot'; req: number }
  | { type: 'decide'; d: GraphDecision }
  | { type: 'rule'; op: GraphRuleOp }
  | { type: 'ai'; config: AiConfig }
  | { type: 'extractNow'; id: string }
  | { type: 'vaultLinks'; rules: Record<string, VaultLinkRule[]> }
  | { type: 'notes'; req: number; id: string }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'status'; status: EngineStatus }
  | { type: 'snapshot'; req: number; snapshot: GraphSnapshot }
  | { type: 'notes'; req: number; notes: VaultNote[] }
  | { type: 'vaultFile'; id: string };

export interface WorkerInit {
  indexFile: string;
  linksFile: string;
  aiFile: string;
  saver: boolean;
}

if (parentPort) {
  const port = parentPort;
  const init = workerData as WorkerInit;
  const post = (m: FromWorker) => port.postMessage(m);
  const engine = new GraphEngine({
    indexFile: init.indexFile,
    linksFile: init.linksFile,
    aiFile: init.aiFile,
    saver: init.saver,
    onStatus: (status) => post({ type: 'status', status }),
    onVaultFile: (id) => post({ type: 'vaultFile', id }),
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
    if (m.type === 'vaultLinks') return engine.setVaultLinks(m.rules);
    if (m.type === 'notes') return post({ type: 'notes', req: m.req, notes: engine.sourceNotes(m.id) });
    if (m.type === 'decide') return engine.decide(m.d);
    if (m.type === 'rule') return engine.ruleOp(m.op);
    if (m.type === 'extractNow') return void engine.extractNow(m.id);
    if (m.type === 'ai') {
      const c = m.config;
      const run = c.fixture ? fixtureRun(c.fixture) : runClaudeHaiku(c.binary, c.configDir);
      return engine.configureAi(c.sources, c.sources.length ? run : null);
    }
    queue = queue.then(() => engine.setSources(m.sources, m.projects)).catch(() => undefined);
  });
}
