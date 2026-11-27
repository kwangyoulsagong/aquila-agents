import type { Translate } from '@/shared/i18n';

/** "5 min ago" for a past time (ms). */
export function ago(t: Translate, at: number, now = Date.now()): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return t('noteReview.ago.now');
  if (min < 60) return t('noteReview.ago.min', { n: String(min) });
  const h = Math.floor(min / 60);
  if (h < 24) return t('noteReview.ago.hour', { n: String(h) });
  return t('noteReview.ago.day', { n: String(Math.floor(h / 24)) });
}

/** Marking a note as seen / reverting refreshes the "changed outside" list (in this window). */
const listeners = new Set<() => void>();
export const onSeenChanged = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
export const seenChanged = () => listeners.forEach((cb) => cb());
