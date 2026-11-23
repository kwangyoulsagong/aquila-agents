import type { GraphNode, GraphSnapshot } from '@/shared/api';

/** `@path`, quoted when it has spaces (how Claude reads a path with spaces). */
export const atPath = (p: string) => (/\s/.test(p) ? `@"${p}"` : `@${p}`);

/** "Handle with Claude" (T70): the intro line, a blank line, then the note as `@path`. */
export const handlePrompt = (intro: string, notePath: string) => `${intro}\n\n${atPath(notePath)}`;

/**
 * The note a node is handled through: a note itself, or for a to-do (and other AI nodes) the note it came from —
 * the strongest note neighbour. null when there is none.
 */
export function handleTarget(
  snap: GraphSnapshot | null,
  node: GraphNode,
): { notePath: string; todo?: string } | null {
  if (node.kind === 'note') return node.path ? { notePath: node.path } : null;
  if (node.kind !== 'todo' || !snap) return null;
  const byId = new Map(snap.nodes.map((n) => [n.id, n]));
  let best: { path: string; strength: number } | null = null;
  for (const e of snap.edges) {
    const other = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
    const n = other ? byId.get(other) : undefined;
    if (n?.kind === 'note' && n.path && (!best || e.strength > best.strength))
      best = { path: n.path, strength: e.strength };
  }
  return best ? { notePath: best.path, todo: node.label } : null;
}
