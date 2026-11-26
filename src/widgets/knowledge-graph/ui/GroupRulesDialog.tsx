import { Button, Dialog, DialogGroup, Field, FieldGrid, Input } from '@design-system/react';
import { useT } from '@/shared/i18n';
import type { GroupRule } from '../model/groups';

/**
 * The user's own Map groups (T73), like Obsidian's graph "Groups": a name and a query. A node goes to the first
 * group whose query it matches; the rest keep their folder / kind group. Edits apply as you type.
 */
export function GroupRulesDialog({
  open,
  rules,
  onChange,
  onClose,
}: {
  open: boolean;
  rules: GroupRule[];
  onChange: (rules: GroupRule[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const set = (id: string, patch: Partial<GroupRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <Dialog
      open={open}
      title={t('graph.groups.edit')}
      onClose={onClose}
      actions={
        <>
          <Button
            variant="ghost"
            onClick={() =>
              onChange([...rules, { id: Math.random().toString(36).slice(2, 10), name: '', query: '' }])
            }
          >
            {t('graph.groups.add')}
          </Button>
          <Button onClick={onClose}>{t('action.close')}</Button>
        </>
      }
    >
      <p>{t('graph.groups.editHint')}</p>
      {rules.map((r) => (
        <DialogGroup key={r.id}>
          <FieldGrid>
            <Field label={t('graph.groups.name')}>
              <Input
                value={r.name}
                placeholder={t('graph.groups.namePlaceholder')}
                onChange={(e) => set(r.id, { name: e.currentTarget.value })}
              />
            </Field>
            <Field label={t('graph.groups.query')}>
              <Input
                value={r.query}
                placeholder="path:specs tag:auth"
                onChange={(e) => set(r.id, { query: e.currentTarget.value })}
              />
            </Field>
          </FieldGrid>
          <Button variant="ghost" onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
            {t('graph.groups.remove')}
          </Button>
        </DialogGroup>
      ))}
    </Dialog>
  );
}
