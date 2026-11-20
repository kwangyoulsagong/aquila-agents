import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type HistoryEntry,
  type HistoryList,
  type HistoryRef,
  type HistoryTranscript,
} from '@/shared/api';
import { refKey } from './history';

/** Full-text search runs in main; wait for typing to pause. */
const SEARCH_DELAY_MS = 200;

/**
 * The panel's data: the list (scanned when the panel opens — main caches parsed files), full-text hits for the
 * query, and the selected session's transcript.
 */
export function useHistory(open: boolean, query: string, selected: HistoryRef | null, remote = false) {
  const [list, setList] = useState<HistoryList | null>(null);
  const [loading, setLoading] = useState(false);
  /** SSH hosts are being scanned (T36): after the local list, which never waits for them. */
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Map<string, string>>(new Map());
  const [transcript, setTranscript] = useState<{ key: string; data: HistoryTranscript } | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    api
      .historyList()
      .then((l) => {
        if (!live) return;
        setList(l);
        setError(null);
        if (!remote) return;
        setRemoteLoading(true);
        return api
          .historyRefreshRemote()
          .then((r) => live && setList(r))
          .finally(() => live && setRemoteLoading(false));
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      setRemoteLoading(false);
    };
  }, [open, remote]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !q || loading) {
      setMatches(new Map());
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .historySearch(q)
        .then((hits) => live && setMatches(new Map(hits.map((h) => [refKey(h), h.snippet]))))
        .catch(() => live && setMatches(new Map()));
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, query, loading]);

  const selectedKey = selected && refKey(selected);
  const latest = useRef(selectedKey);
  latest.current = selectedKey;
  useEffect(() => {
    if (!open || !selected || !selectedKey) return;
    api
      .historyTranscript(selected)
      .then((data) => latest.current === selectedKey && setTranscript({ key: selectedKey, data }))
      .catch(
        () =>
          latest.current === selectedKey &&
          setTranscript({ key: selectedKey, data: { messages: [], truncated: false } }),
      );
    // `selected` is identified by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedKey]);

  /** Main saved a name / favorite: patch the entry in place. */
  const update = useCallback((entry: HistoryEntry) => {
    setList((l) => l && { ...l, entries: l.entries.map((e) => (refKey(e) === refKey(entry) ? entry : e)) });
  }, []);

  return {
    list,
    loading,
    remoteLoading,
    error,
    matches,
    transcript: transcript && transcript.key === selectedKey ? transcript.data : null,
    update,
  };
}
