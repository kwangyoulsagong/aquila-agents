import type { ReactNode, Ref } from 'react';

/** Node kinds with a swatch colour (`--color-graph-*`). */
export type GraphSwatch = 'note' | 'tag' | 'code' | 'missing' | 'other';
/** Line samples, strongest first. */
export type GraphLine = 'solid' | 'dashed' | 'dotted';

interface StageProps {
  /** The element a WebGL renderer draws into (fills the stage). */
  canvasRef: Ref<HTMLDivElement>;
  /** Overlays: a card, a legend, an empty state. */
  children?: ReactNode;
}

/**
 * `.c-kgraph` — the knowledge graph's stage (T66): a canvas host filling the space, overlays on top. The canvas
 * itself is drawn by the caller (WebGL); this only sizes it and places the overlays.
 */
export function GraphStage({ canvasRef, children }: StageProps) {
  return (
    <div className="c-kgraph">
      <div className="c-kgraph__canvas" ref={canvasRef} />
      {children}
    </div>
  );
}

/** `.c-kgraph__legend` — what the colours and line styles mean, bottom-left over the canvas. */
export function GraphLegend({
  swatches,
  lines,
}: {
  swatches: { kind: GraphSwatch; label: string }[];
  lines: { line: GraphLine; label: string }[];
}) {
  return (
    <div className="c-kgraph__legend" aria-hidden>
      {swatches.map((s) => (
        <span key={s.kind} className="c-kgraph__key">
          <span className="c-kgraph__swatch" data-kind={s.kind} />
          {s.label}
        </span>
      ))}
      {lines.map((l) => (
        <span key={l.line} className="c-kgraph__key">
          <span className="c-kgraph__line" data-line={l.line} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

/**
 * `.c-kgraph__hint` — what the graph is for and how to use it, top-left over the canvas until dismissed.
 * `close` is the dismiss button (the caller translates it).
 */
export function GraphHint({ children, close }: { children: ReactNode; close?: ReactNode }) {
  return (
    <div className="c-kgraph__hint" role="note">
      <div className="c-kgraph__hint-text">{children}</div>
      {close && <div className="c-kgraph__card-close">{close}</div>}
    </div>
  );
}

/**
 * `.c-kgraph__card` — the selected node, top-left over the canvas: title, a path line, actions. Actions wrap when
 * the panel is narrow; `close` stays pinned at the top-right so it never gets pushed out of view.
 */
export function GraphCard({
  kind,
  title,
  detail,
  actions,
  close,
  children,
}: {
  kind: GraphSwatch;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  /** The dismiss button, always visible top-right. */
  close?: ReactNode;
  /** Below the title row, full width, scrolls when long (the note's suggested links, T68). */
  children?: ReactNode;
}) {
  return (
    <div className="c-kgraph__card" role="status">
      <span className="c-kgraph__swatch" data-kind={kind} />
      <div className="c-kgraph__card-text">
        <div className="c-kgraph__card-title">{title}</div>
        {detail && <div className="c-kgraph__card-detail">{detail}</div>}
      </div>
      {actions && <div className="c-kgraph__card-actions">{actions}</div>}
      {close && <div className="c-kgraph__card-close">{close}</div>}
      {children && <div className="c-kgraph__card-body">{children}</div>}
    </div>
  );
}
