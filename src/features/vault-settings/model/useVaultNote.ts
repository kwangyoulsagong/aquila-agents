import { useEffect, useState } from 'react';
import { api, type VaultNoteInfo } from '@/shared/api';

/** The index changes often while indexing: ask again at most this often. */
const GAP_MS = 1000;

/**
 * What the editor shows for a note from its source's settings (companion tabs, properties, actions). Asked again
 * when the settings change and when the index moves (a companion added); nothing runs while no note is open.
 */
export function useVaultNote(path: string | null): VaultNoteInfo | null {
  const [info, setInfo] = useState<VaultNoteInfo | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!path) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let version = -1;
    const load = () => {
      timer = null;
      void api.vaultNoteInfo(path).then((i) => alive && setInfo(i));
    };
    const later = () => {
      if (!timer) timer = setTimeout(load, GAP_MS);
    };
    load();
    const offVault = api.onVaultChanged(load);
    const offGraph = api.onGraphStatus((s) => {
      if (s.version === version) return;
      const first = version < 0;
      version = s.version;
      if (!first) later();
    });
    return () => {
      alive = false;
      offVault();
      offGraph();
      if (timer) clearTimeout(timer);
    };
  }, [path]);
  return info;
}
