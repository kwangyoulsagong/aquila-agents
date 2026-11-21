// Designer compare (T62): how the app and the Figma frame sit next to each other, and the prompt that hands both
// screenshots to the agent.

export type CompareLayout = 'stacked' | 'side' | 'overlay';
export const COMPARE_LAYOUTS: readonly CompareLayout[] = ['stacked', 'side', 'overlay'];

/** A stored value back to a layout; anything unknown (or nothing) is the old stacked view. */
export const toLayout = (raw: string): CompareLayout =>
  (COMPARE_LAYOUTS as readonly string[]).includes(raw) ? (raw as CompareLayout) : 'stacked';

/** Overlay opacity of the design over the app, 0–100; 50 when unset or garbled. */
export const toOpacity = (raw: string): number => {
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50;
};

/**
 * The text pasted before the two screenshots: which image is which, where they came from, and what to do. The
 * image paths follow as separate pastes (a paste that is only an image path is attached as an image).
 */
export function buildComparePrompt(
  input: { page: string; design: string },
  labels: { intro: string; app: string; design: string; ask: string },
): string {
  return [
    labels.intro,
    `1. ${labels.app}: ${input.page}`,
    `2. ${labels.design}: ${input.design}`,
    labels.ask,
  ].join('\n');
}
