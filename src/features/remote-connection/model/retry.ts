/** Whole seconds until `retryAt` (never negative); null when there is no scheduled retry. */
export function secondsUntil(retryAt: number | undefined, now: number): number | null {
  return retryAt === undefined ? null : Math.max(0, Math.ceil((retryAt - now) / 1000));
}
