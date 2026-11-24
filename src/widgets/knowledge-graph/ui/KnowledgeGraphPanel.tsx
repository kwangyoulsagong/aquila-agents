import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  GraphCard,
  GraphHint,
  GraphLegend,
  GraphStage,
  Input,
  Range,
  ResizeHandle,
  Segment,
  Select,
  type GraphSwatch,
} from '@design-system/react';
import {
  api,
  type GraphNode,
  type GraphNodeKind,
  type GraphSourceStatus,
  type HistoryResumeResult,
} from '@/shared/api';
import { useT } from '@/shared/i18n';
import { usePanelWidth } from '@/shared/lib/usePanelWidth';
import { usePowerSaver } from '@/shared/lib/usePowerSaver';
import { onThemeChange } from '@/shared/lib/theme';

import { readColors } from '../model/colors';
import { sourceName, useGraphData } from '@/entities/note';
import { LinkSuggestions } from '@/features/link-suggestions';
import { HandleWithClaude, handleTarget } from '@/features/edit-note';
import {
  DEFAULT_FILTER,
  TIME_WINDOWS,
  filterSnapshot,
  kindsOf,
  localView,
  searchMatches,
  tagsOf,
  type GraphFilter,
  type TimeWindow,
} from '../model/view';
import { useGraphRenderer } from './useGraphRenderer';

export interface KnowledgeGraphPanelProps {
  full: boolean;
  onToggleFull: () => void;
  onClose: () => void;
  /** Opens Settings ▸ Note sources (empty state). */
  onSources: () => void;
  /** Opens a note in the editor (T67). */
  onOpenNote: (path: string) => void;
  /** T70: "Handle with Claude" on a note / to-do: a Claude tab with the note pasted (the page's). */
  onClaude: (prompt: string, projectId: string | undefined) => void;
  /** T70: a session node resumed in a new tab. */
  onResumed: (r: HistoryResumeResult) => void;
  onError: (message: string) => void;
}

const HINT_KEY = 'aquila.graph.hintSeen';
const hintSeen = (): boolean => {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
};

/** `session:<agent>:<id>` → the history ref it was made from. */
function sessionRef(n: GraphNode): { agent: 'claude' | 'codex'; id: string } | null {
  const m = /^session:(claude|codex):(.+)$/.exec(n.id);
  return m ? { agent: m[1] as 'claude' | 'codex', id: m[2]! } : null;
}

/** `Meetings/2026-11-20 sync.md` for a note (source folder + path inside it); the path for anything else. */
function notePlace(n: GraphNode, sources: readonly GraphSourceStatus[]): string | undefined {
  const m = /^note:([^:]+):(.+)$/.exec(n.id);
  const src = m && sources.find((s) => s.id === m[1]);
  return src && m ? `${sourceName(src.path)}/${m[2]}` : (n.path ?? n.url);
}

const swatchOf = (kind: GraphNodeKind): GraphSwatch =>
  kind === 'note' || kind === 'tag' || kind === 'missing'
    ? kind
    : kind === 'code' || kind === 'file'
      ? 'code'
      : 'other';

/**
 * Right panel (⌘⇧N) and full window: every note source as one WebGL graph (T66). Filters by source, kind, tag, time
 * and link strength; search lights matches; a click selects a note, "Around this note" shows its depth-1/2
 * neighbours; Open (or double-click) opens the note in the editor (T67).
 */
