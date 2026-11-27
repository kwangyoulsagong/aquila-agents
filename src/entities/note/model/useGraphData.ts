import { useEffect, useState } from 'react';
import { api, type GraphSnapshot, type GraphStatus } from '@/shared/api';
import { usePowerSaver } from '@/shared/lib/usePowerSaver';

/**
 * The index moves on every save of a note (the editor saves while you type) and on every turn of every session.
 * Each refetch is the whole snapshot (thousands of nodes and edges) and every open view recomputes from it on the
 * renderer's one thread — the same one the terminals draw on. So: wait until it has been quiet this long, but never
 * longer than MAX_WAIT_MS while it keeps moving (in power saver, T76: longer).
 */
const QUIET_MS = 1500;
const MAX_WAIT_MS = 8000;
const SAVER_QUIET_MS = 4000;
const SAVER_MAX_WAIT_MS = 20_000;

type Data = { status: GraphStatus | null; snapshot: GraphSnapshot | null };

/**
 * One subscription for every user (the graph panel and the note editor used to fetch a snapshot each). Starts with
 * the first user, stops with the last.
 */
const store = (() => {
  let data: Data = { status: null, snapshot: null };
  const listeners = new Set<(d: Data) => void>();
  let saver = false;
  let stop: (() => void) | null = null;
  let statusJson = '';
  /** Fetch now what is waiting for the index to settle: a view just opened and should show the latest. */
  let kick = () => {};

  const set = (patch: Partial<Data>) => {
    data = { ...data, ...patch };
    for (const l of listeners) l(data);
  };

  const start = () => {
    let alive = true;
    let fetched = -1;
    let wanted = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstWanted = 0;
    let inFlight = false;
    /** A view opened while a fetch was running: the newer version right after it, not after the quiet wait. */
    let urgent = false;
    const fetchNow = () => {
      timer = null;
      if (inFlight || wanted === fetched) return;
      // T76: the app is behind another one: nothing to draw, so nothing to fetch — once when it's back.
      if (document.hidden) return;
      inFlight = true;
      firstWanted = 0;
      const v = wanted;
      void api
        .graphSnapshot()
        .then((snap) => {
          if (!alive) return;
          fetched = v;
          // Often nothing a view shows moved (a save that kept the links): keep the old object, so nothing redraws.
          const prev = data.snapshot;
          if (prev && sameSnapshot(prev, snap)) return;
          set({ snapshot: snap });
        })
        .finally(() => {
          inFlight = false;
          if (!alive || wanted === fetched) urgent = false;
          else if (urgent) {
            urgent = false;
            fetchNow();
          } else schedule();
        });
    };
    const schedule = () => {
      if (inFlight) return;
      if (fetched < 0) {
        if (!timer) timer = setTimeout(fetchNow, 0);
        return;
      }
      const now = Date.now();
      if (!firstWanted) firstWanted = now;
      const quiet = saver ? SAVER_QUIET_MS : QUIET_MS;
      const max = saver ? SAVER_MAX_WAIT_MS : MAX_WAIT_MS;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchNow, Math.max(0, Math.min(quiet, firstWanted + max - now)));
    };
    const onStatus = (s: GraphStatus) => {
      if (!alive) return;
      // The same status again (a rescan that found nothing): no re-render.
      const json = JSON.stringify(s);
      if (json !== statusJson) {
        statusJson = json;
        set({ status: s });
      }
      wanted = s.version;
      if (wanted !== fetched) schedule();
    };
    const onVisible = () => {
      if (!document.hidden && alive && wanted !== fetched && !timer && !inFlight)
        timer = setTimeout(fetchNow, 0);
    };
    document.addEventListener('visibilitychange', onVisible);
    kick = () => {
      if (!alive || fetched < 0 || wanted === fetched) return;
      if (inFlight) {
        urgent = true;
        return;
      }
      if (timer) clearTimeout(timer);
      fetchNow();
    };
    void api.graphStatus().then(onStatus);
    const off = api.onGraphStatus(onStatus);
    return () => {
      alive = false;
      off();
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearTimeout(timer);
    };
  };

  return {
    get: () => data,
    /** The snapshot an open view holds, or null (nobody holds one: nothing is running). */
    peek: () => (listeners.size ? data.snapshot : null),
    setSaver: (on: boolean) => {
      saver = on;
    },
    subscribe(l: (d: Data) => void): () => void {
      listeners.add(l);
      if (!stop) stop = start();
      else kick();
      return () => {
        listeners.delete(l);
        if (listeners.size || !stop) return;
        stop();
        stop = null;
        // The next open starts fresh (the index may have moved a lot meanwhile).
        data = { status: null, snapshot: null };
        statusJson = '';
      };
    },
  };
})();

/** Same nodes and edges (the version aside). */
export function sameSnapshot(a: GraphSnapshot, b: GraphSnapshot): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  return (
    JSON.stringify(a.nodes) === JSON.stringify(b.nodes) &&
    JSON.stringify(a.edges) === JSON.stringify(b.edges) &&
    JSON.stringify(a.idGroups) === JSON.stringify(b.idGroups)
  );
}

/**
 * Sources status and the index snapshot while a view that needs them is open. Asking for the status is what starts
 * the index (nothing runs before the panel or the sources dialog opens). No polling: refetches only when the index
 * version moves, once it has settled.
 */
export function useGraphData(): Data {
  const [data, setData] = useState<Data>(store.get);
  const saver = usePowerSaver();
  store.setSaver(saver);
  useEffect(() => store.subscribe(setData), []);
  return data;
}

/** The snapshot the graph or the editor holds right now, or null when neither is open (quick open reuses it). */
export const peekGraphSnapshot = (): GraphSnapshot | null => store.peek();

/**
 * T79: called with each new snapshot while subscribed (the editor's ID marks follow the index outside React). Holds
 * the subscription like a view does; the returned function lets go.
 */
export const onGraphSnapshot = (cb: (snap: GraphSnapshot | null) => void): (() => void) => {
  let last = store.get().snapshot;
  return store.subscribe((d) => {
    if (d.snapshot === last) return;
    last = d.snapshot;
    cb(d.snapshot);
  });
};
