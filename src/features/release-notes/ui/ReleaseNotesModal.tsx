import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import {
  Button,
  Media,
  Modal,
  ModalActions,
  ModalDetail,
  ModalEmpty,
  ModalGroup,
  ModalItem,
  ModalList,
  ModalSearch,
} from '@design-system/react';
import type { Language } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { usePowerSaver } from '@/shared/lib/usePowerSaver';
import type { ReleaseHeadline, ReleaseNotes } from '../model/notes';

export interface NotesMedia {
  src: string;
  kind: 'image' | 'video';
  poster?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Versions to show, newest first. */
  notes: readonly ReleaseNotes[];
  language: Language;
  /** Media of a guide item (the page passes the guide's captured media). */
  mediaFor: (id: string, lang: Language) => NotesMedia | undefined;
  /** "How to use": open the guide at this item. */
  onHowTo: (guideId: string) => void;
}

interface Row {
  id: string;
  version: string;
  headline: ReleaseHeadline;
}

/**
 * What's new (T27): the guide's list + detail modal. Headlines grouped by version (skipped versions together, newest
 * first); the selected one shows its media, 1–2 lines and "How to use" → that guide item. ↑↓ pick, Esc closes.
 */
export default function ReleaseNotesModal({ open, onClose, notes, language, mediaFor, onHowTo }: Props) {
  const t = useT();
  const saver = usePowerSaver();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedId(null);
    }
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .map((n) => ({
        notes: n,
        rows: n.headlines
          .map((headline, i): Row => ({ id: `${n.version}-${i}`, version: n.version, headline }))
          .filter(
            (r) =>
              !q ||
              r.headline.title[language].toLowerCase().includes(q) ||
              r.headline.body[language].toLowerCase().includes(q),
          ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [notes, query, language]);
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0];
  const media = selected && mediaFor(selected.headline.media ?? selected.headline.guideId, language);
  const optionId = (id: string) => `${baseId}-${id}`;
  const title =
    notes.length === 1 ? t('notes.titleVersion', { version: notes[0].version }) : t('notes.title');

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || !rows.length) return; // Korean IME: arrows belong to the composition.
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if (!down && !up) return;
    e.preventDefault();
    const i = selected ? rows.indexOf(selected) : -1;
    const n = rows.length;
    setSelectedId(rows[(i + (down ? 1 : n - 1)) % n].id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={t('action.close')}
      footer={
        <>
          <span>{t('palette.move')}</span>
          <span>{t('palette.close')}</span>
        </>
      }
      aside={
        <>
          <ModalSearch
            value={query}
            placeholder={t('guide.search')}
            aria-label={t('guide.search')}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={selected && optionId(selected.id)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <ModalList id={listId} label={t('notes.list')}>
            {rows.length === 0 && (
              <ModalEmpty>{notes.length ? t('guide.empty') : t('notes.empty')}</ModalEmpty>
            )}
            {groups.map((g) => (
              <ModalGroup
                key={g.notes.version}
                label={t('notes.version', { version: g.notes.version, date: g.notes.date })}
              >
                {g.rows.map((r) => (
                  <ModalItem
                    key={r.id}
                    id={optionId(r.id)}
                    selected={r === selected}
                    label={r.headline.title[language]}
                    onSelect={() => setSelectedId(r.id)}
                  />
                ))}
              </ModalGroup>
            ))}
          </ModalList>
        </>
      }
    >
      {selected && (
        <>
          <Media
            src={media?.src}
            kind={media?.kind}
            poster={media?.poster}
            alt={selected.headline.title[language]}
            still={saver}
            placeholder={<span>{selected.headline.title[language]}</span>}
          />
          <ModalDetail heading={selected.headline.title[language]} text={selected.headline.body[language]} />
          <ModalActions>
            <Button variant="primary" onClick={() => onHowTo(selected.headline.guideId)}>
              {t('notes.howTo')}
            </Button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
}
