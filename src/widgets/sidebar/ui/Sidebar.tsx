import { Label, Reason } from '@design-system/react';
import { Fragment, type ReactNode } from 'react';
import { REMOTE_GROUP, type Config, type Session } from '@/shared/api';
import { groupLabel, useT } from '@/shared/i18n';
import { isDestructive } from '@/shared/lib/risk';
import { AccountBadge, HostBadge, ProjectRow } from '@/entities/project';
import { StatusDot, WaitingTime, mostUrgent } from '@/entities/session';
import type { ManageProjects } from '@/features/manage-projects';

interface Props {
  config: Config;
  sessions: Session[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  /** Show one session (the waiting reason under a row, T52). */
  onShowSession?: (sessionId: string) => void;
  /** Project management (menus, drag, "+"); its dialogs are rendered by the page (the palette opens them too). */
  manage: ManageProjects;
  /** Footer slot (settings, news, guide). */
  footer?: ReactNode;
  /** Band above the footer (usage gauge). */
  aboveFooter?: ReactNode;
  /** Right end of the top band, next to the traffic lights (empty today). */
  top?: ReactNode;
}

const MAX_DOTS = 4;

/** The session that has waited longest (its `since` is oldest); a waiting session without `since` counts last. */
function longestWaiting(sessions: Session[]): Session | undefined {
  return sessions
    .filter((s) => s.status === 'waiting')
    .reduce<Session | undefined>(
      (best, s) => (!best || (s.since ?? Infinity) < (best.since ?? Infinity) ? s : best),
      undefined,
    );
}

export default function Sidebar({
  config,
  sessions,
  activeProjectId,
  onSelect,
  onShowSession,
  manage,
  footer,
  aboveFooter,
  top,
}: Props) {
  const t = useT();

  return (
    <aside className="c-sidebar" {...manage.folderDrop}>
      <div className="c-sidebar__drag">{top}</div>
      <nav className="c-sidebar__body">
        {config.groups.map((group) => {
          const projects = config.projects.filter((p) => p.group === group.id);
          return (
            <div key={group.id} className="c-sidebar__group" {...manage.groupDrop(group)}>
              <div onContextMenu={(e) => manage.groupMenu(group, e)}>
                <Label>{groupLabel(t, group)}</Label>
              </div>
              {projects.length === 0 && (
                <div className="c-sidebar__empty">
                  {/* Only remote projects go in the Remote group, and they're added, not dragged. */}
                  {t(group.id === REMOTE_GROUP ? 'groups.emptyRemote' : 'groups.empty')}
                </div>
              )}
              {projects.map((p) => {
                const mine = sessions.filter((s) => s.projectId === p.id);
                // The longest wait in this project, and what it waits on (T52).
                const longest = longestWaiting(mine);
                const waitingSince = longest?.since;
                const reason = longest?.detail;
                return (
                  <Fragment key={p.id}>
                    <ProjectRow
                      project={p}
                      current={p.id === activeProjectId}
                      onSelect={onSelect}
                      onContextMenu={(e) => manage.projectMenu(p, e)}
                      {...manage.rowDrag(p)}
                      leading={<StatusDot status={mostUrgent(mine.map((s) => s.status))} />}
                      trailing={
                        <>
                          {waitingSince !== undefined && <WaitingTime since={waitingSince} />}
                          {p.remote ? (
                            <HostBadge host={p.remote.alias} />
                          ) : (
                            <AccountBadge config={config} account={p.account} />
                          )}
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
                    {longest && reason && (
                      <Reason
                        text={reason}
                        risk={isDestructive(reason)}
                        riskLabel={t('attention.risky')}
                        onClick={() => (onShowSession ? onShowSession(longest.id) : onSelect(p.id))}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
          );
        })}
        <button
          type="button"
          className="c-sidebar__add"
          onClick={() => void manage.addProject()}
          aria-haspopup="menu"
        >
          <span aria-hidden="true">+</span> {t('projects.add')}
        </button>
      </nav>
      {aboveFooter}
      <div className="c-sidebar__foot">{footer}</div>
    </aside>
  );
}
