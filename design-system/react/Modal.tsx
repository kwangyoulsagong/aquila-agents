import { useEffect, useId, useRef, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
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
  /** `.c-modal--wide`: larger, with a wider list (session history). */
  wide?: boolean;
  /** Right column: the detail of the selected item. */
  children: ReactNode;
}

/**
 * `.c-modal` — large modal on the native <dialog> (focus trap, Esc and a backdrop click close it): a head with a
 * title and ×, a searchable list on the left, the detail on the right. Shell of the guide, release notes and trends.
 * Opening focuses the element marked `data-autofocus` (`ModalSearch`), else the dialog's first control.
 */
export function Modal({ open, title, onClose, closeLabel, aside, footer, wide, children }: Props) {
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
      className={wide ? 'c-modal c-modal--wide' : 'c-modal'}
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
  /** Caption before `trailing` (a time). */
  meta?: ReactNode;
  /** Shown at the end (a `Kbd`). */
  trailing?: ReactNode;
  onSelect: () => void;
}

/** `.c-modal__item[aria-selected]` — one option. Scrolls itself into view when selected; keeps focus in the search. */
export function ModalItem({ id, selected, label, meta, trailing, onSelect }: ItemProps) {
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
      <span className="c-modal__item-label" title={label}>
        {label}
      </span>
      {meta !== undefined && <span className="c-modal__item-meta">{meta}</span>}
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

/** `.c-modal__group-label` — a labelled group of options in the list (a folder in session history). */
export function ModalGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="c-modal__group-label" aria-hidden title={hint ?? label}>
        {label}
      </div>
      {children}
    </div>
  );
}

/** `.c-modal__tools` — a row of controls under the search (filters). */
export function ModalTools({ children }: { children: ReactNode }) {
  return <div className="c-modal__tools">{children}</div>;
}

/** `.c-modal__actions` — buttons in the detail; with `onSubmit` it's a form (an inline rename: Enter saves). */
export function ModalActions({
  onSubmit,
  children,
}: {
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  return onSubmit ? (
    <form className="c-modal__actions" onSubmit={onSubmit}>
      {children}
    </form>
  ) : (
    <div className="c-modal__actions">{children}</div>
  );
}

/** `.c-modal__note` — a caption line in the detail; `warn` = something will be lost. */
export function ModalNote({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return <p className={warn ? 'c-modal__note c-modal__note--warn' : 'c-modal__note'}>{children}</p>;
}

/** `.c-modal__bullets` — a short bulleted list in the detail (a release's "Added" lines). */
export function ModalBullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="c-modal__bullets">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
