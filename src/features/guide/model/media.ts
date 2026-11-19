import type { Language } from '@/shared/api';
import type { GuideMedia } from './registry';

/**
 * Captured by `npm run capture` (T24) into `../media/`: `<id>.<lang>.webp` (still, or the loop's poster) and, for
 * items that move, `<id>.<lang>.webm`. File name → bundled URL.
 */
const FILES = import.meta.glob<string>('../media/*.{webm,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** Media of one guide item in one language, from a `file name → URL` map; undefined when it wasn't captured. */
export function mediaFrom(
  files: Readonly<Record<string, string>>,
  id: string,
  lang: Language,
): GuideMedia | undefined {
  const url = (ext: string) => files[`../media/${id}.${lang}.${ext}`];
  const video = url('webm');
  const still = url('webp');
  if (video) return { src: video, kind: 'video', poster: still };
  return still ? { src: still, kind: 'image' } : undefined;
}

export const guideMedia = (id: string, lang: Language) => mediaFrom(FILES, id, lang);
