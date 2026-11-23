import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type GraphSourceStatus,
  type VaultPresetId,
  type VaultScope,
  type VaultState,
} from '@/shared/api';
import { formatConfig, parseDraft } from './config';

export type SuggestState = { kind: 'idle' } | { kind: 'running' } | { kind: 'error'; error: string };

/**
 * Settings ▸ Folder settings: the sources, the selected one's settings and a text draft of them. A preset or
 * "Make with Claude" only fills the draft; nothing is written until Save.
 */
export function useVaultSettings(initial?: string) {
  const [sources, setSources] = useState<GraphSourceStatus[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [state, setState] = useState<VaultState | null>(null);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<VaultScope>('personal');
  const [dirty, setDirty] = useState(false);
  const [suggest, setSuggest] = useState<SuggestState>({ kind: 'idle' });
  const [saved, setSaved] = useState<{ problems: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const apply = (list: GraphSourceStatus[]) => {
      if (!alive) return;
      setSources(list);
      setSelected((cur) => (cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? null)));
    };
    void api.graphStatus().then((s) => apply(s.sources));
    const off = api.onGraphStatus((s) => apply(s.sources));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const load = useCallback((id: string) => {
    void api
      .vaultGet(id)
      .then((st) => {
        setState(st);
        setDraft(formatConfig(st.config));
        setScope(st.scope ?? (st.hasShared ? 'shared' : 'personal'));
        setDirty(false);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    setSaved(null);
    setSuggest({ kind: 'idle' });
    if (selected) load(selected);
    else setState(null);
  }, [selected, load]);

  // The shared file changed on disk (or another window saved): reload unless the user is editing.
  useEffect(
    () =>
      api.onVaultChanged((id) => {
        if (id === selected && !dirty) load(id);
      }),
    [selected, dirty, load],
  );

  const edit = useCallback((text: string) => {
    setDraft(text);
    setDirty(true);
    setSaved(null);
  }, []);

  const applyPreset = useCallback(
    async (p: VaultPresetId) => edit(formatConfig(await api.vaultPreset(p))),
    [edit],
  );

  const makeWithClaude = useCallback(
    async (description: string) => {
      if (!selected) return;
      setSuggest({ kind: 'running' });
      const r = await api.vaultSuggest(selected, description);
      if ('error' in r) setSuggest({ kind: 'error', error: r.error });
      else {
        setSuggest({ kind: 'idle' });
        edit(formatConfig(r.config));
      }
    },
    [selected, edit],
  );

  const save = useCallback(async () => {
    if (!selected) return;
    const parsed = parseDraft(draft);
    if ('error' in parsed) return;
    const st = await api.vaultSave(selected, parsed.config, scope);
    setState(st);
    setDraft(formatConfig(st.config));
    setDirty(false);
    setSaved({ problems: st.problems });
  }, [selected, draft, scope]);

  const removePersonal = useCallback(async () => {
    if (!selected) return;
    const st = await api.vaultRemovePersonal(selected);
    setState(st);
    setDraft(formatConfig(st.config));
    setScope(st.scope ?? 'shared');
    setDirty(false);
  }, [selected]);

  const parsed = parseDraft(draft);
  return {
    sources,
    selected,
    select: setSelected,
    state,
    draft,
    parsed,
    edit,
    dirty,
    scope,
    setScope,
    applyPreset,
    makeWithClaude,
    suggest,
    save,
    saved,
    removePersonal,
    error,
  };
}
