import type { ReactNode } from 'react';
import { api, type Config, type Session } from '@/shared/api';
import { groupLabel, useT } from '@/shared/i18n';
import { AccountBadge, ProjectRow } from '@/entities/project';
import { StatusDot, mostUrgent } from '@/entities/session';

interface Props {
  config: Config;
  sessions: Session[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  /** Footer slot (language toggle, system meter…). */
  footer?: ReactNode;
}

const MAX_DOTS = 4;

export default function Sidebar({ config, sessions, activeProjectId, onSelect, footer }: Props) {
  const t = useT();
  return (
    <aside className="c-sidebar">
      <div className="c-sidebar__drag" />
      <nav className="c-sidebar__body">
        {config.groups.map((group) => {
          const projects = config.projects.filter((p) => p.group === group.id);
          if (projects.length === 0) return null;
          return (
            <div key={group.id} className="c-sidebar__group">
              <div className="c-label">{groupLabel(t, group)}</div>
              {projects.map((p) => {
                const mine = sessions.filter((s) => s.projectId === p.id);
                return (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    current={p.id === activeProjectId}
                    onSelect={onSelect}
                    leading={<StatusDot status={mostUrgent(mine.map((s) => s.status))} />}
                    trailing={
                      <>
                        <AccountBadge config={config} account={p.account} />
                        {mine.length > 0 && (
                          <span className="c-row__sessions" aria-label={`${mine.length}`}>
                            {mine.slice(0, MAX_DOTS).map((s) => (
                              <StatusDot key={s.id} status={s.status} />
                            ))}
                            {mine.length > MAX_DOTS && (
                              <span className="c-row__meta">+{mine.length - MAX_DOTS}</span>
                            )}
                          </span>
                        )}
                      </>
                    }
                  />
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="c-sidebar__foot">
        <button className="c-btn c-btn--ghost" onClick={() => api.openConfig()}>
          {t('action.openConfig')}
        </button>
        {footer}
      </div>
    </aside>
  );
}
