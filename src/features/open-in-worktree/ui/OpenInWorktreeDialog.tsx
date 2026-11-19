import { useId, useState } from 'react';
import { Button, Dialog, DialogForm, Field, Input } from '@design-system/react';
import type { Project } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { useWorktreeInfo } from '../model/useWorktreeInfo';
import { worktreeTarget } from '../model/target';

interface Props {
  project: Project;
  onClose: () => void;
  /** Opens Claude in the worktree of `branch` (main creates or reuses it). Throws with git's message. */
  onOpen: (branch: string) => Promise<void>;
}

/** "New Claude in worktree": pick or type a branch; the session runs in `../<repo>-wt/<branch>`. */
export default function OpenInWorktreeDialog({ project, onClose, onOpen }: Props) {
  const t = useT();
  const formId = useId();
  const listId = useId();
  const { info, error: loadError } = useWorktreeInfo(project.id);
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = info && worktreeTarget(info, branch);
  const hint = !target
    ? info?.isRepo && t('worktree.hintEmpty', { root: info.root })
    : target.kind === 'reuse'
      ? t('worktree.hintReuse', { path: target.path })
      : target.kind === 'checkout'
        ? t('worktree.hintCheckout', { path: target.path })
        : t('worktree.hintCreate', { path: target.path, from: target.from || 'HEAD' });

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(branch.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={t('worktree.title')}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!target || busy}>
            {t('worktree.open')}
          </Button>
        </>
      }
    >
      {info && !info.isRepo ? (
        <p>{t('worktree.notRepo', { name: project.name })}</p>
      ) : (
        <DialogForm id={formId} onSubmit={submit}>
          <Field label={t('worktree.branch')} hint={hint}>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              list={listId}
              placeholder={t('worktree.placeholder')}
              autoFocus
            />
          </Field>
          <datalist id={listId}>
            {info?.branches.map((b) => <option key={b} value={b} />)}
          </datalist>
        </DialogForm>
      )}
      {(error ?? loadError) && <p role="alert">{error ?? loadError}</p>}
    </Dialog>
  );
}
