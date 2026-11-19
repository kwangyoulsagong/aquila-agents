import type { ReactNode } from 'react';

/** `.c-label` — uppercase section label. */
export function Label({ children }: { children: ReactNode }) {
  return <div className="c-label">{children}</div>;
}
