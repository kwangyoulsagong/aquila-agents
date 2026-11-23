import type { ReactNode } from 'react';

/** `.c-suggest` — a list of suggested connections (T68), in the note editor's side column or the graph card. */
export function SuggestionList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="c-suggest" aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * `.c-suggest__item` — one suggested connection: a line sample (dotted = suggested, dashed = found in text), the
 * other end (click opens it), why, and the decision buttons on the right.
 */
export function SuggestionItem({
  line,
  label,
  why,
  title,
  onOpen,
  actions,
}: {
  line: 'dotted' | 'dashed';
  label: string;
  why?: string;
  title?: string;
  onOpen?: () => void;
  actions: ReactNode;
}) {
  return (
    <li className="c-suggest__item">
      <span className="c-suggest__line" data-line={line} aria-hidden />
      <button type="button" className="c-suggest__text" title={title ?? label} onClick={onOpen} disabled={!onOpen}>
        <span className="c-suggest__label">{label}</span>
        {why && <span className="c-suggest__why">{why}</span>}
      </button>
      <span className="c-suggest__actions">{actions}</span>
    </li>
  );
}

/**
 * `.c-suggest__proposal` — a line above the list with buttons: "You accepted DB-<n> links 3 times. Always link
 * them?", or (`tone="warn"`) a write that was refused.
 */
export function SuggestionProposal({
  tone,
  children,
  actions,
}: {
  tone?: 'warn';
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className="c-suggest__proposal" role="status" data-tone={tone}>
      <span className="c-suggest__proposal-text">{children}</span>
      <span className="c-suggest__actions">{actions}</span>
    </li>
  );
}
