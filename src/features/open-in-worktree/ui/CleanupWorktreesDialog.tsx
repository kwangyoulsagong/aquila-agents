import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Checklist, ChecklistItem, Dialog, Dot } from '@design-system/react';
import { api, type Project, type WorktreeCandidate } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { removable, sortCandidates, suggested } from '../model/cleanup';

interface Props {
  project: Project;
  onClose: () => void;
}

/**
 * "Clean up worktrees": the project's linked worktrees, merged + clean ones suggested. Remove asks once more, then
 * runs `git worktree remove` (never `--force`; the branch is kept).
 */
export default function CleanupWorktreesDialog({ project, onClose }: Props) {
  const t = useT();
  const [list, setList] = useState<WorktreeCandidate[] | null>(null);
  const [confirm, setConfirm] = useState<WorktreeCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .worktreeCandidates(project.id)
        .then((l) => setList(sortCandidates(l)))
        .catch((e: unknown) => setError((e as Error).message)),
    [project.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeWorktree(project.id, confirm.path);
    } catch (e) {
      setError((e as Error).message);
    }
    setConfirm(null);
    setBusy(false);
    void load();
  };

  const status = (c: WorktreeCandidate) =>
    [
      c.merged ? t('worktree.merged') : t('worktree.unmerged'),
      ...(c.clean ? [] : [t('worktree.dirty')]),
      ...(c.open ? [t('worktree.inUse')] : []),
    ].join(' · ');

  return (
    <Dialog
      open
      wide
      title={confirm ? t('worktree.removeTitle', { branch: confirm.branch }) : t('worktree.cleanupTitle')}
      onClose={onClose}
      actions={
        confirm ? (
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void remove()} disabled={busy} autoFocus>
              {t('worktree.removeConfirm')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t('action.close')}
          </Button>
        )
      }
    >
      {confirm ? (
        <p>{t('worktree.removeBody', { path: confirm.path })}</p>
      ) : list && !list.length ? (
        <p>{t('worktree.none')}</p>
      ) : (
        list && (
          <>
            <p>{t('worktree.cleanupHint')}</p>
            <Checklist label={t('worktree.cleanupTitle')}>
              {list.map((c) => (
                <ChecklistItem
                  key={c.path}
                  leading={<Dot status={suggested(c) ? 'done' : 'idle'} />}
                  title={c.branch}
                  tag={suggested(c) ? <Badge>{t('worktree.suggested')}</Badge> : undefined}
                  meta={`${status(c)} · ${c.path}`}
                  actions={
                    <Button
                      variant={suggested(c) ? 'default' : 'ghost'}
                      disabled={!removable(c) || busy}
                      onClick={() => setConfirm(c)}
                    >
                      {t('worktree.remove')}
                    </Button>
                  }
                />
              ))}
            </Checklist>
          </>
        )
      )}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
