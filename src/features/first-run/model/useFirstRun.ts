import { useCallback, useEffect, useState } from 'react';
import { api, type FirstRunReport, type ToolCheck, type ToolId } from '@/shared/api';

/**
 * First-run checklist state: checks once at launch and opens itself while it was never closed;
 * `reopen` (palette) checks again and opens it. Closing marks it finished (optional things default to Skip).
 */
export function useFirstRun() {
  const [report, setReport] = useState<FirstRunReport | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .firstRun()
      .then((r) => {
        if (!alive) return;
        setReport(r);
        if (r.pending) setOpen(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /** Read the shell's PATH again and re-run every check (after the user installed something). */
  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setReport(await api.firstRun(true));
    } finally {
      setChecking(false);
    }
  }, []);

  const reopen = useCallback(() => {
    setOpen(true);
    void recheck();
  }, [recheck]);

  const close = useCallback(() => {
    setOpen(false);
    void api.finishFirstRun();
  }, []);

  const replaceTool = (check: ToolCheck) =>
    setReport((r) => r && { ...r, tools: r.tools.map((t) => (t.tool === check.tool ? check : t)) });

  const pickBinary = useCallback(async (tool: ToolId) => {
    const check = await api.pickBinary(tool);
    if (check) replaceTool(check);
  }, []);

  const resetBinary = useCallback(async (tool: ToolId) => {
    replaceTool(await api.resetBinary(tool));
  }, []);

  return { report, open, checking, recheck, reopen, close, pickBinary, resetBinary };
}

export type FirstRun = ReturnType<typeof useFirstRun>;
