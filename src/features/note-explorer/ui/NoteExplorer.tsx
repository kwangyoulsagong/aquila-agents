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
  type ContextMenuItem,
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
  filterFiles,
  flatten,
  movedPath,
  nextId,
  projectSourceIds,
  stripMd,
  within,
  type Row,
  type TreeFolder,
} from '../model/tree';

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
  useEffect(() => {
    if (currentSource) setPicked(null);
  }, [currentSource]);
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
  const tree = useMemo(() => buildTree(files, dirs, prefs.sort), [files, dirs, prefs.sort]);
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
  const [linkAsk, setLinkAsk] = useState<{ files: NoteFsMove[]; links: NoteFsLinkNote[] } | null>(null);
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
    const up = ancestors(currentRel);
    if (up.length) setExpanded((s) => (up.every((a) => s.has(a)) ? s : new Set([...s, ...up])));
    setCursor(`row:${currentRel}`);
    setSelection(new Set([currentRel]));
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
        return { kind: 'file', rel, name: stripMd(baseName(rel)), depth: 0, ...(entry ? { entry } : {}) };
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
    const rows = flatten(tree, expanded, matches);
    const adding = editing && editing.mode !== 'rename' ? editing.parent : null;
    if (adding === '') out.push({ key: 'input', kind: 'input', depth: 0 });
    for (const row of rows) {
      out.push({ key: `row:${row.rel}`, kind: 'row', row });
      if (adding && row.kind === 'folder' && row.rel === adding)
        out.push({ key: 'input', kind: 'input', depth: row.depth + 1 });
    }
    return out;
  }, [matches, prefs.pins, prefs.recent, known, files, tree, expanded, editing, t]);
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
    if (!reveal.current || !currentRel || !items.some((i) => i.key === `row:${currentRel}`)) return;
    reveal.current = false;
    scrollTo(`row:${currentRel}`);
  }, [items, currentRel, scrollTo]);

  // ---- operations ----
  const folderOf = (rel: string | null): string => {
    if (!rel) return '';
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
    if (res.links.length) setLinkAsk({ files: res.files, links: res.links });
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

  const fixLinks = async () => {
    const ask = linkAsk;
    setLinkAsk(null);
    if (!ask || !sourceId) return;
    await beforeChange();
    const r = await api.noteFsFixLinks(
      sourceId,
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

  const togglePin = (rel: string) => {
    const p = prefsRef.current;
    savePrefs({ ...p, pins: p.pins.includes(rel) ? p.pins.filter((r) => r !== rel) : [...p.pins, rel] });
  };

  const revealCurrent = () => {
    if (!currentRel) return;
    setQuery('');
    const up = ancestors(currentRel);
    setExpanded((s) => new Set([...s, ...up]));
    setCursor(`row:${currentRel}`);
    setSelection(new Set([currentRel]));
    reveal.current = true;
    treeRef.current?.focus();
  };

  const toggleFolder = (rel: string, open?: boolean) => {
    const willOpen = open ?? !expanded.has(rel);
    setExpanded((s) => {
      const next = new Set(s);
      if (willOpen) next.add(rel);
      else next.delete(rel);
      return next;
    });
    if (willOpen) loadDirs(rel);
  };

  const targets = (rel: string) => (selection.has(rel) && selection.size > 1 ? [...selection] : [rel]);

  const menu = async (rel: string, folder: boolean) => {
    if (!sourceId) return;
    if (!selection.has(rel)) setSelection(new Set([rel]));
    const sel = targets(rel);
    const one = sel.length === 1;
    const items: ContextMenuItem[] = [
      { id: 'note', label: t('explorer.newNote'), accelerator: 'CommandOrControl+N' },
      { id: 'folder', label: t('explorer.newFolder') },
      { separator: true },
      { id: 'rename', label: t('explorer.rename'), enabled: one, accelerator: 'F2' },
      { id: 'move', label: t('explorer.moveTo') },
      ...(!folder && one
        ? [{ id: 'pin', label: prefs.pins.includes(rel) ? t('explorer.unpin') : t('explorer.pin') }]
        : []),
      { separator: true },
      { id: 'finder', label: t('explorer.finder'), enabled: one },
      ...(!folder ? [{ id: 'open', label: t('explorer.openDefault'), enabled: one }] : []),
      { id: 'copy', label: t('explorer.copyPath') },
      { id: 'copyRel', label: t('explorer.copyRel') },
      { separator: true },
      { id: 'trash', label: t('explorer.delete'), accelerator: 'CommandOrControl+Backspace' },
    ];
    const id = await api.showContextMenu(items);
    run(id, rel, folder, sel);
  };

  const run = (id: string | null, rel: string, folder: boolean, sel: string[]) => {
    if (!sourceId || !id) return;
    if (id === 'note') startNew('note', folder ? rel : dirName(rel));
    else if (id === 'folder') startNew('folder', folder ? rel : dirName(rel));
    else if (id === 'rename') startRename(rel);
    else if (id === 'move') setMoveAsk(sel);
    else if (id === 'pin') togglePin(rel);
    else if (id === 'finder') void api.noteFsShell(sourceId, rel, 'reveal');
    else if (id === 'open') void api.noteFsShell(sourceId, rel, 'open');
    else if (id === 'copy') api.copyText(sel.map(abs).join('\n'));
    else if (id === 'copyRel') api.copyText(sel.join('\n'));
    else if (id === 'trash') setTrashAsk(sel);
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

  useEffect(() => {
    const end = () => {
      const d = drag.current;
      if (d?.timer) clearTimeout(d.timer);
      drag.current = null;
      setDragView(null);
    };
    const onMove = (e: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return;
      d.active = true;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest<HTMLElement>('.c-tree__row');
      const inTree = !!el && !!treeRef.current?.contains(el);
      let target: string | null = null;
      if (row?.dataset.rel !== undefined && inTree)
        target = row.dataset.kind === 'folder' ? row.dataset.rel : dirName(row.dataset.rel);
      else if (inTree) target = '';
      if (target !== null && d.items.some((i) => target === i || target!.startsWith(`${i}/`))) target = null;
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
      setDragView({ x: e.clientX, y: e.clientY, label: stripMd(label), target });
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
    if (e.button !== 0 || editing?.mode === 'rename') return;
    drag.current = {
      rel: row.rel,
      x: e.clientX,
      y: e.clientY,
      items: selection.has(row.rel) ? [...selection] : [row.rel],
      active: false,
      target: null,
      hover: null,
      timer: null,
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
      const keys = rowItems.filter((i) => i.key.startsWith('row:')).map((i) => i.row.rel);
      const a = keys.indexOf(anchor.current);
      const b = keys.indexOf(row.rel);
      if (a >= 0 && b >= 0) {
        setSelection(new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1)));
        return;
      }
    }
    anchor.current = row.rel;
    setSelection(new Set([row.rel]));
    if (row.kind === 'folder') toggleFolder(row.rel);
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
        const parent = dirName(cur.row.rel);
        const j = rowItems.findIndex((x) => x.key === `row:${parent}`);
        if (parent && j >= 0) go(j);
      }
    } else if (key === 'Enter' && cur) {
      if (cur.row.kind === 'folder') toggleFolder(cur.row.rel);
      else onOpenNote(abs(cur.row.rel));
    } else if (key === 'F2' && cur) startRename(cur.row.rel);
    else if ((key === 'Backspace' && mod) || key === 'Delete') {
      const sel = selection.size ? [...selection] : cur ? [cur.row.rel] : [];
      if (sel.length) setTrashAsk(sel);
    } else if (mod && e.code === 'KeyN' && !e.shiftKey) startNew('note', folderOf(cur?.row.rel ?? null));
    else if (mod && e.code === 'KeyZ' && !e.shiftKey) void undo();
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
      >
        {items.slice(first, last).map((item, k) => {
          const top = (first + k) * rowH;
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
          const renaming = inTree && editing?.mode === 'rename' && editing.rel === row.rel ? editing : null;
          return (
            <TreeRow
              key={item.key}
              top={top}
              level={row.depth}
              kind={row.kind}
              name={row.name}
              rel={row.rel}
              {...(row.matches ? { matches: row.matches } : {})}
              open={!!row.open}
              selected={inTree && selection.has(row.rel)}
              current={!folder && row.rel === currentRel}
              cursor={item.key === cursor}
              drop={folder && dragView?.target === row.rel}
              dragging={!!dragView && selection.has(row.rel) && inTree}
              {...(folder ? { count: row.count ?? 0 } : {})}
              dot={dot}
              title={folder ? `${row.rel} · ${t('explorer.count', { n: String(row.count ?? 0) })}` : row.rel}
              {...(renaming ? { editor: inputFor(renaming) } : {})}
              actions={
                <>
                  {folder && (
                    <>
                      <TreeAction label={t('explorer.newNote')} onClick={() => startNew('note', row.rel)}>
                        +
                      </TreeAction>
                      <TreeAction label={t('explorer.newFolder')} onClick={() => startNew('folder', row.rel)}>
                        ⊞
                      </TreeAction>
                    </>
                  )}
                  <TreeAction label={t('explorer.more')} onClick={() => void menu(row.rel, folder)}>
                    ⋯
                  </TreeAction>
                </>
              }
              onClick={(ev) => onRowClick(item, ev)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                setCursor(item.key);
                void menu(row.rel, folder);
              }}
              onPointerDown={(ev) => inTree && onRowPointerDown(row, ev)}
            />
          );
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
    walk(tree);
    return out;
  }, [tree]);

  return (
    <>
      <Explorer
        label={t('explorer.title')}
        head={head}
        filter={
          sourceId ? (
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
