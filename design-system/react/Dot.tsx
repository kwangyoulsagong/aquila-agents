export type DotStatus = 'working' | 'waiting' | 'done' | 'error' | 'stopped' | 'idle';

/** `.c-dot` — status dot. Waiting gets a halo, working pulses, stopped is a ring, `estimated` dims it. */
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
