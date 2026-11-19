import { useCallback, useEffect, useState } from 'react';
import { api, type PreviewNav, type PreviewSlot } from '@/shared/api';

export type Device = 'fit' | '390' | '768' | '1440';
export const DEVICES: readonly Device[] = ['fit', '390', '768', '1440'];
export const deviceWidth = (d: Device): number => (d === 'fit' ? 0 : Number(d));

// Per-viewer conveniences only (remembered address, width, layout): storage can be missing.
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

/** A string remembered in localStorage under `key` (re-read when the key changes, e.g. another project). */
export function useStored(key: string, fallback = ''): [string, (v: string) => void] {
  const [state, setState] = useState(() => ({ key, value: read(key) ?? fallback }));
  const value = state.key === key ? state.value : (read(key) ?? fallback);
  const set = useCallback(
    (v: string) => {
      setState({ key, value: v });
      write(key, v || null);
    },
    [key],
  );
  return [value, set];
}

/** Dev server addresses for the project: launch.json + what its terminals printed, live. */
export function useTargets(projectId: string | null): string[] {
  const [targets, setTargets] = useState<{ projectId: string | null; urls: string[] }>({
    projectId,
    urls: [],
  });
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void api.previewTargets(projectId).then((t) => live && setTargets(t));
    const off = api.onPreviewTargets((t) => t.projectId === projectId && setTargets(t));
    return () => {
      live = false;
      off();
    };
  }, [projectId]);
  return targets.projectId === projectId ? targets.urls : [];
}

/** What the native view of a slot is showing (title, loading, last error). */
export function useNav(slot: PreviewSlot): PreviewNav | null {
  const [nav, setNav] = useState<PreviewNav | null>(null);
  useEffect(() => api.onPreviewNav((n) => n.slot === slot && setNav(n)), [slot]);
  return nav;
}

/** True while any native <dialog> is open: the preview is a native view and would cover it. */
export function useDialogOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector('dialog[open]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => mo.disconnect();
  }, []);
  return open;
}

/**
 * Keeps the native view of `slot` over `el`: bounds on every resize, the address, the device width. No address →
 * no view; unmount closes it.
 */
export function useNativeView(
  slot: PreviewSlot,
  el: HTMLElement | null,
  url: string,
  width: number,
  hidden: boolean,
): void {
  useEffect(() => {
    if (!el || !url) {
      api.previewSet(slot, null);
      return;
    }
    const send = () => {
      const r = el.getBoundingClientRect();
      api.previewSet(slot, {
        url,
        width,
        hidden,
        bounds: { x: r.left, y: r.top, width: r.width, height: r.height },
      });
    };
    send();
    // The panel is the rightmost column: it moves only when its own size or the window changes.
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', send);
    };
  }, [slot, el, url, width, hidden]);
  useEffect(() => () => api.previewSet(slot, null), [slot]);
}
