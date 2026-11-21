import type { ReactNode } from 'react';

/**
 * `.c-queue` — one entry of a sidebar queue (review queue, T58): a leading slot (status dot), a title and a dimmed
 * meta line, both ellipsised. A button: clicking it shows that entry.
 */
export function QueueItem({
  leading,
  title,
  meta,
  tooltip,
  onClick,
}: {
  leading?: ReactNode;
  title: string;
  meta?: string;
  /** Full text on hover (defaults to title + meta). */
  tooltip?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="c-queue"
      title={tooltip ?? [title, meta].filter(Boolean).join('\n')}
      onClick={onClick}
    >
      {leading && <span className="c-queue__lead">{leading}</span>}
      <span className="c-queue__text">
        <span className="c-queue__title">{title}</span>
        {meta && <span className="c-queue__meta">{meta}</span>}
      </span>
    </button>
  );
}
