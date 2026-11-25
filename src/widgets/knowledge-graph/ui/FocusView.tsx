import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  FocusHead,
  FocusMore,
  FocusNode,
  FocusStage,
  type FocusLink,
  type GraphSwatch,
} from '@design-system/react';
import type { GraphEdgeKind, GraphNode, GraphNodeKind } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { lineStyle } from '../model/view';
import { pathTo, type FocusColumnKey, type FocusLayout } from '../model/focus';
import { focusGeometry, type FocusMetrics, type Measure } from '../model/geometry';
import { ago } from '../model/lenses';
import type { LiveSession } from './useLiveSessions';

export const swatchOf = (kind: GraphNodeKind): GraphSwatch =>
  kind === 'note' || kind === 'tag' || kind === 'missing'
    ? kind
    : kind === 'code' || kind === 'file'
      ? 'code'
      : 'other';

/** A changed file is named by its file name; its folder goes in the meta line. */
export const nodeLabel = (n: GraphNode): string =>
  n.kind === 'file' ? (n.label.split('/').pop() ?? n.label) : n.label;

/** Token values the layout needs as numbers (read once per mount; they don't change with the theme). */
function readMetrics(el: Element): FocusMetrics {
  const css = getComputedStyle(el);
  const px = (name: string, fallback: number) => parseFloat(css.getPropertyValue(name)) || fallback;
  const inline = px('--space-inline-sm', 8);
  return {
    row: px('--size-focus-row', 40),
    center: px('--size-focus-center', 208),
    gap: px('--size-focus-gap', 48),
    pad: px('--space-inset-md', 12),
    dot: inline * 2,
    head: px('--space-stack-lg', 24),
  };
}

/** Text widths for link anchors, with the label / meta fonts. */
function textMeasure(el: Element): Measure {
  const css = getComputedStyle(el);
  const family = css.getPropertyValue('--font-family-ui').trim() || 'sans-serif';
  const size = (name: string, fallback: number) => parseFloat(css.getPropertyValue(name)) || fallback;
  const ctx = document.createElement('canvas').getContext('2d');
  const fonts = {
    label: `${size('--font-size-body', 13)}px ${family}`,
    meta: `${size('--font-size-caption', 11)}px ${family}`,
  };
  return (text, role) => {
    if (!ctx || !text) return 0;
    ctx.font = fonts[role];
    return Math.ceil(ctx.measureText(text).width);
  };
}

export interface FocusViewProps {
  layout: FocusLayout;
  /** Session nodes open in a tab, with the tab's status. */
  live?: ReadonlyMap<string, LiveSession>;
  onRecentre: (id: string) => void;
  onOpen: (node: GraphNode) => void;
  onMore: (column: FocusColumnKey) => void;
  onBack: () => void;
  /** Test hook: the picture is on screen (smoke / capture wait for it). */
  onShown?: (info: { nodes: number; ms: number }) => void;
}

/**
 * The focus view (T72): the centre and its columns as DOM over one SVG of links. Click a node → it becomes the
 * centre (slides there); ⌘-click or double-click the centre → open it. Hover lights the path from the centre.
 * Keys: ↑↓ within a column, ←→ between columns, Enter → recentre (on the centre: open), ⌘Enter → open, ⌫ → back.
 */
