import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type ApplyRecord,
  type ApplyStartResult,
  type ApplyStep,
  type Language,
  type RepoSkeleton,
} from '@/shared/api';
import { draftsOf, keptSteps, type StepDraft } from './drafts';

/** Which trend, against which project. */
export interface ApplyTarget {
  itemId: string;
  projectId: string;
  language: Language;
}

/**
 * scanning → analysing → proposal ⇄ editing → starting. `ready`: the skeleton is there but no analysis (stopped, or
 * failed). Nothing runs until the user opens it: one scan, one `claude -p` they can stop.
 */
export type ApplyPhase = 'scanning' | 'ready' | 'analysing' | 'proposal' | 'editing' | 'starting';

export interface ApplyTrend {
  phase: ApplyPhase;
  skeleton: RepoSkeleton | null;
  record: ApplyRecord | null;
  error: string | null;
  drafts: StepDraft[];
  setDraft: (id: string, patch: Partial<Omit<StepDraft, 'step'>>) => void;
  request: string;
  setRequest: (text: string) => void;
  analyse: () => void;
  cancel: () => void;
  edit: () => void;
  back: () => void;
  /** Cancel: keeps the decision as dropped. */
  drop: () => void;
  /** Apply (as is, or the ticked steps): the new tab and the text to paste, or null when it failed. */
  start: () => Promise<ApplyStartResult | null>;
}

// Electron prefixes rejected handler errors: keep the message only.
const message = (err: unknown) =>
  String(err instanceof Error ? err.message : err).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export function useApplyTrend(target: ApplyTarget | null): ApplyTrend {
  const [phase, setPhase] = useState<ApplyPhase>('scanning');
  const [skeleton, setSkeleton] = useState<RepoSkeleton | null>(null);
  const [record, setRecord] = useState<ApplyRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<StepDraft[]>([]);
  const [request, setRequest] = useState('');
  // One id per (trend, project): Analyse again keeps it, so ~/.aquila/applies has one file per decision.
  const id = useRef(newId());
  const live = useRef(0);

  const run = useCallback(
    (t: ApplyTarget, extra: { request?: string; steps?: ApplyStep[] } = {}) => {
      const token = ++live.current;
      setPhase('analysing');
      setError(null);
      api
        .applyAnalyse({
          id: id.current,
          projectId: t.projectId,
          itemId: t.itemId,
          language: t.language,
          ...extra,
        })
        .then((r) => {
          if (token !== live.current) return;
          setRecord(r);
          setSkeleton(r.skeleton);
          setDrafts(draftsOf(r.proposal.steps));
          setPhase('proposal');
        })
        .catch((e: unknown) => {
          if (token !== live.current) return;
          const m = message(e);
          setError(m === 'cancelled' ? null : m);
          setPhase((p) => (p === 'analysing' ? (record ? 'proposal' : 'ready') : p));
        });
    },
    [record],
  );

  // A new trend or project: scan, then analyse once.
  const key = target ? `${target.itemId}\n${target.projectId}` : '';
  useEffect(() => {
    if (!target) return;
    const token = ++live.current;
    id.current = newId();
    setRecord(null);
    setSkeleton(null);
    setDrafts([]);
    setRequest('');
    setError(null);
    setPhase('scanning');
    api
      .applyScan(target.projectId)
      .then((s) => {
        if (token !== live.current) return;
        setSkeleton(s);
        run(target);
      })
      .catch((e: unknown) => {
        if (token !== live.current) return;
        setError(message(e));
        setPhase('ready');
      });
    const runId = id.current;
    return () => {
      // Closed or switched while Claude was still thinking: stop it, and ignore whatever still answers.
      api.applyCancel(runId);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter, not a DOM node: reading it late is the point
      live.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the target
  }, [key]);

  const setDraft = useCallback(
    (sid: string, patch: Partial<Omit<StepDraft, 'step'>>) =>
      setDrafts((list) => list.map((d) => (d.step.id === sid ? { ...d, ...patch } : d))),
    [],
  );

  return {
    phase,
    skeleton,
    record,
    error,
    drafts,
    setDraft,
    request,
    setRequest,
    analyse: () => {
      if (!target) return;
      run(target, record ? { request, steps: keptSteps(drafts) } : {});
    },
    cancel: () => api.applyCancel(id.current),
    edit: () => setPhase('editing'),
    back: () => setPhase(record ? 'proposal' : 'ready'),
    drop: () => {
      if (record) void api.applyDrop(record.id).catch(() => {});
    },
    start: async () => {
      if (!record) return null;
      const steps = keptSteps(drafts);
      if (!steps.length) return null;
      setPhase('starting');
      setError(null);
      try {
        return await api.applyStart(record.id, steps);
      } catch (e) {
        setError(message(e));
        setPhase('proposal');
        return null;
      }
    },
  };
}
