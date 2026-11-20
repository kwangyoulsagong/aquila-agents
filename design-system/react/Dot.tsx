export type DotStatus = 'working' | 'waiting' | 'done' | 'error' | 'stopped' | 'idle';

/** `.c-dot` — status dot. Status also has a shape: working pulses, waiting gets a halo, done is a check, error a `!` square, stopped a ring; `estimated` dims it. */
export function Dot({ status, label, estimated }: { status: DotStatus; label?: string; estimated?: boolean }) {
  return (
    <i
      className="c-dot"
      data-status={status}
      data-estimated={estimated || undefined}
      aria-label={label}
      title={label}
      role={label ? 'img' : undefined}
    />
  );
}
