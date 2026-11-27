import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  Button,
  Dialog,
  Explorer,
  Input,
  Palette,
  PaletteEmpty,
  PaletteItem,
  PaletteList,
  Select,
  Tree,
  TreeAction,
  TreeGhost,
  TreeInput,
  TreeRow,
  TreeSection,
  type TreeDotTone,
} from '@design-system/react';
import {
  api,
  type NoteFsError,
  type NoteFsLinkNote,
  type NoteFsList,
  type NoteFsMove,
  type NoteFsMoveResult,
  type NoteFsPrefs,
  type NoteFsSort,
} from '@/shared/api';
import { useT } from '@/shared/i18n';
import { fuzzyRank } from '@/shared/lib/fuzzy';
import { useGraphData } from '@/entities/note';
import {
  ancestors,
  baseName,
  buildTree,
  dirName,
  edgeScroll,
  filterFiles,
  flatten,
  groupByStatus,
  isOpen,
  isVirtual,
  movedPath,
  nextId,
  projectSourceIds,
  stickyRows,
  stripMd,
  within,
  type Row,
  type TreeFolder,
} from '../model/tree';
import {
  ACTION_LABEL,
  applyView,
  HOVER_ACTIONS,
  isExplorerAction,
  keyAction,
  menuTemplate,
  viewMenuTemplate,
  type ExplorerAction,
} from '../model/menu';

export interface NoteExplorerProps {
  /** The note open in the editor (absolute), or null. */
  currentPath: string | null;
  /** Local projects (paths as stored), for which sources belong to the tab in front's project. */
  projects: readonly { id: string; path: string }[];
  activeProjectId: string | null;
  onOpenNote: (path: string) => void;
  /** Saves the editor's pending edits before files move. */
  beforeChange: () => Promise<void>;
  /** The open note was renamed / moved: its new path (the editor follows instead of saying "deleted"). */
  onMoved: (path: string) => void;
  /** The open note went to the Trash (or its creation was undone). */
  onGone: () => void;
}

type Editing =
  | { mode: 'note' | 'folder'; parent: string; value: string; error?: NoteFsError; select?: number }
  | { mode: 'rename'; rel: string; folder: boolean; value: string; error?: NoteFsError };

type Item =
  | { key: string; kind: 'section'; label: string }
  | { key: string; kind: 'row'; row: Row }
  | { key: string; kind: 'input'; depth: number };

/** What ⌘Z undoes (kept in memory for the session; Trash isn't undoable — it asks first). */
type Op = { kind: 'move'; moves: NoteFsMove[] } | { kind: 'create'; rel: string; mtime?: number };

const RECENT_SHOWN = 5;
/** A note written in the last this-many ms (by anyone but the editor's own saves of it) gets the "just changed" dot. */
const CHANGED_MS = 5 * 60_000;
const DRAG_START_PX = 4;
const HOVER_EXPAND_MS = 600;
const OVERSCAN = 6;
/** Most folder rows pinned at the top while scrolling. */
const STICKY_MAX = 5;
const EMPTY_PREFS: NoteFsPrefs = { pins: [], recent: [], sort: 'name' };

const toneOf = (status: string): TreeDotTone =>
  /done|complete|closed|resolved|merged|완료|끝/i.test(status)
    ? 'done'
    : /progress|doing|active|review|wip|진행|검토/i.test(status)
      ? 'active'
      : 'other';

function readSet(key: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function writeSet(key: string, s: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...s].slice(0, 500)));
  } catch {
    // not remembered
  }
}

/**
 * The note explorer (T83): the current project's note sources as a tree built from the index's file list (no disk
 * walk), virtualized. New note / folder, rename, move (drag or "Move to…"), Trash, Reveal, copy paths; links to what
 * moved are fixed only after a yes. ⌘Z undoes the last move / rename / new folder / untouched new note.
 */
