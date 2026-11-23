import { useEffect, useState } from 'react';
import { api, type GraphSnapshot, type GraphStatus } from '@/shared/api';

/** While indexing, the status changes often: fetch the snapshot at most this often. */
const FETCH_GAP_MS = 800;

/**
 * Sources status and the index snapshot while the panel is open. Asking for the status is what starts the index
 * (nothing runs before the panel or the sources dialog opens). No polling: refetches only when the index version
 * moves, coalesced while indexing.
 */
export function useGraphData(): { status: GraphStatus | null; snapshot: GraphSnapshot | null } {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    let fetched = -1;
    let wanted = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const fetchNow = () => {
      timer = null;
      if (inFlight || wanted === fetched) return;
      inFlight = true;
      const v = wanted;
      void api
        .graphSnapshot()
        .then((snap) => {
          if (!alive) return;
          fetched = v;
          setSnapshot(snap);
        })
        .finally(() => {
          inFlight = false;
          if (alive && wanted !== fetched && !timer) timer = setTimeout(fetchNow, FETCH_GAP_MS);
        });
    };
    const onStatus = (s: GraphStatus) => {
      if (!alive) return;
      setStatus(s);
      wanted = s.version;
      if (wanted !== fetched && !timer && !inFlight)
        timer = setTimeout(fetchNow, fetched < 0 ? 0 : FETCH_GAP_MS);
    };
    void api.graphStatus().then(onStatus);
    const off = api.onGraphStatus(onStatus);
    return () => {
      alive = false;
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { status, snapshot };
}
