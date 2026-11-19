import { Button, EmptyState, Kbd } from '@design-system/react';
import type { Project, SessionKind } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { shortcutLabel } from '@/shared/lib/shortcuts';
import { openActions } from '../model/actions';

interface Props {
  project: Project | undefined;
  onOpen: (kind: SessionKind) => void;
}

/** Empty state of a project: what it is, and how to start Claude or Codex. */
export default function OpenSessionPanel({ project, onOpen }: Props) {
  const t = useT();
  if (!project) return <EmptyState>{t('empty.pickProject')}</EmptyState>;
  return (
    <EmptyState
      title={project.name}
      path={project.path}
      actions={openActions(project.defaultAgent).map((a) => (
        <Button key={a.kind} variant={a.primary ? 'primary' : 'default'} onClick={() => onOpen(a.kind)}>
          {t(a.key)}
          <Kbd>{shortcutLabel(a.shortcut)}</Kbd>
        </Button>
      ))}
    />
  );
}
