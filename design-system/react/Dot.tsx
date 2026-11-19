export type DotStatus = 'working' | 'waiting' | 'done' | 'error' | 'idle';

/** `.c-dot` — status dot. Waiting gets a halo, working pulses. */
export function Dot({ status, label }: { status: DotStatus; label?: string }) {
  return <i className="c-dot" data-status={status} aria-label={label} role={label ? 'img' : undefined} />;
}
