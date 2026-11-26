import type { ReactNode } from 'react';
import type { GraphSwatch } from './GraphStage';

/** `.c-kweek` — the graph's "This week" list (T74): days, newest first; fills the stage and scrolls. */
export function WeekList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="c-kweek" role="region" aria-label={label}>
      {children}
    </div>
  );
}

/** `.c-kweek__day` — one day's heading ("Today · 12") and its items. */
export function WeekDay({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="c-kweek__day">
      <h3 className="c-kweek__day-title">
        <span>{title}</span>
        <span className="c-kweek__day-count">{count}</span>
      </h3>
      <ul className="c-kweek__list">{children}</ul>
    </section>
  );
}

/**
 * `.c-kweek__item` — one thing that changed: swatch, name, where / what it touched, when. The row opens it;
 * `side` holds a second action (the caller's small button, e.g. "Around").
 */
export function WeekItem({
  kind,
  label,
  detail,
  time,
  live,
  onOpen,
  side,
}: {
  kind: GraphSwatch;
  label: string;
  detail?: string;
  time: string;
  /** Open in a tab now: its status word, shown as a badge. */
  live?: string;
  onOpen: () => void;
  side?: ReactNode;
}) {
  return (
    <li className="c-kweek__item">
      <button type="button" className="c-kweek__main" onClick={onOpen} title={label}>
        <span className="c-kgraph__swatch" data-kind={kind} />
        <span className="c-kweek__text">
          <span className="c-kweek__label">{label}</span>
          {(detail || live) && (
            <span className="c-kweek__detail">
              {live && <span className="c-kweek__live">{live}</span>}
              {detail}
            </span>
          )}
        </span>
        <span className="c-kweek__time">{time}</span>
      </button>
      {side && <span className="c-kweek__side">{side}</span>}
    </li>
  );
}

/**
 * `.c-kweek__burst` — many things changed in one minute (a checkout, a pull), folded into one row; opening it lists
 * them (`children`: `WeekItem`s) under it.
 */
export function WeekBurst({
  label,
  detail,
  time,
  open,
  onToggle,
  children,
}: {
  label: string;
  detail?: string;
  time: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      <li className="c-kweek__item c-kweek__burst">
        <button type="button" className="c-kweek__main" aria-expanded={open} onClick={onToggle}>
          <span className="c-kweek__chevron" aria-hidden>
            ▸
          </span>
          <span className="c-kweek__text">
            <span className="c-kweek__label">{label}</span>
            {detail && <span className="c-kweek__detail">{detail}</span>}
          </span>
          <span className="c-kweek__time">{time}</span>
        </button>
      </li>
      {open && (
        <li className="c-kweek__nest">
          <ul className="c-kweek__list">{children}</ul>
        </li>
      )}
    </>
  );
}
