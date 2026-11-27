import type { ReactNode } from 'react';

// Requirement IDs in the note editor (T79). The marks and the hover card inside CodeMirror are drawn by the
// editor extension with the same `.c-noteid*` classes; these are the side-column pieces.

/** `.c-noteid-row` — a side-column row with actions at its end (an unlinked mention with "Link"). */
export function NoteIdRow({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="c-noteid-row">
      <div className="c-noteid-row__main">{children}</div>
      {actions && <div className="c-noteid-row__actions">{actions}</div>}
    </div>
  );
}

/** `.c-noteid-text` — a plain, non-clickable side-column line (a session, a changed file). */
export function NoteIdText({ label, detail, title }: { label: string; detail?: string; title?: string }) {
  return (
    <div className="c-noteid-text" title={title ?? label}>
      {label}
      {detail && <span className="c-noteid-text__detail">{detail}</span>}
    </div>
  );
}

/** `.c-noteid-note` — a line of the "Referenced in" section: an inline confirm, a warning, a count. */
export function NoteIdNote({
  tone,
  children,
  actions,
}: {
  tone?: 'warn';
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="c-noteid-note" data-tone={tone}>
      <span className="c-noteid-note__text">{children}</span>
      {actions && <span className="c-noteid-note__actions">{actions}</span>}
    </div>
  );
}
