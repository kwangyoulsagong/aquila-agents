import { useMemo, useRef } from 'react';
import { Button, ChangeRow } from '@design-system/react';
import type { Project, Session } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { DiffView, parseDiff } from '@/entities/diff';
import { useChanges } from '../model/useChanges';

interface Props {
  project: Project | undefined;
  /** Focused session: when it runs in a worktree of this project, the panel shows that worktree. */
  session?: Session;
  onClose: () => void;
}

/** Right panel: branch, changed files and the unified diff of the selected project (⌘⇧G). */
export default function ChangesPanel({ project, session, onClose }: Props) {
  const t = useT();
  const worktree = session?.projectId === project?.id ? session?.worktree : undefined;
  const { changes, error, refresh } = useChanges(project?.id ?? null, worktree && session?.id);
  const files = useMemo(() => parseDiff(changes?.diff ?? ''), [changes?.diff]);
  const body = useRef<HTMLDivElement>(null);

  const scrollTo = (path: string) => {
    const el = body.current?.querySelector(`[data-path="${CSS.escape(path)}"]`);
    el?.scrollIntoView({ block: 'start' });
  };

  const branch = changes?.isRepo
    ? [changes.branch, changes.ahead ? `↑${changes.ahead}` : '', changes.behind ? `↓${changes.behind}` : '']
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <aside className="c-panel" aria-label={t('changes.title')}>
      <div className="c-panel__head">
        <span>{t('changes.title')}</span>
        {branch && (
          <span className="c-row__meta" title={worktree?.path ?? project?.path}>
            {branch}
          </span>
        )}
        {changes?.isRepo && changes.files.length > 0 && (
          <span className="c-row__meta">{t('changes.files', { count: String(changes.files.length) })}</span>
        )}
        <div className="c-panel__actions">
          <Button
            variant="ghost"
            icon
            onClick={refresh}
            title={t('changes.refresh')}
            aria-label={t('changes.refresh')}
          >
            ↻
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
      <div className="c-panel__body" ref={body}>
        {error && <div className="c-panel__note">{error}</div>}
        {changes && !changes.isRepo && <div className="c-panel__note">{t('changes.notRepo')}</div>}
        {changes?.isRepo && changes.files.length === 0 && (
          <div className="c-panel__note">{t('changes.none')}</div>
        )}
        {changes?.isRepo && changes.files.length > 0 && (
          <>
            <div className="c-panel__section">
              {changes.files.map((f) => (
                <ChangeRow key={f.path} status={f.status} path={f.path} onClick={() => scrollTo(f.path)} />
              ))}
            </div>
            <DiffView files={files} />
            {changes.truncated && <div className="c-panel__note">{t('changes.truncated')}</div>}
          </>
        )}
      </div>
    </aside>
  );
}
