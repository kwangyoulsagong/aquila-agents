import type { InputHTMLAttributes, ReactNode } from 'react';

/**
 * `.c-props` — a note's properties above its text (T78): a head that folds the list (title, count, its buttons at
 * the end) and the rows under it while open.
 */
export function PropPanel({
  title,
  count,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="c-props" aria-label={title} data-open={open || undefined}>
      <div className="c-props__head">
        <button type="button" className="c-props__toggle" aria-expanded={open} onClick={onToggle}>
          <span className="c-props__chevron" aria-hidden>
            ›
          </span>
          {title}
          {count !== undefined && <span className="c-props__count">{count}</span>}
        </button>
        {actions && <div className="c-props__actions">{actions}</div>}
      </div>
      {open && children && <div className="c-props__list">{children}</div>}
    </section>
  );
}

/** `.c-props__row` — one property: its key, its value control, a remove button (shown on hover / focus). */
export function PropRow({
  name,
  title,
  onRemove,
  removeLabel,
  children,
}: {
  name: ReactNode;
  title?: string;
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="c-props__row">
      <span className="c-props__key" title={title}>
        {name}
      </span>
      <div className="c-props__value">{children}</div>
      {onRemove && (
        <button
          type="button"
          className="c-props__remove"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** `.c-props__chips` — list values as chips, an input to add one at the end. */
export function PropChips({ children }: { children: ReactNode }) {
  return <div className="c-props__chips">{children}</div>;
}

/** `.c-props__chip` — one list value; × removes it. */
export function PropChip({
  label,
  onRemove,
  removeLabel,
}: {
  label: string;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="c-props__chip">
      {label}
      {onRemove && (
        <button
          type="button"
          className="c-props__chip-remove"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
        >
          ×
        </button>
      )}
    </span>
  );
}

/** `.c-props__input` — a borderless input inside a row (a value, a new chip, a new key). */
export function PropInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className="c-props__input" spellCheck={false} autoComplete="off" {...props} />;
}

/** `.c-props__raw` — a value the panel doesn't edit (a nested map), as written; edited in the text. */
export function PropRaw({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="c-props__raw" title={title}>
      {children}
    </span>
  );
}
