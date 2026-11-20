import { useRef } from 'react';
import { InlineInput } from '@design-system/react';
import { api, type Session } from '@/shared/api';
import { sessionTitle, useT } from '@/shared/i18n';
import { renameValue } from '../model/rename';

interface Props {
  session: Session;
  /** Showing the input instead of the title. */
  editing: boolean;
  onEdit: () => void;
  /** The edit ended (saved or cancelled). */
  onDone: () => void;
  /** Class of the title text in its host (the tab). */
  className?: string;
}

/**
 * A session's title (T43) that edits in place: double-click (or ⌘K "Rename session") → Enter saves, Esc cancels,
 * an empty field goes back to the automatic title. Main saves it with the tab and answers on `onTitle`.
 */
export default function SessionTitle({ session, editing, onEdit, onDone, className }: Props) {
  const t = useT();
  const shown = sessionTitle(t, session);
  if (!editing)
    return (
      <span
        className={className}
        title={`${shown}\n${t('session.renameHint')}`}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        {shown}
      </span>
    );
  return <TitleInput session={session} shown={shown} onDone={onDone} />;
}

function TitleInput({ session, shown, onDone }: { session: Session; shown: string; onDone: () => void }) {
  const t = useT();
  // Enter / Esc unmount the input, which may blur it too: only the first ending counts.
  const ended = useRef(false);
  const finish = (text: string | null) => {
    if (ended.current) return;
    ended.current = true;
    const value = text === null ? null : renameValue(text, { title: session.title, shown });
    if (value !== null) api.renameSession(session.id, value);
    onDone();
  };
  return (
    <InlineInput
      autoFocus
      defaultValue={shown}
      aria-label={t('action.renameSession')}
      maxLength={80}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return; // Korean IME: Enter confirms the syllable first
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
