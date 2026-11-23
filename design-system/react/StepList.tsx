import type { ReactNode } from 'react';

/** `.c-steps` — an ordered list of steps to tick (a proposal's plan). Children are `StepItem`s. */
export function StepList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol className="c-steps" aria-label={label}>
      {children}
    </ol>
  );
}

interface ItemProps {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  /** The title, or an input that edits it. */
  title: ReactNode;
  /** Accessible name of the checkbox when `title` is an input. */
  checkLabel?: string;
  /** Badges after the title (size, risk). */
  tags?: ReactNode;
  /** Monospace line under the title (files). */
  meta?: ReactNode;
  /** Hover / focus: the caller highlights what the step touches. */
  onHover?: (on: boolean) => void;
}

/** `.c-steps__item` — checkbox · title + tags / files. Unticked steps fade (`[data-off]`). */
export function StepItem({ checked, onToggle, title, checkLabel, tags, meta, onHover }: ItemProps) {
  return (
    <li
      className="c-steps__item"
      data-off={!checked || undefined}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
    >
      <input
        type="checkbox"
        className="c-steps__check"
        checked={checked}
        aria-label={checkLabel}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <div className="c-steps__main">
        <div className="c-steps__title">
          {title}
          {tags}
        </div>
        {meta && <div className="c-steps__meta">{meta}</div>}
      </div>
    </li>
  );
}
