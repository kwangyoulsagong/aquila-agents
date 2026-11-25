import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  GraphFoot,
  GraphHint,
  GraphLegend,
  GraphLens,
  GraphResult,
  GraphResults,
  GraphStage,
  GraphTrail,
  Input,
  Range,
  ResizeHandle,
  Segment,
  Select,
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
  searchMatches,
  tagsOf,
  type GraphFilter,
  type TimeWindow,
} from '../model/view';
import { COLUMN_STEP, defaultCenter, focusLayout, type FocusColumnKey } from '../model/focus';
import { LENSES, lensHits, type LensId } from '../model/lenses';
import { useGraphRenderer } from './useGraphRenderer';
import { FocusView, nodeLabel, swatchOf } from './FocusView';

export interface KnowledgeGraphPanelProps {
  full: boolean;
  /** The note open in the editor: the focus view starts there and follows it (unless unpinned). */
  activeNotePath?: string | null;
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

type Mode = 'focus' | 'map';
const HINT_KEY = 'aquila.graph.hintSeen.v2';
const MODE_KEY = 'aquila.graph.mode';
const FOLLOW_KEY = 'aquila.graph.follow';
/** Centres remembered for Back. */
const TRAIL_MAX = 30;
/** Crumbs shown (the rest is still reachable with Back). */
const CRUMBS = 4;
const RESULTS = 8;

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered: the default comes back next time
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

/**
 * Right panel (⌘⇧N) and full window: every note source as one graph (T66), shown two ways (T72).
 * - **Around** (default): the note open in the editor — or the latest one — in the middle, what it links to in
 *   columns (knowledge left, work right). Click to move there, Back to return, ⌘-click / double-click to open.
 * - **Map**: the whole graph (WebGL), with question lenses (to-dos, unlinked notes, recent sessions, notes the
 *   work moved past). Clicking a node goes to it in Around.
 * Search lists matches to jump to; filters (source, kind, tag, time, strength) apply to both.
 */
export default function KnowledgeGraphPanel({
  full,
  activeNotePath,
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [searching, setSearching] = useState(false);
  const [resultAt, setResultAt] = useState(0);
  const [mode, setModeState] = useState<Mode>(() => (stored(MODE_KEY) === 'map' ? 'map' : 'focus'));
  const [follow, setFollowState] = useState(() => stored(FOLLOW_KEY) !== '0');
  const [trail, setTrail] = useState<string[]>([]);
  const [shown, setShown] = useState<Partial<Record<FocusColumnKey, number>>>({});
  const [lens, setLens] = useState<LensId | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [colors, setColors] = useState(readColors);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => onThemeChange(() => setColors(readColors())), []);
  const [hint, setHint] = useState(() => stored(HINT_KEY) !== '1');
  const hideHint = () => {
    setHint(false);
    store(HINT_KEY, '1');
  };
  const setMode = (m: Mode) => {
    setModeState(m);
    store(MODE_KEY, m);
  };
  const setFollow = (on: boolean) => {
    setFollowState(on);
    store(FOLLOW_KEY, on ? '1' : '0');
  };

  const view = useMemo(
    () => (snapshot ? filterSnapshot(snapshot, filter) : { nodes: [], edges: [] }),
    [snapshot, filter],
  );
  const byId = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view.nodes]);
  const allNodes = snapshot?.nodes;
  const tags = useMemo(() => tagsOf(allNodes ?? []), [allNodes]);
  const kinds = useMemo(() => kindsOf(allNodes ?? []), [allNodes]);
  const lenses = useMemo(() => lensHits(view), [view]);

  // The centre: the end of the trail. Moving pushes; Back pops.
  const center = trail[trail.length - 1] ?? null;
  const recentre = (id: string) => {
    setTrail((tr) => (tr[tr.length - 1] === id ? tr : [...tr.slice(-(TRAIL_MAX - 1)), id]));
    setShown({});
    setSuggestOpen(false);
    setMode('focus');
  };
  const back = () => {
    if (trail.length > 1) {
      setTrail((tr) => tr.slice(0, -1));
      setShown({});
    } else setMode('map');
  };
  const activeId = useMemo(() => {
    if (!activeNotePath || !snapshot) return null;
    return snapshot.nodes.find((n) => n.kind === 'note' && n.path === activeNotePath)?.id ?? null;
  }, [activeNotePath, snapshot]);
  // Start at the open note (or the latest one); follow the editor while pinned to it.
  useEffect(() => {
    if (!snapshot) return;
    if (follow && activeId && activeId !== center) {
      recentreQuietly(activeId);
      return;
    }
    if (!center) {
      const first = activeId ?? defaultCenter(view);
      if (first) recentreQuietly(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, follow, snapshot, center === null]);
  /** Like `recentre`, without switching the mode (opening on the map stays on the map). */
  const recentreQuietly = (id: string) => {
    setTrail((tr) => (tr[tr.length - 1] === id ? tr : [...tr.slice(-(TRAIL_MAX - 1)), id]));
    setShown({});
  };
  // A centre the index dropped (file deleted) leaves the trail.
  useEffect(() => {
    if (!snapshot || !center) return;
    if (!snapshot.nodes.some((n) => n.id === center)) setTrail((tr) => tr.filter((id) => id !== center));
  }, [snapshot, center]);

  const layout = useMemo(
    () => (center && mode === 'focus' ? focusLayout(view, center, { shown }) : null),
    [view, center, shown, mode],
  );
  const centerNode = center ? (byId.get(center) ?? snapshot?.nodes.find((n) => n.id === center)) : undefined;

  const matches = useMemo(() => searchMatches(view.nodes, deferredQuery), [view.nodes, deferredQuery]);
  const results = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return [...matches]
      .map((id) => byId.get(id)!)
      .sort(
        (a, b) =>
          Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)) ||
          Number(b.kind === 'note') - Number(a.kind === 'note') ||
          (b.mtime ?? 0) - (a.mtime ?? 0) ||
          a.label.localeCompare(b.label),
      )
      .slice(0, RESULTS);
  }, [matches, byId, deferredQuery]);
  useEffect(() => setResultAt(0), [deferredQuery]);

  const open = (n: GraphNode) => {
    if (n.kind === 'note' && n.path) onOpenNote(n.path);
    else if (n.kind === 'session') resume(n);
    else if (n.kind === 'trend' && n.url) void api.noteOpenUrl(n.url);
    else recentre(n.id);
  };
  const resume = (n: GraphNode) => {
    const ref = sessionRef(n);
    if (ref)
      api
        .historyResume(ref, !n.projects?.length)
        .then(onResumed)
        .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };
  const handle = centerNode ? handleTarget(snapshot, centerNode) : null;
  const mapMatches = lens ? lenses[lens] : matches;
  const renderer = useGraphRenderer(mode === 'map' ? host : null, {
    view,
    colors,
    selected: null,
    matches: mapMatches,
    saver,
    onSelect: (id) => id && recentre(id),
    onOpen: open,
    onSettled: (info) => {
      // Read by the smoke / perf runs.
      (window as unknown as { __graphSettled?: unknown }).__graphSettled = info;
    },
  });

  const notes = view.nodes.filter((n) => n.kind === 'note').length;
  const sources = status?.sources ?? [];
  const enabled = sources.filter((s) => s.enabled);
  const indexing = enabled.some((s) => s.state === 'indexing');
  const set = (patch: Partial<GraphFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const activeFilters =
    filter.sources.length +
    filter.hiddenKinds.length +
    (filter.tag ? 1 : 0) +
    (filter.time !== 'any' ? 1 : 0) +
    (filter.minStrength > 0 ? 1 : 0);
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
  else if (mode === 'focus' && center && !layout) empty = { title: t('graph.focus.hidden'), action: 'reset' };

  const crumbs = trail
    .slice(-CRUMBS)
    .map((id) => ({ id, label: nodeLabel(byId.get(id) ?? { id, kind: 'note', label: id }) }));
  const showResults = searching && deferredQuery.trim().length > 0 && results.length > 0;

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
          {mode === 'map' && !empty && (
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
        <Segment
          label={t('graph.mode.label')}
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: 'focus', label: t('graph.mode.focus') },
            { value: 'map', label: t('graph.mode.map') },
          ]}
        />
        <Input
          type="search"
          value={query}
          placeholder={t('graph.search')}
          aria-label={t('graph.search')}
          aria-expanded={showResults}
          onFocus={() => setSearching(true)}
          onBlur={() => setSearching(false)}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setSearching(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && results.length) {
              e.preventDefault();
              setResultAt((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp' && results.length) {
              e.preventDefault();
              setResultAt((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && results.length) {
              recentre(results[Math.min(resultAt, results.length - 1)]!.id);
              setQuery('');
              setSearching(false);
            } else if (e.key === 'Escape') {
              setQuery('');
              setSearching(false);
            }
          }}
        />
        <Button
          variant="ghost"
          aria-pressed={filtersOpen}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          {activeFilters ? t('graph.filtersN', { n: String(activeFilters) }) : t('graph.filters')}
        </Button>
      </div>
      {filtersOpen && (
        <div className="c-panel__bar">
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
          {activeFilters > 0 && (
            <Button variant="ghost" onClick={() => setFilter(DEFAULT_FILTER)}>
              {t('graph.resetFilters')}
            </Button>
          )}
        </div>
      )}
      {!empty && mode === 'focus' && crumbs.length > 0 && (
        <div className="c-panel__bar">
          <GraphTrail
            back={
              <Button
                variant="ghost"
                icon
                onClick={back}
                title={t('graph.back')}
                aria-label={t('graph.back')}
              >
                ←
              </Button>
            }
            items={crumbs}
            onPick={(id) => {
              setTrail((tr) => tr.slice(0, tr.lastIndexOf(id) + 1));
              setShown({});
            }}
          />
          <Button
            variant="ghost"
            aria-pressed={follow}
            onClick={() => setFollow(!follow)}
            title={t('graph.follow.hint')}
          >
            {t('graph.follow')}
          </Button>
        </div>
      )}
      {!empty && mode === 'map' && (
        <div className="c-panel__bar" role="group" aria-label={t('graph.lens.label')}>
          {LENSES.map((id) => (
            <GraphLens
              key={id}
              pressed={lens === id}
              count={lenses[id].size}
              {...(id === 'untouched' ? { title: t('graph.lens.untouched.hint') } : {})}
              onClick={() => setLens((l) => (l === id ? null : id))}
            >
              {t(`graph.lens.${id}`)}
            </GraphLens>
          ))}
        </div>
      )}
      <GraphStage canvasRef={setHost}>
        {showResults && (
          <GraphResults label={t('graph.results')}>
            {results.map((n, i) => (
              <GraphResult
                key={n.id}
                kind={swatchOf(n.kind)}
                label={nodeLabel(n)}
                {...(notePlace(n, sources) ? { detail: notePlace(n, sources)! } : {})}
                selected={i === resultAt}
                onPick={() => {
                  recentre(n.id);
                  setQuery('');
                  setSearching(false);
                }}
              />
            ))}
          </GraphResults>
        )}
        {!empty && mode === 'focus' && layout && (
          <FocusView
            layout={layout}
            onRecentre={recentre}
            onOpen={open}
            onBack={back}
            onMore={(col) => {
              const step = COLUMN_STEP[col.endsWith('1') ? 1 : 2];
              setShown((s) => ({ ...s, [col]: (s[col] ?? step) + step }));
            }}
            onShown={(info) => {
              (window as unknown as { __graphSettled?: unknown }).__graphSettled = {
                nodes: info.nodes,
                iterations: 0,
                ms: info.ms,
                via: 'focus',
              };
            }}
          />
        )}
        {hint && !empty && !showResults && (
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
                    if (mode === 'focus' && center && !layout) setTrail([]);
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
          mode === 'map' && (
            <GraphLegend
              swatches={swatches}
              lines={[
                { line: 'solid', label: t('graph.line.explicit') },
                { line: 'dashed', label: t('graph.line.mention') },
                { line: 'dotted', label: t('graph.line.suggested') },
              ]}
            />
          )
        )}
      </GraphStage>
      {!empty && mode === 'focus' && centerNode && (
        <GraphFoot
          kind={swatchOf(centerNode.kind)}
          title={centerNode.label}
          {...(notePlace(centerNode, sources) ? { detail: notePlace(centerNode, sources)! } : {})}
          open={suggestOpen}
          actions={
            <>
              {centerNode.kind === 'note' && centerNode.path && (
                <Button variant="ghost" onClick={() => open(centerNode)} title={t('graph.openHint')}>
                  {t('graph.open')}
                </Button>
              )}
              {handle && (
                <HandleWithClaude notePath={handle.notePath} todo={handle.todo} onClaude={onClaude} />
              )}
              {centerNode.kind === 'session' && sessionRef(centerNode) && (
                <Button variant="ghost" onClick={() => resume(centerNode)}>
                  {t('graph.resume')}
                </Button>
              )}
              {centerNode.kind === 'trend' && centerNode.url && (
                <Button variant="ghost" onClick={() => void api.noteOpenUrl(centerNode.url!)}>
                  {t('graph.openLink')}
                </Button>
              )}
              <Button variant="ghost" aria-expanded={suggestOpen} onClick={() => setSuggestOpen((o) => !o)}>
                {t('graph.suggest')} {suggestOpen ? '▴' : '▾'}
              </Button>
            </>
          }
        >
          <LinkSuggestions
            variant="card"
            nodeId={centerNode.id}
            snapshot={snapshot}
            status={status}
            onOpen={(n) => recentre(n.id)}
          />
        </GraphFoot>
      )}
    </aside>
  );
}
