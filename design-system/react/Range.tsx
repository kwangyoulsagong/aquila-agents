import type { InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  /** Accessible name (also the tooltip). */
  label: string;
  value: number;
  onChange: (value: number) => void;
}

/** `.c-range` — a native slider (0–100 by default). */
export function Range({ label, value, onChange, min = 0, max = 100, step = 1, ...rest }: Props) {
  return (
    <input
      {...rest}
      type="range"
      className="c-range"
      aria-label={label}
      title={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  );
}
