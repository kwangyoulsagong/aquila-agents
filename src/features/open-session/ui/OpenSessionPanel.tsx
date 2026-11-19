import type { Project, SessionKind } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { OPEN_ACTIONS } from '../model/actions';

interface Props {
  project: Project | undefined;
  onOpen: (kind: SessionKind) => void;
}

/** Empty state of a project: what it is, and the three ways to start. */
export default function OpenSessionPanel({ project, onOpen }: Props) {
  const t = useT();
  if (!project) return <div className="c-empty">{t('empty.pickProject')}</div>;
  return (
    <div className="c-empty">
      <div className="c-empty__title">{project.name}</div>
      <div className="c-empty__path">{project.ssh ?? project.path}</div>
      <div className="c-empty__actions">
        {OPEN_ACTIONS.map((a) => (
          <button
            key={a.kind}
            className={`c-btn${a.primary ? ' c-btn--primary' : ''}`}
            onClick={() => onOpen(a.kind)}
          >
            {t(a.key)}
            <span className="c-kbd">{a.kbd}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
