import { useEffect, useRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { layerDashed, layerPlain } from 'sigma/rendering';
import type { GraphNode } from '@/shared/api';
import { kindColor, type GraphColors } from '../model/colors';
import { seedPositions } from '../model/layout';
import { runLayout, type LayoutRun } from '../model/runLayout';
import { lineStyle, neighbourhood, nodeSizes, type GraphView, type LineStyle } from '../model/view';

interface NodeAttrs {
  x: number;
  y: number;
  size: number;
  label: string;
  color: string;
  /** Faded: something else is focused / searched. */
  dim: boolean;
  /** Searched or focused: label always shown. */
  lit: boolean;
}
interface EdgeAttrs {
  size: number;
  color: string;
  line: LineStyle;
  dim: boolean;
}

export interface GraphRendererProps {
  view: GraphView;
  colors: GraphColors;
  /** Selected node (local view center); its neighbours stay lit. */
  selected: string | null;
  /** Search hits. */
  matches: ReadonlySet<string>;
  /** Power saver: no layout animation, only the settled picture. */
  saver: boolean;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
  /** Test hook: the layout run finished. */
  onSettled?: (info: { nodes: number; iterations: number; ms: number; via: 'worker' | 'thread' }) => void;
}

const TRANSPARENT = 'rgba(0,0,0,0)';
/** Dash / gap in px per line style (0 = this layer draws nothing; the plain layer draws solid lines). */
const DASH: Record<LineStyle, [number, number]> = { solid: [0, 0], dashed: [5, 4], dotted: [1.5, 3.5] };

/**
 * The WebGL graph (sigma.js). Renders only when something changes — the data, a hover, the camera — never in a loop.
 * The layout runs in a worker after every data change and stops once settled (≤ 3 s). Unmounting (or a new element) kills sigma, which
 * also releases the WebGL context.
 */
export function useGraphRenderer(
  el: HTMLDivElement | null,
  { view, colors, selected, matches, saver, onSelect, onOpen, onSettled }: GraphRendererProps,
): void {
  const graphRef = useRef<Graph<NodeAttrs, EdgeAttrs> | null>(null);
  const sigmaRef = useRef<{ kill(): void } | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const hovered = useRef<string | null>(null);
  const nodesById = useRef(new Map<string, GraphNode>());
  const cb = useRef({ onSelect, onOpen, onSettled });
  cb.current = { onSelect, onOpen, onSettled };
  // Read by sigma's handlers, which live as long as the sigma instance: always the latest render's values.
  const focus = useRef({ selected, matches, view, colors });
  focus.current = { selected, matches, view, colors };
  // Sigma refuses attribute updates for items it hasn't drawn yet: after a rebuild, updates wait for the first frame.
  const painted = useRef(false);
  const pending = useRef<{ xy: Float32Array | null; focus: boolean }>({ xy: null, focus: false });
  const index = useRef(new Map<string, number>());

  /** What's lit: the hovered/selected node's neighbours, or the search hits; everything else fades. */
  const focusOf = () => {
    const g = graphRef.current;
    const { selected: chosen, matches: ms, view: v, colors: c } = focus.current;
    const center = hovered.current ?? chosen;
    const near = center && g?.hasNode(center) ? neighbourhood(v.edges, center, 1) : null;
    const any = !!near || ms.size > 0;
    return {
      node: (id: string) => {
        const lit = (near?.has(id) ?? false) || ms.has(id);
        return { lit, dim: any && !lit };
      },
      edge: (s: string, t: string) => {
        const on = near ? (s === center || t === center) : ms.has(s) && ms.has(t);
        return { dim: any && !on, color: any && on ? c.focus : c.edge };
      },
    };
  };

  const applyFocus = () => {
    const g = graphRef.current;
    if (!g) return;
    if (!painted.current) {
      pending.current.focus = true;
      return;
    }
    const f = focusOf();
    g.updateEachNodeAttributes((id, a) => ({ ...a, ...f.node(id) }));
    g.updateEachEdgeAttributes((_e, a, s, t) => ({ ...a, ...f.edge(s, t) }));
  };

  const applyPositions = (p: Float32Array) => {
    const g = graphRef.current;
    if (!g) return;
    if (!painted.current) {
      pending.current.xy = p;
      return;
    }
    g.updateEachNodeAttributes((id, a) => {
      const i = index.current.get(id);
      if (i === undefined) return a;
      const pos = { x: p[i * 2]!, y: p[i * 2 + 1]! };
      positions.current.set(id, pos);
      return { ...a, ...pos };
    });
  };

  // One sigma per colour set (theme change): its label colours and fonts are fixed at construction.
  useEffect(() => {
    if (!el) return;
    const graph = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false, allowSelfLoops: false });
    graphRef.current = graph;
    const sigma = new Sigma(graph, el, {
      primitives: {
        nodes: { label: { color: colors.label, font: { family: colors.font, size: 11 } } },
        edges: {
          variables: {
            plainColor: { type: 'color', default: TRANSPARENT },
            dash: { type: 'number', default: 0 },
            gap: { type: 'number', default: 0 },
          },
          layers: [
            layerPlain({ color: { attribute: 'plainColor' } }),
            layerDashed({
              dashSize: { attribute: 'dash', mode: 'pixels' },
              gapSize: { attribute: 'gap', mode: 'pixels' },
              cap: 'round',
            }),
          ],
        },
      },
      styles: {
        nodes: {
          x: { attribute: 'x' },
          y: { attribute: 'y' },
          size: { whenState: 'isHovered', then: (a: NodeAttrs) => a.size + 2, else: { attribute: 'size' } },
          color: { attribute: 'color' },
          opacity: (a: NodeAttrs) => (a.dim ? 0.18 : 1),
          label: { attribute: 'label' },
          labelColor: colors.label,
          labelVisibility: (a: NodeAttrs, s) =>
            s.isHovered || a.lit ? 'visible' : a.dim ? 'hidden' : 'auto',
          backdropVisibility: { whenState: 'isHovered', then: 'visible', else: 'hidden' },
          backdropColor: colors.surface,
          backdropShadowColor: TRANSPARENT,
          backdropShadowBlur: 0,
          backdropPadding: 4,
          cursor: 'pointer',
        },
        edges: {
          size: { attribute: 'size' },
          color: { attribute: 'color' },
          opacity: (a: EdgeAttrs) => (a.dim ? 0.12 : 1),
          plainColor: (a: EdgeAttrs) => (a.line === 'solid' ? a.color : TRANSPARENT),
          dash: (a: EdgeAttrs) => DASH[a.line][0],
          gap: (a: EdgeAttrs) => DASH[a.line][1],
          head: 'none',
        },
      },
      settings: {
        renderEdgeLabels: false,
        hideEdgesOnMove: false,
        labelDensity: 0.6,
        labelRenderedSizeThreshold: 4,
        zoomDuration: saver ? 0 : 200,
        inertiaDuration: saver ? 0 : 200,
        doubleClickZoomingDuration: saver ? 0 : 200,
        minCameraRatio: 0.05,
        maxCameraRatio: 10,
        // Clears the legend and the card over the canvas.
        stagePadding: 48,
        // Node sizes are px on screen (not graph units), so a graph of 6 or 2,000 notes looks the same.
        itemSizesReference: 'screen',
        // The wheel zooms inside the panel; it's the only thing the wheel can do there.
        gestureTarget: 'graph',
      },
    });
    sigmaRef.current = sigma;
    sigma.on('afterRender', () => {
      if (painted.current) return;
      painted.current = true;
      const { xy, focus: f } = pending.current;
      pending.current = { xy: null, focus: false };
      if (xy) applyPositions(xy);
      if (f) applyFocus();
    });
    sigma.on('enterNode', ({ node }) => {
      hovered.current = node;
      applyFocus();
    });
    sigma.on('leaveNode', () => {
      hovered.current = null;
      applyFocus();
    });
    sigma.on('clickNode', ({ node }) => cb.current.onSelect(node));
    sigma.on('doubleClickNode', (e) => {
      e.preventSigmaDefault?.();
      const n = nodesById.current.get(e.node);
      if (n) cb.current.onOpen(n);
    });
    sigma.on('clickStage', () => cb.current.onSelect(null));
    return () => {
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // `saver` only tunes camera animation; a new sigma for it isn't worth losing the picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, colors]);

  // Data → graph, then one layout run. Known nodes keep their place; new ones start next to a neighbour.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    nodesById.current = new Map(view.nodes.map((n) => [n.id, n]));
    const sizes = nodeSizes(view);
    const ids = view.nodes.map((n) => n.id);
    const idx = new Map(ids.map((id, i) => [id, i]));
    index.current = idx;
    const pairs: [number, number][] = [];
    const weights: number[] = [];
    for (const e of view.edges) {
      const a = idx.get(e.source);
      const b = idx.get(e.target);
      if (a === undefined || b === undefined || a === b) continue;
      pairs.push([a, b]);
      weights.push(Math.max(0.1, e.strength));
    }
    const xy = seedPositions(ids, pairs, positions.current);
    painted.current = false;
    pending.current = { xy: null, focus: false };
    const f = focusOf();
    g.clear();
    view.nodes.forEach((n, i) =>
      g.addNode(n.id, {
        x: xy[i * 2]!,
        y: xy[i * 2 + 1]!,
        size: sizes.get(n.id) ?? 4,
        label: n.label,
        color: kindColor(colors, n.kind),
        ...f.node(n.id),
      }),
    );
    for (const e of view.edges)
      if (
        g.hasNode(e.source) &&
        g.hasNode(e.target) &&
        e.source !== e.target &&
        !g.hasEdge(e.source, e.target)
      )
        g.addEdgeWithKey(e.id, e.source, e.target, {
          size: e.kind === 'suggested' ? 1 : e.strength >= 1 ? 1.5 : 1,
          line: lineStyle(e.kind),
          ...f.edge(e.source, e.target),
        });
    if (!ids.length) return;
    let run: LayoutRun | null = runLayout(
      { xy, edges: Uint32Array.from(pairs.flat()), weights: Float32Array.from(weights), animate: !saver },
      {
        onTick: applyPositions,
        onDone: (p, info) => {
          run = null;
          applyPositions(p);
          cb.current.onSettled?.({ nodes: ids.length, ...info });
        },
      },
    );
    // A hidden window stops the run; its picture stays as it is.
    const onVisibility = () => {
      if (document.hidden && run) {
        run.stop();
        run = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      run?.stop();
    };
    // applyFocus reads refs and the current view; it doesn't need to restart the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, view, colors, saver]);

  // Focus / search changes only restyle.
  useEffect(applyFocus, [selected, matches]); // eslint-disable-line react-hooks/exhaustive-deps

}
