import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RemoteCheck, type RemoteHost } from '@/shared/api';

/** SSH host suggestions from ~/.ssh/config, and the "Check host" run (result cleared when the host changes). */
export function useRemoteCheck(alias: string) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [check, setCheck] = useState<RemoteCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    api
      .sshHosts()
      .then(setHosts)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    run.current++;
    setCheck(null);
    setChecking(false);
  }, [alias]);

  /** Runs the check; resolves with its result (also shown), or null when the host changed meanwhile. */
  const start = useCallback(async (host: RemoteHost): Promise<RemoteCheck | null> => {
    const mine = ++run.current;
    setChecking(true);
    setCheck(null);
    let result: RemoteCheck;
    try {
      result = await api.checkRemote(host);
    } catch (e) {
      result = { reachable: false, error: (e as Error).message, tools: [] };
    }
    if (run.current !== mine) return null;
    setCheck(result);
    setChecking(false);
    return result;
  }, []);

  return { hosts, check, checking, start };
}
