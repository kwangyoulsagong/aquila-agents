import { useCallback, useState, useSyncExternalStore, type CSSProperties } from 'react';

// Per-viewer convenience only: storage can be missing.
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* fine */
  }
};
const readPx = (key: string): number | null => {
  const n = Number(read(key));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// The panel resized last keeps its width; the other open panels give way first when the window runs out.
const PINNED_KEY = 'aquila.panel.pinned';
// Read on first use, not at import: the first localStorage access is a synchronous trip to the browser process, and
// module evaluation is on the startup path.
let pinned: string | null | undefined;
const listeners = new Set<() => void>();
const setPinned = (key: string | null) => {
  if (getPinned() === key) return;
  pinned = key;
  write(PINNED_KEY, key);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getPinned = (): string | null => (pinned === undefined ? (pinned = read(PINNED_KEY)) : pinned);

/** Spread on the panel element: its width and whether it's the one that keeps its size. */
export interface PanelWidthProps {
  style: CSSProperties | undefined;
  'data-pinned': true | undefined;
}

/**
 * A side panel's dragged width (T49), remembered in localStorage under `key` (re-read when the key changes, e.g. the
 * Changes panel switching to side-by-side). No stored width = the CSS default. Spread `props` on the panel and pass
 * `onChange` / `onReset` to its `ResizeHandle`.
 */
export function usePanelWidth(key: string): {
  props: PanelWidthProps;
  onChange: (px: number) => void;
  onReset: () => void;
} {
  const [state, setState] = useState(() => ({ key, px: readPx(key) }));
  const px = state.key === key ? state.px : readPx(key);
  const pinnedKey = useSyncExternalStore(subscribe, getPinned);
  const onChange = useCallback(
    (v: number) => {
      setState({ key, px: v });
      write(key, String(v));
      setPinned(key);
    },
    [key],
  );
  const onReset = useCallback(() => {
    setState({ key, px: null });
    write(key, null);
    if (getPinned() === key) setPinned(null);
  }, [key]);
  return {
    props: {
      style: px ? ({ '--panel-width': `${px}px` } as CSSProperties) : undefined,
      'data-pinned': px && pinnedKey === key ? true : undefined,
    },
    onChange,
    onReset,
  };
}
