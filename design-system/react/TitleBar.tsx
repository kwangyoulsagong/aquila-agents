import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/**
 * `.c-titlebar` — a bare title band (full window): room for the traffic lights, a truncating title, actions at the
 * right. Draggable like the tab bar; `lead` (a status dot) sits before the title.
 */
export function TitleBar({
  lead,
  actions,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={cx('c-titlebar', className)} {...rest}>
      {lead}
      <span className="c-titlebar__title">{children}</span>
      {actions && <div className="c-titlebar__actions">{actions}</div>}
    </div>
  );
}
