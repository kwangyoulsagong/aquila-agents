/** Whole hours and minutes in `ms`; null under a minute (too short to show). */
export function elapsedParts(ms: number): { h: number; m: number } | null {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return null;
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}
