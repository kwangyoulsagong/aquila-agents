import type { HTMLAttributes, ReactNode } from 'react';
import type { Project } from '@/shared/api';

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  project: Project;
  current: boolean;
  onSelect: (projectId: string) => void;
  /** Leading slot (status dot). */
  leading?: ReactNode;
  /** Trailing slot (badges, counts). */
  trailing?: ReactNode;
}

/** Extra props (drag handlers, `data-drop`, onContextMenu) go to the row element. */
export default function ProjectRow({ project, current, onSelect, leading, trailing, ...rest }: Props) {
  return (
    <div
      {...rest}
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
