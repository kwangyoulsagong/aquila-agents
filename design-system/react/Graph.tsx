import type { ReactNode } from 'react';

/** A box placed by the caller (SVG user units). */
export interface GraphNodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  /** Quiet second line (a count). */
  detail?: string;
  /** `.c-graph__node[data-mark]`: add / change / unfit. */
  mark?: 'add' | 'change' | 'unfit';
  /** Read out for the mark ("added"). */
  markLabel?: string;
  /** Others are highlighted: this one fades. */
  dim?: boolean;
  highlight?: boolean;
  /** Tooltip (the reason of a change). */
  title?: string;
}

export interface GraphEdgeLine {
  id: string;
  /** SVG path. */
  d: string;
  dim?: boolean;
}

export interface GraphColumnLabel {
  x: number;
  y: number;
  label: string;
}

/**
 * `.c-graph` — a static node graph in SVG: boxes, curved edges and column headings, all placed by the caller.
 * Renders on change only (no animation loop); fades and marks come from CSS (`--motion-*`, off under reduced motion).
 */
export function Graph({
  width,
  height,
  label,
  nodes,
  edges,
  columns = [],
  children,
}: {
  width: number;
  height: number;
  /** Accessible name of the figure. */
  label: string;
  nodes: GraphNodeBox[];
  edges: GraphEdgeLine[];
  columns?: GraphColumnLabel[];
  children?: ReactNode;
}) {
  return (
    <svg
      className="c-graph"
      data-marked={nodes.some((n) => n.mark) || undefined}
      width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {columns.map((c) => (
        <text key={c.label} className="c-graph__column" x={c.x} y={c.y}>
          {c.label}
        </text>
      ))}
      {edges.map((e) => (
        <path key={e.id} className="c-graph__edge" d={e.d} data-dim={e.dim || undefined} />
      ))}
      {nodes.map((n) => (
        <g
          key={n.id}
          className="c-graph__node"
          data-mark={n.mark}
          data-dim={n.dim || undefined}
          data-highlight={n.highlight || undefined}
          transform={`translate(${n.x} ${n.y})`}
        >
          <title>{[n.label, n.markLabel, n.title].filter(Boolean).join(' · ')}</title>
          <rect className="c-graph__box" width={n.width} height={n.height} rx={10} />
          <text className="c-graph__label" x={14} y={n.detail ? n.height / 2 - 4 : n.height / 2 + 4}>
            {n.label}
          </text>
          {n.detail && (
            <text className="c-graph__detail" x={14} y={n.height / 2 + 12}>
              {n.detail}
            </text>
          )}
          {n.mark && <circle className="c-graph__mark" cx={n.width - 16} cy={n.height / 2} r={3.5} />}
        </g>
      ))}
      {children}
    </svg>
  );
}
