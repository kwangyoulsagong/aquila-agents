import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** Footer buttons, right-aligned. */
  actions?: ReactNode;
  /** `.c-dialog--wide` (checklists). */
  wide?: boolean;
  children?: ReactNode;
}

/** `.c-dialog` — modal on the native <dialog> (focus trap, Esc to close, backdrop click closes). */
export function Dialog({ open, title, onClose, actions, wide, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'c-dialog c-dialog--wide' : 'c-dialog'}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <h2 id={titleId} className="c-dialog__title">
        {title}
      </h2>
      <div className="c-dialog__body">{children}</div>
      {actions && <div className="c-dialog__actions">{actions}</div>}
    </dialog>
  );
}

/** `.c-dialog__check` — one status line inside a dialog (leading dot or icon + text). */
export function DialogCheck({ leading, children }: { leading?: ReactNode; children: ReactNode }) {
  return (
    <div className="c-dialog__check">
      {leading}
      {children}
    </div>
  );
}

/** `.c-dialog__code` — selectable monospace block (commands, snippets). */
export function DialogCode({ children }: { children: ReactNode }) {
  return <pre className="c-dialog__code">{children}</pre>;
}

/**
 * `.c-dialog__form` — fields stacked like the body; Enter submits. Give the submit button in `actions`
 * `type="submit"` and `form={id}` (actions sit outside the form).
 */
export function DialogForm({
  id,
  onSubmit,
  children,
}: {
  id: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form id={id} className="c-dialog__form" onSubmit={submit}>
      {children}
    </form>
  );
}
