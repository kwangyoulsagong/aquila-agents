import type { ReactNode } from 'react';
import { cx } from './cx';

/** `.c-badge` — small uppercase tag. `tone` maps to `.c-badge--<tone>` (claude, codex, shell, account-shared…). */
export function Badge({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={cx('c-badge', tone && `c-badge--${tone}`)}>{children}</span>;
}
