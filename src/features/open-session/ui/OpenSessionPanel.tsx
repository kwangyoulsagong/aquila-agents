import { Button, EmptyState, Kbd } from '@design-system/react';
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
  if (!project) return <EmptyState>{t('empty.pickProject')}</EmptyState>;
  return (
    <EmptyState
      title={project.name}
      path={project.path}
      actions={OPEN_ACTIONS.map((a) => (
        <Button key={a.kind} variant={a.primary ? 'primary' : 'default'} onClick={() => onOpen(a.kind)}>
          {t(a.key)}
          <Kbd>{a.kbd}</Kbd>
        </Button>
      ))}
    />
  );
}