export function FocusView({ layout, live, onRecentre, onOpen, onMore, onBack, onShown }: FocusViewProps) {
  const t = useT();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>(layout.center.id);
  const started = useRef(performance.now());

  useLayoutEffect(() => {
    if (!host) return;
    const read = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);
  const metrics = useMemo(() => (host ? readMetrics(host) : null), [host]);
  const measure = useMemo(() => (host ? textMeasure(host) : null), [host]);

  // A new centre: the cursor goes to it, hover is stale.
  useEffect(() => {
    setCursor(layout.center.id);
    setHovered(null);
    started.current = performance.now();
  }, [layout.center.id]);

  const now = Date.now();
  const metaOf = (n: GraphNode): string => {
    const when = n.mtime ? ago(n.mtime, now, t, t('locale')) : '';
    switch (n.kind) {
      case 'note':
      case 'trend':
        return when;
      case 'session': {
        const agent = /^session:(claude|codex):/.exec(n.id)?.[1];
        const tab = live?.get(n.id);
        return [agent === 'codex' ? 'Codex' : agent === 'claude' ? 'Claude' : '', tab ? t(`graph.live.${tab.status}`) : when]
          .filter(Boolean)
          .join(' · ');
      }
      case 'file': {
        const dir = n.label.split('/').slice(0, -1).join('/');
        return dir || t('graph.kind.file');
      }
      default:
        return t(`graph.kind.${n.kind}`);
    }
  };

  const geo = useMemo(
    () =>
      metrics && measure && size.width
        ? focusGeometry(layout, size.width, metrics, measure, metaOf, nodeLabel, size.height)
        : null,
    // metaOf / t change with the language; layout and size are what move things.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, size.width, size.height, metrics, measure, t, live],
  );

  useEffect(() => {
    if (geo) onShown?.({ nodes: geo.nodes.length, ms: Math.round(performance.now() - started.current) });
    // Once per picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  // Keep the keyboard cursor on something that's still shown.
  const shownIds = useMemo(() => new Set(geo?.nodes.map((p) => p.node.id)), [geo]);
  const current = shownIds.has(cursor) ? cursor : layout.center.id;
  const focusId = (id: string) => {
    setCursor(id);
    const el = host?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const lit = hovered && shownIds.has(hovered) ? pathTo(layout, hovered) : null;
  const linkState = (from: string, to: string): FocusLink['state'] =>
    !lit ? undefined : lit.has(from) && lit.has(to) ? 'hot' : 'dim';

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!geo || e.target instanceof HTMLInputElement) return;
    const lanes = geo.lanes;
    const li = lanes.findIndex((l) => l.includes(current));
    const lane = lanes[li] ?? [];
    const i = lane.indexOf(current);
    const nodeOf = (id: string) => geo.nodes.find((p) => p.node.id === id);
    const move = (id: string | undefined) => {
      if (!id) return;
      e.preventDefault();
      focusId(id);
    };
    switch (e.key) {
      case 'ArrowUp':
        return move(lane[i - 1]);
      case 'ArrowDown':
        return move(lane[i + 1]);
      case 'ArrowLeft':
      case 'ArrowRight': {
        const next = lanes[li + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (!next?.length) return;
        const y = nodeOf(current)?.y ?? 0;
        // Nearest by height in the next column.
        const best = [...next].sort(
          (a, b) => Math.abs((nodeOf(a)?.y ?? 0) - y) - Math.abs((nodeOf(b)?.y ?? 0) - y),
        )[0];
        return move(best);
      }
      case 'Enter': {
        e.preventDefault();
        const n = nodeOf(current)?.node;
        if (!n) return;
        if (e.metaKey || n.id === layout.center.id) onOpen(n);
        else onRecentre(n.id);
        return;
      }
      case 'Backspace':
        e.preventDefault();
        onBack();
        return;
    }
  };

  const headText = (key: string) =>
    key === 'head:center' ? t('graph.focus.center') : t(`graph.focus.col.${key.slice(5) as FocusColumnKey}`);

  return (
    <div className="c-kgraph__canvas" ref={setHost}>
      {geo && (
        <FocusStage
          width={geo.width}
          height={geo.height}
          label={t('graph.focus.label', { name: layout.center.label })}
          onKeyDown={onKeyDown}
          links={geo.links.map((l) => ({
            id: l.id,
            d: l.d,
            line: lineStyle(l.kind as GraphEdgeKind),
            state: linkState(l.from, l.to),
          }))}
        >
            {geo.heads.map((h) => (
              <FocusHead key={h.key} x={h.x} y={h.y} width={h.width} align={h.align}>
                {headText(h.key)}
              </FocusHead>
            ))}
            {geo.nodes.map((p) => {
              const center = p.column === 'center';
              return (
                <FocusNode
                  key={p.node.id}
                  id={p.node.id}
                  x={p.x}
                  y={p.y}
                  width={p.width}
                  {...(p.height !== undefined ? { height: p.height } : {})}
                  align={p.align}
                  kind={swatchOf(p.node.kind)}
                  label={nodeLabel(p.node)}
                  meta={
                    center
                      ? [t('graph.links', { n: String(layout.degree) }), metaOf(p.node)]
                          .filter(Boolean)
                          .join(' · ')
                      : metaOf(p.node)
                  }
                  {...(p.depth === 2 ? { depth: 2 as const } : {})}
                  {...(lit ? { state: lit.has(p.node.id) ? ('hot' as const) : ('dim' as const) } : {})}
                  current={p.node.id === current}
                  {...(live?.get(p.node.id) ? { live: live.get(p.node.id)!.status } : {})}
                  title={center ? t('graph.focus.openHint') : t('graph.focus.goHint', { name: p.node.label })}
                  onClick={(e) => {
                    setCursor(p.node.id);
                    if (e.metaKey || e.ctrlKey) onOpen(p.node);
                    else if (!center) onRecentre(p.node.id);
                  }}
                  {...(center ? { onDoubleClick: () => onOpen(p.node) } : {})}
                  onHover={(on) => setHovered(on ? p.node.id : null)}
                  onFocus={() => setCursor(p.node.id)}
                />
              );
            })}
            {geo.mores.map((b) => (
              <FocusMore
                key={b.key}
                x={b.x}
                y={b.y}
                width={b.width}
                align={b.align}
                onClick={() => onMore(b.column)}
              >
                {t('graph.focus.more', { n: String(b.count) })}
              </FocusMore>
            ))}
        </FocusStage>
      )}
    </div>
  );
}
