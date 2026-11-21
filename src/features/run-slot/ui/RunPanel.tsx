import { useState } from 'react';
import { Button, Dot, EmptyState, ResizeHandle, RunItem, RunList } from '@design-system/react';
import type { Project, Session } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { usePanelWidth } from '@/shared/lib/usePanelWidth';
import { dotFor, pickRun } from '../model/runView';
import { useRuns } from '../model/useRuns';
import RunLog from './RunLog';

interface Props {
  /** A local project (the workspace doesn't offer runs for remote ones). */
  project: Project;
  /** Focused session: runs follow its worktree (each worktree has its own servers and `PORT`). */
  session?: Session;
  onClose: () => void;
  /** Shows a printed address in the preview panel. */
  onOpenPreview: (url: string) => void;
  onSettings: () => void;
}

// Per-viewer convenience only: storage can be missing.
const readName = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const writeName = (key: string, name: string) => {
  try {
    localStorage.setItem(key, name);
  } catch {
    /* fine */
  }
};

/**
 * Right column (T60): a dev server or test watcher of the project dir / focused worktree, apart from the agent —
 * command picker, Run / Stop, a status dot (running, exited, error), and its log.
 */
export default function RunPanel({ project, session, onClose, onOpenPreview, onSettings }: Props) {
  const t = useT();
  const worktree = session?.projectId === project.id ? session.worktree : undefined;
  const { runs, error, start, stop } = useRuns(project.id, worktree?.path);
  const width = usePanelWidth('aquila.panel.run');
  const nameKey = `aquila.run.name.${project.id}`;
  const [remembered, setRemembered] = useState(() => ({ key: nameKey, name: readName(nameKey) }));
  const name = remembered.key === nameKey ? remembered.name : readName(nameKey);
  const choose = (n: string) => {
    setRemembered({ key: nameKey, name: n });
    writeName(nameKey, n);
  };
  const run = runs ? pickRun(runs, name) : undefined;
  const stateLabel = run ? t(`run.state.${run.state}`) : '';

  return (
    <aside className="c-panel c-run" {...width.props} aria-label={t('run.title')}>
      <ResizeHandle onChange={width.onChange} onReset={width.onReset} label={t('action.resizePanel')} />
      <div className="c-panel__head">
        <span>{t('run.title')}</span>
        {worktree && (
          <span className="c-row__meta" title={worktree.path}>
            {worktree.branch}
          </span>
        )}
        {run?.port && (
          <span className="c-row__meta" data-fixed>
            {t('run.port', { port: String(run.port) })}
          </span>
        )}
        <div className="c-panel__actions">
          <Button variant="ghost" icon onClick={onClose} title={t('action.close')} aria-label={t('action.close')}>
            ×
          </Button>
        </div>
      </div>
      {runs && !run && (
        <EmptyState
          title={t('run.empty')}
          path={t('run.emptyHint')}
          actions={<Button onClick={onSettings}>{t('run.settings')}</Button>}
        />
      )}
      {run && (
        <>
          {runs && runs.length > 1 && (
            <RunList label={t('run.command')}>
              {runs.map((r) => (
                <RunItem
                  key={r.id}
                  name={r.name}
                  status={dotFor(r.state)}
                  state={t(`run.state.${r.state}`)}
                  current={r.id === run.id}
                  title={r.command}
                  onClick={() => choose(r.name)}
                />
              ))}
            </RunList>
          )}
          <div className="c-panel__bar">
            <span className="c-row__meta" title={run.command}>
              {run.command}
            </span>
            <span className="c-run__state">
              <Dot status={dotFor(run.state)} label={stateLabel} />
              {stateLabel}
              {run.state !== 'running' && typeof run.exitCode === 'number' && run.exitCode !== 0 && (
                <> · {t('run.exitCode', { code: String(run.exitCode) })}</>
              )}
            </span>
            <div className="c-panel__bar-end">
              {run.url && run.alive && (
                <Button variant="ghost" onClick={() => onOpenPreview(run.url!)} title={run.url}>
                  {t('run.openPreview')}
                </Button>
              )}
              {run.alive && <Button onClick={() => stop(run.id)}>{t('run.stop')}</Button>}
              <Button variant="primary" onClick={() => start(run.name)}>
                {run.alive ? t('run.restart') : t('run.start')}
              </Button>
            </div>
          </div>
          {(run.reason || error) && (
            <div className="c-panel__note c-run__reason" role="status">
              {error ?? run.reason}
            </div>
          )}
          {run.startedAt ? (
            <RunLog key={`${run.id}@${run.startedAt}`} id={run.id} label={t('run.title')} />
          ) : (
            <div className="c-panel__note">{t('run.noLog')}</div>
          )}
        </>
      )}
    </aside>
  );
}
