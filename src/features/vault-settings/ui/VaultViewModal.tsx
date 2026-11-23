import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Board, BoardCard, BoardColumn, DataTable, EmptyState, Modal, ModalNote } from '@design-system/react';
import { api, type VaultCard, type VaultViewData } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { cellText, DRAG_TYPE, neighbor } from '../model/config';

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
  else {
    const columns = view.kind === 'table' ? (view.columns ?? []) : [];
    body = (
      <DataTable
        label={view.name}
        columns={[t('vault.view.title'), ...columns, ...(view.kind === 'list' ? [t('vault.view.file')] : [])]}
        groups={data.groups
          .filter((g) => g.cards.length)
          .map((g) => ({
            key: g.key,
            title: label(g.key),
            rows: g.cards.map((c) => ({
              key: c.path,
              title: c.title,
              cells: view.kind === 'list' ? [c.rel] : columns.map((k) => cellText(c.props[k])),
              onOpen: () => open(c.path),
            })),
          }))}
      />
    );
  }

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
      {problem && <ModalNote warn>{problem}</ModalNote>}
      {body}
    </Modal>
  );
}
