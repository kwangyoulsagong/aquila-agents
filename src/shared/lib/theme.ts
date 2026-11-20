/**
 * Light / dark follows the OS appearance (Electron maps `nativeTheme` to `prefers-color-scheme`).
 * The theme lives on `<html data-theme>`; tokens.css remaps the semantic colors under `light`.
 */
export type Theme = 'light' | 'dark';

type MediaLike = Pick<MediaQueryList, 'matches' | 'addEventListener'>;

const listeners = new Set<(theme: Theme) => void>();
let current: Theme = 'dark';

export const themeOf = (lightQuery: { matches: boolean }): Theme => (lightQuery.matches ? 'light' : 'dark');

export function currentTheme(): Theme {
  return current;
}

/** Calls `fn` after `data-theme` changed (tokens already resolve to the new values). */
export function onThemeChange(fn: (theme: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Sets `data-theme` now and on every OS appearance change. Call once, before the first render. */
export function followSystemTheme(
  root: HTMLElement = document.documentElement,
  query: MediaLike = window.matchMedia('(prefers-color-scheme: light)'),
): void {
  const apply = () => {
    current = themeOf(query);
    root.dataset.theme = current;
    listeners.forEach((fn) => fn(current));
  };
  apply();
  query.addEventListener('change', apply);
}
