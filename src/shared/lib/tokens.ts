/** 980 · 12.3K · 1.2M · 3.4B */
export function formatTokens(n: number): string {
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, unit] of units) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${unit}`;
    }
  }
  return String(Math.round(n));
}
