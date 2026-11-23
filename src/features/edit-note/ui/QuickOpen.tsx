import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Palette, PaletteEmpty, PaletteItem, PaletteList } from '@design-system/react';
import { api, type GraphSnapshot } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { fuzzyRank } from '@/shared/lib/fuzzy';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
}

interface Item {
  id: string;
  label: string;
  path: string;
  /** `source/rel/path.md`, matched more weakly than the title. */
  place: string;
}

/** ⌘O: every note of the enabled sources by title (or path); Enter opens it in the editor. Reads the index on open. */
export default function QuickOpen({ open, onClose, onPick }: Props) {
  const t = useT();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [snap, setSnap] = useState<GraphSnapshot | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    let alive = true;
    void api.graphSnapshot().then((s) => alive && setSnap(s));
    return () => {
      alive = false;
    };
  }, [open]);

  const items = useMemo<Item[]>(
    () =>
      (snap?.nodes ?? [])
        .filter((n) => n.kind === 'note' && n.path)
        .map((n) => ({
          id: n.id,
          label: n.label,
          path: n.path!,
          place: n.id.replace(/^note:/, '').replace(':', '/'),
        }))
        // Most recently changed first when nothing is typed.
        .sort((a, b) => {
          const ma = snap!.nodes.find((x) => x.id === a.id)?.mtime ?? 0;
          const mb = snap!.nodes.find((x) => x.id === b.id)?.mtime ?? 0;
          return mb - ma;
        }),
    [snap],
  );
  const results = useMemo(
    () => fuzzyRank(items, query, (i) => i.label, (i) => i.place).slice(0, 200),
    [items, query],
  );
  const selected = Math.min(index, results.length - 1);

  const pick = (i: Item) => {
    onClose();
    requestAnimationFrame(() => onPick(i.path));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // Korean IME: Enter/arrows belong to the composition.
    const n = results.length;
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if ((down || up) && n) {
      e.preventDefault();
      setIndex((selected + (down ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter' && n) {
      e.preventDefault();
      pick(results[selected]!.item);
    }
  };
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  return (
    <Palette
      open={open}
      onClose={onClose}
      label={t('note.quickOpen')}
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      placeholder={t('note.quickOpenPlaceholder')}
      onKeyDown={onKeyDown}
      listId={listId}
      activeId={results.length ? optionId(selected) : undefined}
      footer={
        <>
          <span>{t('palette.move')}</span>
          <span>{t('palette.run')}</span>
          <span>{t('palette.close')}</span>
        </>
      }
    >
      {results.length === 0 ? (
        <PaletteEmpty>{snap && !items.length ? t('note.quickOpenEmpty') : t('note.noMatch')}</PaletteEmpty>
      ) : (
        <PaletteList id={listId}>
          {results.map(({ item, indices }, i) => (
            <PaletteItem
              key={item.id}
              id={optionId(i)}
              selected={i === selected}
              label={item.label}
              marks={indices}
              hint={item.place}
              onSelect={() => pick(item)}
              onHover={() => setIndex(i)}
            />
          ))}
        </PaletteList>
      )}
    </Palette>
  );
}
