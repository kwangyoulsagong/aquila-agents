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

  const start = useCallback(async (host: RemoteHost) => {
    const mine = ++run.current;
    setChecking(true);
    setCheck(null);
    try {
      const result = await api.checkRemote(host);
      if (run.current === mine) setCheck(result);
    } catch (e) {
      if (run.current === mine) setCheck({ reachable: false, error: (e as Error).message, tools: [] });
    } finally {
      if (run.current === mine) setChecking(false);
    }
  }, []);

  return { hosts, check, checking, start };
}
