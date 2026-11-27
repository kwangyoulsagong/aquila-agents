import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  Button,
  PropChip,
  PropChips,
  PropInput,
  PropPanel,
  PropRaw,
  PropRow,
  Select,
} from '@design-system/react';
import type { VaultProperty } from '@/shared/api';
import { useT } from '@/shared/i18n';
import {
  kindOf,
  readFrontmatter,
  removeProp,
  setProp,
  validKey,
  type FmEntry,
  type PropValue,
} from '../model/frontmatter';
import { useDeclared } from '../model/useDeclared';

/**
 * What the editor hands its slots (structurally the same as `edit-note`'s `NoteSlotProps`; features don't import
 * each other, the page passes it through).
 */
export interface PropsSlot {
  path: string;
  text: () => string;
  version: string;
  apply: (next: string) => void;
  readOnly: boolean;
}

const OPEN_KEY = 'aquila.note.props';
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}
function writeOpen(on: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, on ? '1' : '0');
  } catch {
    // not remembered: open again next time
  }
}

const splitItems = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** A text field committed on Enter or leaving it; Escape puts the value back. A new value from the text wins. */
function TextValue({
  value,
  label,
  disabled,
  type = 'text',
  onCommit,
}: {
  value: string;
  label: string;
  disabled: boolean;
  type?: 'text' | 'date';
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  const commit = (v = draft) => v !== value && onCommit(type === 'date' ? v : v.trim());
  return (
    <PropInput
      type={type}
      value={draft}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value);
        if (type === 'date') commit(e.target.value);
      }}
      onBlur={type === 'date' ? undefined : () => commit()}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

/** List values as chips (× removes one) and an input at the end: Enter or a comma adds what's typed. */
function TagsValue({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: string[];
  label: string;
  disabled: boolean;
  onCommit: (v: string[]) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const add = () => {
    const items = splitItems(draft).filter((x) => !value.includes(x));
    setDraft('');
    if (items.length) onCommit([...value, ...items]);
  };
  return (
    <PropChips>
      {value.map((v, i) => (
        <PropChip
          key={`${i}:${v}`}
          label={v}
          removeLabel={disabled ? undefined : t('props.removeValue', { value: v })}
          onRemove={disabled ? undefined : () => onCommit(value.filter((_, j) => j !== i))}
        />
      ))}
      {!disabled && (
        <PropInput
          value={draft}
          aria-label={t('props.addValue', { key: label })}
          placeholder={t('props.addValuePlaceholder')}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) {
              const items = splitItems(v).filter((x) => !value.includes(x));
              setDraft('');
              if (items.length) onCommit([...value, ...items]);
            } else setDraft(v);
          }}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            else if (e.key === 'Backspace' && !draft && value.length) onCommit(value.slice(0, -1));
          }}
        />
      )}
    </PropChips>
  );
}

function Value({
  entry,
  declared,
  disabled,
  onCommit,
}: {
  entry: FmEntry;
  declared: VaultProperty | undefined;
  disabled: boolean;
  onCommit: (v: PropValue) => void;
}) {
  const kind = kindOf(entry, declared?.type);
  const v = entry.value;
  if (kind === 'raw')
    return (
      <PropRaw title={typeof v === 'string' ? v : v.join('\n')}>
        {typeof v === 'string' ? v.replace(/\n/g, ' · ') : v.join(', ')}
      </PropRaw>
    );
  if (kind === 'tags')
    return (
      <TagsValue
        value={Array.isArray(v) ? v : v ? [v] : []}
        label={entry.key}
        disabled={disabled}
        onCommit={onCommit}
      />
    );
  const text = Array.isArray(v) ? v.join(', ') : v;
  if (kind === 'select') {
    const options = [...new Set(['', ...(declared?.options ?? []), ...(text ? [text] : [])])];
    return (
      <Select
        value={text}
        disabled={disabled}
        aria-label={entry.key}
        options={options.map((o) => ({ value: o, label: o || '—' }))}
        onChange={onCommit}
      />
    );
  }
  return (
    <TextValue
      value={text}
      label={entry.key}
      type={kind === 'date' ? 'date' : 'text'}
      disabled={disabled}
      onCommit={onCommit}
    />
  );
}

