import { useCallback, useEffect, useState } from 'react';
import { api, type GraphStatus } from '@/shared/api';

export type SourceProblem = 'overlap' | 'notFolder' | 'other';

/** IPC errors arrive as "Error invoking remote method …: Error: overlap". */
export function problemOf(e: unknown): SourceProblem {
  const m = e instanceof Error ? e.message : String(e);
  return /\boverlap\b/.test(m) ? 'overlap' : /\bnotFolder\b/.test(m) ? 'notFolder' : 'other';
}

/** Sources and their index state. Opening this is what starts the index (nothing runs before). */
export function useSources() {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [problem, setProblem] = useState<SourceProblem | null>(null);

  useEffect(() => {
    let alive = true;
    void api.graphStatus().then((s) => alive && setStatus(s));
    const off = api.onGraphStatus(setStatus);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const run = useCallback(async (p: Promise<GraphStatus>) => {
    try {
      setStatus(await p);
      setProblem(null);
    } catch (e) {
      setProblem(problemOf(e));
    }
  }, []);

  const add = useCallback(async () => {
    const folder = await api.pickFolder();
    if (folder) await run(api.graphAddSource(folder));
  }, [run]);

  return {
    status,
    problem,
    add,
    remove: (id: string) => run(api.graphRemoveSource(id)),
    setEnabled: (id: string, enabled: boolean) => run(api.graphSetSourceEnabled(id, enabled)),
    indexNow: (id: string) => run(api.graphIndexNow(id)),
  };
}
