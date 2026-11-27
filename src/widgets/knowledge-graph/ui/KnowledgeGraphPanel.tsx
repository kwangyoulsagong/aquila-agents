import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
  type Session,
} from '@/shared/api';
import { useT } from '@/shared/i18n';
import { usePanelWidth } from '@/shared/lib/usePanelWidth';
import { usePowerSaver } from '@/shared/lib/usePowerSaver';
import { onThemeChange } from '@/shared/lib/theme';

import { readColors } from '../model/colors';
import { sourceName, useGraphData } from '@/entities/note';
import { LinkSuggestions } from '@/features/link-suggestions';
import { HandleWithClaude, handleTarget } from '@/features/edit-note';
import { WhatIsThisButton, type BriefSeed } from '@/features/what-is-this';
import {
  DEFAULT_FILTER,
  TIME_WINDOWS,
  filterSnapshot,
  kindsOf,
  projectSources,
  scopeOf,
  searchMatches,
  tagsOf,
  type GraphFilter,
  type TimeWindow,
} from '../model/view';
import { COLUMN_STEP, defaultCenter, focusLayout, type FocusColumnKey } from '../model/focus';
import { LENSES, lensHits, type LensId } from '../model/lenses';
import { useGraphRenderer } from './useGraphRenderer';
import { FocusView, nodeLabel, swatchOf } from './FocusView';
import { useLiveSessions } from './useLiveSessions';
import {
  crumbStops,
  groupLevel,
  groupPath,
  mapView,
  MORE,
  placeInProject,
  TOPIC,
  unionKey,
  unionKeys,
  type GroupRule,
} from '../model/groups';
import { GroupsView, useGroupLabel } from './GroupsView';
import { GroupRulesDialog } from './GroupRulesDialog';
import { WeekView } from './WeekView';
import { tabWork, WEEK_KINDS, weekList, type WeekKind } from '../model/week';

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
  /** Open tabs: their Claude / Codex conversations show as live session nodes (T72). */
  sessions?: readonly Session[];
  /** Brings a tab to the front (a live session node's "Go to tab"). */
  onShowSession?: (tabId: string) => void;
  /** Local projects: the graph shows one at a time (T73). `path` as stored (`~/…`). */
  projects?: readonly { id: string; name: string; path: string }[];
  /** The project of the tab in front: what "Current project" means. */
  activeProjectId?: string | null;
  /** The tab in front (T74: "This tab" lists its conversation's work). */
  activeSessionId?: string | null;
  /** T81: opens "What is this?" (a file / text dropped on the button comes with it). */
  onWhatIsThis?: (seed?: BriefSeed) => void;
}

type Mode = 'week' | 'focus' | 'map';
const HINT_KEY = 'aquila.graph.hintSeen.v2';
const MODE_KEY = 'aquila.graph.mode';
const FOLLOW_KEY = 'aquila.graph.follow';
const PROJECT_KEY = 'aquila.graph.project';
const RULES_KEY = 'aquila.graph.groups';
/** Project choice: the tab in front's project, every project, or one project id. */
const CURRENT = '';
const ALL = '*';

