import { useEffect, useState } from 'react';
import { api, type GraphStatus } from '@/shared/api';

/** Index status with rules, proposals and AI state (T68). Opening the dialog starts the index, like Note sources. */
export function useLinkSettings() {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void api.graphStatus().then((s) => alive && setStatus(s));
    const off = api.onGraphStatus(setStatus);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return {
    status,
    setAi: async (id: string, ai: boolean) => setStatus(await api.graphSetSourceAi(id, ai)),
    runNow: (id: string) => api.graphExtractNow(id),
  };
}