export default function KnowledgeGraphPanel({
  full,
  onToggleFull,
  onClose,
  onSources,
  onOpenNote,
  onClaude,
  onResumed,
  onError,
}: KnowledgeGraphPanelProps) {
  const t = useT();
  const width = usePanelWidth('aquila.panel.graph');
  const saver = usePowerSaver();
  const { status, snapshot } = useGraphData();
  const [filter, setFilter] = useState<GraphFilter>(DEFAULT_FILTER);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  const [depth, setDepth] = useState<'1' | '2'>('2');
  const [colors, setColors] = useState(readColors);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => onThemeChange(() => setColors(readColors())), []);
  const [hint, setHint] = useState(() => !hintSeen());
  const hideHint = () => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // not remembered: the hint shows again next time
    }
  };

  const filtered = useMemo(
    () => (snapshot ? filterSnapshot(snapshot, filter) : { nodes: [], edges: [] }),
    [snapshot, filter],
  );
  const view = useMemo(
    () => (local ? localView(filtered, selected, Number(depth)) : filtered),
    [filtered, local, selected, depth],
  );
  const matches = useMemo(() => searchMatches(view.nodes, deferredQuery), [view.nodes, deferredQuery]);
  const allNodes = snapshot?.nodes;
  const tags = useMemo(() => tagsOf(allNodes ?? []), [allNodes]);
  const kinds = useMemo(() => kindsOf(allNodes ?? []), [allNodes]);
  const selectedNode = selected ? snapshot?.nodes.find((n) => n.id === selected) : undefined;
  // A selection the index dropped (file deleted) clears itself.
  useEffect(() => {
    if (selected && snapshot && !selectedNode) setSelected(null);
  }, [selected, snapshot, selectedNode]);

  const open = (n: GraphNode) => {
    if (n.kind === 'note' && n.path) onOpenNote(n.path);
  };
  const resume = (n: GraphNode) => {
    const ref = sessionRef(n);
    if (ref)
      api
        .historyResume(ref, !n.projects?.length)
        .then(onResumed)
        .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };
  const handle = selectedNode ? handleTarget(snapshot, selectedNode) : null;
  const renderer = useGraphRenderer(host, {
    view,
    colors,
    selected,
    matches,
    saver,
    onSelect: setSelected,
    onOpen: open,
    onSettled: (info) => {
      // Read by the smoke / perf runs.
      (window as unknown as { __graphSettled?: unknown }).__graphSettled = info;
    },
  });

  const notes = view.nodes.filter((n) => n.kind === 'note').length;
  const links = selected
    ? view.edges.filter((e) => e.source === selected || e.target === selected).length
    : 0;
  const sources = status?.sources ?? [];
  const enabled = sources.filter((s) => s.enabled);
  const indexing = enabled.some((s) => s.state === 'indexing');
  const set = (patch: Partial<GraphFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const toggleKind = (k: GraphNodeKind) =>
    set({
      hiddenKinds: filter.hiddenKinds.includes(k)
        ? filter.hiddenKinds.filter((x) => x !== k)
        : [...filter.hiddenKinds, k],
    });
  const legendKinds = kinds.filter((k) => !filter.hiddenKinds.includes(k));
  // One colour for AI and app nodes: its label names the kinds present ("Sessions · Trends").
  const swatches = [...new Set(legendKinds.map(swatchOf))].map((kind) => ({
    kind,
    label:
      kind === 'other' || kind === 'code'
        ? legendKinds
            .filter((k) => swatchOf(k) === kind)
            .map((k) => t(`graph.kind.${k}`))
            .join(' · ')
        : t(`graph.kind.${kind}`),
  }));

  let empty: { title: string; body?: string; action?: 'sources' | 'reset' } | null = null;
  if (status && !enabled.length)
    empty = { title: t('graph.empty.title'), body: t('graph.empty.body'), action: 'sources' };
  else if (!snapshot || (!snapshot.nodes.length && indexing)) empty = { title: t('graph.empty.indexing') };
  else if (!view.nodes.length) empty = { title: t('graph.empty.filtered'), action: 'reset' };

  return (
    <aside
      className={`c-panel ${full ? 'c-panel--full' : 'c-panel--wide'}`}
      {...(full ? {} : width.props)}
      aria-label={t('graph.title')}
    >
      {!full && (
        <ResizeHandle onChange={width.onChange} onReset={width.onReset} label={t('action.resizePanel')} />
      )}
      <div className="c-panel__head">
        <span>{t('graph.title')}</span>
        {snapshot && (
          <span className="c-row__meta" data-fixed>
            {t('graph.count', { notes: String(notes), edges: String(view.edges.length) })}
          </span>
        )}
        <div className="c-panel__actions">
          {enabled.length > 0 && (
            <Button
              variant="ghost"
              onClick={() =>
                void api
                  .graphDailyNote(filter.sources[0] ?? null)
                  .then((p) => (p ? onOpenNote(p) : onError(t('graph.daily.failed'))))
                  .catch(() => onError(t('graph.daily.failed')))
              }
              title={t('graph.daily.hint')}
            >
              {t('graph.daily')}
            </Button>
          )}
          {!empty && (
            <Button
              variant="ghost"
              icon
              onClick={renderer.fit}
              title={t('graph.fit')}
              aria-label={t('graph.fit')}
            >
              ⊡
            </Button>
          )}
          {!hint && !empty && (
            <Button
              variant="ghost"
              icon
              onClick={() => setHint(true)}
              title={t('graph.hint.show')}
              aria-label={t('graph.hint.show')}
            >
              ?
            </Button>
          )}
          <Button
            variant="ghost"
            icon
            aria-pressed={full}
            onClick={onToggleFull}
            title={full ? t('graph.full.exit') : t('graph.full.enter')}
            aria-label={full ? t('graph.full.exit') : t('graph.full.enter')}
          >
            ⤢
          </Button>
          <Button
            variant="ghost"
            icon
            onClick={onClose}
            title={t('action.close')}
            aria-label={t('action.close')}
          >
            ×
          </Button>
        </div>
      </div>
      <div className="c-panel__bar">
        <Input
          type="search"
          value={query}
          placeholder={t('graph.search')}
          aria-label={t('graph.search')}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.size) setSelected([...matches][0]!);
            if (e.key === 'Escape') setQuery('');
          }}
        />
        {sources.length > 1 && (
          <Select
            aria-label={t('graph.source.all')}
            value={filter.sources[0] ?? ''}
            onChange={(v) => set({ sources: v ? [v] : [] })}
            options={[
              { value: '', label: t('graph.source.all') },
              ...enabled.map((s) => ({ value: s.id, label: sourceName(s.path) })),
            ]}
          />
        )}
        {tags.length > 0 && (
          <Select
            aria-label={t('graph.tag.all')}
            value={filter.tag}
            onChange={(v) => set({ tag: v })}
            options={[
              { value: '', label: t('graph.tag.all') },
              ...tags.map((x) => ({ value: x, label: `#${x}` })),
            ]}
          />
        )}
        <Select
          aria-label={t('graph.time.any')}
          value={filter.time}
          onChange={(v) => set({ time: v as TimeWindow })}
          options={TIME_WINDOWS.map((w) => ({ value: w, label: t(`graph.time.${w}`) }))}
        />
      </div>
      <div className="c-panel__bar">
        {kinds.map((k) => (
          <Button
            key={k}
            variant="ghost"
            aria-pressed={!filter.hiddenKinds.includes(k)}
            onClick={() => toggleKind(k)}
          >
            {t(`graph.kind.${k}`)}
          </Button>
        ))}
        <Range
          label={t('graph.strength', { n: String(Math.round(filter.minStrength * 100)) })}
          value={Math.round(filter.minStrength * 100)}
          step={10}
          onChange={(v) => set({ minStrength: v / 100 })}
        />
        {selected && (
          <Segment
            label={t('graph.scope')}
            value={local ? 'local' : 'whole'}
            onChange={(v) => setLocal(v === 'local')}
            options={[
              { value: 'whole', label: t('graph.whole') },
              { value: 'local', label: t('graph.local') },
            ]}
          />
        )}
        {selected && local && (
          <Segment
            label={t('graph.depth')}
            value={depth}
            onChange={setDepth}
            options={[
              { value: '1', label: t('graph.depthN', { n: '1' }) },
              { value: '2', label: t('graph.depthN', { n: '2' }) },
            ]}
          />
        )}
      </div>
      <GraphStage canvasRef={setHost}>
        {selectedNode && (
          <GraphCard
            kind={swatchOf(selectedNode.kind)}
            title={selectedNode.label}
            detail={[t('graph.links', { n: String(links) }), notePlace(selectedNode, sources)]
              .filter(Boolean)
              .join(' · ')}
            actions={
              <>
                {selectedNode.kind === 'note' && selectedNode.path && (
                  <Button variant="ghost" onClick={() => open(selectedNode)} title={t('graph.openHint')}>
                    {t('graph.open')}
                  </Button>
                )}
                {handle && (
                  <HandleWithClaude notePath={handle.notePath} todo={handle.todo} onClaude={onClaude} />
                )}
                {selectedNode.kind === 'session' && sessionRef(selectedNode) && (
                  <Button variant="ghost" onClick={() => resume(selectedNode)}>
                    {t('graph.resume')}
                  </Button>
                )}
                {selectedNode.kind === 'trend' && selectedNode.url && (
                  <Button variant="ghost" onClick={() => void api.noteOpenUrl(selectedNode.url!)}>
                    {t('graph.openLink')}
                  </Button>
                )}
              </>
            }
            close={
              <Button
                variant="ghost"
                icon
                onClick={() => {
                  setSelected(null);
                  setLocal(false);
                }}
                title={t('graph.clear')}
                aria-label={t('graph.clear')}
              >
                ×
              </Button>
            }
          >
            <LinkSuggestions
              variant="card"
              nodeId={selectedNode.id}
              snapshot={snapshot}
              status={status}
              onOpen={(n) => setSelected(n.id)}
            />
          </GraphCard>
        )}
        {!selectedNode && hint && !empty && (
          <GraphHint
            close={
              <Button
                variant="ghost"
                icon
                onClick={hideHint}
                title={t('graph.hint.hide')}
                aria-label={t('graph.hint.hide')}
              >
                ×
              </Button>
            }
          >
            {t('graph.hint')}
          </GraphHint>
        )}
        {empty ? (
          <EmptyState
            title={empty.title}
            actions={
              empty.action === 'sources' ? (
                <Button onClick={onSources}>{t('sources.menu')}</Button>
              ) : empty.action === 'reset' ? (
                <Button
                  onClick={() => {
                    setFilter(DEFAULT_FILTER);
                    setLocal(false);
                  }}
                >
                  {t('graph.resetFilters')}
                </Button>
              ) : undefined
            }
          >
            {empty.body}
          </EmptyState>
        ) : (
          <GraphLegend
            swatches={swatches}
            lines={[
              { line: 'solid', label: t('graph.line.explicit') },
              { line: 'dashed', label: t('graph.line.mention') },
              { line: 'dotted', label: t('graph.line.suggested') },
            ]}
          />
        )}
      </GraphStage>
    </aside>
  );
}
