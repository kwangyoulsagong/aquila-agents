import { useCallback, useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Button,
  DataGrid,
  EmptyState,
  GridBar,
  GridCell,
  GridChip,
  GridChips,
  GridFrame,
  GridGroup,
  GridInput,
  GridOpen,
  GridRow,
  Input,
  Modal,
  ModalNote,
  Select,
  type GridColumn,
} from '@design-system/react';
import type { VaultProperty } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { sourceName } from '@/entities/note';
import { writeProp } from '@/features/note-properties';
import {
  byStatus,
  cellText,
  defaultColumns,
  filterRows,
  FOLDER,
  folderOf,
  groupRows,
  keysOf,
  MODIFIED,
  nextSort,
  prepare,
  sortRows,
  splitList,
  STATUS,
  statusCounts,
  TITLE,
  valuesOf,
  type Row,
} from '../model/table';
import { readPrefs, writeLastSource, writePrefs, type TablePrefs } from '../model/prefs';
import { useSources, useTableData } from '../model/useTableData';

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

/** Every folder that holds notes, with its parents (a filter shows the folder and everything under it). */
function foldersOf(rows: readonly Row[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (let f = r.folder; f && !set.has(f); f = folderOf(f)) set.add(f);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Table view (T78): a source's notes as rows, their frontmatter keys as columns (pick which, sort by any, group by
 * one), filtered by text, folder, `property = value` and status chips. Rows come from the index (no disk scan) and
 * are virtualized, so a few thousand notes stay smooth. A title opens the note; double-click (or Enter on) a cell
 * edits that property — only its lines in the file change.
 */
export default function NoteTableModal({
  initialSource,
  initialPath,
  onClose,
  onOpenNote,
}: {
  initialSource?: string;
  /** Opened from a note: its source, filtered to its folder. */
  initialPath?: string;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}) {
  const t = useT();
  const { sources, selected, setSelected } = useSources(initialSource, initialPath);
  const { data, patch } = useTableData(selected);
  const [prefs, setPrefsState] = useState<TablePrefs>(() => (selected ? readPrefs(selected) : readPrefs('')));
  const [prefsFor, setPrefsFor] = useState(selected);
  if (selected !== prefsFor) {
    setPrefsFor(selected);
    setPrefsState(selected ? readPrefs(selected) : readPrefs(''));
  }
  const setPrefs = (p: Partial<TablePrefs>) => {
    const next = { ...prefs, ...p };
    setPrefsState(next);
    if (selected) writePrefs(selected, next);
  };

  const [text, setText] = useState('');
  const query = useDeferredValue(text);
  const [folder, setFolder] = useState<string | null>(null);
  const [propKey, setPropKey] = useState('');
  const [propValue, setPropValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{ path: string; key: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const rows = useMemo(() => prepare(data?.notes ?? []), [data]);
  const keys = useMemo(() => keysOf(rows), [rows]);
  const folders = useMemo(() => foldersOf(rows), [rows]);
  const types = useMemo(
    () => new Map<string, VaultProperty>((data?.properties ?? []).map((p) => [p.key, p])),
    [data],
  );
  // Opened from a note: its folder, once the rows are known (unless a folder was picked already).
  const inFolder =
    folder ??
    (initialPath && data?.sourceId === selected
      ? (rows.find((r) => r.card.path === initialPath)?.folder ?? '')
      : '');
  const cols = useMemo(() => {
    const all = new Set([FOLDER, MODIFIED, ...keys]);
    return (prefs.cols ?? defaultColumns(keys)).filter((c) => all.has(c));
  }, [prefs.cols, keys]);
  const prop = propKey && propValue ? { key: propKey, value: propValue } : null;
  const filtered = useMemo(
    () => filterRows(rows, { text: query, folder: inFolder, prop }),
    // `prop` is rebuilt every render; its parts are the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, query, inFolder, propKey, propValue],
  );
  const counts = useMemo(() => statusCounts(filtered), [filtered]);
  const shownStatus = status !== null && counts.some((c) => c.value === status) ? status : null;
  const items = useMemo(
    () => groupRows(sortRows(byStatus(filtered, shownStatus), prefs.sort), prefs.group),
    [filtered, shownStatus, prefs.sort, prefs.group],
  );
  const rowCount = useMemo(() => items.filter((i) => i.kind === 'row').length, [items]);
  const propValues = useMemo(() => (propKey ? valuesOf(rows, propKey).slice(0, 200) : []), [rows, propKey]);

  const label = (c: string) =>
    c === TITLE
      ? t('table.col.title')
      : c === FOLDER
        ? t('table.col.folder')
        : c === MODIFIED
          ? t('table.col.modified')
          : c;
  const columns: GridColumn[] = [TITLE, ...cols].map((c) => ({
    id: c,
    label: label(c),
    sort: prefs.sort?.key === c ? (prefs.sort.dir === 1 ? 'ascending' : 'descending') : undefined,
    onSort: () => setPrefs({ sort: nextSort(prefs.sort, c) }),
  }));

  const open = (path: string) => {
    onClose();
    onOpenNote(path);
  };

  // The cell being edited, cleared by the first of Enter / leaving / Escape (an unmounting input blurs too).
  const live = useRef<string | null>(null);
  const commit = async (row: Row, key: string, raw: string) => {
    if (live.current !== `${row.card.path}\u0000${key}`) return;
    live.current = null;
    setEditing(null);
    const before = row.card.props[key];
    const list = Array.isArray(before) || types.get(key)?.type === 'tags';
    if (raw.trim() === cellText(before).trim()) return;
    if (before === undefined && !raw.trim()) return;
    const value = list ? splitList(raw) : raw.trim();
    patch(row.card.path, { ...row.card.props, [key]: value });
    const r = await writeProp(row.card.path, key, value);
    setProblem(r === 'ok' ? null : t(`table.saveFailed.${r}`));
    if (r !== 'ok') patch(row.card.path, row.card.props);
  };

  const startEdit = (row: Row, key: string) => {
    setDraft(cellText(row.card.props[key]));
    setEditing({ path: row.card.path, key });
    live.current = `${row.card.path}\u0000${key}`;
  };

  const cell = (row: Row, c: string) => {
    if (c === FOLDER) return <GridCell key={c} text={row.folder} muted />;
    if (c === MODIFIED)
      return <GridCell key={c} text={row.card.mtime ? when.format(row.card.mtime) : ''} muted />;
    const v = row.card.props[c];
    const shown = cellText(v);
    const raw = typeof v === 'string' && v.includes('\n');
    const isEditing = editing?.path === row.card.path && editing.key === c;
    const decl = types.get(c);
    let editor = null;
    if (isEditing && decl?.type === 'select') {
      const options = [...new Set(['', ...(decl.options ?? []), ...(shown ? [shown] : [])])];
      editor = (
        <Select
          autoFocus
          value={shown}
          aria-label={c}
          options={options.map((o) => ({ value: o, label: o || '—' }))}
          onChange={(nv) => void commit(row, c, nv)}
          onBlur={() => {
            live.current = null;
            setEditing(null);
          }}
        />
      );
    } else if (isEditing)
      editor = (
        <GridInput
          autoFocus
          type={decl?.type === 'date' && (!shown || /^\d{4}-\d{2}-\d{2}$/.test(shown)) ? 'date' : 'text'}
          value={draft}
          aria-label={c}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit(row, c, draft)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') void commit(row, c, draft);
            else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              live.current = null;
              setEditing(null);
            }
          }}
        />
      );
    return (
      <GridCell
        key={c}
        text={shown}
        editing={isEditing}
        editor={editor}
        editLabel={t('table.editHint')}
        onEdit={raw ? undefined : () => startEdit(row, c)}
      />
    );
  };

  const renderRow = useCallback(
    (i: number) => {
      const it = items[i]!;
      if (it.kind === 'group') return <GridGroup title={it.title || t('table.none')} count={it.count} />;
      const r = it.row;
      return (
        <GridRow>
          <GridOpen label={r.card.title} title={r.card.rel} onOpen={() => open(r.card.path)} />
          {cols.map((c) => cell(r, c))}
        </GridRow>
      );
    },
    // Rows re-render when anything they show changes; the closures read the same render's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, cols, editing, draft, types, t],
  );
  const rowKey = useCallback(
    (i: number) => {
      const it = items[i]!;
      return it.kind === 'group' ? `g:${it.key}` : it.row.card.path;
    },
    [items],
  );

  const source = sources?.find((s) => s.id === selected);
  const toggleCol = (c: string) =>
    setPrefs({ cols: cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c] });

  let body;
  if (sources && !sources.length) body = <EmptyState title={t('table.noSources')} />;
  else
    body = (
      <GridFrame>
        <GridBar>
          {sources && sources.length > 1 && (
            <Select
              value={selected ?? ''}
              aria-label={t('table.source')}
              options={sources.map((s) => ({ value: s.id, label: sourceName(s.path) }))}
              onChange={(id) => {
                setSelected(id);
                writeLastSource(id);
                setFolder('');
                setPropKey('');
                setPropValue('');
                setStatus(null);
              }}
            />
          )}
          <Input
            value={text}
            placeholder={t('table.search')}
            aria-label={t('table.search')}
            data-autofocus=""
            onChange={(e) => setText(e.target.value)}
          />
          <Select
            value={inFolder}
            aria-label={t('table.folder')}
            options={[
              { value: '', label: t('table.allFolders') },
              ...folders.map((f) => ({ value: f, label: f })),
            ]}
            onChange={setFolder}
          />
          <Select
            value={propKey}
            aria-label={t('table.filterKey')}
            options={[
              { value: '', label: t('table.filterKey') },
              ...keys.map((k) => ({ value: k, label: k })),
            ]}
            onChange={(k) => {
              setPropKey(k);
              setPropValue('');
            }}
          />
          {propKey && (
            <Select
              value={propValue}
              aria-label={t('table.filterValue')}
              options={[
                { value: '', label: t('table.anyValue') },
                ...propValues.map((v) => ({ value: v.value, label: `${v.value} (${v.count})` })),
              ]}
              onChange={setPropValue}
            />
          )}
          <Select
            value={prefs.group}
            aria-label={t('table.groupBy')}
            options={[
              { value: '', label: t('table.noGroup') },
              { value: FOLDER, label: t('table.groupBy.folder') },
              ...keys.map((k) => ({ value: k, label: t('table.groupBy.key', { key: k }) })),
            ]}
            onChange={(g) => setPrefs({ group: g })}
          />
          <Button variant="ghost" aria-pressed={picking} onClick={() => setPicking((p) => !p)}>
            {t('table.columns')}
          </Button>
        </GridBar>
        {picking && (
          <GridChips label={t('table.columns')}>
            {[FOLDER, ...keys, MODIFIED].map((c) => (
              <GridChip key={c} label={label(c)} pressed={cols.includes(c)} onClick={() => toggleCol(c)} />
            ))}
            {prefs.cols && (
              <Button variant="ghost" onClick={() => setPrefs({ cols: null })}>
                {t('table.columnsReset')}
              </Button>
            )}
          </GridChips>
        )}
        {counts.length > 0 && (
          <GridChips label={t('table.status', { key: STATUS })}>
            {counts.map((c) => (
              <GridChip
                key={c.value}
                label={c.value}
                count={c.count}
                pressed={shownStatus === c.value}
                onClick={() => setStatus(shownStatus === c.value ? null : c.value)}
              />
            ))}
          </GridChips>
        )}
        {problem && <ModalNote warn>{problem}</ModalNote>}
        <DataGrid
          key={selected ?? ''}
          label={t('table.title')}
          columns={columns}
          count={items.length}
          rowKey={rowKey}
          renderRow={renderRow}
          empty={data === undefined ? t('table.loading') : t('table.empty')}
        />
      </GridFrame>
    );

  return (
    <Modal
      open
      wide
      title={t('table.title')}
      subtitle={source ? sourceName(source.path) : undefined}
      onClose={onClose}
      closeLabel={t('action.close')}
      footer={
        data
          ? t('table.footer', { shown: rowCount.toLocaleString(), total: rows.length.toLocaleString() })
          : undefined
      }
    >
      {body}
    </Modal>
  );
}
