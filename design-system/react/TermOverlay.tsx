import type { ComponentPropsWithRef, CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';
import { cx } from './cx';

/** `.c-term-overlay` — layer over a terminal for helpers; lets clicks through except on its controls. */
export function TermOverlay({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div className={cx('c-term-overlay', className)} {...rest} />;
}

/** `.c-term-overlay__jump` — floating "jump to bottom" button in the terminal's bottom-right corner. */
export function TermJump({ className, ...rest }: ButtonProps) {
  return <Button className={cx('c-term-overlay__jump', className)} {...rest} />;
}

/** `.c-term-overlay__note` — short note at the top-right (`bar`: instructions along the bottom). */
export function TermNote({ bar, className, ...rest }: HTMLAttributes<HTMLDivElement> & { bar?: boolean }) {
  return (
    <div
      role="status"
      className={cx('c-term-overlay__note', bar && 'c-term-overlay__note--bar', className)}
      {...rest}
    />
  );
}

/** `.c-term-overlay__banner` — a bar across the top that takes clicks (connection lost + an action). */
export function TermBanner({
  meta,
  action,
  children,
}: {
  /** Secondary text after the message (retry countdown). */
  meta?: ReactNode;
  /** Trailing control (a Button). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="alert" className="c-term-overlay__banner">
      <span className="c-term-overlay__banner-text">
        {children}
        {meta && <span className="c-term-overlay__banner-meta"> · {meta}</span>}
      </span>
      {action}
    </div>
  );
}

/** `.c-term-overlay__chips` — a bar across the top with groups of prompt chips and a close button (T34). */
export function TermChips({
  label,
  closeLabel,
  onClose,
  children,
}: {
  /** What the chips are for, read by screen readers. */
  label: string;
  closeLabel: string;
  onClose: () => void;
  /** `TermChipGroup`s. */
  children: ReactNode;
}) {
  return (
    <div role="toolbar" aria-label={label} className="c-term-overlay__chips">
      {children}
      <Button
        variant="ghost"
        icon
        className="c-term-overlay__chips-close"
        onClick={onClose}
        title={closeLabel}
        aria-label={closeLabel}
      >
        ×
      </Button>
    </div>
  );
}

/** `.c-term-overlay__chips-group` — a labelled group of chips (Buttons) inside `TermChips`. */
export function TermChipGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div role="group" className="c-term-overlay__chips-group">
      <span className="c-term-overlay__chips-label">{label}</span>
      {children}
    </div>
  );
}

interface HintProps {
  /** Box of the tinted match in px, relative to the overlay (one per screen row the match spans). */
  box: { left: number; top: number; width: number; height: number };
  /** Label to type; only on the first box of a match. */
  label?: ReactNode;
  /** The label starts with what has been typed so far (`data-typed`). */
  typed?: boolean;
}

/** `.c-term-hint` — a quick-select match on screen and its label. */
export function TermHint({ box, label, typed }: HintProps) {
  const style: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height };
  return (
    <div className="c-term-hint" style={style}>
      {label !== undefined && (
        <span className="c-term-hint__label" data-typed={typed || undefined}>
          {label}
        </span>
      )}
    </div>
  );
}