const storedRules = (): GroupRule[] => {
  try {
    const v: unknown = JSON.parse(stored(RULES_KEY) ?? '[]');
    return Array.isArray(v)
      ? v.filter(
          (r): r is GroupRule =>
            !!r &&
            typeof r === 'object' &&
            typeof (r as GroupRule).id === 'string' &&
            typeof (r as GroupRule).name === 'string' &&
            typeof (r as GroupRule).query === 'string',
        )
      : [];
  } catch {
    return [];
  }
};
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
  sessions,
  onShowSession,
  projects = [],
  activeProjectId = null,
  activeSessionId = null,
  onWhatIsThis,
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
  // T74: "This week" first, unless the person chose another view before. Opened beside a note, the graph is about
  // that note (what people keep using is the local view next to the editor), unless the Map was chosen.
  const [mode, setModeState] = useState<Mode>(() => {
    const m = stored(MODE_KEY);
    if (m === 'map') return m;
    return activeNotePath || m === 'focus' ? 'focus' : 'week';
  });
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

  // Project (T73): the current tab's project by default, so the graph is about what you're working on.
  const [projectChoice, setProjectChoiceState] = useState(() => stored(PROJECT_KEY) ?? CURRENT);
  const setProjectChoice = (v: string) => {
    setProjectChoiceState(v);
    store(PROJECT_KEY, v);
  };
  const sourceList = status?.sources;
  const owners = useMemo(() => projectSources(sourceList ?? [], projects), [sourceList, projects]);
  // "Current" needs a note folder inside the tab's project; without one it shows every project (else the graph
  // would open empty in most projects).
  const currentHasNotes = !!activeProjectId && [...owners.values()].includes(activeProjectId);
  const projectId =
    projectChoice === ALL
      ? null
      : projectChoice === CURRENT
        ? currentHasNotes
          ? activeProjectId
          : null
        : projects.some((p) => p.id === projectChoice)
          ? projectChoice
          : null;
  const scopeKey = projectId ? `${projectId}\0${[...owners].join(',')}` : '';
  const scope = useMemo(
    () => (projectId ? scopeOf(projectId, owners) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey],
  );
  // Open tabs' conversations stay in even with no note behind them (T76: "This tab" of a coding tab).
  const live = useLiveSessions(sessions);
  const liveIds = useMemo(() => new Set(live.keys()), [live]);
  const view = useMemo(
    () =>
      snapshot ? filterSnapshot(snapshot, filter, Date.now(), scope, liveIds) : { nodes: [], edges: [] },
    [snapshot, filter, scope, liveIds],
  );
  const byId = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view.nodes]);
  const allNodes = snapshot?.nodes;
  const tags = useMemo(() => tagsOf(allNodes ?? []), [allNodes]);
  const kinds = useMemo(() => kindsOf(allNodes ?? []), [allNodes]);
  const lenses = useMemo(() => lensHits(view, Date.now(), liveIds), [view, liveIds]);
  // "This week" (T74): what changed lately, or — "This tab" — the front tab's conversation and what it touched.
  const [weekKind, setWeekKind] = useState<WeekKind | null>(null);
  const [weekTab, setWeekTab] = useState(false);
  const tabIds = useMemo(
    () => [...live].filter(([, v]) => v.tabId === activeSessionId).map(([id]) => id),
    [live, activeSessionId],
  );
  const tabOnly = useMemo(() => tabWork(view, tabIds), [view, tabIds]);
  const tabCount = useMemo(
    () => (tabOnly.size ? weekList(view, { since: null, only: tabOnly }).counts.all : 0),
    [view, tabOnly],
  );
  const week = useMemo(
    () =>
      mode !== 'week'
        ? null
        : weekList(view, weekTab ? { since: null, only: tabOnly, kind: weekKind } : { kind: weekKind }),
    [mode, view, weekTab, tabOnly, weekKind],
  );

  // Kind chips only when they split something: kinds with items, and at least two of them (T76: fewer controls).
  const weekChips = useMemo(() => {
    if (!week) return [];
    const present = WEEK_KINDS.filter((k) => week.counts[k] > 0 || weekKind === k);
    return present.length > 1 || weekKind ? present : [];
  }, [week, weekKind]);

  // Map as groups (T73): folders / kinds / the user's groups, opened one level at a time.
  const [rules, setRulesState] = useState(storedRules);
  const setRules = (r: GroupRule[]) => {
    setRulesState(r);
    store(RULES_KEY, JSON.stringify(r));
  };
  const [rulesOpen, setRulesOpen] = useState(false);
  const [groupAt, setGroupAt] = useState<string[]>([]);
  useEffect(() => setGroupAt([]), [projectId]);
  const groupLabel = useGroupLabel();
  const recent = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    return new Set(view.nodes.filter((n) => (n.mtime ?? 0) >= since).map((n) => n.id));
  }, [view]);
  const paths = useMemo(() => {
    if (mode !== 'map') return null;
    const names = new Map((sourceList ?? []).map((s) => [s.id, sourceName(s.path)]));
    const ctx = {
      rules: rules.filter((r) => r.query.trim()),
      sourceName: (id: string) => names.get(id) ?? id,
      multiSource: new Set(view.nodes.flatMap((n) => (n.sourceId ? [n.sourceId] : []))).size > 1,
      projects,
      multiProject: !projectId,
    };
    return new Map(view.nodes.map((n) => [n.id, groupPath(n, ctx)]));
  }, [mode, view, rules, sourceList, projects, projectId]);
  const level = useMemo(() => (paths ? groupLevel(view, paths, groupAt) : null), [view, paths, groupAt]);
  // ⌘-clicked groups of this level, to open together.
  const [picked, setPicked] = useState<string[]>([]);
  const levelKey = level ? level.at.join('/') : '';
  useEffect(() => setPicked([]), [levelKey]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const mapV = useMemo(() => {
    if (level?.kind !== 'map') return view;
    // Sessions / code / files make sense with what they link to; a note folder stands on its own.
    const nonNotes = [...level.ids].every((id) => byId.get(id)?.kind !== 'note');
    return mapView(view, level.ids, nonNotes && level.at.length > 0);
  }, [level, view, byId]);
  /**
   * Crumbs of the Map: every group, then each opened group by name. A level that holds a single group is skipped on
   * the way in, so its crumb (and Back) would land straight back here: it is merged into the next one ("a / b").
   */
  const { groupCrumbs, groupParent } = useMemo(() => {
    if (!level || !paths) return { groupCrumbs: [], groupParent: null };
    // One name per step. Depth counts real levels ("N more" stays on its level), as `groupLevel` walks them.
    const labels: string[] = [];
    let depth = 0;
    let parent: string | null = null;
    for (const key of level.at) {
      if (key === MORE) {
        labels.push(t('graph.groups.moreShort'));
        continue;
      }
      const at = depth;
      const name = (k: string) =>
        groupLabel(
          { seg: [...paths.values()].find((p) => p[at]?.key === k)?.[at] ?? { key: k, label: k } },
          parent,
        );
      const together = unionKeys(key);
      const label = together ? together.map(name).join(' + ') : name(key);
      labels.push(label);
      parent = label;
      // A topic (T75) splits a level, it isn't a folder deeper.
      if (!key.startsWith(TOPIC)) depth++;
    }
    const stops = crumbStops(view, paths, level.at);
    const items = stops.map((k, j) => {
      const from = j === 0 ? 0 : stops[j - 1]!;
      const names = labels.slice(from, k);
      return {
        id: String(k),
        label: j === 0 ? [t('graph.groups.all'), ...names].join(' / ') : names.join(' / '),
      };
    });
    return { groupCrumbs: items, groupParent: labels[labels.length - 1] ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, paths, view, t]);

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
  // Start at the open note (or the latest one); follow the editor while pinned to it — when the editor moves to
  // another note (or follow is switched on), not on every snapshot refresh: that snapped a node picked by search or a
  // click straight back to the editor's note.
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    if (!follow) followed.current = null;
    if (follow && activeId && activeId !== followed.current) {
      followed.current = activeId;
      if (activeId !== center) recentreQuietly(activeId);
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
  // Enter pressed before anything matched: the first match once the snapshot has it (typing again cancels).
  const [pendingEnter, setPendingEnter] = useState<string | null>(null);
  useEffect(() => {
    if (pendingEnter === null) return;
    if (pendingEnter !== query) return setPendingEnter(null);
    if (deferredQuery !== query || !results.length) return;
    setPendingEnter(null);
    recentre(results[0]!.id);
    setQuery('');
    setSearching(false);
    // `recentre` reads state setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, query, deferredQuery, results]);

  const open = (n: GraphNode) => {
    if (n.kind === 'note' && n.path) onOpenNote(n.path);
    else if (n.kind === 'session' && live.get(n.id) && onShowSession) onShowSession(live.get(n.id)!.tabId);
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
  const renderer = useGraphRenderer(mode === 'map' && level?.kind === 'map' ? host : null, {
    view: mapV,
    colors,
    selected: null,
    matches: mapMatches,
    saver,
    nodeColor: null,
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
  // The Map's legend names what is drawn (a group's dots), not every kind in the graph.
  const drawn = new Set(mapV.nodes.map((n) => n.kind));
  const legendKinds = kinds.filter((k) => !filter.hiddenKinds.includes(k) && drawn.has(k));
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
          {onWhatIsThis && <WhatIsThisButton onOpen={onWhatIsThis} />}
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
          {mode === 'map' && level?.kind === 'map' && !empty && (
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
        {projects.length > 0 && (
          <Select
            aria-label={t('graph.project.label')}
            value={
              projectChoice === CURRENT ||
              projectChoice === ALL ||
              projects.some((p) => p.id === projectChoice)
                ? projectChoice
                : CURRENT
            }
            onChange={setProjectChoice}
            options={[
              {
                value: CURRENT,
                label: t(currentHasNotes ? 'graph.project.current' : 'graph.project.currentAll', {
                  name: projects.find((p) => p.id === activeProjectId)?.name ?? '—',
                }),
              },
              { value: ALL, label: t('graph.project.all') },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        )}
        <Segment
          label={t('graph.mode.label')}
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: 'week', label: t('graph.mode.week') },
            { value: 'focus', label: t('graph.mode.focusNote') },
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
            } else if (e.key === 'Enter' && query.trim()) {
              // Nothing found yet (the snapshot is still coming): take the first match when it arrives.
              setPendingEnter(query);
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
      {!empty && mode === 'week' && week && (weekChips.length > 0 || tabCount > 0 || weekTab) && (
        <div className="c-panel__bar" role="group" aria-label={t('graph.mode.week')}>
          {(tabCount > 0 || weekTab) && (
            <GraphLens
              pressed={weekTab}
              count={tabCount}
              title={t('graph.week.tabHint')}
              onClick={() => setWeekTab((v) => !v)}
            >
              {t('graph.week.tab')}
            </GraphLens>
          )}
          {weekChips.map((k) => (
            <GraphLens
              key={k}
              pressed={weekKind === k}
              count={week.counts[k]}
              onClick={() => setWeekKind((v) => (v === k ? null : k))}
            >
              {k === 'other' ? t('graph.week.other') : t(`graph.kind.${k}`)}
            </GraphLens>
          ))}
        </div>
      )}
      {!empty && mode === 'map' && groupCrumbs.length > 1 && (
        <div className="c-panel__bar">
          <GraphTrail
            back={
              <Button
                variant="ghost"
                icon
                // To the previous crumb (a skipped level isn't one: Back would land here again).
                onClick={() =>
                  setGroupAt((at) =>
                    (level?.at ?? at).slice(0, Number(groupCrumbs[groupCrumbs.length - 2]?.id ?? 0)),
                  )
                }
                title={t('graph.back')}
                aria-label={t('graph.back')}
              >
                ←
              </Button>
            }
            items={groupCrumbs}
            onPick={(id) => setGroupAt((level?.at ?? []).slice(0, Number(id)))}
          />
        </div>
      )}
      {!empty && mode === 'map' && level?.kind === 'groups' && picked.length > 0 && (
        <div className="c-panel__bar">
          <Button variant="primary" onClick={() => setGroupAt([...level.at, unionKey(picked)])}>
            {t('graph.groups.together', { n: String(picked.length) })}
          </Button>
          <Button variant="ghost" onClick={() => setPicked([])}>
            {t('graph.groups.unpick')}
          </Button>
        </div>
      )}
      {!empty && mode === 'map' && (
        <div className="c-panel__bar" role="group" aria-label={t('graph.lens.label')}>
          {/* Only questions with answers here (or the one switched on): a row of zeros is noise (T76). */}
          {LENSES.filter((id) => lenses[id].size > 0 || lens === id).map((id) => (
            <GraphLens
              key={id}
              pressed={lens === id}
              count={lenses[id].size}
              {...(id === 'untouched' || id === 'noWork' || id === 'idIssues'
                ? { title: t(`graph.lens.${id}.hint`) }
                : {})}
              onClick={() => setLens((l) => (l === id ? null : id))}
            >
              {t(`graph.lens.${id}`)}
            </GraphLens>
          ))}
          <span className="c-panel__bar-end">
            <Button variant="ghost" onClick={() => setRulesOpen(true)} title={t('graph.groups.editHint')}>
              {rules.length ? t('graph.groups.editN', { n: String(rules.length) }) : t('graph.groups.edit')}
            </Button>
          </span>
        </div>
      )}
      <GroupRulesDialog
        open={rulesOpen}
        rules={rules}
        onChange={setRules}
        onClose={() => setRulesOpen(false)}
      />
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
        {!empty && mode === 'map' && level?.kind === 'groups' && (
          <GroupsView
            items={level.items}
            links={level.links}
            parent={groupParent}
            hits={lens ? lenses[lens] : null}
            recent={recent}
            picked={pickedSet}
            onToggle={(key) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))}
            onOpen={(key) => setGroupAt([...level.at, key])}
          />
        )}
        {!empty && mode === 'week' && week && (
          <WeekView
            list={week}
            tab={weekTab}
            live={live}
            placeOf={(n) => {
              // In one project, the path inside it (the project's name on every row is noise).
              const p = projectId && n.path ? placeInProject(n, projects) : null;
              return p ? [...p.dirs, n.path!.split('/').pop()].join('/') : notePlace(n, sources);
            }}
            onOpen={open}
            onAround={recentre}
          />
        )}
        {!empty && mode === 'focus' && layout && (
          <FocusView
            live={live}
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
        {hint && !empty && !showResults && mode !== 'week' && (
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
                    if (projectId && !view.nodes.length) setProjectChoice(ALL);
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
          mode === 'map' &&
          level?.kind === 'map' && (
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
              {centerNode.kind === 'session' && live.get(centerNode.id) && onShowSession && (
                <Button variant="ghost" onClick={() => onShowSession(live.get(centerNode.id)!.tabId)}>
                  {t('graph.live.show')}
                </Button>
              )}
              {centerNode.kind === 'session' && !live.get(centerNode.id) && sessionRef(centerNode) && (
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
