import type { ReactNode } from 'react';
import { cx } from './cx';

/** `.c-meta` — label · value rows (a session's folder, branch, id). */
export function MetaList({ children }: { children: ReactNode }) {
  return <dl className="c-meta">{children}</dl>;
}

/** One row; `mono` for paths and ids. */
export function MetaRow({ label, mono, children }: { label: ReactNode; mono?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className="c-meta__label">{label}</dt>
      <dd className={cx('c-meta__value', mono && 'c-meta__value--mono')}>{children}</dd>
    </>
  );
}
