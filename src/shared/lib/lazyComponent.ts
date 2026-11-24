// Components that aren't on screen at launch (dialogs, side panels, modals) load as their own chunks, so the startup
// chunk holds only what the first frame needs: the terminals, the sidebar, the tab bar.
import { createElement, lazy, Suspense, useRef, type ComponentType } from 'react';

const loaders: (() => Promise<unknown>)[] = [];

/**
 * A component loaded on its first render. With `until`, it renders nothing (and loads nothing) until `until(props)`
 * is first true — for modals that are always mounted and opened by a prop; after that it stays mounted, so closing
 * still animates.
 */
export function lazyComponent<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  until?: (props: P) => boolean,
): ComponentType<P> {
  const Loaded = lazy(load);
  loaders.push(load);
  function Lazy(props: P) {
    const seen = useRef(false);
    if (!until || until(props)) seen.current = true;
    if (!seen.current) return null;
    // `lazy` widens the props type; P is what the loaded component takes.
    return createElement(Suspense, { fallback: null }, createElement(Loaded as ComponentType<P>, props));
  }
  return Lazy;
}

/** Loads every lazy component's chunk in the background (after startup), so the first open doesn't wait. */
export function preloadLazyComponents(): void {
  for (const load of loaders) void load().catch(() => undefined);
}
