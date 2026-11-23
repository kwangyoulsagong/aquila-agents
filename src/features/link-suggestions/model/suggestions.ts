import type { GraphEdge, GraphNode, GraphRulePattern, GraphSnapshot } from '@/shared/api';
import type { Translate } from '@/shared/i18n';

/** A connection of a node nobody wrote down yet: suggested (similar words, AI) or found in text (title, ID, URL). */
export interface Suggestion {
  edge: GraphEdge;
  /** The other end. */
  other: GraphNode;
  line: 'dotted' | 'dashed';
  why: string;
  /** Both ends are notes: Accept can also write `[[linkName]]` into this note. */
  linkName?: string;
}

const MAX = 20;

export const patternLabel = (p: GraphRulePattern) => (p.kind === 'id' ? `${p.prefix}-<n>` : p.host);

const fileName = (p: string) => (p.split(/[/\\]/).pop() ?? p).replace(/\.md$/i, '');

/** Why two nodes are suggested, in words: "Shared words: footer, margins · Same ID DB-31". */
export function whyOf(t: Translate, e: GraphEdge): string {
  const parts = e.reasons.flatMap((r) => {
    switch (r.via) {
      case 'similar':
        return [t('links.why.similar', { terms: r.label ?? '' })];
      case 'ai':
        return [t(`links.why.ai.${r.label === 'person' || r.label === 'decision' || r.label === 'todo' ? r.label : 'note'}`)];
      case 'id':
        return [t('links.why.id', { label: r.label ?? '' })];
      case 'url':
        return [t('links.why.url')];
      case 'title':
        return [t('links.why.title')];
      case 'code':
        return [t('links.why.code', { label: r.label ?? '' })];
      default:
        return [];
    }
  });
  return [...new Set(parts)].join(' · ');
}

/** Suggested and found-in-text connections of `nodeId`, strongest first. Written / app-made ones aren't listed. */
export function suggestionsFor(t: Translate, snap: GraphSnapshot | null, nodeId: string | undefined): Suggestion[] {
  if (!snap || !nodeId) return [];
  const byId = new Map(snap.nodes.map((n) => [n.id, n]));
  const me = byId.get(nodeId);
  if (!me) return [];
  const out: Suggestion[] = [];
  for (const e of snap.edges) {
    if (e.kind !== 'suggested' && e.kind !== 'mention') continue;
    const otherId = e.source === nodeId ? e.target : e.target === nodeId ? e.source : null;
    const other = otherId ? byId.get(otherId) : undefined;
    if (!other) continue;
    out.push({
      edge: e,
      other,
      line: e.kind === 'suggested' ? 'dotted' : 'dashed',
      why: whyOf(t, e),
      ...(me.kind === 'note' && other.kind === 'note' && other.path ? { linkName: fileName(other.path) } : {}),
    });
  }
  return out
    .sort((a, b) => b.edge.strength - a.edge.strength || a.other.label.localeCompare(b.other.label))
    .slice(0, MAX);
}
