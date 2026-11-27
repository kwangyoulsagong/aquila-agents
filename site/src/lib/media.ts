import type { Lang } from '../i18n/ui';

/**
 * Guide media shared with the app (`npm run capture` rebuilds it in src/features/guide/media).
 * Every loop (.webm) has a still (.webp) with the same name, used as its poster.
 */
const files = import.meta.glob<string>('../../../src/features/guide/media/*.{webp,webm}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const byName = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  byName.set(path.slice(path.lastIndexOf('/') + 1), url);
}

export interface MediaSrc {
  kind: 'image' | 'video';
  src: string;
  poster: string;
}

export function media(id: string, lang: Lang): MediaSrc {
  const still = byName.get(`${id}.${lang}.webp`);
  if (!still) throw new Error(`No guide media for "${id}" (${lang}). Run npm run capture in the app.`);
  const loop = byName.get(`${id}.${lang}.webm`);
  return loop ? { kind: 'video', src: loop, poster: still } : { kind: 'image', src: still, poster: still };
}
