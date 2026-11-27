import { useCallback, useRef } from 'react';
import type { Extension } from '@codemirror/state';
import { onGraphSnapshot, peekGraphSnapshot } from '@/entities/note';
import type { Translate } from '@/shared/i18n';
import { idIndex } from './ids';

/**
 * The note editor's requirement-ID extension, as a stable loader: CodeMirror stays in the editor's lazy chunk (the
 * page only holds this function). Reads the snapshot the editor already holds — no fetch of its own. `t` comes
 * from the caller: the workspace page provides the language context, so `useT()` there would read the default (ko).
 */
export function useNoteIds(onOpen: (path: string) => void, t: Translate): () => Promise<Extension> {
  const live = useRef({ onOpen, t });
  live.current = { onOpen, t };
  const loaded = useRef<Promise<Extension> | null>(null);
  return useCallback(() => {
    loaded.current ??= import('./extension').then((m) =>
      m.noteIds({
        index: () => {
          const s = peekGraphSnapshot();
          return s ? idIndex(s.nodes, s.edges) : null;
        },
        subscribe: (cb) => onGraphSnapshot(() => cb()),
        onOpen: (p) => live.current.onOpen(p),
        t: () => live.current.t,
      }),
    );
    return loaded.current;
  }, []);
}
