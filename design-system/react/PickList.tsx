import type { ReactNode } from 'react';

interface PickListProps {
  label: string;
  /** Monospace head line (the current folder). */
  path: ReactNode;
  /** Buttons in the head (up, use this folder). */
  actions?: ReactNode;
  /** Shown instead of rows when there are none (loading, empty, error). */
  empty?: ReactNode;
  children?: ReactNode;
}

/** `.c-pick` — a short scrolling list of choices inside a dialog (T56 remote folders). Children are `PickItem`s. */
export function PickList({ label, path, actions, empty, children }: PickListProps) {
  return (
    <div className="c-pick" role="group" aria-label={label}>
      <div className="c-pick__head">
        <span className="c-pick__path" title={typeof path === 'string' ? path : undefined}>
          {path}
        </span>
        {actions}
      </div>
      {empty ? <div className="c-pick__empty">{empty}</div> : <ul className="c-pick__list">{children}</ul>}
    </div>
  );
}

/** `.c-pick__item` — one row: a label and something small after it (a badge). */
export function PickItem({
  onClick,
  trailing,
  children,
}: {
  onClick: () => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li>
      <button type="button" className="c-pick__item" onClick={onClick}>
        <span className="c-pick__label">{children}</span>
        {trailing}
      </button>
    </li>
  );
}
