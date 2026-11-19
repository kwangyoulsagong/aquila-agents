import { useEffect, useState } from 'react';
import { api, type Config } from '@/shared/api';

/** Name of another project that already uses folder `path` (asked from main, which knows the home dir). */
export function useDuplicateFolder(config: Config, path: string, selfId?: string): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!path) {
      setId(null);
      return;
    }
    api
      .projectForPath(path)
      .then((found) => live && setId(found))
      .catch(() => live && setId(null));
    return () => {
      live = false;
    };
  }, [path]);
  if (!id || id === selfId) return null;
  return config.projects.find((p) => p.id === id)?.name ?? null;
}
