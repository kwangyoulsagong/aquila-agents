import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface GridColumn {
  id: string;
  label: string;
  /** Current sort of this column (`aria-sort`). */
  sort?: 'ascending' | 'descending';
  /** Clicking the header sorts by it. */
  onSort?: () => void;
}

/** Rows drawn above and below the visible ones, so a fast scroll doesn't show blank rows. */
const OVERSCAN = 8;

/**
 * `.c-ntable` — a virtualized grid (the table view, T78): a sticky header of sortable columns, then only the rows
 * on screen out of `count` (thousands stay smooth). Every row is one `--size-row` high; `renderRow(i)` draws row
 * `i` as a `GridRow` or a `GridGroup`. The first column is the title column (wider).
 */
export function DataGrid({
  label,
  columns,
  count,
  renderRow,
  rowKey,
  empty,
}: {
  label: string;
  columns: GridColumn[];
  count: number;
  renderRow: (i: number) => ReactNode;
  rowKey: (i: number) => string;
  /** Shown instead of rows when there are none. */
  empty?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState(32);
  const [view, setView] = useState({ top: 0, height: 0 });
  const frame = useRef(0);

  // The row height is the token's; the viewport follows the element's size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = parseFloat(getComputedStyle(el).getPropertyValue('--size-row'));
    if (h > 0) setRow(h);
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = ref.current;
      if (el) setView({ top: el.scrollTop, height: el.clientHeight });
    });
  }, []);

  const first = Math.max(0, Math.floor(view.top / row) - OVERSCAN);
  const last = Math.min(count, Math.ceil((view.top + view.height) / row) + OVERSCAN);
  const rows: ReactNode[] = [];
  for (let i = first; i < last; i++)
    rows.push(
      <div key={rowKey(i)} className="c-ntable__slot" role="presentation" aria-rowindex={i + 2}>
        {renderRow(i)}
      </div>,
    );

  return (
    <div
      ref={ref}
      className="c-ntable"
      role="table"
      aria-label={label}
      aria-rowcount={count + 1}
      onScroll={onScroll}
      style={{ '--ntable-cols': Math.max(0, columns.length - 1) } as CSSProperties}
    >
      <div className="c-ntable__head" role="row" aria-rowindex={1}>
        {columns.map((c) => (
          <div key={c.id} className="c-ntable__th" role="columnheader" aria-sort={c.sort ?? 'none'}>
            {c.onSort ? (
              <button type="button" className="c-ntable__sort" onClick={c.onSort}>
                {c.label}
                <span className="c-ntable__arrow" aria-hidden>
                  {c.sort === 'ascending' ? '↑' : c.sort === 'descending' ? '↓' : ''}
                </span>
              </button>
            ) : (
              c.label
            )}
          </div>
        ))}
      </div>
      {count === 0 && empty ? (
        <div className="c-ntable__empty">{empty}</div>
      ) : (
        <div className="c-ntable__body" style={{ height: count * row }}>
          <div className="c-ntable__window" style={{ transform: `translateY(${first * row}px)` }}>
            {rows}
          </div>
        </div>
      )}
    </div>
  );
}

/** `.c-ntable__row` — one row of cells. */
export function GridRow({ children }: { children: ReactNode }) {
  return (
    <div className="c-ntable__row" role="row">
      {children}
    </div>
  );
}

/** `.c-ntable__group` — a group's heading across the row (title and count). */
export function GridGroup({ title, count }: { title: string; count: number }) {
  return (
    <div className="c-ntable__group" role="row">
      <span role="rowheader">
        {title} <span className="c-ntable__count">{count}</span>
      </span>
    </div>
  );
}

/** `.c-ntable__open` — the title cell: a button that opens the row's note. */
export function GridOpen({ label, title, onOpen }: { label: string; title?: string; onOpen: () => void }) {
  return (
    <div className="c-ntable__cell" role="cell">
      <button type="button" className="c-ntable__open" title={title ?? label} onClick={onOpen}>
        {label}
      </button>
    </div>
  );
}

/**
 * `.c-ntable__cell` — a value. `onEdit` makes it editable: double-click or Enter starts editing, and `editor`
 * (an input) replaces the text while `editing`.
 */
export function GridCell({
  text,
  muted,
  onEdit,
  editing,
  editor,
  editLabel,
}: {
  text: string;
  muted?: boolean;
  onEdit?: () => void;
  editing?: boolean;
  editor?: ReactNode;
  editLabel?: string;
}) {
  if (editing && editor)
    return (
      <div className="c-ntable__cell" role="cell" data-editing>
        {editor}
      </div>
    );
  return (
    <div
      className="c-ntable__cell"
      role="cell"
      data-muted={muted || undefined}
      data-editable={onEdit ? true : undefined}
      tabIndex={onEdit ? 0 : undefined}
      title={onEdit && editLabel ? `${text}${text ? '\n' : ''}${editLabel}` : text}
      onDoubleClick={onEdit}
      onKeyDown={
        onEdit
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === 'F2') {
                e.preventDefault();
                onEdit();
              }
            }
          : undefined
      }
    >
      {text}
    </div>
  );
}

/** `.c-ntable__input` — the input a cell edits in (fills the cell). */
export function GridInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className="c-ntable__input" spellCheck={false} autoComplete="off" {...props} />;
}

/** `.c-ntable__bar` — the row of controls above the grid (search, filters, columns). */
export function GridBar({ children }: { children: ReactNode }) {
  return <div className="c-ntable__bar">{children}</div>;
}

/** `.c-ntable__chips` — toggle chips (status counts, which columns show). */
export function GridChips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="c-ntable__chips" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** `.c-ntable__chip` — one toggle chip with an optional count. */
export function GridChip({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count?: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="c-ntable__chip" aria-pressed={pressed} onClick={onClick}>
      {label}
      {count !== undefined && <span className="c-ntable__count">{count}</span>}
    </button>
  );
}

/** `.c-ntable__frame` — fills the modal's main column: bar and chips on top, the grid taking the rest. */
export function GridFrame({ children }: { children: ReactNode }) {
  return <div className="c-ntable__frame">{children}</div>;
}
