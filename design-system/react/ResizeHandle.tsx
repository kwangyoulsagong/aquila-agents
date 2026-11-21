import { useState, type KeyboardEvent, type PointerEvent } from 'react';

interface Props {
  /** New width of the parent in px: live while dragging, and on each arrow key. */
  onChange: (px: number) => void;
  /** Double-click: back to the default width. */
  onReset?: () => void;
  /** Which edge of its (position: relative) parent the handle sits on. `start` = left: dragging left grows. */
  edge?: 'start' | 'end';
  /** Tooltip and accessible name. */
  label: string;
}

const STEP = 16;

/**
 * Limits for the parent, measured when a drag or key press starts: from its current (possibly shrunk) width, down to
 * its CSS `min-width`, up to what its flexible siblings (the flex: 1 column, other shrinkable panels) can give before
 * their own `min-width`.
 */
function measure(parent: HTMLElement): { from: number; min: number; max: number } {
  const from = parent.getBoundingClientRect().width;
  const min = parseFloat(getComputedStyle(parent).minWidth) || 0;
  let room = 0;
  for (const sib of parent.parentElement?.children ?? []) {
    if (sib === parent || !(sib instanceof HTMLElement)) continue;
    const css = getComputedStyle(sib);
    if (css.display === 'none' || !(parseFloat(css.flexGrow) > 0 || parseFloat(css.flexShrink) > 0)) continue;
    room += Math.max(0, sib.getBoundingClientRect().width - (parseFloat(css.minWidth) || 0));
  }
  return { from, min, max: Math.max(min, from + room) };
}

/** `.c-resize` — a draggable edge that sizes its parent panel (pointer, or ←/→ when focused). */
export function ResizeHandle({ onChange, onReset, edge = 'start', label }: Props) {
  const [active, setActive] = useState(false);
  const sign = edge === 'start' ? -1 : 1;
  const clamp = (px: number, m: { min: number; max: number }) =>
    Math.round(Math.min(m.max, Math.max(m.min, px)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const parent = el.parentElement;
    if (e.button !== 0 || !parent) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const m = measure(parent);
    setActive(true);
    const move = (ev: globalThis.PointerEvent) => onChange(clamp(m.from + sign * (ev.clientX - x0), m));
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      setActive(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const parent = e.currentTarget.parentElement;
    if (!dir || !parent) return;
    e.preventDefault();
    e.stopPropagation();
    const m = measure(parent);
    onChange(clamp(m.from + sign * dir * STEP, m));
  };

  return (
    <div
      className="c-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={label}
      data-edge={edge}
      data-active={active || undefined}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  );
}
