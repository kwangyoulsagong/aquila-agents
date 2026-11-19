import { useEffect, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Kbd } from './Kbd';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog (the input's placeholder is a good fit). */
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  /** Arrow keys, Enter… (Esc closes the dialog natively). */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** id of the listbox (`PaletteList`) and of the selected option, for the combobox semantics. */
  listId: string;
  activeId?: string;
  /** Rows (`PaletteList` with `PaletteItem`s, or `PaletteEmpty`). */
  children: ReactNode;
  /** Hint line under the list (keys). */
  footer?: ReactNode;
}

/**
 * `.c-palette` — command palette on the native <dialog>: a search field over a list, near the top of the
 * window. Opening focuses the field; Esc and a backdrop click close it.
 */
export function Palette({
  open,
  onClose,
  label,
  query,
  onQueryChange,
  placeholder,
  onKeyDown,
  listId,
  activeId,
  children,
  footer,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      inputRef.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const inputProps: InputHTMLAttributes<HTMLInputElement> = {
    role: 'combobox',
    'aria-expanded': true,
    'aria-controls': listId,
    'aria-activedescendant': activeId,
    'aria-autocomplete': 'list',
  };

  return (
    <dialog
      ref={ref}
      className="c-palette"
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <input
        ref={inputRef}
        className="c-palette__input"
        value={query}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        {...inputProps}
      />
      {children}
      {footer && <div className="c-palette__foot">{footer}</div>}
    </dialog>
  );
}

/** `.c-palette__list` — the listbox. */
export function PaletteList({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="c-palette__list" role="listbox">
      {children}
    </div>
  );
}

/** `.c-palette__empty` — "no results" line in place of the list. */
export function PaletteEmpty({ children }: { children: ReactNode }) {
  return <div className="c-palette__empty">{children}</div>;
}

interface ItemProps {
  id: string;
  selected: boolean;
  label: string;
  /** Indices of `label` to highlight (fuzzy match). */
  marks?: readonly number[];
  leading?: ReactNode;
  /** Dimmed text after the label (project name, path). */
  hint?: ReactNode;
  /** Shortcut shown at the end. */
  kbd?: string;
  onSelect: () => void;
  /** Mouse moved onto the row: make it the selected one. */
  onHover: () => void;
}

/** `.c-palette__item[aria-selected]` — one option. Scrolls itself into view when selected. */
export function PaletteItem({
  id,
  selected,
  label,
  marks,
  leading,
  hint,
  kbd,
  onSelect,
  onHover,
}: ItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div
      ref={ref}
      id={id}
      className="c-palette__item"
      role="option"
      aria-selected={selected}
      onMouseMove={selected ? undefined : onHover}
      // Keep focus in the input.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
    >
      {leading && <span className="c-palette__leading">{leading}</span>}
      <span className="c-palette__label">{highlight(label, marks)}</span>
      {hint && <span className="c-palette__hint">{hint}</span>}
      {kbd && <Kbd>{kbd}</Kbd>}
    </div>
  );
}

function highlight(text: string, marks?: readonly number[]): ReactNode {
  if (!marks?.length) return text;
  const set = new Set(marks);
  const out: ReactNode[] = [];
  let run = '';
  let marked = false;
  const flush = () => {
    if (!run) return;
    out.push(
      marked ? (
        <mark key={out.length} className="c-palette__mark">
          {run}
        </mark>
      ) : (
        run
      ),
    );
    run = '';
  };
  // UTF-16 indices, same as the matcher.
  for (let i = 0; i < text.length; i++) {
    if (set.has(i) !== marked) {
      flush();
      marked = !marked;
    }
    run += text[i];
  }
  flush();
  return out;
}
