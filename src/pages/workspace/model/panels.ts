import { useEffect, useRef } from 'react';

/** The right-hand side panels. */
export type PanelId = 'changes' | 'run' | 'preview';

/** How many side panels fit next to the sidebar and the terminal's minimum width (always at least one). */
export function panelsThatFit(
  windowWidth: number,
  sidebar: number,
  stageMin: number,
  panelMin: number,
): number {
  if (panelMin <= 0) return Infinity;
  return Math.max(1, Math.floor((windowWidth - sidebar - stageMin) / panelMin));
}

/**
 * Keeps the open order (oldest first) in step with what's open now: closed panels drop out, newly opened ones go
 * to the end in the order given.
 */
export function nextOrder(order: PanelId[], open: PanelId[]): PanelId[] {
  return [...order.filter((p) => open.includes(p)), ...open.filter((p) => !order.includes(p))];
}

/** The oldest panels to close so the rest fit; the newest is always kept. */
export function panelsToClose(order: PanelId[], fit: number): PanelId[] {
  return order.slice(0, Math.max(0, order.length - Math.max(1, fit)));
}

const px = (name: string) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;

/**
 * A panel that wouldn't fit closes the one opened longest ago instead of running off the window's edge: a 1440 px
 * window holds two, a wider one three. Only when a panel opens — resizing the window never closes anything.
 * `open` is what the user opened (sets the order); `shown` is what is on screen now (full window, remote projects
 * hide some), and only those count.
 */
export function usePanelFit(
  open: Record<PanelId, boolean>,
  shown: Record<PanelId, boolean>,
  close: (p: PanelId) => void,
): void {
  const order = useRef<PanelId[]>([]);
  const ids = (Object.keys(open) as PanelId[]).filter((p) => open[p]);
  const key = ids.join(',');
  useEffect(() => {
    const opened = ids.some((p) => !order.current.includes(p));
    order.current = nextOrder(order.current, ids);
    if (!opened) return;
    const fit = panelsThatFit(
      window.innerWidth,
      px('--size-sidebar'),
      px('--size-stage-min'),
      px('--size-panel-min'),
    );
    for (const p of panelsToClose(
      order.current.filter((x) => shown[x]),
      fit,
    ))
      close(p);
    // Runs only when what's open changes (`key`); `ids` and `shown` are read fresh, `close` only wraps setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
