import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Palette, PaletteEmpty, PaletteItem, PaletteList } from '@design-system/react';
import { api, type GraphSnapshot } from '@/shared/api';
import { peekGraphSnapshot } from '@/entities/note';
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
  /** Enter pressed before the list arrived: open the first match as soon as it does (no dead key). */
  const pendingEnter = useRef(false);

  useEffect(() => {
    // Closed: let go of the snapshot (every node of the graph); it's read again on the next open.
    pendingEnter.current = false;
    if (!open) return setSnap(null);
    setQuery('');
    setIndex(0);
    // The graph or the editor holds one already: at once. Else the notes alone — the full snapshot waits for the
    // session history scan (seconds on the first open).
    const held = peekGraphSnapshot();
    if (held) return setSnap(held);
    let alive = true;
    void api.graphSnapshot({ notesOnly: true }).then((s) => alive && setSnap(s));
    return () => {
      alive = false;
    };
  }, [open]);

  const items = useMemo<Item[]>(
    () =>
      (snap?.nodes ?? [])
        .filter((n) => n.kind === 'note' && n.path)
        // Most recently changed first when nothing is typed (sorted on the node's own mtime: O(n log n)).
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
        .map((n) => ({
          id: n.id,
          label: n.label,
          path: n.path!,
          place: n.id.replace(/^note:/, '').replace(':', '/'),
        })),
    [snap],
  );
  const results = useMemo(
    () =>
      fuzzyRank(
        items,
        query,
        (i) => i.label,
        (i) => i.place,
      ).slice(0, 200),
    [items, query],
  );
  const selected = Math.min(index, results.length - 1);
  useEffect(() => {
    if (!pendingEnter.current || !snap) return;
    pendingEnter.current = false;
    if (results.length) pick(results[0]!.item);
    // `pick` closes over the latest props; only the list arriving matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

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
    } else if (e.key === 'Enter' && !snap) {
      e.preventDefault();
      pendingEnter.current = true;
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
