import type { CSSProperties, ReactNode, Ref } from 'react';

interface EditorProps {
  /** The element CodeMirror mounts into (fills the main column). */
  hostRef: Ref<HTMLDivElement>;
  /** Above the text: a banner, a compare view. */
  top?: ReactNode;
  /** Outline / links column on the right; omitted = hidden. */
  side?: ReactNode;
}

/**
 * `.c-editor` — the note editor (T67): a CodeMirror host and an optional side column. CodeMirror's own classes
 * (`.cm-*`) and the live-preview marks (`.cm-md-*`) are styled under `.c-editor` in components.css.
 */
export function NoteEditor({ hostRef, top, side }: EditorProps) {
  return (
    <div className="c-editor">
      <div className="c-editor__main">
        {top}
        <div className="c-editor__host" ref={hostRef} />
      </div>
      {side && <aside className="c-editor__side">{side}</aside>}
    </div>
  );
}

/** `.c-editor__banner` — a line across the top of the text (changed on disk, read-only) with its buttons. */
export function EditorBanner({
  tone,
  actions,
  children,
}: {
  tone?: 'warn';
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="c-editor__banner" role="status" data-tone={tone}>
      <span className="c-editor__banner-text">{children}</span>
      {actions}
    </div>
  );
}

/** `.c-editor__compare` — a scrolling area under the banner (a diff). */
export function EditorCompare({ children }: { children: ReactNode }) {
  return <div className="c-editor__compare">{children}</div>;
}

/** `.c-editor__section` — a titled list in the side column (outline, backlinks, mentions). */
export function EditorSection({
  title,
  empty,
  children,
}: {
  title: string;
  /** Shown when there are no children. */
  empty?: string;
  children?: ReactNode;
}) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section className="c-editor__section" aria-label={title}>
      <div className="c-editor__section-title">{title}</div>
      {has ? children : empty ? <div className="c-editor__empty">{empty}</div> : null}
    </section>
  );
}

/** `.c-editor__item` — one row of a side list; `level` indents it (outline). */
export function EditorItem({
  label,
  detail,
  level = 0,
  title,
  onClick,
}: {
  label: string;
  detail?: string;
  level?: number;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="c-editor__item"
      style={{ '--level': level } as CSSProperties}
      title={title ?? label}
      onClick={onClick}
    >
      {label}
      {detail && <span className="c-editor__item-detail">{detail}</span>}
    </button>
  );
}

/** `.c-editor__tabs` — companion files as tabs above the text (T69); `end` sits at the row's right (actions). */
export function EditorTabs({ label, end, children }: { label: string; end?: ReactNode; children?: ReactNode }) {
  return (
    <div className="c-editor__tabs">
      {children && (
        <div role="tablist" aria-label={label} className="c-editor__tablist">
          {children}
        </div>
      )}
      {end && <div className="c-editor__tabs-end">{end}</div>}
    </div>
  );
}

/** `.c-editor__tab` — one companion file; the selected one is the note shown. */
export function EditorTab({
  selected,
  title,
  onClick,
  children,
}: {
  selected: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      className="c-editor__tab"
      aria-selected={selected}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** `.c-editor__fields` — form fields inside a side section (typed properties, T69). */
export function EditorFields({ children }: { children: ReactNode }) {
  return <div className="c-editor__fields">{children}</div>;
}
