import type { MeterTone } from './Meter';

export interface RingProps {
  /** 0–1 (clamped). */
  fraction: number;
  /** Accessible name ("Context"). */
  label: string;
  /** Spoken / shown value ("62%"). */
  valueText: string;
  /** Show `valueText` next to the ring (e.g. only once it matters). */
  showValue?: boolean;
  tone?: MeterTone;
  title?: string;
}

/** `.c-ring` — a tiny circular meter that fits in a tab (context use per session). */
export function Ring({ fraction, label, valueText, showValue, tone = 'default', title }: RingProps) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <span
      className="c-ring"
      data-tone={tone !== 'default' ? tone : undefined}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText}
      title={title}
    >
      <svg className="c-ring__svg" viewBox="0 0 16 16" aria-hidden="true">
        <circle className="c-ring__track" cx="8" cy="8" r="6" />
        <circle className="c-ring__fill" cx="8" cy="8" r="6" pathLength={100} strokeDasharray={`${pct} 100`} />
      </svg>
      {showValue && <span className="c-ring__value">{valueText}</span>}
    </span>
  );
}
