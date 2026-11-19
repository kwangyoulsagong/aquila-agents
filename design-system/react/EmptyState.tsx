import type { ReactNode } from 'react';

interface Props {
  title?: ReactNode;
  /** Monospace line under the title (a path). */
  path?: ReactNode;
  /** Row of buttons. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** `.c-empty` — centered empty state: title, path, actions. */
export function EmptyState({ title, path, actions, children }: Props) {
  return (
    <div className="c-empty">
      {title && <div className="c-empty__title">{title}</div>}
      {path && <div className="c-empty__path">{path}</div>}
      {children}
      {actions && <div className="c-empty__actions">{actions}</div>}
    </div>
  );
}
