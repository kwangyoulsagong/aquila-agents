import type { ReactNode } from 'react';

/** `.c-kbd` — keyboard shortcut hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return <span className="c-kbd">{children}</span>;
}
