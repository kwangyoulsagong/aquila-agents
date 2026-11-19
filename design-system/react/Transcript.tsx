import type { ReactNode } from 'react';

/** `.c-transcript` — a read-only conversation (session history preview). */
export function Transcript({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="c-transcript" aria-label={label}>
      {children}
    </section>
  );
}

/** `.c-transcript__message[data-role]` — one message: who, then the text as written (wrapped, not rendered). */
export function TranscriptMessage({
  role,
  label,
  children,
}: {
  role: 'user' | 'assistant';
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="c-transcript__message" data-role={role}>
      <div className="c-transcript__role">{label}</div>
      <p className="c-transcript__text">{children}</p>
    </article>
  );
}
