import { useMemo } from 'react';
import {
  Button,
  EditorSection,
  SuggestionItem,
  SuggestionList,
  SuggestionProposal,
} from '@design-system/react';
import type { GraphNode, GraphSnapshot, GraphStatus } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { patternLabel, suggestionsFor } from '../model/suggestions';
import { useLinkDecisions } from '../model/useLinkDecisions';

export interface LinkSuggestionsProps {
  nodeId: string | undefined;
  snapshot: GraphSnapshot | null;
  status: GraphStatus | null;
  /** The other end was clicked. */
  onOpen: (node: GraphNode) => void;
  /** `side`: a titled section of the note editor's column; `card`: the bare list under the graph card (or nothing). */
  variant: 'side' | 'card';
}

/**
 * Suggested connections of one node (T68) — similar words, AI, or found in text — with Link (becomes solid),
 * [[ (link and write `[[name]]` at the end of this note) and Not related (never suggested again). Rule proposals
 * ("`DB-<n>` always links?") sit on top.
 */
export default function LinkSuggestions({ nodeId, snapshot, status, onOpen, variant }: LinkSuggestionsProps) {
  const t = useT();
  const d = useLinkDecisions();
  const list = useMemo(() => suggestionsFor(t, snapshot, nodeId), [t, snapshot, nodeId]);
  const me = nodeId ? snapshot?.nodes.find((n) => n.id === nodeId) : undefined;
  const proposals = status?.links?.proposals ?? [];

  const rows = [
    ...proposals.map((p) => (
      <SuggestionProposal
        key={`p:${p.key}`}
        actions={
          <>
            <Button onClick={() => void d.makeRule(p.pattern)}>{t('links.makeRule')}</Button>
            <Button variant="ghost" onClick={() => void d.dismiss(p.key)}>
              {t('links.notNow')}
            </Button>
          </>
        }
      >
        {t('links.proposal', { pattern: patternLabel(p.pattern), n: String(p.accepts) })}
      </SuggestionProposal>
    )),
    ...(d.insertFailed
      ? [
          <SuggestionProposal key="failed" tone="warn" actions={null}>
            {t('links.insertFailed')}
          </SuggestionProposal>,
        ]
      : []),
    ...list.map((s) => (
      <SuggestionItem
        key={s.edge.id}
        line={s.line}
        label={s.other.label}
        why={s.why}
        title={s.other.path ?? s.other.label}
        {...(s.other.kind === 'note' ? { onOpen: () => onOpen(s.other) } : {})}
        actions={
          <>
            <Button
              variant="ghost"
              icon
              title={t('links.acceptHint')}
              aria-label={t('links.accept')}
              onClick={() => me && void d.accept(s, me, false)}
            >
              ✓
            </Button>
            {s.linkName && me?.path && (
              <Button
                variant="ghost"
                icon
                title={t('links.insertHint', { name: s.linkName })}
                aria-label={t('links.insert')}
                onClick={() => void d.accept(s, me, true)}
              >
                [[
              </Button>
            )}
            <Button
              variant="ghost"
              icon
              title={t('links.rejectHint')}
              aria-label={t('links.reject')}
              onClick={() => void d.reject(s)}
            >
              ×
            </Button>
          </>
        }
      />
    )),
  ];

  if (variant === 'card')
    return rows.length ? <SuggestionList label={t('links.section')}>{rows}</SuggestionList> : null;
  return (
    <EditorSection title={t('links.section')} empty={t('links.none')}>
      {rows.length ? <SuggestionList label={t('links.section')}>{rows}</SuggestionList> : undefined}
    </EditorSection>
  );
}
