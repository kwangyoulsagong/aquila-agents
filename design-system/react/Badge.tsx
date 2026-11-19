import type { ReactNode } from 'react';
import { cx } from './cx';

/** `.c-badge` — small uppercase tag. `tone` maps to `.c-badge--<tone>` (claude, codex, shell, account-shared…). */
export function Badge({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={cx('c-badge', tone && `c-badge--${tone}`)}>{children}</span>;
}

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'lost';

/** `.c-badge--host` — a remote host alias with its connection dot (`.c-badge__conn[data-conn]`). */
export function HostBadge({ host, conn, label }: { host: string; conn?: ConnState; label?: string }) {
  return (
    <span className="c-badge c-badge--host" title={label ? `${host} · ${label}` : host}>
      {conn && (
        <i className="c-badge__conn" data-conn={conn} aria-label={label} role={label ? 'img' : undefined} />
      )}
      {host}
    </span>
  );
}