export default function NoteExplorer({
  currentPath,
  projects,
  activeProjectId,
  onOpenNote,
  beforeChange,
  onMoved,
  onGone,
}: NoteExplorerProps) {
  const t = useT();
  const baseId = useId();
  const { status, snapshot } = useGraphData();

  // ---- which source ----
  const enabled = useMemo(() => (status?.sources ?? []).filter((s) => s.enabled), [status?.sources]);
  const projectIds = useMemo(
    () => projectSourceIds(enabled, projects, activeProjectId),
    [enabled, projects, activeProjectId],
  );
  const currentSource = useMemo(
    () =>
      currentPath
        ? snapshot?.nodes.find((n) => n.kind === 'note' && n.path === currentPath)?.sourceId
        : undefined,
    [snapshot, currentPath],
  );
  const [picked, setPicked] = useState<string | null>(null);
  // Follows the open note to its source and stays there (a renamed note is briefly not in the index) — once per note
  // opened, not on every snapshot refresh: that pulled the explorer back from a source the user had picked, and the
  // source change dropped a half-typed new name.
  const followedPath = useRef<string | null>(null);
  useEffect(() => {
    if (!currentSource || !currentPath || followedPath.current === currentPath) return;
    followedPath.current = currentPath;
    setPicked(currentSource);
  }, [currentSource, currentPath]);
  const has = (id: string | null | undefined): id is string => !!id && enabled.some((s) => s.id === id);
  const sourceId = has(picked)
    ? picked
    : has(currentSource)
      ? currentSource
      : (projectIds[0] ?? enabled[0]?.id ?? null);

  // ---- data ----
  const [prefs, setPrefsState] = useState<NoteFsPrefs>(EMPTY_PREFS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const savePrefs = useCallback(
    (next: NoteFsPrefs) => {
      setPrefsState(next);
      if (sourceId) void api.noteFsSetPrefs(sourceId, next);
    },
    [sourceId],
  );
  useEffect(() => {
    setPrefsState(EMPTY_PREFS);
    if (!sourceId) return;
    let alive = true;
    void api.noteFsPrefs(sourceId).then((p) => alive && setPrefsState(p));
    return () => {
      alive = false;
    };
  }, [sourceId]);

  const [listState, setList] = useState<NoteFsList | null>(null);
  const list = listState && listState.sourceId === sourceId ? listState : null;
  const listRef = useRef(list);
  listRef.current = list;
  const [tick, setTick] = useState(0);
  const created = prefs.sort === 'created';
  const version = status?.version ?? 0;
  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    // The index moved (a save, an agent's write, git): fetch again shortly — rows that didn't change keep their
    // props, so only what changed re-renders.
    const timer = setTimeout(
      () => void api.noteFsList(sourceId, { created }).then((l) => alive && l && setList(l)),
      listRef.current ? 250 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sourceId, created, version, tick]);
  const refreshSoon = () => setTimeout(() => setTick((n) => n + 1), 900);

  const [expanded, setExpandedState] = useState<Set<string>>(new Set());
  const openKey = sourceId ? `aquila.explorer.open.${sourceId}` : '';
  useEffect(() => {
    setExpandedState(openKey ? readSet(openKey) : new Set());
  }, [openKey]);
  const setExpanded = useCallback(
    (f: (s: Set<string>) => Set<string>) =>
      setExpandedState((s) => {
        const next = f(s);
        if (openKey) writeSet(openKey, next);
        return next;
      }),
    [openKey],
  );

  /** Empty folders, read when a folder is expanded (folders holding notes come from the index's paths). */
  const [dirs, setDirs] = useState<Map<string, string[]>>(new Map());
  useEffect(() => setDirs(new Map()), [sourceId]);
  const loadDirs = useCallback(
    (rel: string) => {
      if (!sourceId) return;
      void api.noteFsDirs(sourceId, rel).then((names) => setDirs((m) => new Map(m).set(rel, names)));
    },
    [sourceId],
  );
  useEffect(() => {
    if (!sourceId) return;
    loadDirs('');
    for (const rel of expanded) loadDirs(rel);
    // Once per source (and when the index moves): expanding later loads that folder alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, loadDirs, version]);

  const files = useMemo(() => list?.files ?? [], [list]);
  const grouped = prefs.group === 'status';
  const folderNotes = prefs.folderNotes !== false;
  /** The folders on disk (also for "Move to…" while the view is by status). */
  const folderTree = useMemo(
    () => buildTree(files, dirs, prefs.sort, { folderNotes }),
    [files, dirs, prefs.sort, folderNotes],
  );
  const tree = useMemo(
    () => (grouped ? groupByStatus(files, prefs.sort) : folderTree),
    [grouped, files, prefs.sort, folderTree],
  );
  /** Folder note → its folder (the row that stands for it). */
  const noteFolder = useMemo(() => {
    const m = new Map<string, string>();
    if (grouped) return m;
    const walk = (f: TreeFolder) => {
      if (f.note) m.set(f.note.rel, f.rel);
      f.folders.forEach(walk);
    };
    walk(folderTree);
    return m;
  }, [grouped, folderTree]);
  const noteFolderRef = useRef(noteFolder);
  noteFolderRef.current = noteFolder;
  const known = useMemo(() => new Set(files.map((f) => f.rel)), [files]);
  const root = list?.root ?? '';
  const abs = useCallback((rel: string) => (rel ? `${root}/${rel}` : root), [root]);
  const currentRel =
    currentPath && root && currentPath.startsWith(`${root}/`) ? currentPath.slice(root.length + 1) : null;

  // ---- filter ----
  const [query, setQuery] = useState('');
  const matches = useMemo(() => (query.trim() ? filterFiles(files, query) : null), [files, query]);

  // ---- selection, editing, dialogs ----
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [note, setNote] = useState<{ text: string; warn?: boolean } | null>(null);
  const [linkAsk, setLinkAsk] = useState<{
    sourceId: string;
    files: NoteFsMove[];
    links: NoteFsLinkNote[];
  } | null>(null);
  const [trashAsk, setTrashAsk] = useState<string[] | null>(null);
  const [moveAsk, setMoveAsk] = useState<string[] | null>(null);
  const history = useRef<Op[]>([]);
  useEffect(() => {
    history.current = [];
    setSelection(new Set());
    setEditing(null);
    setQuery('');
  }, [sourceId]);
  const errorText = (e: NoteFsError) => t(`explorer.error.${e}`);
  const say = (text: string, warn = false) => setNote({ text, warn });

  // ---- the open note: highlighted, its folder open, remembered as recent ----
  const reveal = useRef(false);
  useEffect(() => {
    if (!currentRel) return;
    // A folder note stands as its folder's row: that folder's parents open, not the folder itself.
    const shown = noteFolderRef.current.get(currentRel) ?? currentRel;
    const up = ancestors(shown);
    if (up.length) setExpanded((s) => (up.every((a) => s.has(a)) ? s : new Set([...s, ...up])));
    setCursor(`row:${shown}`);
    setSelection(new Set([shown]));
    reveal.current = true;
    const p = prefsRef.current;
    if (sourceId && p.recent[0] !== currentRel)
      savePrefs({ ...p, recent: [currentRel, ...p.recent.filter((r) => r !== currentRel)].slice(0, 20) });
    // `savePrefs` changes with the source; only the note matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRel, sourceId]);

  // ---- rows ----
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (!matches) {
      const pins = prefs.pins.filter((r) => known.has(r));
      const recent = prefs.recent.filter((r) => known.has(r) && !pins.includes(r)).slice(0, RECENT_SHOWN);
      const fileRow = (rel: string): Row => {
        const entry = files.find((f) => f.rel === rel);
        return {
          kind: 'file',
          rel,
          name: stripMd(baseName(rel)),
          depth: 0,
          parent: '',
          ...(entry ? { entry } : {}),
        };
      };
      if (pins.length) {
        out.push({ key: 'sec:pin', kind: 'section', label: t('explorer.pinned') });
        for (const r of pins) out.push({ key: `pin:${r}`, kind: 'row', row: fileRow(r) });
      }
      if (recent.length) {
        out.push({ key: 'sec:recent', kind: 'section', label: t('explorer.recent') });
        for (const r of recent) out.push({ key: `recent:${r}`, kind: 'row', row: fileRow(r) });
      }
      if (pins.length || recent.length)
        out.push({ key: 'sec:files', kind: 'section', label: t('explorer.title') });
    }
    const rows = flatten(tree, expanded, matches, { compact: prefs.compact !== false });
    const adding = editing && editing.mode !== 'rename' ? editing.parent : null;
    const head = out.length;
    if (adding === '') out.push({ key: 'input', kind: 'input', depth: 0 });
    for (const row of rows) {
      out.push({ key: `row:${row.rel}`, kind: 'row', row });
      if (adding && row.kind === 'folder' && row.rel === adding)
        out.push({ key: 'input', kind: 'input', depth: row.depth + 1 });
    }
    // A folder not on screen (the view is by status): the name field goes on top.
    if (adding !== null && !out.some((i) => i.kind === 'input'))
      out.splice(head, 0, { key: 'input', kind: 'input', depth: 0 });
    return out;
  }, [matches, prefs.pins, prefs.recent, prefs.compact, known, files, tree, expanded, editing, t]);
  const rowItems = useMemo(
    () => items.filter((i): i is Extract<Item, { kind: 'row' }> => i.kind === 'row'),
    [items],
  );

  // ---- virtual list ----
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [rowH, setRowH] = useState(24);
  const [view, setView] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const h = parseFloat(getComputedStyle(el).getPropertyValue('--size-tree-row'));
    if (h > 0) setRowH(h);
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, height: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, [list !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = Math.max(0, Math.floor(view.top / rowH) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((view.top + view.height) / rowH) + OVERSCAN);
  const scrollTo = useCallback(
    (key: string) => {
      const el = treeRef.current;
      const i = items.findIndex((x) => x.key === key);
      if (!el || i < 0) return;
      const y = i * rowH;
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + rowH > el.scrollTop + el.clientHeight) el.scrollTop = y + rowH - el.clientHeight;
    },
    [items, rowH],
  );
  useEffect(() => {
    const key = `row:${currentRel ? (noteFolder.get(currentRel) ?? currentRel) : ''}`;
    if (!reveal.current || !currentRel || !items.some((i) => i.key === key)) return;
    reveal.current = false;
    scrollTo(key);
  }, [items, currentRel, scrollTo, noteFolder]);

  /** Each item's parent row index (-1: none), for the sticky folder rows. */
  const parents = useMemo(() => {
    const at = new Map(items.map((x, i) => [x.key, i]));
    return items.map((x) =>
      x.kind === 'row' && x.key.startsWith('row:') && x.row.parent
        ? (at.get(`row:${x.row.parent}`) ?? -1)
        : -1,
    );
  }, [items]);
  const sticky = useMemo(
    () => (matches ? [] : stickyRows(parents, Math.floor(view.top / rowH), STICKY_MAX)),
    [parents, view.top, rowH, matches],
  );

  // ---- operations ----
  const folderOf = (rel: string | null): string => {
    if (!rel || isVirtual(rel)) return '';
    return files.some((f) => f.rel === rel) ? dirName(rel) : rel;
  };
  const isFolder = (rel: string) => !known.has(rel);

  const startNew = (mode: 'note' | 'folder', parent: string) => {
    if (parent) setExpanded((s) => (s.has(parent) ? s : new Set([...s, parent])));
    if (parent) loadDirs(parent);
    setQuery('');
    let value = '';
    if (mode === 'note') {
      const names = files.filter((f) => dirName(f.rel) === parent).map((f) => stripMd(baseName(f.rel)));
      value = nextId(names) ?? '';
    }
    setEditing({ mode, parent, value });
  };

  const startRename = (rel: string) => {
    if (isVirtual(rel)) return;
    const folder = isFolder(rel);
    const name = folder ? baseName(rel) : stripMd(baseName(rel));
    setEditing({ mode: 'rename', rel, folder, value: name });
  };

  /** After a move / rename (or its undo): paths follow, the editor follows, and the links question comes up. */
  const moved = (res: NoteFsMoveResult, record: boolean) => {
    if (!res.ok) {
      say(errorText(res.error), true);
      if (res.moved?.length) setTick((n) => n + 1);
      return;
    }
    if (!res.moved.length) return;
    const ms = res.moved;
    if (record) history.current = [...history.current.slice(-49), { kind: 'move', moves: ms }];
    setList((l) => (l ? { ...l, files: l.files.map((f) => ({ ...f, rel: movedPath(f.rel, ms) })) } : l));
    setExpanded((s) => new Set([...s].map((r) => movedPath(r, ms))));
    setDirs(new Map());
    setSelection(new Set(ms.map((m) => m.to)));
    const p = prefsRef.current;
    savePrefs({
      ...p,
      pins: p.pins.map((r) => movedPath(r, ms)),
      recent: p.recent.map((r) => movedPath(r, ms)),
    });
    if (currentRel) {
      const next = movedPath(currentRel, res.files.length ? res.files : ms);
      if (next !== currentRel) onMoved(abs(next));
    }
    setNote(null);
    if (res.links.length && sourceId) {
      const ask = { sourceId, files: res.files, links: res.links };
      // Remembered per source: fix without asking, or leave them.
      const pref = prefsRef.current.links ?? 'ask';
      if (pref === 'always') void fixLinks(ask);
      else if (pref === 'ask') setLinkAsk(ask);
    }
    refreshSoon();
  };

  const move = async (rels: string[], folder: string) => {
    if (!sourceId || !rels.length) return;
    // Dropped where they already are: nothing (never "moved out").
    if (rels.every((r) => dirName(r) === folder)) return;
    await beforeChange();
    moved(await api.noteFsMove(sourceId, rels, folder), true);
  };

  const submit = async () => {
    const e = editing;
    if (!e || !sourceId) return;
    const value = e.value.trim();
    if (!value) return setEditing(null);
    if (e.mode === 'rename') {
      const same = value === (e.folder ? baseName(e.rel) : stripMd(baseName(e.rel)));
      if (same) return setEditing(null);
      await beforeChange();
      const res = await api.noteFsRename(sourceId, e.rel, value);
      if (!res.ok) return setEditing({ ...e, error: res.error });
      setEditing(null);
      moved(res, true);
      return;
    }
    const res =
      e.mode === 'folder'
        ? await api.noteFsMkdir(sourceId, e.parent, value)
        : await api.noteFsCreateNote(sourceId, e.parent, value);
    if (!res.ok) return setEditing({ ...e, error: res.error });
    setEditing(null);
    history.current = [
      ...history.current.slice(-49),
      { kind: 'create', rel: res.rel, ...(res.mtime !== undefined ? { mtime: res.mtime } : {}) },
    ];
    if (e.mode === 'folder') {
      setDirs((m) => new Map(m).set(e.parent, [...(m.get(e.parent) ?? []), baseName(res.rel)]));
      setCursor(`row:${res.rel}`);
      setSelection(new Set([res.rel]));
    } else {
      setList((l) =>
        l ? { ...l, files: [...l.files, { rel: res.rel, title: value, mtime: res.mtime ?? Date.now() }] } : l,
      );
      onOpenNote(abs(res.rel));
    }
    refreshSoon();
  };

  const trash = async (rels: string[]) => {
    setTrashAsk(null);
    if (!sourceId) return;
    await beforeChange();
    const done = await api.noteFsTrash(sourceId, rels);
    if (!done.length) return say(errorText('failed'), true);
    const gone = (r: string) => done.some((d) => within(r, d));
    setList((l) => (l ? { ...l, files: l.files.filter((f) => !gone(f.rel)) } : l));
    setDirs(new Map());
    setSelection(new Set());
    const p = prefsRef.current;
    savePrefs({ ...p, pins: p.pins.filter((r) => !gone(r)), recent: p.recent.filter((r) => !gone(r)) });
    if (currentRel && gone(currentRel)) onGone();
    refreshSoon();
  };

  const undo = async () => {
    const op = history.current.pop();
    if (!op || !sourceId) return say(t('explorer.undo.none'));
    if (op.kind === 'create') {
      const ok = await api.noteFsUndoCreate(sourceId, op.rel, op.mtime);
      if (!ok) return say(t('explorer.undo.kept'), true);
      setList((l) => (l ? { ...l, files: l.files.filter((f) => f.rel !== op.rel) } : l));
      setDirs(new Map());
      if (currentRel === op.rel) onGone();
      say(t('explorer.undo.done'));
      refreshSoon();
      return;
    }
    await beforeChange();
    // Back in reverse order: renames in place, moves back into each one's old folder.
    for (const m of [...op.moves].reverse()) {
      const res =
        dirName(m.from) === dirName(m.to)
          ? await api.noteFsRename(sourceId, m.to, baseName(m.from))
          : await api.noteFsMove(sourceId, [m.to], dirName(m.from));
      moved(res, false);
      if (!res.ok) return;
    }
    say(t('explorer.undo.done'));
  };

  const fixLinks = async (ask = linkAsk) => {
    setLinkAsk(null);
    if (!ask) return;
    await beforeChange();
    const r = await api.noteFsFixLinks(
      ask.sourceId,
      ask.files,
      ask.links.map((l) => l.rel),
    );
    say(
      [
        t('explorer.links.done', { n: String(r.fixed) }),
        r.failed.length ? t('explorer.links.failed', { n: String(r.failed.length) }) : '',
      ]
        .filter(Boolean)
        .join(' · '),
      r.failed.length > 0,
    );
  };

  /** "Always" / "Never" in the links question: remembered for this source (changeable in the ⋯ menu). */
  const rememberLinks = (pref: 'always' | 'never') => {
    savePrefs({ ...prefsRef.current, links: pref });
    if (pref === 'always') void fixLinks();
    else setLinkAsk(null);
  };

  const togglePin = (rel: string) => {
    const p = prefsRef.current;
    savePrefs({ ...p, pins: p.pins.includes(rel) ? p.pins.filter((r) => r !== rel) : [...p.pins, rel] });
  };

  const revealCurrent = () => {
    if (!currentRel) return;
    setQuery('');
    const shown = noteFolder.get(currentRel) ?? currentRel;
    const up = ancestors(shown);
    setExpanded((s) => new Set([...s, ...up]));
    setCursor(`row:${shown}`);
    setSelection(new Set([shown]));
    reveal.current = true;
    treeRef.current?.focus();
  };

  const toggleFolder = (rel: string, open?: boolean) => {
    const willOpen = open ?? !isOpen(rel, expanded);
    const virtual = isVirtual(rel);
    setExpanded((s) => {
      const next = new Set(s);
      // Status groups are open unless closed: the set holds the closed ones.
      if (willOpen !== virtual) next.add(rel);
      else next.delete(rel);
      return next;
    });
    if (!willOpen || virtual) return;
    // A compact row `a / b / c`: every folder on it may hold empty folders that end the chain.
    const chain = rowItems.find((x) => x.row.rel === rel)?.row.chain ?? [rel];
    for (const r of chain) loadDirs(r);
  };

  const targets = (rel: string) =>
    (selection.has(rel) && selection.size > 1 ? [...selection] : [rel]).filter((r) => !isVirtual(r));

  /** The right-click / ⋯ menu of a row (a status group gets the empty-space menu: it isn't a folder). */
  const menu = async (rel: string, folder: boolean) => {
    if (!sourceId) return;
    if (isVirtual(rel)) return emptyMenu();
    if (!selection.has(rel)) setSelection(new Set([rel]));
    const sel = targets(rel);
    const target =
      sel.length > 1
        ? ({ kind: 'multi', count: sel.length, folder } as const)
        : folder
          ? ({ kind: 'folder' } as const)
          : ({ kind: 'file', pinned: prefs.pins.includes(rel) } as const);
    const id = await api.showContextMenu(menuTemplate(target, t));
    if (isExplorerAction(id)) dispatch(id, rel, folder, sel);
  };

  const emptyMenu = async () => {
    if (!sourceId) return;
    const id = await api.showContextMenu(menuTemplate({ kind: 'empty' }, t));
    if (isExplorerAction(id)) dispatch(id, '', true, ['']);
  };

  /** Every action, from the menu, the hover buttons and the keys alike. `rel` '' is the source root. */
  const dispatch = (action: ExplorerAction, rel: string, folder: boolean, sel: readonly string[]) => {
    if (!sourceId) return;
    if (isVirtual(rel)) {
      rel = '';
      folder = true;
    }
    const real = sel.filter((r) => !isVirtual(r));
    if (action === 'newNote') startNew('note', folder ? rel : dirName(rel));
    else if (action === 'newFolder') startNew('folder', folder ? rel : dirName(rel));
    else if (action === 'rename') {
      if (rel) startRename(rel);
    } else if (action === 'move') {
      if (real.some(Boolean)) setMoveAsk(real);
    } else if (action === 'pin') togglePin(rel);
    else if (action === 'finder') void api.noteFsShell(sourceId, rel, 'reveal');
    else if (action === 'open') void api.noteFsShell(sourceId, rel, 'open');
    else if (action === 'copy') api.copyText(real.map(abs).join('\n'));
    else if (action === 'copyRel') api.copyText(real.join('\n'));
    else if (action === 'trash') {
      if (real.some(Boolean)) setTrashAsk(real.filter(Boolean));
    }
  };

  const viewMenu = async () => {
    const id = await api.showContextMenu(viewMenuTemplate(prefsRef.current, t));
    const next = applyView(prefsRef.current, id);
    if (next !== prefsRef.current) savePrefs(next);
  };

  // ---- pointer: click, ⌘/⇧ click, drag and drop ----
  const drag = useRef<{
    rel: string;
    x: number;
    y: number;
    items: string[];
    active: boolean;
    target: string | null;
    hover: string | null;
    timer: ReturnType<typeof setTimeout> | null;
    /** Last pointer position, and the auto-scroll frame while it's near the tree's top / bottom edge. */
    px: number;
    py: number;
    frame: number | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragView, setDragView] = useState<{
    x: number;
    y: number;
    label: string;
    target: string | null;
  } | null>(null);
  const moveRef = useRef(move);
  moveRef.current = move;
  const toggleRef = useRef(toggleFolder);
  toggleRef.current = toggleFolder;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const rowHRef = useRef(rowH);
  rowHRef.current = rowH;

  useEffect(() => {
    const end = () => {
      const d = drag.current;
      if (d?.timer) clearTimeout(d.timer);
      if (d?.frame) cancelAnimationFrame(d.frame);
      drag.current = null;
      setDragView(null);
    };
    // Held near the tree's top / bottom edge: it scrolls (faster closer to the edge) and the drop target follows.
    const autoScroll = () => {
      const d = drag.current;
      const tree = treeRef.current;
      if (!d || !tree) return;
      d.frame = null;
      const r = tree.getBoundingClientRect();
      const dy = edgeScroll(d.py, r.top, r.bottom, rowHRef.current * 1.5);
      const before = tree.scrollTop;
      if (dy) tree.scrollTop = before + dy;
      if (tree.scrollTop !== before) {
        track(d.px, d.py);
        d.frame = requestAnimationFrame(autoScroll);
      }
    };
    const onMove = (e: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return;
      d.active = true;
      track(e.clientX, e.clientY);
      if (!d.frame) d.frame = requestAnimationFrame(autoScroll);
    };
    const track = (x: number, y: number) => {
      const d = drag.current;
      if (!d) return;
      d.px = x;
      d.py = y;
      const el = document.elementFromPoint(x, y);
      const row = el?.closest<HTMLElement>('.c-tree__row');
      const inTree = !!el && !!treeRef.current?.contains(el);
      let target: string | null = null;
      if (row?.dataset.rel !== undefined && inTree)
        target = row.dataset.kind === 'folder' ? row.dataset.rel : dirName(row.dataset.rel);
      else if (inTree) target = '';
      if (target !== null && d.items.some((i) => target === i || target!.startsWith(`${i}/`))) target = null;
      // A status group isn't a folder: nothing to drop into.
      if (target !== null && isVirtual(target)) target = null;
      d.target = target;
      // Held over a closed folder: it opens.
      const hover = row?.dataset.kind === 'folder' ? (row.dataset.rel ?? null) : null;
      if (hover !== d.hover) {
        if (d.timer) clearTimeout(d.timer);
        d.timer = null;
        d.hover = hover;
        if (hover && !expandedRef.current.has(hover))
          d.timer = setTimeout(() => toggleRef.current(hover, true), HOVER_EXPAND_MS);
      }
      const label =
        d.items.length > 1 ? `${baseName(d.items[0]!)} +${d.items.length - 1}` : baseName(d.items[0]!);
      setDragView({ x, y, label: stripMd(label), target });
    };
    const onUp = () => {
      const d = drag.current;
      if (d?.active) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        if (d.target !== null) void moveRef.current(d.items, d.target);
      }
      end();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current?.active) {
        e.preventDefault();
        e.stopPropagation();
        end();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const onRowPointerDown = (row: Row, e: PointerEvent<HTMLDivElement>) => {
    // By status, rows aren't where the files are: no drag (Move to… still works).
    if (e.button !== 0 || editing?.mode === 'rename' || grouped || row.virtual) return;
    drag.current = {
      rel: row.rel,
      x: e.clientX,
      y: e.clientY,
      items: selection.has(row.rel) ? [...selection] : [row.rel],
      active: false,
      target: null,
      hover: null,
      timer: null,
      px: e.clientX,
      py: e.clientY,
      frame: null,
    };
  };

  const onRowClick = (item: Extract<Item, { kind: 'row' }>, e: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) return;
    const { row } = item;
    setCursor(item.key);
    treeRef.current?.focus();
    if (e.metaKey || e.ctrlKey) {
      setSelection((s) => {
        const next = new Set(s);
        if (next.has(row.rel)) next.delete(row.rel);
        else next.add(row.rel);
        return next;
      });
      anchor.current = row.rel;
      return;
    }
    if (e.shiftKey && anchor.current) {
      const keys = rowItems.filter((i) => i.key.startsWith('row:') && !i.row.virtual).map((i) => i.row.rel);
      const a = keys.indexOf(anchor.current);
      const b = keys.indexOf(row.rel);
      if (a >= 0 && b >= 0) {
        setSelection(new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1)));
        return;
      }
    }
    anchor.current = row.rel;
    setSelection(new Set([row.rel]));
    // A folder with a folder note: its name opens the note (the chevron toggles, `onToggle`).
    if (row.kind === 'folder' && row.note) onOpenNote(abs(row.note));
    else if (row.kind === 'folder') toggleFolder(row.rel);
    else onOpenNote(abs(row.rel));
  };

  // ---- keyboard ----
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const mod = e.metaKey || e.ctrlKey;
    const i = rowItems.findIndex((x) => x.key === cursor);
    const cur = i >= 0 ? rowItems[i]! : undefined;
    const go = (j: number) => {
      const next = rowItems[Math.max(0, Math.min(rowItems.length - 1, j))];
      if (!next) return;
      setCursor(next.key);
      setSelection(new Set([next.row.rel]));
      anchor.current = next.row.rel;
      scrollTo(next.key);
    };
    const key = e.key;
    let handled = true;
    if (key === 'ArrowDown') go(i + 1);
    else if (key === 'ArrowUp') go(i < 0 ? 0 : i - 1);
    else if (key === 'ArrowRight' && cur?.row.kind === 'folder') {
      if (!cur.row.open) toggleFolder(cur.row.rel, true);
      else go(i + 1);
    } else if (key === 'ArrowLeft' && cur) {
      if (cur.row.kind === 'folder' && cur.row.open && !matches) toggleFolder(cur.row.rel, false);
      else {
        const parent = cur.row.parent;
        const j = rowItems.findIndex((x) => x.key === `row:${parent}`);
        if (parent && j >= 0) go(j);
      }
    } else if (key === 'Enter' && cur) {
      if (cur.row.kind === 'folder') toggleFolder(cur.row.rel);
      else onOpenNote(abs(cur.row.rel));
    } else if (keyAction(e)) {
      // The same actions as the menu items that show these keys (`KEY_ACTIONS`).
      const action = keyAction(e)!;
      const rel = cur?.row.rel ?? '';
      if (action === 'newNote') dispatch('newNote', folderOf(cur?.row.rel ?? null), true, []);
      else if (action === 'trash') dispatch('trash', rel, false, selection.size ? [...selection] : [rel]);
      else if (cur) dispatch(action, rel, cur.row.kind === 'folder', [rel]);
    } else if (mod && e.code === 'KeyZ' && !e.shiftKey) void undo();
    else if (key === 'Escape' && selection.size) setSelection(new Set());
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---- render ----
  const now = Date.now();
  const sourceOptions = [...enabled]
    .sort((a, b) => Number(projectIds.includes(b.id)) - Number(projectIds.includes(a.id)))
    .map((s) => ({ value: s.id, label: s.path.split('/').filter(Boolean).pop() ?? s.id }));
  const sortOptions = (['name', 'modified', 'created'] as const).map((s) => ({
    value: s,
    label: t(`explorer.sort.${s}`),
  }));
  const newHere = () => folderOf(cursor?.startsWith('row:') ? cursor.slice(4) : null);

  const head = (
    <>
      <Select
        aria-label={t('explorer.source')}
        title={t('explorer.source')}
        value={sourceId ?? ''}
        options={sourceOptions}
        onChange={(v) => setPicked(v)}
      />
      <Select
        aria-label={t('explorer.sort')}
        title={t('explorer.sort')}
        value={prefs.sort}
        options={sortOptions}
        onChange={(v) => savePrefs({ ...prefs, sort: v as NoteFsSort })}
      />
      <Button
        variant="ghost"
        icon
        title={t('explorer.newNote')}
        aria-label={t('explorer.newNote')}
        disabled={!list}
        onClick={() => startNew('note', newHere())}
      >
        +
      </Button>
      <Button
        variant="ghost"
        icon
        title={t('explorer.newFolder')}
        aria-label={t('explorer.newFolder')}
        disabled={!list}
        onClick={() => startNew('folder', newHere())}
      >
        ⊞
      </Button>
      <Button
        variant="ghost"
        icon
        title={t('explorer.reveal')}
        aria-label={t('explorer.reveal')}
        disabled={!currentRel}
        onClick={revealCurrent}
      >
        ◎
      </Button>
    </>
  );

  const inputFor = (e: Editing) => (
    <TreeInput
      value={e.value}
      label={
        e.mode === 'folder' || (e.mode === 'rename' && e.folder)
          ? t('explorer.name.folder')
          : t('explorer.name.note')
      }
      invalid={!!e.error}
      onChange={(value) => setEditing({ ...e, value, error: undefined } as Editing)}
      onSubmit={() => void submit()}
      onCancel={() => {
        setEditing(null);
        treeRef.current?.focus();
      }}
    />
  );

  /** A folder / note row; `pin` ≥ 0: its copy pinned at the top (sticky), at that position. */
  /** The row that shows a name field right now (see the render: it is kept last in the DOM). */
  const isEditingItem = (item: Item): boolean =>
    item.kind === 'input' ||
    (item.kind === 'row' &&
      item.key.startsWith('row:') &&
      editing?.mode === 'rename' &&
      editing.rel === item.row.rel);
  const rowView = (item: Extract<Item, { kind: 'row' }>, top: number, pin = -1) => {
    const { row } = item;
    const folder = row.kind === 'folder';
    const e = row.entry;
    const changed = !!e && now - e.mtime < CHANGED_MS && row.rel !== currentRel;
    const dot = e
      ? changed
        ? { tone: 'changed' as const, label: t('explorer.changed') }
        : e.status
          ? { tone: toneOf(e.status), label: t('explorer.status', { status: e.status }) }
          : null
      : null;
    const inTree = item.key.startsWith('row:');
    const renaming =
      inTree && pin < 0 && editing?.mode === 'rename' && editing.rel === row.rel ? editing : null;
    const name = row.virtual && !row.name ? t('explorer.noStatus') : row.name;
    const title = row.virtual
      ? `${name} · ${t('explorer.count', { n: String(row.count ?? 0) })}`
      : folder
        ? `${row.rel} · ${t('explorer.count', { n: String(row.count ?? 0) })}`
        : row.rel;
    return (
      <TreeRow
        key={pin >= 0 ? `sticky:${item.key}` : item.key}
        top={top}
        level={row.depth}
        kind={row.kind}
        name={name}
        rel={row.rel}
        {...(row.matches ? { matches: row.matches } : {})}
        open={!!row.open}
        selected={inTree && selection.has(row.rel)}
        current={folder ? !!row.note && row.note === currentRel : row.rel === currentRel}
        cursor={pin < 0 && item.key === cursor}
        drop={folder && dragView?.target === row.rel}
        dragging={!!dragView && selection.has(row.rel) && inTree}
        {...(folder ? { count: row.count ?? 0 } : {})}
        {...(row.note ? { folderNote: t('explorer.folderNote', { name: baseName(row.note) }) } : {})}
        {...(row.virtual ? { virtual: true } : {})}
        {...(pin >= 0 ? { sticky: true } : {})}
        dot={dot}
        title={title}
        {...(renaming ? { editor: inputFor(renaming) } : {})}
        actions={
          row.virtual ? undefined : (
            <>
              {HOVER_ACTIONS[row.kind].map((a) => (
                <TreeAction
                  key={a}
                  label={t(ACTION_LABEL[a])}
                  onClick={() => dispatch(a, row.rel, folder, [row.rel])}
                >
                  {a === 'newFolder' ? '⊞' : '+'}
                </TreeAction>
              ))}
              <TreeAction label={t('explorer.more')} onClick={() => void menu(row.rel, folder)}>
                ⋯
              </TreeAction>
            </>
          )
        }
        {...(folder && (row.note || pin >= 0) ? { onToggle: () => toggleFolder(row.rel) } : {})}
        onClick={(ev) => {
          if (pin < 0) return onRowClick(item, ev);
          // A pinned folder: back to where it is in the list (its own folders stay pinned above it).
          const i = items.findIndex((x) => x.key === item.key);
          if (treeRef.current && i >= 0) treeRef.current.scrollTop = Math.max(0, (i - pin) * rowH);
          setCursor(item.key);
          setSelection(new Set([row.rel]));
          treeRef.current?.focus();
        }}
        onContextMenu={(ev) => {
          ev.preventDefault();
          setCursor(item.key);
          void menu(row.rel, folder);
        }}
        onPointerDown={(ev) => inTree && pin < 0 && onRowPointerDown(row, ev)}
      />
    );
  };

  let body;
  if (!sourceId) body = null;
  else
    body = (
      <Tree
        label={t('explorer.title')}
        height={items.length * rowH}
        scrollRef={treeRef}
        onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          if ((e.target as Element).closest('.c-tree__row, .c-tree__section')) return;
          e.preventDefault();
          void emptyMenu();
        }}
        sticky={
          sticky.length
            ? sticky.map((i, k) => {
                const item = items[i];
                return item?.kind === 'row' ? rowView(item, k * rowH, k) : null;
              })
            : null
        }
      >
        {items
          .slice(first, last)
          .map((item, k) => ({ item, top: (first + k) * rowH }))
          // Visual order, except the row holding a name field (new note / folder, rename) goes last: rows are placed by
          // `top`, and when the tree reorders (a folder's children load, a file appears) React moves DOM nodes — moving
          // the focused field drops its focus and the first keys typed were lost. Last never moves.
          .sort((a, b) => Number(isEditingItem(a.item)) - Number(isEditingItem(b.item)))
          .map(({ item, top }) => {
            if (item.kind === 'section')
              return (
                <TreeSection key={item.key} top={top}>
                  {item.label}
                </TreeSection>
              );
            if (item.kind === 'input')
              return editing && editing.mode !== 'rename' ? (
                <TreeRow
                  key="input"
                  top={top}
                  level={item.depth}
                  kind={editing.mode === 'folder' ? 'folder' : 'file'}
                  name=""
                  rel=""
                  editor={inputFor(editing)}
                />
              ) : null;
            return rowView(item, top);
          })}
      </Tree>
    );

  const firstMatch = matches ? [...matches.keys()][0] : undefined;
  const folders = useMemo(() => {
    const out: string[] = [''];
    const walk = (f: TreeFolder) => {
      for (const d of f.folders) {
        out.push(d.rel);
        walk(d);
      }
    };
    walk(folderTree);
    return out;
  }, [folderTree]);

  return (
    <>
      <Explorer
        label={t('explorer.title')}
        head={head}
        filter={
          sourceId ? (
            <>
              <Input
                value={query}
                placeholder={t('explorer.filter')}
                aria-label={t('explorer.filter')}
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter' && firstMatch) {
                    e.preventDefault();
                    onOpenNote(abs(firstMatch));
                  } else if (e.key === 'Escape' && query) {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery('');
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    treeRef.current?.focus();
                    const firstRow = rowItems[0];
                    if (firstRow && !cursor) setCursor(firstRow.key);
                  }
                }}
              />
              <Button
                variant="ghost"
                icon
                title={t('explorer.groupStatus')}
                aria-label={t('explorer.groupStatus')}
                aria-pressed={grouped}
                onClick={() => savePrefs(applyView(prefsRef.current, 'view:group'))}
              >
                ☰
              </Button>
              <Button
                variant="ghost"
                icon
                title={t('explorer.view')}
                aria-label={t('explorer.view')}
                disabled={!sourceId}
                onClick={() => void viewMenu()}
              >
                ⋯
              </Button>
            </>
          ) : undefined
        }
        note={
          !sourceId
            ? { text: t('explorer.noSource') }
            : editing?.error
              ? { text: errorText(editing.error), warn: true }
              : matches && !matches.size
                ? { text: t('explorer.noMatch') }
                : note
        }
      >
        {body}
      </Explorer>
      {dragView && (
        <TreeGhost x={dragView.x} y={dragView.y}>
          {dragView.label}
        </TreeGhost>
      )}
      <Dialog
        open={!!linkAsk}
        title={t('explorer.links.title', { n: String(linkAsk?.links.length ?? 0) })}
        onClose={() => setLinkAsk(null)}
        actions={
          <>
            <Button
              variant="ghost"
              title={t('explorer.links.pref.never')}
              onClick={() => rememberLinks('never')}
            >
              {t('explorer.links.never')}
            </Button>
            <Button
              variant="ghost"
              title={t('explorer.links.pref.always')}
              onClick={() => rememberLinks('always')}
            >
              {t('explorer.links.always')}
            </Button>
            <Button variant="ghost" onClick={() => setLinkAsk(null)}>
              {t('explorer.links.skip')}
            </Button>
            <Button variant="primary" onClick={() => void fixLinks()}>
              {t('explorer.links.fix')}
            </Button>
          </>
        }
      >
        <p>{t('explorer.links.body')}</p>
        <ul>
          {linkAsk?.links.map((l) => (
            <li key={l.rel}>
              {l.rel} · {t('explorer.links.count', { n: String(l.count) })}
            </li>
          ))}
        </ul>
      </Dialog>
      <Dialog
        open={!!trashAsk}
        title={t('explorer.delete.title', { n: String(trashAsk?.length ?? 0) })}
        onClose={() => setTrashAsk(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setTrashAsk(null)}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => trashAsk && void trash(trashAsk)}>
              {t('explorer.delete')}
            </Button>
          </>
        }
      >
        <p>{t('explorer.delete.body')}</p>
        <ul>
          {trashAsk?.slice(0, 10).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Dialog>
      <MoveTo
        open={!!moveAsk}
        folders={folders}
        exclude={moveAsk ?? []}
        onClose={() => setMoveAsk(null)}
        onPick={(f) => {
          const rels = moveAsk ?? [];
          setMoveAsk(null);
          void move(rels, f);
        }}
        baseId={baseId}
      />
    </>
  );
}

