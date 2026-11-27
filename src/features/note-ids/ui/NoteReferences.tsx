import { useMemo } from 'react';
import { EditorItem, EditorSection, Meter, NoteIdNote, NoteIdText } from '@design-system/react';
import type { GraphNode } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { useGraphData } from '@/entities/note';
import { checklist, idIndex, referencedIn } from '../model/ids';

export interface NoteReferencesProps {
  /** The note open in the editor. */
  path: string;
  /** Its text right now (the editor's, refreshed after edits). */
  text: string;
  onOpenNote: (path: string) => void;
}

/** Rows shown per list before "+N". */
const MAX_ROWS = 12;

/**
 * "Referenced in" (T79), in the editor's side column: for the IDs this note defines, the notes that mention them,
 * the sessions that worked on them and the files those changed; and the note's own checklist progress. Nothing
 * when the note defines no ID and has no checklist.
 */
export default function NoteReferences({ path, text, onOpenNote }: NoteReferencesProps) {
  const t = useT();
  const { snapshot } = useGraphData();
  const refs = useMemo(() => {
    if (!snapshot) return null;
    const node = snapshot.nodes.find((n) => n.kind === 'note' && n.path === path);
    return node ? referencedIn(idIndex(snapshot.nodes, snapshot.edges), node.id) : null;
  }, [snapshot, path]);
  const tasks = useMemo(() => checklist(text), [text]);
  if (!refs?.ids.length && !tasks.total) return null;

  const more = (list: readonly GraphNode[]) =>
    list.length > MAX_ROWS ? <NoteIdNote>+{list.length - MAX_ROWS}</NoteIdNote> : null;
  const title = refs?.ids.length ? `${t('noteId.section')} · ${refs.ids.join(', ')}` : t('noteId.section');

  return (
    <EditorSection title={title}>
      {tasks.total > 0 && (
        <NoteIdNote>
          <Meter
            label={t('noteId.checklist')}
            value={`${tasks.done}/${tasks.total}`}
            fraction={tasks.done / tasks.total}
          />
        </NoteIdNote>
      )}
      {refs && refs.duplicates.length > 0 && (
        <>
          <NoteIdNote tone="warn">{t('noteId.duplicateOf')}</NoteIdNote>
          {refs.duplicates.map((d) => (
            <EditorItem
              key={d.id}
              label={d.label}
              title={d.path}
              onClick={() => d.path && onOpenNote(d.path)}
            />
          ))}
        </>
      )}
      {refs && refs.ids.length > 0 && (
        <NoteIdNote>
          {t('noteId.refs', {
            notes: String(refs.notes.length),
            sessions: String(refs.sessions.length),
            files: String(refs.files.length),
          })}
        </NoteIdNote>
      )}
      {refs?.notes.slice(0, MAX_ROWS).map((n) => (
        <EditorItem
          key={n.id}
          label={n.label}
          detail={t('noteId.notes')}
          title={n.path}
          onClick={() => n.path && onOpenNote(n.path)}
        />
      ))}
      {refs && more(refs.notes)}
      {refs?.sessions.slice(0, MAX_ROWS).map((s) => (
        <NoteIdText key={s.id} label={s.label} detail={t('noteId.sessions')} />
      ))}
      {refs && more(refs.sessions)}
      {refs?.files.slice(0, MAX_ROWS).map((f) => (
        <NoteIdText
          key={f.id}
          label={f.label}
          detail={t('noteId.files')}
          title={f.path ?? f.label}
        />
      ))}
      {refs && more(refs.files)}
    </EditorSection>
  );
}
