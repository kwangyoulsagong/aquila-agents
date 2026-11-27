import { useCallback, useEffect, useState } from 'react';
import { api, type GraphSourceStatus, type NoteTableData, type VaultCard } from '@/shared/api';
import { readLastSource } from './prefs';

/** The index moves often while indexing: ask again at most this often. */
const GAP_MS = 800;

/** Enabled sources, and the one to show first: asked for, the note's, the last shown, else the first. */
export function useSources(initialSource: string | undefined, initialPath: string | undefined) {
  const [sources, setSources] = useState<GraphSourceStatus[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSource ?? null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [status, info] = await Promise.all([
        api.graphStatus(),
        !initialSource && initialPath ? api.vaultNoteInfo(initialPath) : Promise.resolve(null),
      ]);
      if (!alive) return;
      const list = status.sources.filter((s) => s.enabled);
      setSources(list);
      setSelected((cur) => {
        const ok = (id: string | null | undefined): id is string => !!id && list.some((s) => s.id === id);
        const last = readLastSource();
        if (ok(cur)) return cur;
        if (ok(info?.sourceId)) return info.sourceId;
        if (ok(last)) return last;
        return list[0]?.id ?? null;
      });
    })();
    return () => {
      alive = false;
    };
  }, [initialSource, initialPath]);
  return { sources, selected, setSelected };
}

/** A source's notes from the index, loaded again when the index moves or its settings change. */
export function useTableData(sourceId: string | null) {
  const [data, setData] = useState<NoteTableData | null | undefined>(undefined);
  const load = useCallback(() => {
    if (sourceId) void api.noteTable(sourceId).then(setData);
  }, [sourceId]);
  useEffect(() => {
    setData(undefined);
    if (!sourceId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let version = -1;
    load();
    const offVault = api.onVaultChanged((id) => id === sourceId && load());
    const offGraph = api.onGraphStatus((s) => {
      if (s.version === version) return;
      const first = version < 0;
      version = s.version;
      if (!first && !timer)
        timer = setTimeout(() => {
          timer = null;
          load();
        }, GAP_MS);
    });
    return () => {
      offVault();
      offGraph();
      if (timer) clearTimeout(timer);
    };
  }, [sourceId, load]);

  /** A cell edited: shown at once, the next load (after the index re-reads the file) replaces it. */
  const patch = useCallback((path: string, props: VaultCard['props']) => {
    setData((d) => (d ? { ...d, notes: d.notes.map((n) => (n.path === path ? { ...n, props } : n)) } : d));
  }, []);
  return { data, patch, reload: load };
}
