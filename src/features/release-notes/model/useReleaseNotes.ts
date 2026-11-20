import { useCallback, useEffect, useState } from 'react';
import { api } from '@/shared/api';
import { ALL_NOTES } from './bundle';
import { unseenNotes, type ReleaseNotes } from './notes';

/**
 * Release notes state: after an update the modal opens once with every version since the last one shown (skipped
 * versions together); "What's new" in the ? menu opens all bundled versions. A fresh install shows nothing.
 */
export function useReleaseNotes(all: readonly ReleaseNotes[] = ALL_NOTES) {
  const [shown, setShown] = useState<readonly ReleaseNotes[] | null>(null);

  useEffect(() => {
    let live = true;
    api
      .releaseNotesState()
      .then((s) => {
        if (!live || s.fresh || s.lastSeen === s.current) return;
        const unseen = unseenNotes(all, s.lastSeen, s.current);
        if (unseen.length) setShown(unseen);
        void api.markReleaseNotesSeen(s.current);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [all]);

  const showAll = useCallback(() => setShown(all), [all]);
  const close = useCallback(() => setShown(null), []);

  return { open: shown !== null, notes: shown ?? [], showAll, close };
}

export type ReleaseNotesModel = ReturnType<typeof useReleaseNotes>;
