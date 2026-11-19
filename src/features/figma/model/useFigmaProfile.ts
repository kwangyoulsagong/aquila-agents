import { useCallback, useEffect, useState } from 'react';
import { api, type FigmaProfile } from '@/shared/api';

/** Cached Figma profile of one account, and "Connect" (the hidden whoami check in main). */
export function useFigmaProfile(account: string) {
  const [profiles, setProfiles] = useState<Record<string, FigmaProfile>>({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .figmaProfiles()
      .then((p) => live && setProfiles(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setChecking(true);
    try {
      const p = await api.figmaConnect(account);
      setProfiles((all) => ({ ...all, [account]: p }));
    } catch (e) {
      setProfiles((all) => ({
        ...all,
        [account]: { state: 'error', checkedAt: Date.now(), plans: [], error: (e as Error).message },
      }));
    } finally {
      setChecking(false);
    }
  }, [account]);

  return { profile: profiles[account], checking, connect };
}
