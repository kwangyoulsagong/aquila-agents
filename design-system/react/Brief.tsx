import type { ReactNode } from 'react';
import { Button } from './Button';

/** `.c-brief` — the "What is this?" dialog's column: meta line, notices, the card, related notes (T81). */
export function Brief({ children }: { children: ReactNode }) {
  return <div className="c-brief">{children}</div>;
}

/** `.c-brief__meta` — one quiet line: what the input is (`label` ellipsised) and its size. */
export function BriefMeta({ label, children }: { label?: ReactNode; children?: ReactNode }) {
  return (
    <div className="c-brief__meta">
      {label && <span className="c-brief__meta-label">{label}</span>}
      {children}
    </div>
  );
}

/** `.c-brief__notice` — a caption; `warn` for what leaves the machine. */
export function BriefNotice({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return (
    <p className="c-brief__notice" data-tone={warn ? 'warn' : undefined} role={warn ? 'note' : undefined}>
      {children}
    </p>
  );
}

/** `.c-brief__preview` — collapsed "what will be sent", the exact text in a scrolling monospace block. */
export function BriefPreview({ summary, text }: { summary: ReactNode; text: string }) {
  return (
    <details className="c-brief__preview">
      <summary>{summary}</summary>
      <pre>{text}</pre>
    </details>
  );
}

/** `.c-brief__card` — the fixed fields. */
export function BriefCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="c-brief__card" aria-label={label}>
      {children}
    </section>
  );
}

/** `.c-brief__section` — a field: its label, then a line (`text`), bullets (`items`) or terms (`terms`). */
export function BriefField({
  label,
  text,
  items,
  terms,
  children,
}: {
  label: ReactNode;
  text?: string;
  items?: string[];
  terms?: string[];
  children?: ReactNode;
}) {
  return (
    <div className="c-brief__section">
      <span className="c-brief__label">{label}</span>
      {text && <p className="c-brief__text">{text}</p>}
      {items && items.length > 0 && (
        <ul className="c-brief__bullets">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      {terms && terms.length > 0 && (
        <ul className="c-brief__terms">
          {terms.map((x) => (
            <li key={x} className="c-brief__term">
              {x}
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}

/** `.c-brief__related` — related notes, each with why. */
export function BriefRelated({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="c-brief__related" aria-label={label}>
      {children}
    </ul>
  );
}

/** One related note: the title opens it; the toggle (`aria-pressed`) puts a link to it in the saved note. */
export function BriefRelatedItem({
  title,
  why,
  onOpen,
  linked,
  onToggle,
  linkLabel,
}: {
  title: string;
  why: string;
  onOpen: () => void;
  linked?: boolean;
  onToggle?: () => void;
  linkLabel?: string;
}) {
  return (
    <li className="c-brief__rel">
      <button type="button" className="c-brief__rel-main" onClick={onOpen} title={title}>
        <span className="c-brief__rel-title">{title}</span>
        <span className="c-brief__rel-why">{why}</span>
      </button>
      {onToggle && (
        <Button variant="ghost" aria-pressed={!!linked} onClick={onToggle}>
          {linkLabel}
        </Button>
      )}
    </li>
  );
}
