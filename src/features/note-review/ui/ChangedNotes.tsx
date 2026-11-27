import { useEffect, useState } from 'react';
import { EditorItem, EditorSection } from '@design-system/react';
import { api, type NoteSeenChange } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { ago, onSeenChanged } from '../model/ago';

const noteName = (p: string) => (p.split(/[/\\]/).pop() ?? p).replace(/\.md$/i, '');

/**
 * T80: in the editor's side column, notes changed outside since the user last looked (mtimes against the seen
 * copies, no diff). Refreshed when the open note changes or one is marked as seen; hidden when there are none.
 */
export function ChangedNotes({ path, onOpenNote }: { path: string; onOpenNote: (path: string) => void }) {
  const t = useT();
  const [list, setList] = useState<NoteSeenChange[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void api.noteSeenChanged().then((l) => {
        if (alive) setList(l);
      });
    load();
    const off = onSeenChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [path]);

  const others = list.filter((c) => c.path !== path);
  if (!others.length) return null;
  return (
    <EditorSection title={t('noteReview.changedList')}>
      {others.map((c) => (
        <EditorItem
          key={c.path}
          label={noteName(c.path)}
          detail={`${c.by === 'claude' ? t('noteReview.claude') : t('noteReview.outside')} · ${ago(t, c.changedAt)}`}
          title={c.path}
          onClick={() => onOpenNote(c.path)}
        />
      ))}
    </EditorSection>
  );
}
