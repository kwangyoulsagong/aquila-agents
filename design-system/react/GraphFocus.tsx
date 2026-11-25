import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import type { GraphLine, GraphSwatch } from './GraphStage';

// `.c-kfocus` — the knowledge graph's focus view ("around this note", T72): one node in the middle, columns of
// what it links to either side, links drawn underneath. The caller computes every position (it owns the layout);
// these only draw a box at (x, y) and animate it when the position changes, so a node that becomes the centre
// slides there.

export interface FocusLink {
  id: string;
  /** SVG path data in plane coordinates. */
  d: string;
  line: GraphLine;
  /** Lit (on the hovered path) or faded (another path is lit). */
  state?: 'hot' | 'dim';
}

interface StageProps {
  width: number;
  height: number;
  links: FocusLink[];
  label: string;
  stageRef?: Ref<HTMLDivElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

/** The scrolling plane: links (SVG) under the nodes, headings and "+N more" buttons. */
export function FocusStage({ width, height, links, label, stageRef, onKeyDown, children }: StageProps) {
  return (
    <div className="c-kfocus" role="group" aria-label={label} ref={stageRef} onKeyDown={onKeyDown}>
      <div className="c-kfocus__plane" style={{ width, height }}>
        <svg className="c-kfocus__links" width={width} height={height} aria-hidden>
          {links.map((l) => (
            <path key={l.id} className="c-kfocus__link" d={l.d} data-line={l.line} data-state={l.state} />
          ))}
        </svg>
        {children}
      </div>
    </div>
  );
}

const place = (x: number, y: number, width: number, height?: number): CSSProperties => ({
  transform: `translate(${x}px, ${y}px)`,
  width,
  ...(height !== undefined ? { height } : {}),
});

interface NodeProps {
  /** Stable id, also `data-id` (the caller moves keyboard focus by it). */
  id: string;
  /** Top-left of the box, plane coordinates. */
  x: number;
  y: number;
  width: number;
  /** The centre card's height (the others are one row). */
  height?: number;
  /** `end`: dot on the right edge, text right-aligned (left columns). `center`: the card in the middle. */
  align: 'start' | 'end' | 'center';
  kind: GraphSwatch;
  label: string;
  meta?: ReactNode;
  /** Outer columns are quieter. */
  depth?: 1 | 2;
  state?: 'hot' | 'dim';
  /** The keyboard cursor: the one item in the tab order (roving tabindex). */
  current?: boolean;
  /** Open in a tab right now: its status rings the dot (`--color-status-*`). */
  live?: 'working' | 'waiting' | 'done' | 'error' | 'stopped' | 'idle';
  title?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
  onHover?: (on: boolean) => void;
  onFocus?: () => void;
}

/** `.c-kfocus__node` — one node: a dot on the column edge (where its links meet) and a one-line label + meta. */
export function FocusNode({
  id,
  x,
  y,
  width,
  height,
  align,
  kind,
  label,
  meta,
  depth,
  state,
  current,
  live,
  title,
  onClick,
  onDoubleClick,
  onHover,
  onFocus,
}: NodeProps) {
  return (
    <button
      type="button"
      className="c-kfocus__node"
      data-id={id}
      data-align={align}
      data-depth={depth}
      data-state={state}
      data-live={live}
      aria-current={align === 'center' ? 'true' : undefined}
      tabIndex={current ? 0 : -1}
      title={title}
      style={place(x, y, width, height)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onHover && (() => onHover(true))}
      onMouseLeave={onHover && (() => onHover(false))}
      onFocus={onFocus}
    >
      <span className="c-kgraph__swatch" data-kind={kind} />
      <span className="c-kfocus__text">
        <span className="c-kfocus__label">{label}</span>
        {meta && <span className="c-kfocus__meta">{meta}</span>}
      </span>
    </button>
  );
}

interface BoxProps {
  x: number;
  y: number;
  width: number;
  align: 'start' | 'end' | 'center';
  children: ReactNode;
}

/** `.c-kfocus__head` — a column's heading. */
export function FocusHead({ x, y, width, align, children }: BoxProps) {
  return (
    <div className="c-kfocus__head" data-align={align} style={place(x, y, width)}>
      {children}
    </div>
  );
}

/** `.c-kfocus__more` — "+N more" under a column. */
export function FocusMore({ x, y, width, align, children, onClick }: BoxProps & { onClick: () => void }) {
  return (
    <button
      type="button"
      className="c-kfocus__more"
      data-align={align}
      tabIndex={-1}
      style={place(x, y, width)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** `.c-kgraph__trail` — back, then where you came from (clickable), ending at the centre. */
export function GraphTrail({
  back,
  items,
  onPick,
}: {
  back: ReactNode;
  items: { id: string; label: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <nav className="c-kgraph__trail">
      {back}
      <ol className="c-kgraph__trail-list">
        {items.map((it, i) => (
          <li key={`${it.id}:${i}`} className="c-kgraph__trail-item">
            {i === items.length - 1 ? (
              <span aria-current="page">{it.label}</span>
            ) : (
              <button type="button" onClick={() => onPick(it.id)}>
                {it.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** `.c-kgraph__lens` — a question chip on the map ("To-dos 7"); pressed = its answers are lit. */
export function GraphLens({
  pressed,
  count,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  count: number;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="c-kgraph__lens"
      aria-pressed={pressed}
      disabled={!count && !pressed}
      title={title}
      onClick={onClick}
    >
      {children}
      <span className="c-kgraph__lens-count">{count}</span>
    </button>
  );
}

/** `.c-kgraph__results` — search results over the top of the stage. Children are `GraphResult`s. */
export function GraphResults({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="c-kgraph__results" role="listbox" aria-label={label}>
      {children}
    </ul>
  );
}

export function GraphResult({
  kind,
  label,
  detail,
  selected,
  onPick,
}: {
  kind: GraphSwatch;
  label: string;
  detail?: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <li
      className="c-kgraph__result"
      role="option"
      aria-selected={selected}
      // mousedown: the search field keeps focus (a click would blur it first and close the list).
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
    >
      <span className="c-kgraph__swatch" data-kind={kind} />
      <span className="c-kgraph__result-label">{label}</span>
      {detail && <span className="c-kgraph__result-detail">{detail}</span>}
    </li>
  );
}

/**
 * `.c-kgraph__foot` — the centre's one-line card under the stage: dot, title, place, actions. `children` is the
 * expandable part (suggested links), shown above the line when `open`.
 */
export function GraphFoot({
  kind,
  title,
  detail,
  actions,
  open,
  children,
}: {
  kind: GraphSwatch;
  title: string;
  detail?: string;
  actions?: ReactNode;
  open?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="c-kgraph__foot" role="status">
      {open && children && <div className="c-kgraph__foot-body">{children}</div>}
      <div className="c-kgraph__foot-line">
        <span className="c-kgraph__swatch" data-kind={kind} />
        <span className="c-kgraph__foot-title" title={title}>
          {title}
        </span>
        {detail && (
          <span className="c-kgraph__foot-detail" title={detail}>
            {detail}
          </span>
        )}
        {actions && <span className="c-kgraph__foot-actions">{actions}</span>}
      </div>
    </div>
  );
}
