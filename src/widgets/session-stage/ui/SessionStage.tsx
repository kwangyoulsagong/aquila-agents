import type { Project, Session, SessionKind } from '@/shared/api';
import { TerminalView } from '@/entities/session';
import { OpenSessionPanel } from '@/features/open-session';

interface Props {
  sessions: Session[];
  project: Project | undefined;
  activeSessionId: string | null;
  onOpen: (kind: SessionKind) => void;
}

/** All terminals stay mounted (scrollback + pty survive); only the active one is visible and painted. */
export default function SessionStage({ sessions, project, activeSessionId, onOpen }: Props) {
  const hasSessions = sessions.some((s) => s.projectId === project?.id);
  return (
    <div className="app__stage">
      {!hasSessions && <OpenSessionPanel project={project} onOpen={onOpen} />}
      {sessions.map((s) => {
        const visible = s.id === activeSessionId && s.projectId === project?.id;
        return (
          <div key={s.id} className="term-host" hidden={!visible}>
            <TerminalView id={s.id} visible={visible} />
          </div>
        );
      })}
    </div>
  );
}
