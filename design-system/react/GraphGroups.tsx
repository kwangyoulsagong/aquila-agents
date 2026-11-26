import type { KeyboardEvent, Ref } from 'react';

export interface GroupBubble {
  key: string;
  x: number;
  y: number;
  r: number;
  label: string;
  /** In the middle of the bubble ("371"). */
  count: string;
  /** Quiet line under the name ("+3 this week"). */
  detail?: string;
  /** 1–8: `--color-graph-group-<n>`; 0: neutral. */
  group: number;
  /** A lens is on: how many of its hits are in this group (a badge); 0 fades the bubble. */
  hits?: number;
  /** Another bubble is hovered and this one isn't linked to it. */
  dim?: boolean;
  /** Tooltip / accessible name. */
  title: string;
  /** Picked to be shown together with others (⌘-click). */
  selected?: boolean;
}

export interface GroupLinkLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width in px (by how many links). */
  width: number;
  /** Number of links, shown at the middle while lit. */
  label: string;
  lit?: boolean;
  dim?: boolean;
}

/**
 * `.c-kgroups` — the Map's groups (T73): one bubble per group, sized and placed by the caller, with lines as thick
 * as the links between them. A bubble is a button (click / Enter opens it). Static SVG: renders on change only.
 */
export function GraphGroups({
  hint,
  hostRef,
  width,
  height,
  label,
  bubbles,
  links,
  onPick,
  onHover,
}: {
  /** The box filling the stage (the caller measures it for `width` / `height`). */
  hostRef?: Ref<HTMLDivElement>;
  width: number;
  height: number;
  /** Accessible name of the figure. */
  label: string;
  bubbles: GroupBubble[];
  links: GroupLinkLine[];
  /** `multi`: ⌘ / Shift held — add to (or take out of) the picked ones instead of opening. */
  onPick: (key: string, multi: boolean) => void;
  onHover?: (key: string | null) => void;
  /** A quiet line bottom-left (how to use it). */
  hint?: string;
}) {
  const key = (e: KeyboardEvent, k: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(k, e.metaKey || e.shiftKey);
    }
  };
  return (
    <div className="c-kgroups" ref={hostRef}>
      <svg
        className="c-kgroups__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={label}
      >
        {links.map((l) => (
          <line
            key={l.id}
            className="c-kgroups__link"
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            strokeWidth={l.width}
            data-lit={l.lit || undefined}
            data-dim={l.dim || undefined}
          />
        ))}
        {links
          .filter((l) => l.lit)
          .map((l) => (
            <text
              key={`${l.id}-n`}
              className="c-kgroups__link-count"
              x={(l.x1 + l.x2) / 2}
              y={(l.y1 + l.y2) / 2}
            >
              {l.label}
            </text>
          ))}
        {bubbles.map((b) => (
          <g
            key={b.key}
            className="c-kgroups__bubble"
            data-group={b.group || undefined}
            data-dim={b.dim || b.hits === 0 || undefined}
            transform={`translate(${b.x} ${b.y})`}
            role="button"
            tabIndex={0}
            aria-label={b.title}
            aria-pressed={b.selected ?? false}
            data-selected={b.selected || undefined}
            onClick={(e) => onPick(b.key, e.metaKey || e.shiftKey)}
            onKeyDown={(e) => key(e, b.key)}
            onMouseEnter={() => onHover?.(b.key)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(b.key)}
            onBlur={() => onHover?.(null)}
          >
            <title>{b.title}</title>
            <circle className="c-kgroups__disc" r={b.r} />
            <text className="c-kgroups__count" y={4}>
              {b.count}
            </text>
            <text className="c-kgroups__label" y={b.r + 16}>
              {b.label}
            </text>
            {b.detail && (
              <text className="c-kgroups__detail" y={b.r + 30}>
                {b.detail}
              </text>
            )}
            {b.hits !== undefined && b.hits > 0 && (
              <g className="c-kgroups__hits" transform={`translate(${b.r * 0.72} ${-b.r * 0.72})`}>
                <circle r={10} />
                <text y={4}>{b.hits}</text>
              </g>
            )}
          </g>
        ))}
      </svg>
      {hint && <div className="c-kgroups__hint">{hint}</div>}
    </div>
  );
}
