import { Button, Label } from '@design-system/react';
import type { ReactNode } from 'react';
import { api, type Config, type Session } from '@/shared/api';
import { groupLabel, useT } from '@/shared/i18n';
import { AccountBadge, ProjectRow } from '@/entities/project';
import { StatusDot, WaitingTime, mostUrgent } from '@/entities/session';
import type { ManageProjects } from '@/features/manage-projects';

interface Props {
  config: Config;
  sessions: Session[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  /** Project management (menus, drag, "+"); its dialogs are rendered by the page (the palette opens them too). */
  manage: ManageProjects;
  /** Footer slot (language toggle, system meter…). */
  footer?: ReactNode;
}

const MAX_DOTS = 4;

export default function Sidebar({ config, sessions, activeProjectId, onSelect, manage, footer }: Props) {
  const t = useT();

  return (
    <aside className="c-sidebar">
      <div className="c-sidebar__drag" />
      <nav className="c-sidebar__body">
        {config.groups.map((group) => {
          const projects = config.projects.filter((p) => p.group === group.id);
          return (
            <div key={group.id} className="c-sidebar__group" {...manage.groupDrop(group)}>
              <div onContextMenu={(e) => manage.groupMenu(group, e)}>
                <Label>{groupLabel(t, group)}</Label>
              </div>
              {projects.length === 0 && <div className="c-sidebar__empty">{t('groups.empty')}</div>}
              {projects.map((p) => {
                const mine = sessions.filter((s) => s.projectId === p.id);
                // The longest wait in this project.
                const waitingSince = mine
                  .filter((s) => s.status === 'waiting' && s.since !== undefined)
                  .reduce<number | undefined>(
                    (min, s) => Math.min(min ?? Infinity, s.since ?? Infinity),
                    undefined,
                  );
                return (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    current={p.id === activeProjectId}
                    onSelect={onSelect}
                    onContextMenu={(e) => manage.projectMenu(p, e)}
                    {...manage.rowDrag(p)}
                    leading={<StatusDot status={mostUrgent(mine.map((s) => s.status))} />}
                    trailing={
                      <>
                        {waitingSince !== undefined && <WaitingTime since={waitingSince} />}
                        <AccountBadge config={config} account={p.account} />
                        {mine.length > 0 && (
                          <span className="c-row__sessions" aria-label={`${mine.length}`}>
                            {mine.slice(0, MAX_DOTS).map((s) => (
                              <StatusDot
                                key={s.id}
                                status={s.status}
                                estimated={s.estimated}
                                reason={s.reason}
                              />
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
        <Button variant="ghost" onClick={() => api.openConfig()}>
          {t('action.openConfig')}
        </Button>
        {footer}
        <Button
          variant="ghost"
          icon
          onClick={manage.addProject}
          title={t('projects.add')}
          aria-label={t('projects.add')}
        >
          +
        </Button>
      </div>
    </aside>
  );
}
