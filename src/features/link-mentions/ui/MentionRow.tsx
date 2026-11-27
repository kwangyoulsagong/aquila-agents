import { useState } from 'react';
import { Button, EditorItem, NoteIdNote, NoteIdRow } from '@design-system/react';
import { useT } from '@/shared/i18n';
import { linkMention } from '../model/linkMention';
import { linkName } from '../model/splice';

export interface MentionRowProps {
  /** The note that mentions this one without a link. */
  mention: { id: string; label: string; path: string };
  /** This note's title (what the other note's text has) and path (its file name goes in the link). */
  title: string;
  path: string;
  onOpen: () => void;
}

type Phase = 'idle' | 'confirm' | 'busy' | 'none' | 'failed';

/**
 * An unlinked mention with "Link" (T79): asks once inline (it writes another file), then turns the first plain
 * mention there into `[[name]]`. The index picks the change up and the row moves to backlinks.
 */
export default function MentionRow({ mention, title, path, onOpen }: MentionRowProps) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const name = linkName(path);
  const run = async () => {
    setPhase('busy');
    const r = await linkMention(mention.path, title, name);
    setPhase(r === 'linked' ? 'idle' : r);
  };
  return (
    <>
      <NoteIdRow
        actions={
          phase === 'idle' || phase === 'none' || phase === 'failed' ? (
            <Button
              variant="ghost"
              title={t('mentions.linkHint', { name: mention.label })}
              onClick={() => setPhase('confirm')}
            >
              {t('mentions.link')}
            </Button>
          ) : null
        }
      >
        <EditorItem label={mention.label} title={mention.path} onClick={onOpen} />
      </NoteIdRow>
      {(phase === 'confirm' || phase === 'busy') && (
        <NoteIdNote
          actions={
            <>
              <Button variant="primary" disabled={phase === 'busy'} onClick={() => void run()}>
                {t('mentions.write')}
              </Button>
              <Button variant="ghost" disabled={phase === 'busy'} onClick={() => setPhase('idle')}>
                {t('mentions.cancel')}
              </Button>
            </>
          }
        >
          {t('mentions.confirm', { name: mention.label })}
        </NoteIdNote>
      )}
      {phase === 'none' && <NoteIdNote>{t('mentions.none')}</NoteIdNote>}
      {phase === 'failed' && <NoteIdNote tone="warn">{t('mentions.failed')}</NoteIdNote>}
    </>
  );
}
