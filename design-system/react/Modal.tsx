import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Button } from './Button';

interface Props {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** Accessible name of the × button in the head. */
  closeLabel: string;
  /** Left column (`ModalSearch` + `ModalList`); without it the detail takes the whole body. */
  aside?: ReactNode;
  /** Hint line under the body (keys). */
  footer?: ReactNode;
  /** Right column: the detail of the selected item. */
  children: ReactNode;
}

/**
 * `.c-modal` — large modal on the native <dialog> (focus trap, Esc and a backdrop click close it): a head with a
 * title and ×, a searchable list on the left, the detail on the right. Shell of the guide, release notes and trends.
 * Opening focuses the element marked `data-autofocus` (`ModalSearch`), else the dialog's first control.
 */
export function Modal({ open, title, onClose, closeLabel, aside, footer, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="c-modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="c-modal__head">
        <h2 id={titleId} className="c-modal__title">
          {title}
        </h2>
        <Button variant="ghost" icon onClick={onClose} aria-label={closeLabel} title={closeLabel}>
          ×
        </Button>
      </div>
      <div className="c-modal__body">
        {aside && <div className="c-modal__aside">{aside}</div>}
        <div className="c-modal__main">{children}</div>
      </div>
      {footer && <div className="c-modal__foot">{footer}</div>}
    </dialog>
  );
}

/** `.c-modal__search` — the list's search field (focused when the modal opens). */
export function ModalSearch(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input className="c-modal__search" spellCheck={false} autoComplete="off" data-autofocus="" {...props} />
  );
}

/** `.c-modal__list` — the listbox in the left column. */
export function ModalList({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div id={id} className="c-modal__list" role="listbox" aria-label={label}>
      {children}
    </div>
  );
}

/** `.c-modal__empty` — "no results" in place of the list's rows. */
export function ModalEmpty({ children }: { children: ReactNode }) {
  return <div className="c-modal__empty">{children}</div>;
}

interface ItemProps {
  id: string;
  selected: boolean;
  label: string;
  /** Shown at the end (a `Kbd`). */
  trailing?: ReactNode;
  onSelect: () => void;
}

/** `.c-modal__item[aria-selected]` — one option. Scrolls itself into view when selected; keeps focus in the search. */
export function ModalItem({ id, selected, label, trailing, onSelect }: ItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div
      ref={ref}
      id={id}
      className="c-modal__item"
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
    >
      <span className="c-modal__item-label">{label}</span>
      {trailing}
    </div>
  );
}

/** `.c-modal__heading`, `.c-modal__text`, `.c-modal__keys` — the detail's title, 1–2 lines and its shortcuts. */
export function ModalDetail({
  heading,
  text,
  keys,
}: {
  heading: ReactNode;
  text?: ReactNode;
  keys?: ReactNode;
}) {
  return (
    <>
      <h3 className="c-modal__heading">{heading}</h3>
      {text && <p className="c-modal__text">{text}</p>}
      {keys && <div className="c-modal__keys">{keys}</div>}
    </>
  );
}