/** "Move to…": every folder of the source, found by typing (fuzzy, the whole path). */
function MoveTo({
  open,
  folders,
  exclude,
  onClose,
  onPick,
  baseId,
}: {
  open: boolean;
  folders: string[];
  exclude: string[];
  onClose: () => void;
  onPick: (folder: string) => void;
  baseId: string;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);
  const allowed = folders.filter((f) => !exclude.some((x) => f === x || f.startsWith(`${x}/`)));
  const results = fuzzyRank(allowed, query, (f) => f || t('explorer.move.root')).slice(0, 200);
  const selected = Math.min(index, results.length - 1);
  const listId = `${baseId}-move`;
  const optionId = (i: number) => `${baseId}-move-${i}`;
  return (
    <Palette
      open={open}
      onClose={onClose}
      label={t('explorer.move.title')}
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      placeholder={t('explorer.move.placeholder')}
      listId={listId}
      activeId={results.length ? optionId(selected) : undefined}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        const n = results.length;
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
          e.preventDefault();
          setIndex((selected + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        } else if (e.key === 'Enter' && n) {
          e.preventDefault();
          onPick(results[selected]!.item);
        }
      }}
    >
      {results.length ? (
        <PaletteList id={listId}>
          {results.map(({ item, indices }, i) => (
            <PaletteItem
              key={item || '/'}
              id={optionId(i)}
              selected={i === selected}
              label={item || t('explorer.move.root')}
              marks={indices}
              onSelect={() => onPick(item)}
              onHover={() => setIndex(i)}
            />
          ))}
        </PaletteList>
      ) : (
        <PaletteEmpty>{t('explorer.move.none')}</PaletteEmpty>
      )}
    </Palette>
  );
}
