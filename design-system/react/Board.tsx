import type { DragEvent, KeyboardEvent, ReactNode } from 'react';

/** `.c-board` — columns of cards side by side, scrolling sideways (a source's board view, T69). */
export function Board({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="c-board" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * `.c-board__column` — a titled column; `dropping` highlights it while a card is dragged over. The drag handlers are
 * the caller's (what a drop means is up to it).
 */
export function BoardColumn({
  title,
  count,
  dropping,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  title: string;
  count: number;
  dropping?: boolean;
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  children?: ReactNode;
}) {
  return (
    <section
      className="c-board__column"
      aria-label={title}
      data-drop={dropping || undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="c-board__head">
        {title}
        <span className="c-board__count">{count}</span>
      </div>
      <div className="c-board__cards">{children}</div>
    </section>
  );
}

/** `.c-board__card` — a card (a button: opens it); draggable, `moving` while dragged. */
export function BoardCard({
  title,
  meta,
  hint,
  moving,
  onOpen,
  onDragStart,
  onDragEnd,
  onKeyDown,
}: {
  title: string;
  meta?: string;
  hint?: string;
  moving?: boolean;
  onOpen: () => void;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <button
      type="button"
      className="c-board__card"
      draggable={!!onDragStart}
      data-moving={moving || undefined}
      title={hint}
      onClick={onOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
    >
      {title}
      {meta && <span className="c-board__card-meta">{meta}</span>}
    </button>
  );
}
