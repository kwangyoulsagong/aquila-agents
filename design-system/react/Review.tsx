import type { ReactNode } from 'react';

/** `.c-review__counts` — `+12 −3 lines` (added in the add color, removed in the delete color). */
export function ReviewCounts({ added, removed, unit }: { added: number; removed: number; unit?: string }) {
  return (
    <span className="c-review__counts">
      <span className="c-review__add">+{added}</span> <span className="c-review__del">−{removed}</span>
      {unit && ` ${unit}`}
    </span>
  );
}

/** `.c-review__meta` — a quiet part of the review line (who, when). */
export function ReviewMeta({ children }: { children: ReactNode }) {
  return <span className="c-review__meta">{children}</span>;
}

/** `.c-review__confirm` — the question before a destructive hunk action; its buttons follow. */
export function ReviewConfirm({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <>
      <span className="c-review__confirm">{children}</span>
      {actions}
    </>
  );
}
