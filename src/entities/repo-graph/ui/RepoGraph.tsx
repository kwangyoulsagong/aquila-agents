import { useMemo } from 'react';
import { Graph, type GraphEdgeLine, type GraphNodeBox } from '@design-system/react';
import type { ApplyProposal, NodeChangeKind, RepoSkeleton } from '@/shared/api';
import { useT } from '@/shared/i18n';
import {
  edgePath,
  fit,
  graphNodes,
  layoutGraph,
  marksOf,
  NODE_H,
  NODE_W,
  visibleEdges,
  visibleIn,
  type GraphMode,
} from '../model/graph';

interface Props {
  skeleton: RepoSkeleton;
  proposal: ApplyProposal | null;
  mode: GraphMode;
  /** A hovered step's nodes: the rest fade. */
  highlight?: string[];
}

const MARK_KEY = {
  add: 'repoGraph.mark.add',
  change: 'repoGraph.mark.change',
  unfit: 'repoGraph.mark.unfit',
} as const satisfies Record<NodeChangeKind, string>;

/**
 * The repo skeleton as an SVG graph (T64): harness column, code columns, folder-level imports. Now / After share one
 * layout; After marks what the proposal adds, changes or finds unfit, with the reason on hover.
 */
export default function RepoGraph({ skeleton, proposal, mode, highlight }: Props) {
  const t = useT();
  const layout = useMemo(() => layoutGraph(graphNodes(skeleton, proposal)), [skeleton, proposal]);
  const marks = useMemo(() => marksOf(proposal), [proposal]);
  const why = useMemo(() => new Map((proposal?.changes ?? []).map((c) => [c.node, c.why])), [proposal]);
  const lit = highlight?.length ? new Set(highlight) : null;

  const shown = layout.nodes.filter((p) => visibleIn(mode, p.node));
  const ids = new Set(shown.map((p) => p.node.id));
  const at = new Map(layout.nodes.map((p) => [p.node.id, p]));

  const nodes: GraphNodeBox[] = shown.map(({ node, x, y }) => {
    const mark = mode === 'after' ? marks.get(node.id) : undefined;
    return {
      id: node.id,
      x,
      y,
      width: NODE_W,
      height: NODE_H,
      label: fit(node.label),
      detail: node.detail ? fit(node.detail, 24) : mark === 'add' ? t('repoGraph.new') : undefined,
      mark,
      markLabel: mark ? t(MARK_KEY[mark]) : undefined,
      title: mark ? why.get(node.id) : node.path,
      dim: !!lit && !lit.has(node.id),
      highlight: !!lit?.has(node.id),
    };
  });
  const edges: GraphEdgeLine[] = visibleEdges(skeleton.edges, ids).map((e) => ({
    id: `${e.from}>${e.to}`,
    d: edgePath(at.get(e.from)!, at.get(e.to)!),
    dim: !!lit && !(lit.has(e.from) && lit.has(e.to)),
  }));

  return (
    <Graph
      width={layout.width}
      height={layout.height}
      label={t(mode === 'now' ? 'repoGraph.labelNow' : 'repoGraph.labelAfter')}
      nodes={nodes}
      edges={edges}
      columns={layout.columns.map((c) => ({ x: c.x, y: 20, label: t(`repoGraph.column.${c.column}`) }))}
    />
  );
}
