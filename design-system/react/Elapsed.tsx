import type { ReactNode } from 'react';

/** `.c-elapsed` — how long something has been waiting ("12m"); `title` spells it out. */
export function Elapsed({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="c-elapsed" title={title}>
      {children}
    </span>
  );
}
