/** `.c-risk` — a warning glyph for a possibly destructive command; `label` is read out and shown on hover. */
export function RiskMark({ label }: { label: string }) {
  return (
    <span className="c-risk" role="img" aria-label={label} title={label}>
      {'⚠︎'}
    </span>
  );
}

/**
 * `.c-reason` — what a waiting session waits on, one ellipsised line. `risk` (with `riskLabel`) colours it and
 * leads with `RiskMark`. A button: clicking it shows that session.
 */
export function Reason({
  text,
  risk,
  riskLabel,
  onClick,
}: {
  text: string;
  risk?: boolean;
  riskLabel?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="c-reason"
      data-risk={risk || undefined}
      title={text}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {risk && riskLabel && <RiskMark label={riskLabel} />}
      <span className="c-reason__text">{text}</span>
    </button>
  );
}
