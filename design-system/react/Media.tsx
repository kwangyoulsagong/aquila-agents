import { useSyncExternalStore, type ReactNode } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribe(cb: () => void): () => void {
  const m = window.matchMedia(REDUCED);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

const reducedMotion = () => window.matchMedia(REDUCED).matches;

interface Props {
  /** Image (PNG/WebP) or video (MP4) URL; none = the placeholder. */
  src?: string;
  kind?: 'image' | 'video';
  /** Still frame of a video: shown under reduced motion and when `still`. */
  poster?: string;
  alt: string;
  /** Show the still frame even with motion allowed (power-saver mode). */
  still?: boolean;
  /** Shown while there is no media. */
  placeholder?: ReactNode;
}

/**
 * `.c-media` — 16:10 frame for a screenshot or a short muted loop. Under `prefers-reduced-motion` (or `still`) a
 * video shows its poster instead of playing.
 */
export function Media({ src, kind = 'image', poster, alt, still, placeholder }: Props) {
  const reduced = useSyncExternalStore(subscribe, reducedMotion);
  let content: ReactNode;
  if (!src) content = <div className="c-media__placeholder">{placeholder}</div>;
  else if (kind === 'video' && !(reduced || still))
    content = (
      <video
        className="c-media__frame"
        src={src}
        poster={poster}
        aria-label={alt}
        autoPlay
        loop
        muted
        playsInline
      />
    );
  else if (kind === 'video' && !poster) content = <div className="c-media__placeholder">{placeholder}</div>;
  else content = <img className="c-media__frame" src={kind === 'video' ? poster : src} alt={alt} />;
  return <div className="c-media">{content}</div>;
}
