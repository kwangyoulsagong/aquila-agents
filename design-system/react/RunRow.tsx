import type { ReactNode } from 'react';
import { Dot, type DotStatus } from './Dot';

/** `.c-runs` — the commands of a run slot (T60), one row each, so every run's state shows at once. */
export function RunList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="c-runs" aria-label={label}>
      {children}
    </ul>
  );
}

/** `.c-runs__item` — one command: dot, name, state; `current` = the one the log below shows. */
export function RunItem({
  name,
  status,
  state,
  current,
  title,
  onClick,
}: {
  name: string;
  status: DotStatus;
  /** State in words ("Running"). */
  state: string;
  current: boolean;
  /** The full command. */
  title?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="c-runs__item"
        aria-current={current || undefined}
        title={title}
        onClick={onClick}
      >
        <Dot status={status} />
        <span className="c-runs__name">{name}</span>
        <span className="c-runs__state">{state}</span>
      </button>
    </li>
  );
}