/** The "add a property" row: a key and a value; Enter adds it, Escape (or an empty key on leaving) cancels. */
function AddRow({
  taken,
  onAdd,
  onCancel,
}: {
  taken: (key: string) => boolean;
  onAdd: (key: string, value: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const bad = !!key.trim() && (!validKey(key) || taken(key.trim()));
  const submit = () => {
    if (!key.trim() || bad) return;
    onAdd(key.trim(), value.trim());
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <PropRow
      name={
        <PropInput
          autoFocus
          value={key}
          aria-label={t('props.newKey')}
          aria-invalid={bad || undefined}
          title={bad ? t('props.badKey') : undefined}
          placeholder={t('props.newKey')}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={keys}
        />
      }
      onRemove={onCancel}
      removeLabel={t('action.cancel')}
    >
      <PropInput
        value={value}
        aria-label={t('props.newValue')}
        placeholder={t('props.newValue')}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={keys}
        onBlur={() => key.trim() && submit()}
      />
    </PropRow>
  );
}

/**
 * Above every note's text (T78): its frontmatter as properties — edit a value in place, add one, remove one. Each
 * edit changes only that key's lines (an edit of the editor's text, saved like typing), so the raw frontmatter in the
 * text and this panel stay one thing. Folds, remembered; a note without frontmatter shows only "Add property".
 */
export default function NoteProperties({
  slot,
  onOpenTable,
}: {
  slot: PropsSlot;
  onOpenTable?: (path: string) => void;
}) {
  const t = useT();
  const [open, setOpenState] = useState(readOpen);
  const [adding, setAdding] = useState(false);
  const declared = useDeclared(slot.path);
  // The editor's text after edits settle: line breaks are `\n` there, which is all reading needs.
  const fm = useMemo(() => readFrontmatter(slot.version), [slot.version]);
  const types = useMemo(() => new Map(declared.map((p) => [p.key, p])), [declared]);
  const setOpen = (on: boolean) => {
    setOpenState(on);
    writeOpen(on);
  };
  if (slot.readOnly && !fm) return null;

  const edit = (change: (src: string) => string) => {
    if (slot.readOnly) return;
    const cur = slot.text();
    const next = change(cur);
    if (next !== cur) slot.apply(next);
  };
  const entries = fm?.entries ?? [];

  return (
    <PropPanel
      title={t('props.title')}
      count={entries.length || undefined}
      open={open}
      onToggle={() => setOpen(!open)}
      actions={
        <>
          {!slot.readOnly && (
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(true);
                setAdding(true);
              }}
            >
              {t('props.add')}
            </Button>
          )}
          {onOpenTable && (
            <Button variant="ghost" onClick={() => onOpenTable(slot.path)} title={t('table.openHint')}>
              {t('table.open')}
            </Button>
          )}
        </>
      }
    >
      {entries.length > 0 || adding ? (
        <>
          {entries.map((e) => (
            <PropRow
              key={e.key}
              name={e.key}
              title={e.key}
              onRemove={slot.readOnly ? undefined : () => edit((src) => removeProp(src, e.key))}
              removeLabel={t('props.remove', { key: e.key })}
            >
              <Value
                entry={e}
                declared={types.get(e.key)}
                disabled={slot.readOnly}
                onCommit={(v) => edit((src) => setProp(src, e.key, v))}
              />
            </PropRow>
          ))}
          {adding && (
            <AddRow
              taken={(k) => entries.some((e) => e.key === k)}
              onCancel={() => setAdding(false)}
              onAdd={(key, value) => {
                const type = types.get(key)?.type;
                edit((src) => setProp(src, key, type === 'tags' ? splitItems(value) : value));
                setAdding(false);
              }}
            />
          )}
        </>
      ) : null}
    </PropPanel>
  );
}
