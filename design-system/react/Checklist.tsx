import type { ReactNode } from 'react';

/** `.c-checklist` — bordered list of checks (first run). Children are `ChecklistItem`s. */
export function Checklist({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul className="c-checklist" aria-label={label}>
      {children}
    </ul>
  );
}

interface ItemProps {
  /** Status dot on the title line. */
  leading: ReactNode;
  title: ReactNode;
  /** Next to the title (a `Badge`). */
  tag?: ReactNode;
  /** Monospace line under the title (version · path, or why it's missing). */
  meta?: ReactNode;
  /** Buttons on the right. */
  actions?: ReactNode;
  /** Full-width block under the row (install command, drop zone). */
  children?: ReactNode;
}

/** `.c-checklist__item` — dot · title (+ tag) / meta · actions, then an optional detail block. */
export function ChecklistItem({ leading, title, tag, meta, actions, children }: ItemProps) {
  return (
    <li className="c-checklist__item">
      <span className="c-checklist__lead">{leading}</span>
      <div className="c-checklist__main">
        <div className="c-checklist__title">
          {title}
          {tag}
        </div>
        {meta && <div className="c-checklist__meta">{meta}</div>}
      </div>
      {actions ? <div className="c-checklist__actions">{actions}</div> : <span />}
      {children && <div className="c-checklist__detail">{children}</div>}
    </li>
  );
}

/** `.c-checklist__command` — a selectable command with a button beside it (Copy). */
export function ChecklistCommand({ command, action }: { command: string; action?: ReactNode }) {
  return (
    <div className="c-checklist__command">
      <code>{command}</code>
      {action}
    </div>
  );
}
