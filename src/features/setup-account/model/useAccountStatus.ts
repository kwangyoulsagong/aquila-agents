import { useCallback, useEffect, useState } from 'react';
import { api, type AccountStatus } from '@/shared/api';
import { usePollInterval } from '@/shared/lib/usePowerSaver';

const POLL_MS = 5000;

/**
 * Per-account setup status. Re-reads on window focus (back from the browser login) and, while some account is
 * still logged out, every few seconds while the window is focused — so the "Set up" button goes away after /login.
 */
export function useAccountStatus() {
  const pollMs = usePollInterval(POLL_MS);
  const [status, setStatus] = useState<Record<string, AccountStatus> | null>(null);
  const refresh = useCallback(() => {
    api.accountsStatus().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const pending = status !== null && Object.values(status).some((s) => !s.loggedIn);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => document.hasFocus() && refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pending, refresh, pollMs]);

  return { status, refresh };
}
