import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type BriefInput,
  type BriefModel,
  type BriefPrepared,
  type BriefResult,
  type BriefTargets,
  type RelatedNote,
} from '@/shared/api';
import { termIds, type BriefSeed } from './brief';

export type BriefPhase = 'idle' | 'running' | 'done' | 'error';

const PREPARE_DELAY_MS = 250;

/**
 * The dialog's state. Typing / dropping only prepares (main sanitizes and caps; nothing is sent) and looks up related
 * notes locally; Claude runs only on `run()`, once, cancellable. Nothing is written until `save()`.
 */
export function useWhatIsThis(projectId: string | null, seed: BriefSeed | undefined) {
  const [input, setInput] = useState<BriefInput | null>(seed && 'text' in seed ? seed : null);
  const [seedError, setSeedError] = useState<string | null>(seed && 'error' in seed ? seed.error : null);
  const [prepared, setPrepared] = useState<BriefPrepared | null>(null);
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [model, setModel] = useState<BriefModel>('haiku');
  const [phase, setPhase] = useState<BriefPhase>('idle');
  const [result, setResult] = useState<BriefResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<BriefTargets | null>(null);
  const runId = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .briefTargets(projectId)
      .then((x) => live && setTargets(x))
      .catch(() => live && setTargets({ sources: [], defaultId: null }));
    return () => {
      live = false;
    };
  }, [projectId]);

  // A new input: prepare it (debounced while typing), then related notes from the local index.
  useEffect(() => {
    setResult(null);
    setPhase('idle');
    setError(null);
    if (!input || !input.text.trim()) {
      setPrepared(null);
      setRelated([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .briefPrepare(input, projectId)
        .then((p) => {
          if (!live) return;
          setPrepared(p);
          return api.graphRelated(p.text).then((r) => live && setRelated(r));
        })
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    }, PREPARE_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [input, projectId]);

  const cancel = useCallback(() => {
    if (runId.current) api.briefCancel(runId.current);
    runId.current = null;
    setPhase('idle');
  }, []);

  // Closing the dialog while it runs stops the run.
  useEffect(
    () => () => {
      if (runId.current) api.briefCancel(runId.current);
    },
    [],
  );

  const run = useCallback(async () => {
    if (!input || !prepared || runId.current) return;
    const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    runId.current = id;
    setPhase('running');
    setError(null);
    try {
      const r = await api.briefRun({ id, input, projectId, model });
      if (runId.current !== id) return;
      setResult(r);
      setPhase('done');
      const ids = termIds(r.fields);
      if (ids.length) void api.graphRelated(prepared.text, ids).then(setRelated, () => undefined);
    } catch (e) {
      if (runId.current !== id) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setPhase('error');
    } finally {
      if (runId.current === id) runId.current = null;
    }
  }, [input, prepared, projectId, model]);

  const setSeed = useCallback((s: BriefSeed | null) => {
    if (!s) return;
    if ('error' in s) {
      setSeedError(s.error);
      return;
    }
    setSeedError(null);
    setInput(s);
  }, []);

  return {
    input,
    setText: (text: string) => setInput(text ? { text } : null),
    setSeed,
    clear: () => {
      setSeedError(null);
      setInput(null);
    },
    seedError,
    prepared,
    related,
    model,
    setModel,
    phase,
    result,
    error,
    targets,
    run,
    cancel,
  };
}
