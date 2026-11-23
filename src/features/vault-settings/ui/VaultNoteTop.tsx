import { Button, EditorTab, EditorTabs } from '@design-system/react';
import { api } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { useVaultNote } from '../model/useVaultNote';
import type { NoteSlot } from './slot';

/**
 * Above the note's text (T69): its companion files as tabs (a spec, its checklist, its retrospect) and the note
 * actions its source defines. An insert action changes the text as one edit (saved like typing); a Claude action
 * opens a Claude tab with its prompt and the note.
 */
export default function VaultNoteTop({
  slot,
  onOpenNote,
  onClaude,
}: {
  slot: NoteSlot;
  onOpenNote: (path: string) => void;
  onClaude: (prompt: string, projectId: string | undefined) => void;
}) {
  const t = useT();
  const info = useVaultNote(slot.path);
  if (!info || (!info.companions.length && !info.actions.length)) return null;

  const run = async (id: string) => {
    const r = await api.vaultEdit(slot.path, slot.text(), { action: id });
    if (!r) return;
    if ('text' in r) slot.apply(r.text);
    else onClaude(r.prompt, r.projectId);
  };

  return (
    <EditorTabs
      label={t('vault.companions')}
      end={info.actions.map((a) => (
        <Button
          key={a.id}
          variant="ghost"
          disabled={a.kind === 'insert' && slot.readOnly}
          title={a.kind === 'claude' ? t('vault.action.claudeHint') : t('vault.action.insertHint')}
          onClick={() => void run(a.id)}
        >
          {a.name}
        </Button>
      ))}
    >
      {info.companions.length > 0 &&
        info.companions.map((c) => (
          <EditorTab
            key={c.path}
            selected={c.path === slot.path}
            title={c.path}
            onClick={() => c.path !== slot.path && onOpenNote(c.path)}
          >
            {c.label}
          </EditorTab>
        ))}
    </EditorTabs>
  );
}
