import { Label, QueueItem } from '@design-system/react';
import type { Project } from '@/shared/api';
import { sessionTitle, useT } from '@/shared/i18n';
import { StatusDot } from '@/entities/session';
import type { ReviewItem } from '../model/useReviewQueue';

interface Props {
  items: ReviewItem[];
  projects: Project[];
  onShow: (sessionId: string) => void;
}

/** "To review" (T58): finished sessions not looked at yet, oldest first. Renders nothing when empty. */
export default function ReviewQueue({ items, projects, onShow }: Props) {
  const t = useT();
  if (!items.length) return null;
  return (
    <>
      <Label>{t('review.title', { count: String(items.length) })}</Label>
      {items.map(({ id, session, info }) => {
        const project = projects.find((p) => p.id === session.projectId);
        const branch = session.worktree?.branch ?? info?.branch;
        const meta = [
          project?.name,
          // Before the branch: a long branch name would cut the count off.
          info?.files !== undefined ? t('review.files', { count: String(info.files) }) : undefined,
          branch,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <QueueItem
            key={id}
            leading={<StatusDot status="done" />}
            title={sessionTitle(t, session)}
            meta={meta}
            onClick={() => onShow(id)}
          />
        );
      })}
    </>
  );
}
