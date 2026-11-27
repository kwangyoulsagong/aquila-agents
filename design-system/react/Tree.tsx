import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, Ref, UIEvent } from 'react';

/** `.c-explorer` — the note explorer column (T83): a head row, a filter field, then the tree. */
export function Explorer({
  label,
  head,
  filter,
  note,
  children,
}: {
  label: string;
  head: ReactNode;
  filter?: ReactNode;
  /** A line under the filter (an error, "nothing matches"). */
  note?: { text: string; warn?: boolean } | null;
  children: ReactNode;
}) {
  return (
    <section className="c-explorer" aria-label={label}>
      <div className="c-explorer__head">{head}</div>
      {filter && <div className="c-explorer__filter">{filter}</div>}
      {note && (
        <div className="c-explorer__note" role="status" data-tone={note.warn ? 'warn' : undefined}>
          {note.text}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * `.c-tree` — a scrolling, focusable tree whose rows are placed absolutely (`TreeRow` `top`), so only the rows in
 * view need to be rendered. `height` is the whole list's height.
 */
export function Tree({
  label,
  height,
  scrollRef,
  onScroll,
  onKeyDown,
  children,
}: {
  label: string;
  height: number;
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      className="c-tree"
      role="tree"
      aria-label={label}
      aria-multiselectable
      tabIndex={0}
      ref={scrollRef}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      <div className="c-tree__spacer" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

/** `.c-tree__section` — a small title row ("Pinned", "Recent"). */
export function TreeSection({ top, children }: { top: number; children: ReactNode }) {
  return (
    <div className="c-tree__section" style={{ position: 'absolute', top, left: 0, right: 0 }}>
      {children}
    </div>
  );
}

export type TreeDotTone = 'done' | 'active' | 'other' | 'changed';

export interface TreeRowProps {
  top: number;
  level: number;
  kind: 'folder' | 'file';
  /** Shown name; `matches` are indices to highlight (filter). */
  name: string;
  matches?: readonly number[];
  /** Folders: open or closed. */
  open?: boolean;
  selected?: boolean;
  /** The note open in the editor. */
  current?: boolean;
  /** The keyboard cursor. */
  cursor?: boolean;
  /** Something is being dragged over this folder. */
  drop?: boolean;
  dragging?: boolean;
  count?: number;
  dot?: { tone: TreeDotTone; label: string } | null;
  title?: string;
  /** Hover buttons. */
  actions?: ReactNode;
  /** Replaces the name (renaming in place). */
  editor?: ReactNode;
  /** `data-rel`: what the row is (drag and drop looks rows up by it). */
  rel: string;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
}

function highlight(name: string, matches: readonly number[] | undefined): ReactNode {
  if (!matches?.length) return name;
  const set = new Set(matches);
  const out: ReactNode[] = [];
  let run = '';
  let on = false;
  const flush = (k: number) => {
    if (run) out.push(on ? <mark key={k}>{run}</mark> : run);
    run = '';
  };
  for (let i = 0; i < name.length; i++) {
    const m = set.has(i);
    if (m !== on) {
      flush(i);
      on = m;
    }
    run += name[i];
  }
  flush(name.length);
  return out;
}

/** `.c-tree__row` — a folder or a note. */
export function TreeRow(p: TreeRowProps) {
  return (
    <div
      className="c-tree__row"
      role="treeitem"
      aria-level={p.level + 1}
      aria-selected={!!p.selected}
      aria-expanded={p.kind === 'folder' ? !!p.open : undefined}
      data-kind={p.kind}
      data-rel={p.rel}
      data-current={p.current || undefined}
      data-cursor={p.cursor || undefined}
      data-drop={p.drop || undefined}
      data-dragging={p.dragging || undefined}
      title={p.title}
      style={{ top: p.top, '--level': p.level } as CSSProperties}
      onClick={p.onClick}
      onContextMenu={p.onContextMenu}
      onPointerDown={p.onPointerDown}
    >
      {p.kind === 'folder' ? (
        <span className="c-tree__twisty" aria-hidden>
          ›
        </span>
      ) : (
        <span className="c-tree__icon" aria-hidden />
      )}
      {p.editor ?? <span className="c-tree__name">{highlight(p.name, p.matches)}</span>}
      {p.dot && (
        <i className="c-tree__dot" data-tone={p.dot.tone} title={p.dot.label} aria-label={p.dot.label} />
      )}
      {!p.editor && p.actions && <span className="c-tree__actions">{p.actions}</span>}
      {p.count !== undefined && !p.editor && <span className="c-tree__count">{p.count}</span>}
    </div>
  );
}

/** `.c-tree__action` — a small hover button on a row (new note, new folder, more). */
export function TreeAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="c-tree__action"
      title={label}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** `.c-tree__input` — a name typed in place (new note / folder, rename). Enter submits, Esc cancels. */
export function TreeInput({
  value,
  label,
  invalid,
  onChange,
  onSubmit,
  onCancel,
  selectUntil,
}: {
  value: string;
  label: string;
  invalid?: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Selects the name up to here when it mounts (the part before `.md` or a suggested ID's number). */
  selectUntil?: number;
}) {
  return (
    <input
      className="c-tree__input"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      autoFocus
      spellCheck={false}
      ref={(el) => {
        if (el && !el.dataset.ready) {
          el.dataset.ready = '1';
          el.setSelectionRange(0, selectUntil ?? el.value.length);
          // A click that opened the field may still move focus (row / tree handlers, a folder's children loading):
          // take it back once the frame settles, so the first key typed lands in the name.
          requestAnimationFrame(() => {
            if (el.isConnected && document.activeElement !== el) {
              el.focus();
              el.setSelectionRange(0, selectUntil ?? el.value.length);
            }
          });
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Korean IME: Enter that ends a composition isn't a submit.
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
    />
  );
}

/** `.c-tree__ghost` — the label following the pointer while dragging. */
export function TreeGhost({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="c-tree__ghost" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}
