import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  Board,
  BoardCard,
  BoardColumn,
  DataGrid,
  EmptyState,
  GridCell,
  GridFrame,
  GridGroup,
  GridOpen,
  GridRow,
  Modal,
  ModalNote,
  type GridColumn,
} from '@design-system/react';
import { api, type VaultCard, type VaultViewData } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { cellText, DRAG_TYPE, FILE, gridItems, neighbor, nextSort, TITLE, type Sort } from '../model/config';

/** The index moves often while indexing: ask again at most this often. */
const GAP_MS = 800;

function useViewData(sourceId: string, viewId: string) {
  const [data, setData] = useState<VaultViewData | null | undefined>(undefined);
  const load = useCallback(() => void api.vaultView(sourceId, viewId).then(setData), [sourceId, viewId]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let version = -1;
    load();
    const offVault = api.onVaultChanged((id) => id === sourceId && load());
    const offGraph = api.onGraphStatus((s) => {
      if (s.version === version) return;
      const first = version < 0;
      version = s.version;
      if (!first && !timer)
        timer = setTimeout(() => {
          timer = null;
          load();
        }, GAP_MS);
    });
    return () => {
      offVault();
      offGraph();
      if (timer) clearTimeout(timer);
    };
  }, [sourceId, load]);
  return { data, setData, load };
}

/** A card moved before the index catches up (the next load replaces it). */
function moved(data: VaultViewData, card: VaultCard, to: string): VaultViewData {
  return {
    ...data,
    groups: data.groups.map((g) => ({
      ...g,
      cards:
        g.key === to
          ? [card, ...g.cards.filter((c) => c.path !== card.path)]
          : g.cards.filter((c) => c.path !== card.path),
    })),
  };
}

/**
 * A source's view (T69): a board (columns of cards; drag a card or Alt+←/→ to move it — sets the property or moves
 * the file), a table or a list, grouped as the settings say. A card opens its note.
 */
export default function VaultViewModal({
  sourceId,
  viewId,
  onClose,
  onOpenNote,
}: {
  sourceId: string;
  viewId: string;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}) {
  const t = useT();
  const { data, setData, load } = useViewData(sourceId, viewId);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const label = (key: string) => key || t('vault.view.none');
  const open = (path: string) => {
    onClose();
    onOpenNote(path);
  };

  const move = async (card: VaultCard, to: string) => {
    if (!data) return;
    const from = data.groups.find((g) => g.cards.some((c) => c.path === card.path))?.key;
    if (from === to) return;
    setData(moved(data, card, to));
    const r = await api.vaultMove(card.path, viewId, to);
    setProblem(r.ok ? null : t(`vault.view.moveFailed.${r.reason}`));
    if (!r.ok) load();
  };

  const view = data?.view;
  const find = (path: string) => data?.groups.flatMap((g) => g.cards).find((c) => c.path === path);
  let body;
  if (data === undefined) body = null;
  else if (!data || !view) body = <EmptyState title={t('vault.view.gone')} />;
  else if (view.kind === 'board')
    body = (
      <Board label={view.name}>
        {data.groups.map((g) => (
          <BoardColumn
            key={g.key}
            title={label(g.key)}
            count={g.cards.length}
            dropping={over === g.key && !!dragging}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              setOver(g.key);
            }}
            onDragLeave={() => setOver((o) => (o === g.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const card = find(e.dataTransfer.getData(DRAG_TYPE));
              if (card) void move(card, g.key);
            }}
          >
            {g.cards.map((c) => (
              <BoardCard
                key={c.path}
                title={c.title}
                meta={c.rel}
                hint={t('vault.view.cardHint')}
                moving={dragging === c.path}
                onOpen={() => open(c.path)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, c.path);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(c.path);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                  if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                  e.preventDefault();
                  const to = neighbor(data, g.key, e.key === 'ArrowLeft' ? -1 : 1);
                  if (to !== null) void move(c, to);
                }}
              />
            ))}
          </BoardColumn>
        ))}
      </Board>
    );
  else
    body = (
      <GridFrame>
        {problem && <ModalNote warn>{problem}</ModalNote>}
        <ViewGrid data={data} view={view} label={label} onOpen={open} />
      </GridFrame>
    );

  return (
    <Modal
      open
      wide
      title={view?.name ?? t('vault.view.title')}
      subtitle={view ? t(`vault.view.kind.${view.kind}`) : undefined}
      onClose={onClose}
      closeLabel={t('action.close')}
      footer={view?.kind === 'board' ? t('vault.view.boardHint') : undefined}
    >
      {problem && view?.kind === 'board' && <ModalNote warn>{problem}</ModalNote>}
      {body}
    </Modal>
  );
}

/** A table or list view on the shared grid (T78): sortable columns, group headings, virtualized rows. */
function ViewGrid({
  data,
  view,
  label,
  onOpen,
}: {
  data: VaultViewData;
  view: VaultViewData['view'];
  label: (key: string) => string;
  onOpen: (path: string) => void;
}) {
  const t = useT();
  const [sort, setSort] = useState<Sort>(null);
  const keys = view.kind === 'table' ? (view.columns ?? []) : [];
  const ids = [TITLE, ...keys, ...(view.kind === 'list' ? [FILE] : [])];
  const cellOf = useCallback(
    (c: VaultCard, key: string) => (key === TITLE ? c.title : key === FILE ? c.rel : cellText(c.props[key])),
    [],
  );
  const items = useMemo(() => gridItems(data, cellOf, sort), [data, cellOf, sort]);
  const columns: GridColumn[] = ids.map((id) => ({
    id,
    label: id === TITLE ? t('vault.view.title') : id === FILE ? t('vault.view.file') : id,
    sort: sort?.key === id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined,
    onSort: () => setSort((s) => nextSort(s, id)),
  }));
  return (
    <DataGrid
      label={view.name}
      columns={columns}
      count={items.length}
      rowKey={(i) => {
        const it = items[i]!;
        return it.kind === 'group' ? `g:${it.key}` : it.card.path;
      }}
      renderRow={(i) => {
        const it = items[i]!;
        if (it.kind === 'group') return <GridGroup title={label(it.key)} count={it.count} />;
        const c = it.card;
        return (
          <GridRow>
            <GridOpen label={c.title} title={c.rel} onOpen={() => onOpen(c.path)} />
            {ids.slice(1).map((k) => (
              <GridCell key={k} text={cellOf(c, k)} muted={k === FILE} />
            ))}
          </GridRow>
        );
      }}
      empty={t('vault.view.empty')}
    />
  );
}
