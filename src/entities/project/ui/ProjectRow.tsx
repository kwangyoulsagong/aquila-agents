import type { ReactNode } from 'react';
import type { Project } from '@/shared/api';

interface Props {
  project: Project;
  current: boolean;
  onSelect: (projectId: string) => void;
  /** Leading slot (status dot). */
  leading?: ReactNode;
  /** Trailing slot (badges, counts). */
  trailing?: ReactNode;
}

export default function ProjectRow({ project, current, onSelect, leading, trailing }: Props) {
  return (
    <div
      className="c-row"
      role="button"
      tabIndex={0}
      aria-current={current}
      onClick={() => onSelect(project.id)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(project.id)}
    >
      {leading}
      <span className="c-row__name">{project.name}</span>
      {trailing}
    </div>
  );
}
