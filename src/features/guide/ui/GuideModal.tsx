import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import {
  Kbd,
  Media,
  Modal,
  ModalDetail,
  ModalEmpty,
  ModalItem,
  ModalList,
  ModalSearch,
  ShortcutSheet,
} from '@design-system/react';
import type { Language } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { usePowerSaver } from '@/shared/lib/usePowerSaver';
import { guideMedia } from '../model/media';
import { GUIDE_ITEMS, SHORTCUTS_ITEM } from '../model/registry';
import { guideEntries, searchGuide } from '../model/search';
import { buildSheet } from '../model/sheet';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Media are captured per language. */
  language: Language;
  /** Item selected on open (release notes' "How to use"); default the first. */
  initialId?: string;
}

/**
 * ? / ⌘/: every feature in a searchable list; the selected one shows its screenshot or loop, 1–2 lines and its
 * shortcuts. The last item is the full shortcut sheet. ↑↓ pick, Esc closes.
 */
export default function GuideModal({ open, onClose, language, initialId }: Props) {
  const t = useT();
  const saver = usePowerSaver();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(GUIDE_ITEMS[0].id);

  // Fresh start every time it opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedId((GUIDE_ITEMS.find((i) => i.id === initialId) ?? GUIDE_ITEMS[0]).id);
    }
  }, [open, initialId]);

  const entries = useMemo(() => guideEntries(GUIDE_ITEMS, t), [t]);
  const results = useMemo(() => searchGuide(entries, query, t), [entries, query, t]);
  const sheet = useMemo(() => buildSheet(t), [t]);
  // The selection follows the results: the first match when the selected item was filtered out.
  const selected = results.find((e) => e.item.id === selectedId) ?? results[0];
  const media = selected && guideMedia(selected.item.id, language);
  const optionId = (id: string) => `${baseId}-${id}`;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || !results.length) return; // Korean IME: arrows belong to the composition.
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if (!down && !up) return;
    e.preventDefault();
    const i = selected ? results.indexOf(selected) : -1;
    const n = results.length;
    setSelectedId(results[(i + (down ? 1 : n - 1)) % n].item.id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('guide.title')}
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
            aria-activedescendant={selected && optionId(selected.item.id)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <ModalList id={listId} label={t('guide.list')}>
            {results.length === 0 && <ModalEmpty>{t('guide.empty')}</ModalEmpty>}
            {results.map((e) => (
              <ModalItem
                key={e.item.id}
                id={optionId(e.item.id)}
                selected={e === selected}
                label={e.title}
                trailing={e.keys[0] && <Kbd>{e.keys[0]}</Kbd>}
                onSelect={() => setSelectedId(e.item.id)}
              />
            ))}
          </ModalList>
        </>
      }
    >
      {selected?.item.id === SHORTCUTS_ITEM && (
        <>
          <ModalDetail heading={selected.title} text={selected.body} />
          <ShortcutSheet groups={sheet} />
        </>
      )}
      {selected && selected.item.id !== SHORTCUTS_ITEM && (
        <>
          <Media
            src={media?.src}
            kind={media?.kind}
            poster={media?.poster}
            alt={selected.title}
            still={saver}
            placeholder={
              <>
                <span>{selected.title}</span>
                {selected.keys.length > 0 && <Kbd>{selected.keys.join(' ')}</Kbd>}
              </>
            }
          />
          <ModalDetail
            heading={selected.title}
            text={selected.body}
            keys={selected.keys.length > 0 && selected.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
          />
        </>
      )}
    </Modal>
  );
}
