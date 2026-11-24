import { useEffect } from 'react';
import { api } from '@/shared/api';

/**
 * Keeps extension `id`'s native view over `el` (T71). The extensions panel isn't always the last column, so besides
 * its own size it follows the terminal area (`.app__main`): a panel opening or resizing next to it changes that width.
 * The panel's slide-in is a transform: the bounds are sent again when it ends. Unmount / another id hides the view
 * (main suspends it after a while).
 */
export function useExtensionView(id: string | null, el: HTMLElement | null, hidden: boolean): void {
  useEffect(() => {
    if (!id || !el) return;
    let frame = 0;
    const send = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        api.extensionsShow(id, {
          bounds: { x: r.left, y: r.top, width: r.width, height: r.height },
          hidden,
        });
      });
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    const main = document.querySelector('.app__main');
    if (main) ro.observe(main);
    const panel = el.closest('.c-panel');
    panel?.addEventListener('animationend', send);
    window.addEventListener('resize', send);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      panel?.removeEventListener('animationend', send);
      window.removeEventListener('resize', send);
      api.extensionsShow(id, null);
    };
  }, [id, el, hidden]);
}
