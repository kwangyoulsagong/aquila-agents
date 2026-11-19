import type { CSSProperties, ReactNode } from 'react';

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
}

interface Props<V extends string> {
  label: string;
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
}

/** `.c-segment` — segmented radio group with a sliding thumb. */
export function Segment<V extends string>({ label, options, value, onChange }: Props<V>) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      className="c-segment"
      role="radiogroup"
      aria-label={label}
      title={label}
      style={{ '--segment-count': options.length, '--segment-index': index } as CSSProperties}
    >
      <span className="c-segment__thumb" aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="c-segment__item"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
