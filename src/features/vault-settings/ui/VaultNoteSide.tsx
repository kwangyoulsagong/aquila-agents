import { useState, type KeyboardEvent } from 'react';
import {
  Button,
  EditorFields,
  EditorItem,
  EditorSection,
  Field,
  FieldRow,
  Input,
  Select,
} from '@design-system/react';
import { api, type VaultProperty } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { cellText } from '../model/config';
import { useVaultNote } from '../model/useVaultNote';
import type { NoteSlot } from './slot';

const tagsOf = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** One typed property: select / date change at once, text / tags on Enter or leaving the field. */
function PropertyField({
  prop,
  value,
  disabled,
  onCommit,
}: {
  prop: VaultProperty;
  value: string | string[] | undefined;
  disabled: boolean;
  onCommit: (v: string | string[]) => void;
}) {
  const shown = cellText(value);
  const [draft, setDraft] = useState(shown);
  const [base, setBase] = useState(shown);
  // A new indexed value replaces the draft (the note was saved and re-read).
  if (shown !== base) {
    setBase(shown);
    setDraft(shown);
  }
  const commit = () => {
    if (draft === shown) return;
    onCommit(prop.type === 'tags' ? tagsOf(draft) : draft.trim());
  };
  const enter = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && commit();
  if (prop.type === 'select') {
    const options = [...new Set(['', ...(prop.options ?? []), ...(shown ? [shown] : [])])];
    return (
      <Field label={prop.key}>
        <Select
          value={shown}
          disabled={disabled}
          options={options.map((o) => ({ value: o, label: o || '—' }))}
          onChange={(v) => onCommit(v)}
        />
      </Field>
    );
  }
  return (
    <Field label={prop.key}>
      <Input
        type={prop.type === 'date' ? 'date' : 'text'}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          if (prop.type === 'date') onCommit(e.target.value);
        }}
        onBlur={prop.type === 'date' ? undefined : commit}
        onKeyDown={prop.type === 'date' ? undefined : enter}
      />
    </Field>
  );
}

/**
 * Beside the note's text (T69): its typed properties (written into the frontmatter as one edit), the source's views
 * and a new note from one of its templates.
 */
export default function VaultNoteSide({
  slot,
  onOpenNote,
  onOpenView,
}: {
  slot: NoteSlot;
  onOpenNote: (path: string) => void;
  onOpenView: (sourceId: string, viewId: string) => void;
}) {
  const t = useT();
  const info = useVaultNote(slot.path);
  const [template, setTemplate] = useState('');
  const [title, setTitle] = useState('');
  if (!info || (!info.properties.length && !info.views.length && !info.templates.length)) return null;

  const set = async (key: string, value: string | string[]) => {
    const r = await api.vaultEdit(slot.path, slot.text(), { property: key, value });
    if (r && 'text' in r) slot.apply(r.text);
  };
  const create = async () => {
    const name = title.trim();
    if (!name) return;
    const p = await api.vaultCreateNote(info.sourceId, template || info.templates[0]?.id || null, name);
    if (p) {
      setTitle('');
      onOpenNote(p);
    }
  };

  return (
    <>
      {info.properties.length > 0 && (
        <EditorSection title={t('vault.properties')}>
          <EditorFields>
            {info.properties.map((p) => (
              <PropertyField
                key={p.key}
                prop={p}
                value={info.values[p.key]}
                disabled={slot.readOnly}
                onCommit={(v) => void set(p.key, v)}
              />
            ))}
          </EditorFields>
        </EditorSection>
      )}
      {info.views.length > 0 && (
        <EditorSection title={t('vault.views')}>
          {info.views.map((v) => (
            <EditorItem key={v.id} label={v.name} onClick={() => onOpenView(info.sourceId, v.id)} />
          ))}
        </EditorSection>
      )}
      {info.templates.length > 0 && (
        <EditorSection title={t('vault.newNote')}>
          <EditorFields>
            {info.templates.length > 1 && (
              <Select
                value={template || info.templates[0]!.id}
                aria-label={t('vault.template')}
                options={info.templates.map((x) => ({ value: x.id, label: x.name }))}
                onChange={setTemplate}
              />
            )}
            <FieldRow>
              <Input
                value={title}
                placeholder={t('vault.newNoteTitle')}
                aria-label={t('vault.newNoteTitle')}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
              />
              <Button disabled={!title.trim()} onClick={() => void create()}>
                {t('vault.create')}
              </Button>
            </FieldRow>
          </EditorFields>
        </EditorSection>
      )}
    </>
  );
}
