import { cx } from './cx';

export type MeterTone = 'default' | 'warn' | 'danger';

export interface MeterProps {
  label: string;
  /** Text at the right of the label ("72%", "1.2M"). */
  value: string;
  /** 0–1 (clamped); null = no known limit: an outlined, empty bar. */
  fraction: number | null;
  tone?: MeterTone;
  /** Line under the bar (reset time). */
  caption?: string;
  title?: string;
  className?: string;
}

/** `.c-meter` — a share of a limit: label · value, a thin bar, a caption. */
export function Meter({ label, value, fraction, tone = 'default', caption, title, className }: MeterProps) {
  const pct = fraction === null ? 0 : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div
      className={cx('c-meter', className)}
      data-tone={tone !== 'default' ? tone : undefined}
      data-unknown={fraction === null ? '' : undefined}
      title={title}
    >
      <div className="c-meter__head">
        <span>{label}</span>
        <span className="c-meter__value">{value}</span>
      </div>
      <div
        className="c-meter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : pct}
        aria-valuetext={value}
      >
        <div className="c-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      {caption && <div className="c-meter__caption">{caption}</div>}
    </div>
  );
}
